-- Standalone schema for a new deployment. Never changes another app's public tables.
-- Existing legacy CodeAutopsy installations must explicitly migrate their old data.
BEGIN;
SELECT pg_advisory_xact_lock(192837466);
CREATE SCHEMA IF NOT EXISTS codeautopsy;
REVOKE ALL ON SCHEMA codeautopsy FROM PUBLIC;
CREATE TABLE IF NOT EXISTS codeautopsy.submissions (
  id text PRIMARY KEY, problem_id text NOT NULL, source text NOT NULL,
  status text NOT NULL DEFAULT 'queued', result jsonb, error text,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS submissions_created_at_idx ON codeautopsy.submissions (created_at DESC);
CREATE TABLE IF NOT EXISTS codeautopsy.execution_jobs (
  id text PRIMARY KEY, fingerprint text NOT NULL, payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  result jsonb, error text, attempts integer NOT NULL DEFAULT 0,
  lease_token text, lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS execution_jobs_claim_idx ON codeautopsy.execution_jobs (created_at) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS execution_jobs_expiry_idx ON codeautopsy.execution_jobs (lease_until) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS execution_jobs_retention_idx ON codeautopsy.execution_jobs (completed_at) WHERE completed_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS codeautopsy.submission_access (
  submission_id text PRIMARY KEY REFERENCES codeautopsy.submissions(id) ON DELETE CASCADE,
  owner_hash text NOT NULL, address_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS submission_access_address_idx ON codeautopsy.submission_access (address_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS submission_access_created_idx ON codeautopsy.submission_access (created_at DESC);
CREATE TABLE IF NOT EXISTS codeautopsy.sandbox_runs (
  job_id text PRIMARY KEY REFERENCES codeautopsy.submissions(id) ON DELETE CASCADE,
  payload jsonb, state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','starting','running','completed','failed')),
  sandbox_name text NOT NULL UNIQUE, launch_token text, launch_until timestamptz,
  deadline_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), error text
);
CREATE INDEX IF NOT EXISTS sandbox_runs_state_idx ON codeautopsy.sandbox_runs (state, deadline_at);
REVOKE ALL ON ALL TABLES IN SCHEMA codeautopsy FROM PUBLIC;
ALTER TABLE codeautopsy.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE codeautopsy.execution_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE codeautopsy.submission_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE codeautopsy.sandbox_runs ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['submissions', 'execution_jobs', 'submission_access', 'sandbox_runs'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'codeautopsy' AND tablename = target AND policyname = 'backend_role') THEN
      EXECUTE format('CREATE POLICY backend_role ON codeautopsy.%I FOR ALL TO %I USING (true) WITH CHECK (true)', target, current_user);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA codeautopsy FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA codeautopsy FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA codeautopsy FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA codeautopsy FROM authenticated;
  END IF;
END $$;
COMMIT;
