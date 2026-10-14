import { NextResponse } from "next/server";
import { getStore } from "@codeautopsy/db";
import { ExecutionCallback } from "@codeautopsy/schemas";

export async function POST(req: Request) {
  const secret = process.env.AUTOPSY_NODE_SECRET;
  if (process.env.NODE_ENV === "production" && !secret)
    return NextResponse.json({ error: "callback authentication is not configured" }, { status: 503 });
  if (secret && req.headers.get("x-autopsy-secret") !== secret)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = ExecutionCallback.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "invalid execution callback", details: parsed.error.flatten() },
      { status: 400 },
    );
  const store = getStore();
  const data = parsed.data;
  if (!(await store.get(data.submissionId)))
    return NextResponse.json({ error: "unknown submission" }, { status: 404 });
  if (data.status === "completed") await store.complete(data.submissionId, data.result);
  else await store.fail(data.submissionId, data.error ?? "execution failed");
  return NextResponse.json({ ok: true });
}
