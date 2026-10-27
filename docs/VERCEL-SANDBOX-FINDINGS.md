# Verified free execution option: Vercel Sandbox

Verified against the existing account on 28 October 2026. The initial provider findings below are historical. The subsequent native integration passed eleven real cloud execution/containment cases on both build and restored 2-GiB VMs, plus an authenticated web deployment submission with persisted output and traces. See [native execution architecture and deployment](VERCEL-NATIVE-EXECUTION.md) for the implemented path and its boundaries.

## Recommendation

Use the existing Vercel account's Hobby Sandbox allowance for an initial deployment, with Supabase retaining the database role. No additional hosting account or payment details were needed for the tests below. No plan was upgraded and no payment method was added.

The deployed integration uses per-submission VMs and native namespace isolation. The legacy Docker HTTP worker remains available as a separate provider.

## Evidence from the actual account

The authenticated Vercel API returned these filtered, non-secret account fields:

```json
{ "slug": "hello-dec4", "plan": "hobby", "status": "active" }
```

The official Sandbox CLI then created a one-vCPU sandbox associated with the existing `codeatopsy` project. It had a 60-second maximum lifetime, denied network access, disabled persistence and was removed on command completion. The JavaScript execution returned:

```json
{ "check": "codeautopsy-free-sandbox", "result": 10 }
```

A second disposable sandbox reported:

```text
x86_64
v24.22.1
Python 3.14.4
gcc: missing
g++: missing
java: missing
docker: missing
```

The final `sandbox list --scope hello-dec4 --project codeatopsy --name-prefix codeautopsy-` command returned no matching sandboxes. Both test resources were removed. Existing project deployments and environment settings were unchanged. No secret files were opened; CLIs used their normal authenticated credential handling.

## Free allowance and limits

The current official Sandbox pricing page lists these Hobby limits:

| Resource                 | Included amount    |
| ------------------------ | ------------------ |
| Active CPU               | 5 hours/month      |
| Provisioned memory       | 420 GB-hours/month |
| Sandbox creations        | 5,000/month        |
| Concurrent sandboxes     | 10                 |
| Maximum session duration | 45 minutes         |

These are separate limits, not a promise of 5,000 complete CodeAutopsy submissions. Compilation, replay instrumentation, reference executions, memory allocation, storage and data transfer consume resources. A 24/7 idle sandbox also consumes provisioned memory allowance; create execution resources on demand and clean them up.

Vercel documents that Hobby Sandbox usage beyond the quotas is not additionally charged; new sandbox creation is paused at the limit. Pro Sandbox billing behaves differently. The account plan was explicitly checked before testing.

Hobby is intended for personal/non-commercial use. A future commercial or larger public service needs a suitable plan and capacity assessment.

## Original integration checklist (now implemented; retained as design context)

1. Add a Vercel Sandbox provider integration; the current `EXECUTION_NODE_URL` dispatch expects a separately hosted HTTP worker.
2. Prepare a repeatable toolchain image or snapshot for C, C++, Java, Python and JavaScript. The default image tested above does not contain all required tools. Vercel documents custom images and elevated Docker support, but neither was established by these two small tests.
3. Preserve per-program time, memory, process, output and trace bounds. Do not substitute unrestricted processes for the current Docker containment just to pass a readiness check.
4. Keep database credentials and orchestration credentials outside untrusted execution environments. Restrict task network access; grant setup-time package access separately if needed.
5. Adapt durable scheduling and result recovery to short-lived execution resources. Test retries, cancellation, quota exhaustion, cleanup and duplicate submissions.
6. Validate the actual Supabase configuration and access policies separately. Provider access does not establish database readiness.
7. Run real accepted, wrong-answer, compilation-error, runtime-error and timeout cases, as well as trace verification, for all supported languages before claiming the integration is complete.

Do not put `vercel.com`, `vercel.com/sandbox` or a disposable test sandbox address into `EXECUTION_NODE_URL`. This provider uses an SDK and controlled sandbox lifecycles; it is not a static replacement URL for the current worker.

## Reproduce the small access test

From the already-authenticated project terminal:

```powershell
pnpm dlx sandbox@latest run --scope hello-dec4 --project codeatopsy --name codeautopsy-free-check --timeout 60s --vcpus 1 --network-policy deny-all --non-persistent --rm -- node -e 'console.log(1+2+3+4)'
```

The expected result is `10`. This proves only provider access and JavaScript execution. It does not migrate or enable the application.

## Official sources

- [Sandbox pricing and Hobby quota behavior](https://vercel.com/docs/sandbox/pricing)
- [Sandbox CLI authentication and lifecycle flags](https://vercel.com/docs/sandbox/cli-reference)
- [Sandbox capabilities, custom images and Docker support](https://vercel.com/sandbox)
- [Vercel's network-isolation and payment-method statement](https://vercel.com/blog/a-sandbox-without-a-network-boundary-is-only-half-a-sandbox)
- [Hobby plan eligibility](https://vercel.com/docs/plans/hobby)

E2B is not the recommendation for this user's current signup: the user encountered a payment requirement despite the public pricing page advertising no-card credits. Oracle also failed the user's available card verification. Their public marketing is not evidence that either provider is accessible on this user's account.
