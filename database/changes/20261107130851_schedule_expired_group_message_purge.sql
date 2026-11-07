
create extension if not exists pg_cron with schema pg_catalog;

create or replace function app_private.purge_expired_chat_messages()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  delete from public.chat_messages
  where expires_at is not null and expires_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function app_private.purge_expired_chat_messages() from public, anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in select jobid from cron.job where jobname='purge-expired-chat-messages'
  loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule(
    'purge-expired-chat-messages',
    '*/5 * * * *',
    'select app_private.purge_expired_chat_messages();'
  );
end $$;
