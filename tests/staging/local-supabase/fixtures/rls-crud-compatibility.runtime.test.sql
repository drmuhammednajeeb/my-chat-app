-- TEST ONLY: rollback-only CRUD/RPC compatibility after the least-privilege overlay.
-- Requires the synthetic active direct-chat identities and the completed RLS overlay.
-- All inserted rows and the direct conversation are rolled back.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222201',true);

DO $crud_compatibility$
DECLARE
  v_user_a uuid := '22222222-2222-4222-8222-222222222201';
  v_user_b uuid := '22222222-2222-4222-8222-222222222202';
  v_conversation uuid;
  v_message uuid;
  v_list uuid;
  v_count integer;
  v_rejected boolean;
BEGIN
  -- Real RPC path: create/reuse a direct conversation for two eligible synthetic users.
  v_conversation := public.get_or_create_direct_conversation(v_user_b);
  IF v_conversation IS NULL THEN
    RAISE EXCEPTION 'Direct conversation RPC returned NULL';
  END IF;

  -- Real message INSERT path, including SECURITY DEFINER triggers.
  INSERT INTO public.chat_messages(conversation_id,sender_id,content)
  VALUES(v_conversation,v_user_a,'RLS runtime CRUD probe')
  RETURNING id INTO v_message;

  -- Chat list create/read/update/delete path.
  INSERT INTO public.chat_lists(user_id,name)
  VALUES(v_user_a,'RLS Runtime Probe')
  RETURNING id INTO v_list;

  IF NOT EXISTS (
    SELECT 1 FROM public.chat_lists WHERE id=v_list AND user_id=v_user_a
  ) THEN
    RAISE EXCEPTION 'Owner cannot read own chat list after overlay';
  END IF;

  UPDATE public.chat_lists SET name='RLS Runtime Probe Updated'
  WHERE id=v_list AND user_id=v_user_a;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Owner cannot update own chat list after overlay';
  END IF;

  -- The UI uses ON CONFLICT upsert for chat_list_items; UPDATE privilege is required.
  INSERT INTO public.chat_list_items(user_id,list_id,conversation_id)
  VALUES(v_user_a,v_list,v_conversation)
  ON CONFLICT(user_id,list_id,conversation_id)
  DO UPDATE SET created_at=EXCLUDED.created_at;
  INSERT INTO public.chat_list_items(user_id,list_id,conversation_id)
  VALUES(v_user_a,v_list,v_conversation)
  ON CONFLICT(user_id,list_id,conversation_id)
  DO UPDATE SET created_at=EXCLUDED.created_at;

  -- The UI uses ON CONFLICT upsert for user_message_stars; UPDATE must remain granted.
  INSERT INTO public.user_message_stars(user_id,conversation_id,message_id)
  VALUES(v_user_a,v_conversation,v_message)
  ON CONFLICT(user_id,message_id)
  DO UPDATE SET created_at=EXCLUDED.created_at;
  INSERT INTO public.user_message_stars(user_id,conversation_id,message_id)
  VALUES(v_user_a,v_conversation,v_message)
  ON CONFLICT(user_id,message_id)
  DO UPDATE SET created_at=EXCLUDED.created_at;

  -- The invoker RPC must still append its policy-gated audit row and update the message.
  PERFORM public.edit_message_secure(v_message,'RLS runtime CRUD probe edited',0);
  IF NOT EXISTS (
    SELECT 1 FROM public.message_edit_history
    WHERE message_id=v_message AND editor_id=v_user_a AND revision_number=1
  ) THEN
    RAISE EXCEPTION 'edit_message_secure did not persist its audit row';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_messages
    WHERE id=v_message AND content='RLS runtime CRUD probe edited' AND edit_revision=1
  ) THEN
    RAISE EXCEPTION 'edit_message_secure did not update the message';
  END IF;

  -- The same audit table must reject direct INSERT without the secure-edit guard.
  v_rejected := false;
  BEGIN
    INSERT INTO public.message_edit_history(
      message_id,editor_id,old_content,new_content,revision_number,edited_at
    ) VALUES(
      v_message,v_user_a,'forged old','forged new',99,now()
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Direct message_edit_history INSERT bypassed the secure-edit guard';
  END IF;

  -- A second active member must not read or mutate the first user's private chat list.
  PERFORM set_config('request.jwt.claim.sub',v_user_b::text,true);
  IF EXISTS (SELECT 1 FROM public.chat_lists WHERE id=v_list) THEN
    RAISE EXCEPTION 'Cross-user chat list read was not isolated';
  END IF;
  UPDATE public.chat_lists SET name='cross-user mutation' WHERE id=v_list;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Cross-user chat list update was not isolated';
  END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO public.chat_lists(user_id,name)
    VALUES(v_user_a,'cross-user insert attempt');
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Cross-user chat list INSERT was accepted';
  END IF;

  -- A conversation member may read the message, but not another author's edit history.
  IF EXISTS (
    SELECT 1 FROM public.message_edit_history WHERE message_id=v_message
  ) THEN
    RAISE EXCEPTION 'Non-author can read another member edit history';
  END IF;

  -- Return to the owner and verify normal DELETE paths still work.
  PERFORM set_config('request.jwt.claim.sub',v_user_a::text,true);
  DELETE FROM public.chat_list_items
  WHERE user_id=v_user_a AND list_id=v_list AND conversation_id=v_conversation;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Owner cannot delete own chat list item after overlay';
  END IF;

  DELETE FROM public.user_message_stars
  WHERE user_id=v_user_a AND message_id=v_message;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Owner cannot remove own starred message after overlay';
  END IF;

  DELETE FROM public.chat_lists WHERE id=v_list;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Owner cannot delete own chat list after overlay';
  END IF;
END
$crud_compatibility$;

RESET ROLE;
ROLLBACK;
