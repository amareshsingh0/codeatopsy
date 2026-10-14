"""
CodeAutopsy Python trace runner.

Wraps user code with sys.settrace and emits the same JSONL TraceEvent stream
as the C++/JS probes — no source instrumentation needed.

Usage: python autopsy_runner.py <user_script.py>
Env:   AUTOPSY_TRACE_PATH, AUTOPSY_MAX_EVENTS (default 200000),
       AUTOPSY_TIME_BUDGET_MS (default 4000)
"""
import sys
import os
import json
import time

TARGET = os.path.abspath(sys.argv[1])
TRACE_PATH = os.environ.get("AUTOPSY_TRACE_PATH")
MAX_EVENTS = int(os.environ.get("AUTOPSY_MAX_EVENTS", "200000"))
TIME_BUDGET_MS = float(os.environ.get("AUTOPSY_TIME_BUDGET_MS", "4000"))

_events = 0
_disabled = False
_buf = []
_depth = 0
_start = time.monotonic()
_prev_locals = {}  # frame -> last seen locals dict
_frame_names = {}  # frame -> function name
_last_lines = {}


def _ser(v):
    def bounded(value, seen, depth=0):
        if value is None or type(value) in (bool, int, float):
            return value
        if type(value) is str:
            return value[:200]
        if depth >= 6:
            return "<depth limit>"
        if id(value) in seen:
            return "<circular>"
        seen = seen | {id(value)}
        if type(value) in (list, tuple):
            items = [bounded(x, seen, depth + 1) for x in value[:50]]
            if len(value) > 50:
                items.append("<truncated: %d more items>" % (len(value) - 50))
            return items
        if type(value) is dict:
            fields = {str(k)[:80] if type(k) in (str, int, float, bool) else "<key>": bounded(x, seen, depth + 1)
                      for k, x in list(value.items())[:50]}
            if len(value) > 50:
                fields["$autopsy"] = "<truncated: more fields>"
            return fields
        # Read stored instance fields only. Never invoke properties, __repr__, or user getters.
        try:
            fields = object.__getattribute__(value, "__dict__")
            if type(fields) is dict:
                return bounded(fields, seen, depth + 1)
        except Exception:
            pass
        return "<%s>" % type(value).__name__
    try:
        s = json.dumps(bounded(v, set()))
    except Exception:
        return '"<unprintable>"'
    if s is None:
        return "<unprintable>"
    return s if len(s) <= 8192 else '"<snapshot exceeds 8192 character limit>"'


def _emit(**ev):
    global _events, _disabled
    if _disabled:
        return
    _events += 1
    if _events > MAX_EVENTS:
        _disabled = True
        return
    if _events % 1024 == 0 and (time.monotonic() - _start) * 1000.0 > TIME_BUDGET_MS:
        _disabled = True
        return
    ev.setdefault("f", "")
    ev.setdefault("d", _depth)
    _buf.append(json.dumps(ev, default=str))
    if len(_buf) >= 4096:
        _flush()


def _flush():
    if TRACE_PATH:
        with open(TRACE_PATH, "a", encoding="utf-8") as f:
            f.write("\n".join(_buf) + ("\n" if _buf else ""))
    else:
        sys.stderr.write("\n".join(_buf) + "\n")
    _buf.clear()


def _tracer(frame, event, arg):
    if frame.f_code.co_filename != TARGET:
        return None
    if _disabled:
        return None
    fn = frame.f_code.co_name

    if event == "call":
        global _depth
        _depth += 1
        _frame_names[frame] = fn
        _prev_locals[frame] = {}
        _last_lines[frame] = frame.f_lineno
        _emit(k="call", l=frame.f_lineno, f=fn)
        return _tracer

    if event in ("line", "return"):
        locs = {
            k: _ser(v)
            for k, v in frame.f_locals.items()
            if not k.startswith("__") and not k.startswith(".") and k != "_(dot)"
        }
        prev = _prev_locals.get(frame, {})
        changed_any = False
        for name, val in locs.items():
            pv = prev.get(name, _SENTINEL)
            if pv is _SENTINEL or pv != val:
                changed_any = True
                _emit(k="assign", l=_last_lines.get(frame, frame.f_lineno), f=fn, n=name, v=val)
        if event == "line" and not changed_any:
            _emit(k="line", l=frame.f_lineno, f=fn)
        _prev_locals[frame] = dict(locs)
        _last_lines[frame] = frame.f_lineno
        if event == "line":
            return _tracer

    if event == "return":
        if arg is not None:
            _emit(k="return", l=frame.f_lineno, f=fn, v=_ser(arg))
        else:
            _emit(k="returnvoid", l=frame.f_lineno, f=fn)
        _depth = max(0, _depth - 1)
        _prev_locals.pop(frame, None)
        _frame_names.pop(frame, None)
        _last_lines.pop(frame, None)
        return None

    return _tracer


class _Sentinel:
    pass


_SENTINEL = _Sentinel()


def main():
    with open(TARGET, "r", encoding="utf-8") as f:
        src = f.read()
    code = compile(src, TARGET, "exec")
    globs = {"__name__": "__main__", "__file__": TARGET}
    sys.settrace(_tracer)
    try:
        exec(code, globs)
    finally:
        sys.settrace(None)
        _flush()
        if TRACE_PATH:
            with open(TRACE_PATH, "a", encoding="utf-8") as f:
                f.write('{"_autopsy_truncated": %s}\n' % ("true" if _disabled else "false"))


main()
