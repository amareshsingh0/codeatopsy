import { NextResponse } from "next/server";
import { configurationIssue } from "@/lib/readiness";
import { EXECUTION_NODE_URL } from "@/lib/dispatch";
export const dynamic = "force-dynamic";
export async function GET() {
  const issue = configurationIssue();
  if (issue)
    return NextResponse.json(
      { ready: false, message: issue },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  try {
    const response = await fetch(`${EXECUTION_NODE_URL}/health`, {
      cache: "no-store",
      headers: process.env.AUTOPSY_NODE_SECRET ? { "x-autopsy-secret": process.env.AUTOPSY_NODE_SECRET } : {},
      signal: AbortSignal.timeout(3000),
    });
    const health = (await response.json()) as { ok?: boolean; sandbox?: string; queue?: string };
    const ready =
      response.ok &&
      health.ok === true &&
      (process.env.NODE_ENV !== "production" || (health.sandbox === "docker" && health.queue === "postgres"));
    return NextResponse.json(
      {
        ready,
        message: ready ? "Execution service ready" : "Execution service is not ready for isolated runs.",
      },
      { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ready: false, message: "Execution service is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
