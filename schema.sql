create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  ls_subscription_id text unique,
  status text not null default 'none',
  renews_at timestamptz,
  ends_at timestamptz,
  variant_id text,
  updated_at timestamptz not null default now()
);

create table if not exists usage_counters (
  user_id uuid primary key references users(id) on delete cascade,
  daily_count int not null default 0,
  monthly_count int not null default 0,
  daily_reset_at date not null default current_date,
  monthly_reset_at date not null default date_trunc('month', now())
);
