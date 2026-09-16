BEGIN;

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_memberships (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  principal_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','admin','editor','analyst','viewer','node')),
  PRIMARY KEY (project_id, principal_id)
);

CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  bytes bigint NOT NULL CHECK (bytes >= 0),
  checksum_sha256 text,
  metadata jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_project_created_idx ON assets(project_id, created_at, id);

CREATE TABLE IF NOT EXISTS queue_jobs (
  id text PRIMARY KEY,
  queue text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('ready','leased','completed','dead-letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS queue_jobs_lease_idx ON queue_jobs(queue, status, available_at, lease_expires_at);

CREATE TABLE IF NOT EXISTS outbox_events (
  id text PRIMARY KEY,
  event jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);
CREATE INDEX IF NOT EXISTS outbox_events_pending_idx ON outbox_events(created_at, id) WHERE delivered_at IS NULL;

COMMIT;
