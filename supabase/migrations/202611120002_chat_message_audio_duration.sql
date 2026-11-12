-- Preserve the measured duration of recorded voice messages so it is available
-- immediately after send and on subsequent conversation loads.
alter table public.chat_messages
  add column if not exists attachment_duration_seconds integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_messages_attachment_duration_nonnegative'
      and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages
      add constraint chat_messages_attachment_duration_nonnegative
      check (
        attachment_duration_seconds is null
        or attachment_duration_seconds between 0 and 86400
      );
  end if;
end
$$;
