# Build once on the execution host:
# docker build -f infra/sandbox.Dockerfile -t codeautopsy-sandbox:local .
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ python3 openjdk-17-jdk-headless \
    && rm -rf /var/lib/apt/lists/*
# node:bookworm already provides the non-root node user with UID/GID 1000.
USER 1000:1000
WORKDIR /work
