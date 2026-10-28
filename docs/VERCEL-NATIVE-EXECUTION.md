# Native Vercel execution

The production application uses Vercel Functions for orchestration, Vercel Sandbox for isolated execution and PostgreSQL for durable state. It needs no static `EXECUTION_NODE_URL` and no software installation on a visitor's computer.

## Production configuration

Use Node.js 24 and enable the project's Vercel OIDC tokens. Configure these values in the **web project's Production environment**, then redeploy:

| Variable                      | Value                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `AUTOPSY_EXECUTION_PROVIDER`  | `vercel`                                                                                                          |
| `AUTOPSY_SANDBOX_SNAPSHOT_ID` | Verified toolchain snapshot ID from the same Vercel project                                                       |
| `DATABASE_URL`                | Backend-only PostgreSQL connection URI; pooled Supabase connection is supported with prepared statements disabled |
| `AUTOPSY_NODE_SECRET`         | At least 32 random characters; used to sign submission ownership cookies                                          |

Do not expose database, signing or Vercel credentials to the browser or execution guest. The SDK authenticates through Vercel OIDC; guests receive only the submitted execution payload. No guest callback secret or database connection is needed.

Run `packages/db/migrations/002_codeautopsy_private.sql` with a backend migration connection. This creates the dedicated `codeautopsy` schema and does not migrate or modify another application's public tables. Existing legacy installations must migrate historical data explicitly. The private schema revokes anonymous/client access and enables row-level security. Never paste connection credentials into tickets, chat or source control.

## Isolation and lifecycle

Each submission gets a separate, non-persistent, network-denied VM with one vCPU, **2 GiB aggregate VM memory**, and a twelve-minute lifetime cap. The memory limit includes the trusted runner and all compile/replay processes; it is not an independent 256 MiB per-process guarantee.

Inside the VM, each stage uses a new mount/PID/network/IPC/UTS namespace. The toolchain filesystem is read-only; only files needed by that stage are copied into its work directory. Execution drops to UID 1000 with no capabilities and no-new-privileges. Other-side reference source, the trusted runner filesystem and host cgroups are not mounted into program stages. Process, file, descriptor, CPU-time, wall-time, output and trace budgets apply. No root-cgroup initialization or delegation changes are used.

The private database stores ownership, admission, launch leases and terminal results. Up to three submissions can start concurrently, with thirty unfinished submissions admitted. Leases recover interrupted web requests; a stable VM name and execution lock prevent duplicate launches. Polling retrieves and persists the result before deleting the VM. A disconnected browser can leave a VM until its lifetime cap; it cannot run indefinitely.

Submission ownership uses a signed, HttpOnly, Secure, SameSite=Lax cookie. Missing or modified ownership returns 404. Completed submission data becomes eligible for pruning after 24 hours; pruning occurs when new submissions arrive, rather than at an exact scheduled deletion time. Saving or sharing permanent run history is not currently supported.

The initial shared free deployment admits at most 50 runs per address hash per hour and 100 runs globally per 24 hours. These application limits do not guarantee provider quota availability. Provider exhaustion produces an actionable failure. This is an initial bounded service, not unlimited free execution or a capacity claim for a large commercial audience.

Original programs determine verdicts; separate instrumented programs produce replay data. C++, Python and JavaScript have tracing, compatible C programs have partial tracing, and Java currently has output/verdicts only. Large replay prefixes and output previews are explicitly marked truncated. Algorithm-specific structure detection remains dependent on captured state.

## Toolchain build and refresh

Build the trusted bundle with `pnpm --filter @codeautopsy/execution-node build:microvm`. Prepare the filesystem only in a disposable cloud build VM with no application credentials:

1. Copy the bundle as `/opt/codeautopsy/job.cjs`, `infra/sandbox.Dockerfile`, `infra/vercel-prepare-worker.sh`, and `infra/vercel-extract-toolchain.sh` (the latter as `/opt/codeautopsy/extract.sh`). Include the Python runner at `/opt/codeautopsy/apps/execution-node/assets/autopsy_python_runner.py` and the instrumenter runtime header at its package-relative path.
2. Run the prepare script with setup-time network access. Docker only exports the public compiler/interpreter filesystem; production execution uses native VM namespaces. Never run submitted programs during setup with unrestricted network access.
3. Deny VM network access. Run `scripts/verify-microvm.mjs` inside the prepared VM and repeat on a restored one-vCPU/2-GiB VM. Validate C, C++, Python, JavaScript and Java, trace presence, incorrect output, compilation/runtime errors, timeout and filesystem/network isolation.
4. Remove fixture/result/started files and temporary build artifacts before snapshotting. Keep the toolchain and trusted assets. Create the snapshot with a finite `--expiration 30d`, stop the build VM, and record the bundle SHA-256 and new snapshot ID.
5. Update the Production snapshot ID and deploy a protected candidate. Verify an actual authenticated submission before promoting the public deployment.

The current verified snapshot is `snap_Nm98cHavATFW96mDxSWEeBzCryJO`; trusted bundle SHA-256 is `761401F682875A62D6C2894341A19454D395CB44D418D87F100B1BCDAC7C22FF`. This refresh includes the validated dependency security patches from 28 October 2026 and passed all eleven native cloud regression cases. Rebuild after execution-source, dependency or runtime-asset changes; deploying only the web application does not update an existing snapshot.

Vercel resets snapshot expiration on use. The finite snapshot can expire after thirty days without a restore, so check readiness and rebuild following a long inactive period. See [Vercel's retention announcement](https://vercel.com/changelog/sandboxes-now-expire-based-on-last-use). Track usage in the hosting dashboard; Hobby quotas pause creation when exhausted, and personal/non-commercial eligibility applies. See [current pricing and limits](https://vercel.com/docs/sandbox/pricing).

## Verification

`pnpm test` covers application behavior and cloud orchestration mocks. `node scripts/test-postgres.mjs` tests shared admission, ownership, launch fencing, stale work, terminal persistence and queue limits against an isolated disposable PostgreSQL database. `scripts/verify-microvm.mjs` must run in the prepared cloud VM, not on a developer's unrestricted host. `AUTOPSY_WEB_URL=https://codeatopsy.vercel.app node scripts/verify-examples.mjs` verifies all twenty public learning examples through the real production API with ownership cookies.

GET `/api/health` checks database/schema and snapshot availability without allocating a VM. It does not replace an actual code execution test. The temporary release database-setup endpoint was removed before public promotion.
