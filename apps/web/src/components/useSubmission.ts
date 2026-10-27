"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Submission, type Submission as SubmissionType } from "@codeautopsy/schemas";

export function useSubmission() {
  const [phase, setPhase] = useState<"editing" | "running" | "done" | "error">("editing");
  const [submission, setSubmission] = useState<SubmissionType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const reset = useCallback(() => {
    controller.current?.abort();
    setSubmission(null);
    setError(null);
    setPhase("editing");
  }, []);

  const stop = useCallback(() => {
    controller.current?.abort();
    setPhase("editing");
    setError("Stopped waiting for this run. The execution worker may still finish the job.");
  }, []);

  const submit = useCallback(async (payload: unknown) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setPhase("running");
    setError(null);
    setSubmission(null);
    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(90000)]),
      });
      const body = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? `Submit failed (${response.status})`);
      const started = Date.now();
      let failures = 0;
      while (!current.signal.aborted) {
        if (Date.now() - started > 15 * 60 * 1000)
          throw new Error(`Still waiting for submission ${body.id}. The execution queue may be busy.`);
        try {
          const res = await fetch(`/api/submissions/${encodeURIComponent(body.id)}`, {
            cache: "no-store",
            signal: AbortSignal.any([current.signal, AbortSignal.timeout(90000)]),
          });
          if (!res.ok) {
            const message = (await res.json()) as { error?: string };
            throw new Error(message.error ?? `Status check failed (${res.status})`);
          }
          const sub = Submission.parse(await res.json());
          if (current.signal.aborted) return;
          failures = 0;
          setSubmission(sub);
          if (sub.status === "completed" || sub.status === "failed") {
            setError(sub.status === "failed" ? (sub.result?.error ?? "Execution failed") : null);
            setPhase(sub.status === "failed" ? "error" : "done");
            return;
          }
        } catch (err) {
          if (current.signal.aborted) return;
          if (++failures >= 10) throw err;
        }
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            current.signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, Math.min(5000, 1200 * Math.max(1, failures)));
          current.signal.addEventListener("abort", done, { once: true });
        });
      }
    } catch (err) {
      if (current.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, []);
  return { phase, submission, error, submit, reset, stop };
}
