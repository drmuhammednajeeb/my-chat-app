begin;
create or replace function app_private.is_conversation_creator(target_conversation uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.conversations c where c.id=target_conversation and c.created_by=(select auth.uid())) $$;
revoke all on function app_private.is_conversation_creator(uuid) from public,anon;
grant execute on function app_private.is_conversation_creator(uuid) to authenticated;
drop policy if exists "Creator adds first member" on public.conversation_members;
create policy "Creator adds first member" on public.conversation_members for insert to authenticated
with check (
 (user_id=(select auth.uid()) and role='owner' and app_private.is_conversation_creator(conversation_id))
 or (role='member' and app_private.can_manage_conversation(conversation_id))
);
commit;