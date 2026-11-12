-- Explicitly deny direct access to private channel invite records.
DROP POLICY IF EXISTS "No direct access to channel invites" ON app_private.channel_invites;
CREATE POLICY "No direct access to channel invites" ON app_private.channel_invites FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON TABLE app_private.channel_invites FROM PUBLIC, anon, authenticated;
