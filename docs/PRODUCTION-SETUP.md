# Existing Vercel production setup

The existing Vercel project `codeatopsy` hosts the frontend/API. It currently needs production execution infrastructure configured. A frontend deployment alone does not enable code execution.

## Required infrastructure

- A persistent Postgres database with pooled TLS connections and backups. Apply `packages/db/migrations/001_execution_jobs.sql` through your database migration runner before starting workers. Use separate least-privilege roles for the web store and worker queue.
- A dedicated execution service reachable over HTTPS, with Docker available and the sandbox image built from `infra/sandbox.Dockerfile`. The worker image and sandbox image are separate. Keep the Docker daemon private; configure the worker to use `AUTOPSY_SANDBOX=docker` and the correct `AUTOPSY_DOCKER_IMAGE`.
- A shared high-entropy authentication secret supplied only through hosting secret settings. Do not paste it in chat, source files or logs.

## Vercel environment variable names

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Web role's pooled Postgres connection |
| `EXECUTION_NODE_URL` | HTTPS execution service base URL |
| `AUTOPSY_NODE_SECRET` | Authenticates web-to-worker requests and callbacks |

## Execution service environment variable names

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Worker role's connection to the shared queue database |
| `AUTOPSY_NODE_SECRET` | Same shared authentication value as Vercel |
| `AUTOPSY_SANDBOX` | `docker` |
| `AUTOPSY_DOCKER_IMAGE` | Built toolchain sandbox image tag |
| `AUTOPSY_HOST` | `0.0.0.0` behind a protected TLS ingress |
| `AUTOPSY_CONCURRENCY` | Start at 1, increase after resource/load validation |
| `AUTOPSY_MAX_JOBS` | Shared pending/running queue capacity, default 100 |
| `AUTOPSY_CALLBACK_URL` | Optional Vercel `/api/internal/execution-callback` URL; polling independently recovers results |

No language-model key is required for deterministic reports. Optional provider narratives must not delay or replace original execution verdicts.

## Release checks

For a self-managed dedicated Linux host, `infra/docker-compose.production.yml` keeps the worker API bound to loopback for a TLS reverse proxy. Create `/var/lib/codeautopsy/work`, set its ownership for the container's runner user, and bind it at the same absolute path in the worker and Docker host. Set `DOCKER_GID` to the socket's group ID. This avoids the common Docker-outside-Docker bind-path mismatch. Build the sandbox image separately before starting the worker. Do not expose the Docker socket or worker port to the public internet; route authenticated HTTPS through the reverse proxy.

Run type checks, full tests, `node scripts/test-postgres.mjs`, production build and HTTP smoke. Test Docker containment on the intended host. After setting hosting environment values, redeploy the existing Vercel project. Confirm `/api/health` returns `ready: true`, then run accepted, wrong-answer, compilation-error, runtime-error and timeout cases online. The health API checks configuration and worker mode; it is not a full database/toolchain proof. Protect public execution with ownership, quotas and admission controls before broad launch.

On this machine the Vercel project is authenticated, but no production environment variables were listed. Fly.io CLI was not authenticated. No secret files were opened. Infrastructure credentials/configuration must be completed by the account owner or an already-authorized hosting integration.
