-- Separate production migration: index message_reactions.user_id.
create index message_reactions_user_id_idx
  on public.message_reactions(user_id);
