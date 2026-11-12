begin;
alter table public.conversation_members drop constraint if exists conversation_members_user_id_fkey;
alter table public.conversation_members add constraint conversation_members_user_id_fkey foreign key(user_id) references public.profiles(id) on delete cascade;
alter table public.conversations drop constraint if exists conversations_created_by_fkey;
alter table public.conversations add constraint conversations_created_by_fkey foreign key(created_by) references public.profiles(id) on delete restrict;
alter table public.chat_messages drop constraint if exists chat_messages_sender_id_fkey;
alter table public.chat_messages add constraint chat_messages_sender_id_fkey foreign key(sender_id) references public.profiles(id) on delete restrict;
commit;