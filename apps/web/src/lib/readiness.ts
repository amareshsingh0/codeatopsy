import "server-only";
import { executionProvider } from "./execution-provider";
export function configurationIssue(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (!process.env.DATABASE_URL && process.env.AUTOPSY_ALLOW_FILE_STORE !== "true")
    return "Online execution is not configured: persistent database required.";
  if (executionProvider() === "vercel") {
    if (!process.env.AUTOPSY_SANDBOX_SNAPSHOT_ID)
      return "Online execution is not configured: isolated toolchain snapshot required.";
    if (!process.env.AUTOPSY_NODE_SECRET || process.env.AUTOPSY_NODE_SECRET.length < 32)
      return "Online execution requires a shared secret of at least 32 characters.";
    return null;
  }
  if (!process.env.EXECUTION_NODE_URL || !process.env.AUTOPSY_NODE_SECRET)
    return "Online execution is not configured: authenticated execution worker required.";
  return null;
}
