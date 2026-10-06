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


def _ser(v):
    try:
        s = json.dumps(v, default=str)
    except Exception:
        try:
            s = json.dumps(repr(v))
        except Exception:
            return "<unprintable>"
    if s is None:
        return "<unprintable>"
    return s[:200]


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
    fn = frame.f_code.co_name

    if event == "call":
        global _depth
        _depth += 1
        _frame_names[frame] = fn
        _prev_locals[frame] = {}
        _emit(k="call", l=frame.f_lineno, f=fn)
        return _tracer

    if event == "line":
        locs = {
            k: v
            for k, v in frame.f_locals.items()
            if not k.startswith("__") and not k.startswith(".") and k != "_(dot)"
        }
        prev = _prev_locals.get(frame, {})
        changed_any = False
        for name, val in locs.items():
            pv = prev.get(name, _SENTINEL)
            if pv is _SENTINEL or pv is not val:
                try:
                    same = pv is not _SENTINEL and _ser(pv) == _ser(val)
                except Exception:
                    same = False
                if same:
                    continue
                changed_any = True
                _emit(k="assign", l=frame.f_lineno, f=fn, n=name, v=_ser(val))
        if not changed_any:
            _emit(k="line", l=frame.f_lineno, f=fn)
        _prev_locals[frame] = dict(locs)
        return _tracer

    if event == "return":
        if arg is not None:
            _emit(k="return", l=frame.f_lineno, f=fn, v=_ser(arg))
        else:
            _emit(k="returnvoid", l=frame.f_lineno, f=fn)
        _depth = max(0, _depth - 1)
        _prev_locals.pop(frame, None)
        _frame_names.pop(frame, None)
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
