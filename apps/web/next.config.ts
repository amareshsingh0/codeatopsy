import type { NextConfig } from "next";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  distDir: process.env.AUTOPSY_NEXT_DIST_DIR ?? ".next",
  outputFileTracingRoot: resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  transpilePackages: ["@codeautopsy/schemas", "@codeautopsy/db", "@codeautopsy/trace-core"],
  outputFileTracingIncludes: {
    "/**": ["../../problems/**/*"],
  },
  outputFileTracingExcludes: {
    "/**": [
      "**/.env*",
      "**/*secret*",
      "**/*.pem",
      "**/*.key",
      "../../.git/**/*",
      "../../.data/**/*",
      "../../.zcode/**/*",
      "../../legacy/**/*",
    ],
  },
};

export default nextConfig;
