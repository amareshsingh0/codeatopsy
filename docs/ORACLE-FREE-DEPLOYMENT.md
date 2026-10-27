# CodeAutopsy: Oracle Always Free execution server

This route requires an accepted card and did not work with the user's cards. For the free provider access tested on the existing Vercel account, see [Vercel Sandbox findings](VERCEL-SANDBOX-FINDINGS.md). Those findings also distinguish the successful provider test from application integration still required.

Researched on 28 October 2026. This is a deployment guide, not evidence that an Oracle server has been provisioned or tested. No infrastructure was created while writing it.

## What runs where

| Component                                        | Platform                                                  | Configuration location                                       |
| ------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------ |
| Website and web API                              | Existing Vercel project `codeatopsy`                      | Project Settings > Environment Variables > Production        |
| Persistent database                              | Your existing Supabase project                            | Supabase project > Connect                                   |
| Execution worker and isolated program containers | Dedicated Oracle Cloud VM                                 | Private file `/etc/codeautopsy/worker.env` on the VM         |
| Public HTTPS address                             | Free DuckDNS hostname pointing to the VM, served by Caddy | DuckDNS dashboard and `/etc/codeautopsy/Caddyfile` on the VM |

The current worker starts a separate Docker container for a program. It requires control of a Docker daemon and matching host/container work-directory paths. Merely selecting a Dockerfile runtime on a hosting platform does not establish that this requirement is supported. Never switch to local unsandboxed execution to make deployment appear successful.

## 1. Check the free-tier conditions before signing up

Open [Oracle Cloud Free Tier](https://www.oracle.com/cloud/free/).

- Oracle requires a supported credit/debit card for identity verification and may place a temporary authorization hold.
- Choose only resources marked **Always Free eligible**. Trial credit is different from an ongoing free allowance.
- The current published A1 allowance for Always Free tenancies is **2 OCPUs and 12 GB RAM total**, not the 4 OCPU / 24 GB figure in older tutorials. Existing resources also count toward your limits.
- The published storage allowance is 200 GB total across eligible boot/block volumes. A 50 GB boot volume is sufficient to start this setup.
- Available capacity is not guaranteed. Oracle may reclaim idle free instances. This is a practical option for an initial deployment, not a guarantee of production uptime or unlimited scaling.

Sources: [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [signup and billing FAQ](https://www.oracle.com/cloud/free/).

## 2. Create the VM

In the [Oracle Cloud console](https://cloud.oracle.com/):

1. Select your home region. Free compute must be provisioned there.
2. Open **Compute > Instances > Create instance**.
3. Name: `codeautopsy-runner`.
4. Image: **Ubuntu 24.04**, using the Arm image compatible with A1.
5. Shape: **VM.Standard.A1.Flex**. Allocate at most **2 OCPUs / 12 GB RAM**, within your remaining free allocation. Confirm eligibility in the console before creating it.
6. Boot volume: **50 GB**, within your remaining eligible storage allowance. Avoid paid image options and extra paid resources.
7. Use a public subnet with an internet gateway and assign a public IPv4 address. If you do not have a VCN, use **Networking > Virtual cloud networks > Start VCN Wizard > Create VCN with Internet Connectivity** first.
8. Generate/download an SSH key pair or supply your public SSH key. Keep the private key on your own computer.
9. Create the instance. Wait for **Running** and copy its public IPv4 address.

If A1 reports out of capacity, try another availability domain in your home region if available, or retry later. A paid shape is not a free substitute. The 1 GB E2 Micro option is not the recommendation for this multi-language worker.

Official walkthrough: [launch a Linux instance](https://docs.oracle.com/en-us/iaas/Content/Compute/tutorials/first-linux-instance/overview.htm).

## 3. Configure network access and connect

In the VM's attached network security group/security list, permit TCP:

| Destination port | Source                                |
| ---------------- | ------------------------------------- |
| 22               | Your own public IP address with `/32` |
| 80               | `0.0.0.0/0`                           |
| 443              | `0.0.0.0/0`                           |

Leave worker port 8787 and the Docker daemon private. The supplied worker Compose file binds 8787 to `127.0.0.1` only. Keep outbound connectivity available for package downloads, database TLS connections, DNS and certificate issuance.

From PowerShell on your computer, replace both placeholders:

```powershell
ssh -i "C:\path\to\your-private-key.key" ubuntu@YOUR_VM_PUBLIC_IP
```

Everything below labelled `bash` runs **inside this SSH session on the Ubuntu VM**, not in Windows PowerShell. The `sudo` password, if requested, is the VM user's password; it is unrelated to the Supabase database password.

## 4. Install Docker Engine and Compose

These commands target a fresh Ubuntu 24.04 VM without an existing Docker installation. For an existing host, use the official instructions to resolve conflicting packages first.

```bash
sudo apt update
sudo apt install -y ca-certificates curl git nano openssl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
```

Source: [Docker's Ubuntu installation instructions](https://docs.docker.com/engine/install/ubuntu/). Docker supports Ubuntu Arm64, but this project's complete A1 build/execution must still pass the target-host checks below.

## 5. Prepare Supabase before starting the worker

Use your existing project; a second database provider is unnecessary.

1. Apply `packages/db/migrations/001_execution_jobs.sql` to the intended database through your migration process. Connecting an integration alone does not create these application tables.
2. Keep `submissions` and `execution_jobs` private from Supabase's browser-facing Data API roles. Configure dedicated web and worker database roles with only the permissions needed for their respective tables; enable RLS on exposed-schema tables with policies appropriate to those backend roles. This is required before publishing real user source code into these tables. The base migration alone does not supply Supabase-specific access policies.
3. For the Vercel web role, use **Connect > Transaction pooler** and copy its PostgreSQL URI.
4. For the long-running worker role on an IPv4-only VM, use **Connect > Session pooler**. A direct connection is also suitable when the VM has connectivity to the direct endpoint. Copy the actual endpoint from Supabase rather than constructing a hostname.
5. Insert the correct database-role password in the URI. Percent-encode reserved characters in the password. Require TLS using your provider's connection instructions, e.g. `sslmode=require` in the URI.

The two roles connect to the **same database**, but their passwords/usernames can differ. A Supabase project URL such as `https://PROJECT.supabase.co`, an API key and a PostgreSQL URI are different values. Only the PostgreSQL URI belongs in `DATABASE_URL`.

Sources: [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase roles](https://supabase.com/docs/guides/database/postgres/roles), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 6. Get the code and build both images

```bash
git clone https://github.com/amareshsingh0/codeatopsy.git "$HOME/codeatopsy"
cd "$HOME/codeatopsy"

sudo docker build -f infra/sandbox.Dockerfile -t codeautopsy-sandbox:local .
```

The worker image is built in the next step after its required Compose interpolation values exist.

If the repository is private, authenticate Git on the VM using a scoped read-only deploy key. Do not put a personal token into the clone URL or share it in chat. If the directory already exists, inspect its changes before updating it; do not overwrite a checkout blindly.

## 7. Save worker values in a private file on Oracle

Oracle Compute does not provide the managed app-service Environment Variables page described for some hosting providers. For this deployment, the location is **a private file on the VM**.

Create it without overwriting any existing file:

```bash
sudo install -m 0700 -d /etc/codeautopsy
sudo touch /etc/codeautopsy/worker.env
sudo chmod 0600 /etc/codeautopsy/worker.env
openssl rand -hex 32
sudo nano /etc/codeautopsy/worker.env
```

Copy the newly generated random value into the secret field below and save the same value privately for Vercel. In `nano`, save with Ctrl+O, Enter, then exit with Ctrl+X.

Enter these lines, replacing the two placeholders:

```dotenv
DATABASE_URL=YOUR_WORKER_ROLE_POSTGRESQL_URI
AUTOPSY_NODE_SECRET=YOUR_GENERATED_SECRET
AUTOPSY_CONCURRENCY=1
AUTOPSY_MAX_JOBS=100
```

Append the host Docker socket group without revealing the private file:

```bash
printf 'DOCKER_GID=%s\n' "$(stat -c '%g' /var/run/docker.sock)" | sudo tee -a /etc/codeautopsy/worker.env >/dev/null
```

The supplied Compose file already sets `NODE_ENV=production`, `AUTOPSY_SANDBOX=docker`, `AUTOPSY_DOCKER_IMAGE=codeautopsy-sandbox:local`, `AUTOPSY_HOST=0.0.0.0` and the matching work-directory path. Do not change the sandbox mode to bypass an error.

Now validate configuration without printing resolved secrets, build and identify the worker image:

```bash
sudo docker compose --env-file /etc/codeautopsy/worker.env -f infra/docker-compose.production.yml config --quiet
sudo docker compose --env-file /etc/codeautopsy/worker.env -f infra/docker-compose.production.yml build execution-node
worker_image=$(sudo docker compose --env-file /etc/codeautopsy/worker.env -f infra/docker-compose.production.yml config --images)
test -n "$worker_image" || exit 1
worker_uid=$(sudo docker run --rm --entrypoint id "$worker_image" -u)
worker_gid=$(sudo docker run --rm --entrypoint id "$worker_image" -g)
sudo install -d -o "$worker_uid" -g "$worker_gid" -m 0755 /var/lib/codeautopsy/work
sudo docker compose --env-file /etc/codeautopsy/worker.env -f infra/docker-compose.production.yml up -d --no-build execution-node
sudo docker compose --env-file /etc/codeautopsy/worker.env -f infra/docker-compose.production.yml ps
```

The actual image UID/GID is used so the worker can create job directories on the host. Mounting `/var/lib/codeautopsy/work` at the same absolute path is necessary because the host Docker daemon resolves job bind mounts.

Keep this file outside Git and inaccessible to ordinary users. Do not run `docker compose config` without `--quiet`, print `docker inspect` environment values, paste the file into chat, or include it in logs.

## 8. Create a free public hostname

1. Sign in at [DuckDNS](https://www.duckdns.org/).
2. Choose an available subdomain, for example `YOUR-AVAILABLE-NAME`.
3. Set its IPv4 address to the Oracle VM's public IPv4 address and save/update it. The example name is not pre-created or reserved for this project.
4. Use that actual hostname in the Caddy configuration below.

For example, if the registered name is `YOUR-AVAILABLE-NAME`, the hostname is `YOUR-AVAILABLE-NAME.duckdns.org`. Update the record if the VM's public IP changes. Keep the DuckDNS token private.

DuckDNS is a free dynamic-DNS service, not a compute host. Source: [DuckDNS FAQ](https://www.duckdns.org/faqs.jsp).

## 9. Enable HTTPS

Create the Caddy file:

```bash
sudo nano /etc/codeautopsy/Caddyfile
```

Use your registered hostname in this configuration:

```caddyfile
YOUR-AVAILABLE-NAME.duckdns.org {
    request_body {
        max_size 8MB
    }
    reverse_proxy 127.0.0.1:8787
}
```

The domain must resolve to this VM before certificate issuance. Allow TCP 80 and 443 through **both** the Oracle network rules and the Ubuntu host firewall. Oracle images can have host-level reject rules even after the cloud ingress rules are added; adding an ingress rule alone does not prove the port is reachable.

On a fresh dedicated VM using the stock iptables firewall, the following narrow rules preserve existing SSH and other rules. The systemd unit reapplies the two HTTP rules after reboot. For a host already managed by UFW, firewalld or another firewall manager, use that manager's persistent 80/443 rules instead of installing this helper.

```bash
sudo tee /usr/local/sbin/codeautopsy-http-firewall >/dev/null <<'EOF'
#!/bin/sh
set -eu
for port in 80 443; do
    /usr/sbin/iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null ||
        /usr/sbin/iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
done
EOF
sudo chmod 0750 /usr/local/sbin/codeautopsy-http-firewall

sudo tee /etc/systemd/system/codeautopsy-http-firewall.service >/dev/null <<'EOF'
[Unit]
Description=Allow CodeAutopsy HTTPS ingress on the dedicated VM
After=network.target
Before=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/codeautopsy-http-firewall
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now codeautopsy-http-firewall.service
```

Start the official Caddy image with persistent certificate/configuration storage and the Linux host network so it can reach loopback port 8787:

```bash
sudo docker run --rm --entrypoint caddy \
  -v /etc/codeautopsy/Caddyfile:/etc/caddy/Caddyfile:ro \
  caddy:2.11.7 validate --config /etc/caddy/Caddyfile --adapter caddyfile

sudo docker run -d --name codeautopsy-proxy --restart unless-stopped \
  --network host \
  -v /etc/codeautopsy/Caddyfile:/etc/caddy/Caddyfile:ro \
  -v codeautopsy-caddy-data:/data \
  -v codeautopsy-caddy-config:/config \
  caddy:2.11.7
```

For the first deployment the proxy container name must be unused. On later deployments, reload the existing Caddy instance rather than starting a duplicate. Retain its data volume to preserve certificates and ACME account state.

Sources: [Caddy automatic HTTPS prerequisites](https://caddyserver.com/docs/automatic-https), [official Caddy image](https://hub.docker.com/_/caddy).

From your own computer, open `https://YOUR-AVAILABLE-NAME.duckdns.org/health`. An unauthenticated `401` from this route is expected: the worker requires the shared secret. A TLS error, connection timeout, Caddy 502 or a database-startup failure is not a ready service.

## 10. Put the final three values in Vercel

Vercel > `codeatopsy` > Settings > Environment Variables > **Production**:

| Name                  | Value                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | Supabase web-role Transaction pooler PostgreSQL URI                                                            |
| `AUTOPSY_NODE_SECRET` | Exactly the value saved in the Oracle worker's private file                                                    |
| `EXECUTION_NODE_URL`  | `https://YOUR-AVAILABLE-NAME.duckdns.org`, using your actual registered hostname, without `/health` or `/jobs` |

Do not prefix any of these names with `NEXT_PUBLIC_`. Redeploy the Vercel project after saving them.

Source: [Vercel environment variables](https://vercel.com/docs/environment-variables).

## 11. Verify the actual deployment

Open `https://codeatopsy.vercel.app/api/health`. The expected result is HTTP 200 with `ready: true`.

Then use the deployed playground to run accepted, wrong-answer, compile-error, runtime-error and timeout cases. Exercise C, C++, Python, JavaScript and Java on this actual VM. Check recorded traces and output, not only the health flag. The A1 CPU is Arm64; successful local/CI tests on another architecture do not establish this target's results.

Reboot the VM once and repeat readiness and execution checks to confirm Docker, proxy, host firewall and work-directory permissions survive a restart. Keep concurrency at 1 until resource tests justify an increase. Apply the ownership, quota and admission requirements in `PRODUCTION-SETUP.md` before broad public execution.

This guide does not establish that the service is production-ready: the infrastructure, Supabase access policies and target-host checks must actually be completed. No Oracle VM, DNS record, certificate or execution URL has been created by writing this document.

## Troubleshooting without exposing secrets

| Symptom                          | Check                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A1 cannot be created             | Free capacity and remaining home-region allocation                                                         |
| SSH fails                        | Correct private key, `ubuntu` user, VM IP, port 22 rule restricted to your current public IP               |
| Worker exits immediately         | Private environment settings, required database tables, backend-role permissions and database connectivity |
| Docker socket permission denied  | `DOCKER_GID` matches `stat -c '%g' /var/run/docker.sock`                                                   |
| Cannot create work directory     | Owner UID/GID derived from the built worker image; matching host/container path                            |
| HTTPS times out                  | DNS record, cloud ingress rules, host firewall, running Caddy container                                    |
| Caddy returns 502                | Worker running and listening on host loopback port 8787                                                    |
| `/health` directly returns 401   | Expected without authentication; the Vercel health route supplies the secret                               |
| Vercel health returns 503        | Missing settings, incorrect worker base URL, mismatched secret, worker startup/database failure            |
| Ready flag passes but code fails | Actual sandbox image, language toolchains, bind mounts, resources and target architecture                  |

Inspect errors privately; redact connection strings and authentication headers before sharing diagnostics. Do not disable isolation, authentication or TLS to make a check pass.
