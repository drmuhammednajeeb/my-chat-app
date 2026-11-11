-- Keep the app's conversation metadata subscription in the Supabase Realtime publication.
-- Realtime delivery remains subject to the table's authenticated RLS policies.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'Required Supabase publication supabase_realtime is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END
$migration$;

-- Create only the authenticated caller's own self-chat. SECURITY DEFINER is
-- limited by an explicit active-membership check and a fixed empty search_path.
CREATE OR REPLACE FUNCTION public.ensure_self_chat()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_conversation_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT app_private.is_active_member() THEN
    RAISE EXCEPTION 'Active membership required';
  END IF;

  INSERT INTO public.conversations (type, title, description, created_by)
  VALUES ('group', 'ملاحظاتي', 'bizmindmakers:self-chat:v1', v_user_id)
  ON CONFLICT (created_by)
    WHERE type = 'group' AND description = 'bizmindmakers:self-chat:v1'
  DO NOTHING
  RETURNING id INTO v_conversation_id;

  IF v_conversation_id IS NULL THEN
    SELECT id INTO v_conversation_id
    FROM public.conversations
    WHERE created_by = v_user_id
      AND type = 'group'
      AND description = 'bizmindmakers:self-chat:v1';
  END IF;

  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Could not initialize personal chat';
  END IF;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES (v_conversation_id, v_user_id, 'owner')
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN v_conversation_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_self_chat() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_self_chat() TO authenticated;
