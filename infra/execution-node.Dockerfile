# Execution node — bundles the worker + toolchains for all supported languages
# (C/C++, Python 3, Node.js, Java 17). Deployable to Render / Fly / Railway.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends \
    nodejs \
    g++ \
    python3 \
    openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m runner

# pnpm for the workspace build
RUN npm install -g pnpm@9

WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages ./packages
COPY apps/execution-node ./apps/execution-node

RUN pnpm install --frozen-lockfile=false --filter @codeautopsy/execution-node... \
    && pnpm --filter @codeautopsy/execution-node build \
    && pnpm prune --prod

ENV AUTOPSY_HOST=0.0.0.0 \
    AUTOPSY_SANDBOX=local \
    AUTOPSY_PYTHON=python3 \
    AUTOPSY_CXX=g++ \
    NODE_ENV=production
EXPOSE 8787

USER runner

CMD ["node", "apps/execution-node/dist/server.js"]
