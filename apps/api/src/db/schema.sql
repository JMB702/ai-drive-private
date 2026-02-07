-- Core schema for AI Drive platform (PostgreSQL)

create table if not exists users (
  id text primary key,
  email text not null unique,
  display_name text not null,
  password_hash text,
  created_at timestamptz not null default now()
);

create table if not exists workspaces (
  id text primary key,
  name text not null,
  created_by text not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id text not null references workspaces(id),
  user_id text not null references users(id),
  role text not null check (role in ('OWNER','ADMIN','EDITOR','VIEWER')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists folders (
  id text primary key,
  workspace_id text not null references workspaces(id),
  parent_id text references folders(id),
  name text not null,
  deleted_at timestamptz,
  created_by text not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists assets (
  id text primary key,
  workspace_id text not null references workspaces(id),
  folder_id text references folders(id),
  name text not null,
  mime_type text not null,
  tags text[] not null default '{}',
  deleted_at timestamptz,
  created_by text not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists asset_versions (
  id text primary key,
  asset_id text not null references assets(id),
  version int not null,
  source text not null check (source in ('UPLOAD','GENERATE','EDIT','TRANSFORM')),
  storage_key text not null,
  checksum text not null,
  metadata jsonb not null default '{}',
  created_by text not null references users(id),
  created_at timestamptz not null default now(),
  unique (asset_id, version)
);

create table if not exists asset_lineage_edges (
  id text primary key,
  workspace_id text not null references workspaces(id),
  from_version_id text not null references asset_versions(id),
  to_version_id text not null references asset_versions(id),
  transform_type text not null,
  created_at timestamptz not null default now()
);

create table if not exists permission_grants (
  id text primary key,
  workspace_id text not null references workspaces(id),
  resource_type text not null check (resource_type in ('WORKSPACE','FOLDER','ASSET')),
  resource_id text not null,
  principal_type text not null check (principal_type in ('USER','WORKSPACE_ROLE')),
  principal_id text not null,
  action text not null,
  effect text not null check (effect in ('ALLOW','DENY'))
);

create table if not exists generation_jobs (
  id text primary key,
  workspace_id text not null references workspaces(id),
  created_by text not null references users(id),
  status text not null check (status in ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELED')),
  request jsonb not null,
  result jsonb,
  error text,
  reserved_credits int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists credit_transactions (
  id text primary key,
  workspace_id text not null references workspaces(id),
  job_id text references generation_jobs(id),
  type text not null check (type in ('RESERVE','FINALIZE','REFUND','TOP_UP','OVERAGE_CHARGE')),
  amount int not null,
  balance_after int not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);

create table if not exists moderation_events (
  id text primary key,
  workspace_id text not null references workspaces(id),
  asset_version_id text not null references asset_versions(id),
  status text not null check (status in ('PENDING','APPROVED','REJECTED','QUARANTINED')),
  reason text not null,
  actor_id text not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists audit_events (
  id text primary key,
  workspace_id text not null references workspaces(id),
  actor_id text not null references users(id),
  action text not null,
  resource_type text not null,
  resource_id text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists share_links (
  id text primary key,
  workspace_id text not null references workspaces(id),
  resource_type text not null check (resource_type in ('FOLDER','ASSET')),
  resource_id text not null,
  token_hash text not null,
  expires_at timestamptz,
  passcode_hash text,
  created_by text not null references users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_assets_workspace on assets(workspace_id);
create index if not exists idx_assets_name on assets using gin (to_tsvector('simple', name));
create index if not exists idx_assets_tags on assets using gin (tags);
create index if not exists idx_generation_jobs_workspace on generation_jobs(workspace_id, created_at desc);
create index if not exists idx_audit_workspace on audit_events(workspace_id, created_at desc);
