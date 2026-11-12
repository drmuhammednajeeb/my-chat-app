alter table public.user_conversation_settings add column if not exists is_favorite boolean not null default false;
