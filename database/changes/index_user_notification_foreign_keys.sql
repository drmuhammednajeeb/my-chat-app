create index if not exists user_notifications_actor_id_idx on public.user_notifications(actor_id);
create index if not exists user_notifications_conversation_id_idx on public.user_notifications(conversation_id);
create index if not exists user_notifications_message_id_idx on public.user_notifications(message_id);
