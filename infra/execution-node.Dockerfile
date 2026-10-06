# Execution node — bundles the worker + its sandboxed toolchain.
# In production the node itself can run this image and use AUTOPSY_SANDBOX=docker
# for per-submission isolation; or run the node bare (trusted) with AUTOPSY_SANDBOX=local.
FROM gcc:13-bookworm AS runtime

RUN useradd -m -u 1000 runner

WORKDIR /app
ENV NODE_VERSION=22
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates xz-utils \
    && curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1 \
    && rm -rf /var/lib/apt/lists/*

# pnpm via corepack
RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/execution-node ./apps/execution-node

RUN pnpm install --frozen-lockfile=false --filter @codeautopsy/execution-node... \
    && pnpm --filter @codeautopsy/execution-node build

ENV AUTOPSY_PORT=8787 \
    AUTOPSY_HOST=0.0.0.0 \
    AUTOPSY_SANDBOX=local
EXPOSE 8787

# drop privileges for the worker itself; each submission additionally gets
# per-run limits through the sandbox implementation
USER runner

CMD ["node", "apps/execution-node/dist/server.js"]
