// trace-runtime.hpp — CodeAutopsy execution trace runtime (header-only, C++11).
//
// The instrumenter injects AUTOPSY_* probes into student code; this header
// (compiled in with `g++ -include trace-runtime.hpp`) records them as JSONL.
//
// Configuration via environment variables (set by the execution runner):
//   AUTOPSY_TRACE_PATH      output file (falls back to stderr)
//   AUTOPSY_MAX_EVENTS      hard cap on emitted events (default 200000)
//   AUTOPSY_TIME_BUDGET_MS  stop emitting after this much wall time (default 4000)
//
// Design constraints:
//   * never crashes or changes program semantics — probes are no-ops if the
//     trace file cannot be opened
//   * every serializer is SFINAE-guarded: probing an unprintable type emits
//     "<unprintable>" instead of failing compilation
//   * flushes every 64 KB and at process exit, so partial traces survive crashes
#ifndef AUTOPSY_RUNTIME_HPP
#define AUTOPSY_RUNTIME_HPP

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <chrono>
#include <sstream>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

namespace autopsy {

inline const char* envOr(const char* key, const char* def) {
  const char* v = std::getenv(key);
  return (v && *v) ? v : def;
}

inline void jsonEscape(const std::string& s, std::string& out) {
  for (size_t i = 0; i < s.size(); i++) {
    unsigned char c = static_cast<unsigned char>(s[i]);
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char b[8];
          std::snprintf(b, sizeof(b), "\\u%04x", c);
          out += b;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
}

// ---- SFINAE streamability check ------------------------------------
template <class T, class = void>
struct is_streamable : std::false_type {};
template <class T>
struct is_streamable<T, decltype(void(std::declval<std::ostream&>() << std::declval<const T&>()))>
    : std::true_type {};

// ---- value serialization --------------------------------------------
template <class T>
inline typename std::enable_if<is_streamable<T>::value && !std::is_same<T, bool>::value &&
                                   !std::is_same<T, char>::value && !std::is_same<T, std::string>::value &&
                                   !std::is_same<T, const char*>::value,
                               std::string>::type
serOne(const T& v) {
  std::ostringstream o;
  o << v;
  return o.str();
}
template <class T>
inline typename std::enable_if<!is_streamable<T>::value, std::string>::type serOne(const T&) {
  return "<unprintable>";
}
inline std::string serOne(const bool& v) { return v ? "true" : "false"; }
inline std::string serOne(const char& v) {
  std::string s = "'";
  s += v;
  s += "'";
  return s;
}
inline std::string serOne(const std::string& v) {
  std::string out = "\"";
  jsonEscape(v, out);
  out += "\"";
  return out;
}
inline std::string serOne(const char* const& v) {
  std::string out = "\"";
  jsonEscape(v ? std::string(v) : std::string("(null)"), out);
  out += "\"";
  return out;
}
template <class T>
inline std::string serOne(const std::vector<T>& v) {
  const size_t cap = 50;
  std::string out = "[";
  for (size_t i = 0; i < v.size() && i < cap; i++) {
    if (i) out += ",";
    out += serOne(v[i]);
  }
  if (v.size() > cap) out += ",...(" + serOne(v.size() - cap) + " more)";
  out += "]";
  return out;
}

// ---- emitter ---------------------------------------------------------
struct Emitter {
  std::FILE* f;
  std::string buf;
  long events;
  long maxEvents;
  long long timeBudgetMs;
  std::chrono::steady_clock::time_point start;
  bool disabled;
  bool truncated;

  Emitter()
      : f(0), buf(), events(0), maxEvents(200000), timeBudgetMs(4000),
        start(std::chrono::steady_clock::now()), disabled(false), truncated(false) {}

  void init() {
    if (f) return;
    const char* path = std::getenv("AUTOPSY_TRACE_PATH");
    if (path && *path) f = std::fopen(path, "w");
    maxEvents = std::atol(envOr("AUTOPSY_MAX_EVENTS", "200000"));
    timeBudgetMs = std::atoll(envOr("AUTOPSY_TIME_BUDGET_MS", "4000"));
    start = std::chrono::steady_clock::now();
  }

  ~Emitter() { finalize(); }

  void rawAppend(const std::string& line) {
    buf += line;
    buf += '\n';
    if (buf.size() >= 65536) flushSome();
  }

  void flushSome() {
    if (!f || buf.empty()) {
      buf.clear();
      return;
    }
    std::fwrite(buf.data(), 1, buf.size(), f);
    buf.clear();
  }

  bool budgetOk() {
    if (disabled) return false;
    if (events >= maxEvents) {
      truncated = true;
      disabled = true;
      return false;
    }
    if ((events & 1023) == 0) {
      double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
      if (ms > static_cast<double>(timeBudgetMs)) {
        truncated = true;
        disabled = true;
        return false;
      }
    }
    return true;
  }

  void finalize() {
    flushSome();
    if (f) {
      std::string t = "{\"_autopsy_truncated\":";
      t += truncated ? "true" : "false";
      t += "}\n";
      std::fwrite(t.data(), 1, t.size(), f);
      std::fclose(f);
      f = 0;
    }
  }
};

inline Emitter& em() {
  static Emitter e;
  return e;
}

inline int& depth() {
  static int d = 0;
  return d;
}

// emits one event line; fields: k(kind) l(line) f(fn) n(name) v(value) c(cond) t(taken) d(depth)
inline void emit(const char* kind, int line, const char* fn, const char* name,
                 const std::string& value, const std::string& cond, int taken) {
  Emitter& e = em();
  e.init();
  if (!e.budgetOk()) return;
  std::string out = "{\"k\":\"";
  out += kind;
  out += "\",\"l\":";
  char nb[24];
  std::snprintf(nb, sizeof(nb), "%d", line);
  out += nb;
  out += ",\"f\":\"";
  jsonEscape(fn ? fn : "", out);
  out += "\",\"d\":";
  std::snprintf(nb, sizeof(nb), "%d", depth());
  out += nb;
  if (name && *name) {
    out += ",\"n\":\"";
    jsonEscape(name, out);
    out += "\"";
  }
  if (!value.empty()) {
    out += ",\"v\":\"";
    jsonEscape(value, out);
    out += "\"";
  }
  if (!cond.empty()) {
    out += ",\"c\":\"";
    jsonEscape(cond, out);
    out += "\"";
  }
  if (taken >= 0) {
    out += ",\"t\":";
    out += taken ? "true" : "false";
  }
  out += "}";
  e.events++;
  e.rawAppend(out);
}

} // namespace autopsy

// ---- public probes (global namespace, called by injected code) --------

inline void AUTOPSY_INIT() { autopsy::em().init(); }

inline void AUTOPSY_CALL(const char* fn, int line) {
  autopsy::depth()++;
  autopsy::emit("call", line, fn, 0, std::string(), std::string(), -1);
}

inline void AUTOPSY_RETURNV(const char* fn, int line) {
  autopsy::emit("returnvoid", line, fn, 0, std::string(), std::string(), -1);
  if (autopsy::depth() > 0) autopsy::depth()--;
}

template <class T>
inline T AUTOPSY_RETURN(const char* fn, int line, const T& v) {
  autopsy::emit("return", line, fn, 0, autopsy::serOne(v), std::string(), -1);
  if (autopsy::depth() > 0) autopsy::depth()--;
  return v;
}

template <class T>
inline void AUTOPSY_ASSIGN(const char* name, int line, const T& v) {
  autopsy::emit("assign", line, 0, name, autopsy::serOne(v), std::string(), -1);
}

template <class T>
inline T& AUTOPSY_ASSIGNV(const char* name, int line, T& v) {
  autopsy::emit("assign", line, 0, name, autopsy::serOne(v), std::string(), -1);
  return v;
}

template <class T>
inline const T& AUTOPSY_ASSIGNV(const char* name, int line, const T& v) {
  autopsy::emit("assign", line, 0, name, autopsy::serOne(v), std::string(), -1);
  return v;
}

inline bool AUTOPSY_BRANCH(const char* cond, int line, bool taken) {
  autopsy::emit("branch", line, 0, 0, std::string(), std::string(cond), taken ? 1 : 0);
  return taken;
}

template <class T>
inline T AUTOPSY_SWITCH(const char* cond, int line, const T& v) {
  autopsy::emit("branch", line, 0, 0, autopsy::serOne(v), std::string(cond), 1);
  return v;
}

#endif // AUTOPSY_RUNTIME_HPP
