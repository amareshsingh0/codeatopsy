"use client";
import { useEffect, useState } from "react";
export function SystemStatus() {
  const [status, setStatus] = useState<{ ready: boolean; message: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const check = async () => {
      try {
        const res = await fetch("/api/health", {
          cache: "no-store",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]),
        });
        const data = await res.json();
        if (!controller.signal.aborted) setStatus(data);
      } catch {
        if (!controller.signal.aborted)
          setStatus({ ready: false, message: "Execution service could not be reached." });
      }
    };
    void check();
    const timer = setInterval(check, 60000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);
  return (
    <div className={`service-status ${status?.ready ? "ready" : ""}`} role="status">
      <span className="status-dot" />
      <span>
        {status ? (status.ready ? "Execution service ready" : status.message) : "Checking execution service…"}
      </span>
    </div>
  );
}
