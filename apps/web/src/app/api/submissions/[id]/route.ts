import { NextResponse } from "next/server";
import { getStore } from "@codeautopsy/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const submission = await getStore().get(id);
  if (!submission) {
    return NextResponse.json({ error: "unknown submission" }, { status: 404 });
  }
  return NextResponse.json(submission);
}
