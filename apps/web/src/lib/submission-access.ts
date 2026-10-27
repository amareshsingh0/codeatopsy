import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { executionProvider } from "./execution-provider";

export const protectedSubmissions = () => executionProvider() === "vercel";
const cookieName = "codeautopsy_session";
function hash(value: string) {
  return createHmac("sha256", process.env.AUTOPSY_NODE_SECRET!).update(value).digest("hex");
}
export function submissionSession(request: Request) {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  let value = raw;
  let valid = false;
  if (raw && /^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(raw)) {
    const [id, signature] = raw.split(".");
    valid = timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(hash("session:" + id), "hex"));
  }
  if (!valid) {
    const id = randomUUID();
    value = id + "." + hash("session:" + id);
  }
  const address = (
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "unknown"
  )
    .split(",")[0]
    .trim()
    .slice(0, 200);
  return {
    ownerHash: hash("owner:" + value),
    addressHash: hash("address:" + address),
    valid,
    cookie: `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
  };
}
