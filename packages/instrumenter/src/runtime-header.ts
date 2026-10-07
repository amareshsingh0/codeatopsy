import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve a bundled asset by walking up from the module directory / cwd.
 * Works from src (tsx), dist (bundled CJS), and any container WORKDIR.
 */
function resolveAsset(relFromModule: string, assetSubPath: string): string {
  const candidates: string[] = [];
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(resolve(here, relFromModule));
  } catch {
    // import.meta unavailable (CJS bundle) — fall through to cwd walk
  }
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    candidates.push(join(dir, assetSubPath));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0] ?? join(process.cwd(), assetSubPath);
}

/** Absolute path to the bundled trace-runtime.hpp */
export const runtimeHeaderPath = resolveAsset(
  join("..", "assets", "trace-runtime.hpp"),
  join("packages", "instrumenter", "assets", "trace-runtime.hpp"),
);

/** The header contents (read eagerly; empty string if unavailable). */
export const defaultRuntimeHeader = (() => {
  try {
    return readFileSync(runtimeHeaderPath, "utf8");
  } catch {
    return "";
  }
})();
