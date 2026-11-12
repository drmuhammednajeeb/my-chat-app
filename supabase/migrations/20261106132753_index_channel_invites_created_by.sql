-- Separate production migration: index channel invite creator.
CREATE INDEX IF NOT EXISTS channel_invites_created_by_idx
  ON app_private.channel_invites(created_by);

