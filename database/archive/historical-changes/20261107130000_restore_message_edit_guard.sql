-- Restore the request-local edit guard immediately after the atomic edit.
-- This prevents a second statement in the same transaction from inheriting the bypass flag.
create or replace function public.edit_message_secure(
  p_message_id uuid,
  p_new_content text,
  p_expected_revision integer
)
returns public.chat_messages
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_message public.chat_messages;
  v_updated public.chat_messages;
  v_conversation_type text;
  v_content text := btrim(coalesce(p_new_content, ''));
  v_next_revision integer;
  v_previous_setting text := current_setting('app.allow_message_edit', true);
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_message_id is null then raise exception 'Message ID is required'; end if;
  if char_length(v_content) < 1 or char_length(v_content) > 5000 then
    raise exception 'Message text must contain between 1 and 5000 characters';
  end if;

  select * into v_message from public.chat_messages where id = p_message_id for update;
  if not found then raise exception 'Message not found'; end if;
  if v_message.sender_id <> v_user_id then raise exception 'You can only edit your own messages'; end if;
  if not app_private.is_conversation_member(v_message.conversation_id) then
    raise exception 'You are not a member of this conversation';
  end if;
  if v_message.deleted_at is not null then raise exception 'Deleted messages cannot be edited'; end if;
  if v_message.attachment_path is not null or v_message.attachment_type is not null then
    raise exception 'Only text-only messages can be edited';
  end if;

  select c.type into v_conversation_type from public.conversations c where c.id = v_message.conversation_id;
  if v_conversation_type not in ('direct', 'group') then
    raise exception 'Editing is available only in direct and group conversations';
  end if;
  if clock_timestamp() > v_message.created_at + interval '15 minutes' then
    raise exception 'The 15-minute edit window has expired';
  end if;
  if p_expected_revision is null or p_expected_revision <> coalesce(v_message.edit_revision, 0) then
    raise exception 'This message changed elsewhere. Refresh it before editing again';
  end if;
  if v_content = v_message.content then return v_message; end if;

  v_next_revision := coalesce(v_message.edit_revision, 0) + 1;
  perform set_config('app.allow_message_edit', 'on', true);

  insert into public.message_edit_history (
    message_id, editor_id, old_content, new_content, revision_number, edited_at
  ) values (
    v_message.id, v_user_id, v_message.content, v_content, v_next_revision, clock_timestamp()
  );

  update public.chat_messages
  set content = v_content, edited_at = clock_timestamp(), edit_revision = v_next_revision
  where id = v_message.id returning * into v_updated;

  perform set_config('app.allow_message_edit', coalesce(v_previous_setting, ''), true);
  return v_updated;
end;
$function$;
revoke all on function public.edit_message_secure(uuid, text, integer) from public, anon;
grant execute on function public.edit_message_secure(uuid, text, integer) to authenticated;
