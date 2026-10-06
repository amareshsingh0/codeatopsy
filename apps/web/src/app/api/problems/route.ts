import { NextResponse } from "next/server";
import { listProblems } from "@/lib/problems";

export async function GET() {
  return NextResponse.json({ problems: listProblems() });
}
