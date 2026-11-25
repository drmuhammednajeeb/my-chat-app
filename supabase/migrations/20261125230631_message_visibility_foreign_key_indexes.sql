-- Supporting indexes for per-user message visibility and conversation pins.
-- Applied to production as migration 20261125230631.

create index if not exists user_hidden_messages_conversation_id_idx
  on public.user_hidden_messages (conversation_id);

create index if not exists user_hidden_messages_message_id_idx
  on public.user_hidden_messages (message_id);

create index if not exists user_conversation_pins_conversation_id_idx
  on public.user_conversation_pins (conversation_id);
