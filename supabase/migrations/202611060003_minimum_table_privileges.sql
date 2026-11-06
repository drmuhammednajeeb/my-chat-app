begin;
revoke all on public.profiles, public.conversations, public.conversation_members, public.chat_messages from authenticated;
grant select,insert,update on public.profiles to authenticated;
grant select,insert,update on public.conversations to authenticated;
grant select,insert,delete on public.conversation_members to authenticated;
grant update(last_read_at) on public.conversation_members to authenticated;
grant select,insert,update on public.chat_messages to authenticated;
commit;