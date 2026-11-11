-- Enforce a fixed 48-hour retention window for every chat message.
-- Applies uniformly to direct conversations, groups, and channels.
-- Existing rows are backfilled from their original created_at timestamp.

begin;

create or replace function app_private.prepare_group_message_expiry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  -- The expiry is immutable relative to message creation, not message edits
  -- or later activity in the conversation.
  new.expires_at := new.created_at + interval '48 hours';
  return new;
end;
$function$;

drop trigger if exists prepare_group_message_expiry on public.chat_messages;

create trigger prepare_group_message_expiry
before insert or update on public.chat_messages
for each row
execute function app_private.prepare_group_message_expiry();

-- Normalize all existing messages, including rows previously missing an expiry
-- or carrying a group-specific disappearing-message duration.
update public.chat_messages
set expires_at = created_at + interval '48 hours'
where expires_at is distinct from (created_at + interval '48 hours');

alter table public.chat_messages
  alter column expires_at set not null;

do $constraint$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.chat_messages'::regclass
      and conname = 'chat_messages_exact_48h_expiry'
  ) then
    alter table public.chat_messages
      add constraint chat_messages_exact_48h_expiry
      check (expires_at = created_at + interval '48 hours');
  end if;
end;
$constraint$;

-- Keep the expiry index available to the scheduled purge worker.
create index if not exists chat_messages_expiry_idx
  on public.chat_messages (expires_at)
  where expires_at is not null;

-- Delete in bounded statements, but continue until every currently expired
-- message has been processed. SKIP LOCKED avoids waiting on concurrent writers.
create or replace function app_private.purge_expired_chat_messages()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_batch_deleted bigint;
  v_total_deleted bigint := 0;
begin
  loop
    with expired_batch as materialized (
      select m.id
      from public.chat_messages as m
      where m.expires_at <= pg_catalog.clock_timestamp()
      order by m.expires_at, m.id
      for update skip locked
      limit 5000
    ),
    deleted_rows as (
      delete from public.chat_messages as m
      using expired_batch as batch
      where m.id = batch.id
      returning 1
    )
    select pg_catalog.count(*)
    into v_batch_deleted
    from deleted_rows;

    v_total_deleted := v_total_deleted + v_batch_deleted;
    exit when v_batch_deleted = 0;
  end loop;

  return v_total_deleted;
end;
$function$;

revoke all on function app_private.purge_expired_chat_messages() from public, anon, authenticated;

-- Replace any older five-minute schedule with a one-minute schedule.
do $schedule$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where command ilike '%app_private.purge_expired_chat_messages%'
       or jobname = 'purge-expired-chat-messages-48h'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'purge-expired-chat-messages-48h',
    '* * * * *',
    'select app_private.purge_expired_chat_messages();'
  );
end;
$schedule$;

commit;
