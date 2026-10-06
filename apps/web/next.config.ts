import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@codeautopsy/schemas",
    "@codeautopsy/db",
    "@codeautopsy/trace-core",
  ],
  outputFileTracingIncludes: {
    "/api/**": ["../../problems/**/*"],
  },
};

export default nextConfig;
