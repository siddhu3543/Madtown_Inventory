-- ADR-02: Supabase compatibility shim for local / CI PostgreSQL.
-- On a real Supabase project every object below already exists, and each
-- statement is guarded so this migration is a no-op there.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;
create schema if not exists extensions;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'users') then
    -- Minimal subset of Supabase's auth.users used by this app.
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique,
      encrypted_password text,
      raw_app_meta_data jsonb default '{}'::jsonb,
      raw_user_meta_data jsonb default '{}'::jsonb,
      created_at timestamptz default now(),
      updated_at timestamptz default now(),
      last_sign_in_at timestamptz
    );
    -- marker so app code knows it runs on the shim
    comment on table auth.users is 'LOCAL SHIM - not Supabase';
    -- local only: lets seed/local-auth code manage test accounts (Supabase uses the Admin API instead)
    grant select, insert, update on auth.users to service_role;
  end if;
end $$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

-- Only (re)define auth.uid() when it does not exist (Supabase ships its own).
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $f$
      create function auth.uid() returns uuid language sql stable as $b$
        select nullif(
          coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                   (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')),
          '')::uuid
      $b$
    $f$;
  end if;
end $$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;
