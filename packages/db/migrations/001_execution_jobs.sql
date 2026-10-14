-- Apply once with the deployment migration runner before starting workers.
-- A dedicated worker role should access execution_jobs only; sandbox processes never receive DATABASE_URL.
CREATE TABLE IF NOT EXISTS submissions (
  id text PRIMARY KEY, problem_id text NOT NULL, source text NOT NULL,
  status text NOT NULL DEFAULT 'queued', result jsonb, error text,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS submissions_created_at_idx ON submissions (created_at DESC);
CREATE TABLE IF NOT EXISTS execution_jobs (
  id text PRIMARY KEY, fingerprint text NOT NULL, payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  result jsonb, error text, attempts integer NOT NULL DEFAULT 0,
  lease_token text, lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS execution_jobs_claim_idx ON execution_jobs (created_at) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS execution_jobs_expiry_idx ON execution_jobs (lease_until) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS execution_jobs_retention_idx ON execution_jobs (completed_at) WHERE completed_at IS NOT NULL;
