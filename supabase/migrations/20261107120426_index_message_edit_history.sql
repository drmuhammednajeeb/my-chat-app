-- Resolve new audit-table performance advisor findings.
create index if not exists message_edit_history_editor_id_idx
  on public.message_edit_history (editor_id);

drop policy if exists "Authors append own edit history during secure edits" on public.message_edit_history;
create policy "Authors append own edit history during secure edits"
  on public.message_edit_history for insert to authenticated
  with check (
    editor_id = (select auth.uid())
    and (select current_setting('app.allow_message_edit', true)) = 'on'
    and exists (
      select 1 from public.chat_messages m
      where m.id = message_id
        and m.sender_id = (select auth.uid())
        and app_private.is_conversation_member(m.conversation_id)
    )
  );
