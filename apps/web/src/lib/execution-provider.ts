import "server-only";

export function executionProvider(): "worker" | "vercel" {
  const configured = process.env.AUTOPSY_EXECUTION_PROVIDER;
  if (configured && configured !== "worker" && configured !== "vercel")
    throw new Error("Unsupported execution provider");
  return configured === "vercel" ? "vercel" : "worker";
}

export class ExecutionUnavailable extends Error {
  constructor(
    message: string,
    readonly retryAfter = 30,
  ) {
    super(message);
    this.name = "ExecutionUnavailable";
  }
}

export function publicExecutionError(error: unknown): string {
  return error instanceof ExecutionUnavailable
    ? error.message
    : "Execution service is temporarily unavailable. Retry shortly.";
}
