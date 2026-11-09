-- TEST ONLY: minimal legacy relation required by two historical table-level hardening statements.
-- This stub is only for disposable local migration rehearsal; it is not production schema.
create table public.messages (
  id uuid primary key
);
