import { NextResponse } from "next/server";
import { getStore } from "@codeautopsy/db";
import { ExecutionResult } from "@codeautopsy/schemas";

/**
 * Callback target for the execution node. Authenticated with the shared
 * AUTOPSY_NODE_SECRET (same secret the node requires from us).
 */
export async function POST(req: Request) {
  const secret = process.env.AUTOPSY_NODE_SECRET;
  if (secret && req.headers.get("x-autopsy-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { submissionId?: string; status?: string; result?: unknown; error?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { submissionId, status, result, error } = body;
  if (!submissionId) {
    return NextResponse.json({ error: "submissionId required" }, { status: 400 });
  }

  const store = getStore();
  if (status === "completed" && result) {
    const parsed = ExecutionResult.safeParse(result);
    if (!parsed.success) {
      await store.fail(submissionId, "execution node returned an invalid result");
      return NextResponse.json({ ok: false }, { status: 422 });
    }
    await store.complete(submissionId, parsed.data);
  } else {
    await store.fail(submissionId, error ?? "execution failed");
  }
  return NextResponse.json({ ok: true });
}
