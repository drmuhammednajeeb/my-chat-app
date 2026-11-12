-- Separate production migration: conversation member delivery receipts realtime.
alter publication supabase_realtime add table public.conversation_members;

alter table public.conversation_members replica identity full;
