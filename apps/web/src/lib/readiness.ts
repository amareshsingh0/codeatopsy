import "server-only";
export function configurationIssue(): string | null {
  if (process.env.NODE_ENV !== "production") return null;
  if (!process.env.DATABASE_URL && process.env.AUTOPSY_ALLOW_FILE_STORE !== "true")
    return "Online execution is not configured: persistent database required.";
  if (!process.env.EXECUTION_NODE_URL || !process.env.AUTOPSY_NODE_SECRET)
    return "Online execution is not configured: authenticated execution worker required.";
  return null;
}
