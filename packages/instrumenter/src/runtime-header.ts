import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the bundled trace-runtime.hpp */
export const runtimeHeaderPath = join(here, "..", "assets", "trace-runtime.hpp");

/** The header contents (read once, cached) — useful for embedding in Docker images. */
export const defaultRuntimeHeader: string = readFileSync(runtimeHeaderPath, "utf8");
