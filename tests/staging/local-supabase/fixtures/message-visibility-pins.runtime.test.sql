-- TEST ONLY: authenticated two-user integration for per-user message visibility,
-- per-user conversation pins, and the 15-minute author-only secure deletion RPC.
-- All Auth-owned records and conversation changes are rolled back.
BEGIN;
SELECT set_config('app.test.direct_a_id', :'direct_a_id', true);
SELECT set_config('app.test.direct_b_id', :'direct_b_id', true);
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
-- Promote both synthetic members through the real admin RPC, then seed a
-- two-member group as the disposable postgres role. All changes are rolled back.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT public.admin_set_member_official_number(
  current_setting('app.test.direct_a_id')::uuid, '971001000002');
SELECT public.admin_set_member_official_number(
  current_setting('app.test.direct_b_id')::uuid, '971001000003');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);

DO $seed_message_visibility_conversation$
DECLARE
  v_conversation uuid;
  v_user_a uuid := current_setting('app.test.direct_a_id')::uuid;
  v_user_b uuid := current_setting('app.test.direct_b_id')::uuid;
BEGIN
  INSERT INTO public.conversations(type,title,created_by)
  VALUES ('group','Message visibility runtime probe',v_user_a)
  RETURNING id INTO v_conversation;
  INSERT INTO public.conversation_members(conversation_id,user_id,role)
  VALUES (v_conversation,v_user_a,'owner'),(v_conversation,v_user_b,'member');
  PERFORM set_config('app.test.message_visibility_conversation_id',v_conversation::text,true);
END;
$seed_message_visibility_conversation$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', current_setting('app.test.direct_a_id'), true);

DO $message_visibility_runtime$
DECLARE
  v_user_a uuid := current_setting('app.test.direct_a_id')::uuid;
  v_user_b uuid := current_setting('app.test.direct_b_id')::uuid;
  v_conversation uuid := current_setting('app.test.message_visibility_conversation_id')::uuid;
  v_fresh_message uuid;
  v_expired_message uuid;
  v_deleted public.chat_messages;
  v_content text;
  v_count integer;
  v_rejected boolean;
BEGIN
  INSERT INTO public.chat_messages(conversation_id,sender_id,content)
  VALUES(v_conversation,v_user_a,'Message visibility runtime probe')
  RETURNING id INTO v_fresh_message;

  INSERT INTO public.chat_messages(conversation_id,sender_id,content,created_at)
  VALUES(v_conversation,v_user_a,'Expired message runtime probe',clock_timestamp()-interval '16 minutes')
  RETURNING id INTO v_expired_message;

  -- A hides one message and pins the conversation for A only.
  INSERT INTO public.user_hidden_messages(user_id,conversation_id,message_id)
  VALUES(v_user_a,v_conversation,v_fresh_message);
  INSERT INTO public.user_conversation_pins(user_id,conversation_id)
  VALUES(v_user_a,v_conversation);

  IF NOT EXISTS (
    SELECT 1 FROM public.user_hidden_messages
    WHERE user_id=v_user_a AND message_id=v_fresh_message
  ) THEN
    RAISE EXCEPTION 'User A cannot read their own hidden-message state';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_conversation_pins
    WHERE user_id=v_user_a AND conversation_id=v_conversation
  ) THEN
    RAISE EXCEPTION 'User A cannot read their own pinned conversation';
  END IF;

  -- The local-hide operation is also bounded by the original send time.
  v_rejected := false;
  BEGIN
    INSERT INTO public.user_hidden_messages(user_id,conversation_id,message_id)
    VALUES(v_user_a,v_conversation,v_expired_message);
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := true;
  END;
  IF NOT v_rejected OR EXISTS (
    SELECT 1 FROM public.user_hidden_messages
    WHERE user_id=v_user_a AND message_id=v_expired_message
  ) THEN
    RAISE EXCEPTION 'Delete-for-me accepted a message outside the 15-minute window';
  END IF;

  -- B cannot see or remove A's private state, but can still see the underlying message.
  PERFORM set_config('request.jwt.claim.sub',v_user_b::text,true);
  IF EXISTS (SELECT 1 FROM public.user_hidden_messages WHERE message_id=v_fresh_message) THEN
    RAISE EXCEPTION 'User B can see User A hidden-message state';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_conversation_pins WHERE conversation_id=v_conversation) THEN
    RAISE EXCEPTION 'User B can see User A pinned-conversation state';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_messages
    WHERE id=v_fresh_message AND content='Message visibility runtime probe' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Hiding a message for A incorrectly hid it for B';
  END IF;

  DELETE FROM public.user_hidden_messages
  WHERE user_id=v_user_a AND message_id=v_fresh_message;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'User B removed User A hidden-message state';
  END IF;
  DELETE FROM public.user_conversation_pins
  WHERE user_id=v_user_a AND conversation_id=v_conversation;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'User B removed User A pinned-conversation state';
  END IF;

  -- B can create their own independent visibility and pin records.
  INSERT INTO public.user_hidden_messages(user_id,conversation_id,message_id)
  VALUES(v_user_b,v_conversation,v_fresh_message);
  INSERT INTO public.user_conversation_pins(user_id,conversation_id)
  VALUES(v_user_b,v_conversation);
  IF NOT EXISTS (
    SELECT 1 FROM public.user_hidden_messages
    WHERE user_id=v_user_b AND message_id=v_fresh_message
  ) OR NOT EXISTS (
    SELECT 1 FROM public.user_conversation_pins
    WHERE user_id=v_user_b AND conversation_id=v_conversation
  ) THEN
    RAISE EXCEPTION 'User B cannot create independent per-user message state';
  END IF;

  -- A non-author cannot delete A's message for everyone.
  v_rejected := false;
  BEGIN
    PERFORM public.delete_message_secure(v_fresh_message);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected OR EXISTS (
    SELECT 1 FROM public.chat_messages WHERE id=v_fresh_message AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'User B deleted User A message for everyone';
  END IF;

  -- Direct table UPDATE must not bypass the secure delete RPC.
  v_rejected := false;
  BEGIN
    UPDATE public.chat_messages
    SET deleted_at=clock_timestamp(),content='تم حذف الرسالة'
    WHERE id=v_fresh_message;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_rejected := v_count = 0;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected OR EXISTS (
    SELECT 1 FROM public.chat_messages WHERE id=v_fresh_message AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Direct message UPDATE bypassed secure deletion';
  END IF;

  -- Return to A: the author may delete within 15 minutes using the database clock.
  PERFORM set_config('request.jwt.claim.sub',v_user_a::text,true);
  v_deleted := public.delete_message_secure(v_fresh_message);
  IF v_deleted.id IS DISTINCT FROM v_fresh_message
     OR v_deleted.deleted_at IS NULL
     OR v_deleted.content IS DISTINCT FROM 'تم حذف الرسالة' THEN
    RAISE EXCEPTION 'Author secure deletion did not return the expected tombstone';
  END IF;

  -- Both edit and global deletion must reject a message older than 15 minutes.
  v_rejected := false;
  BEGIN
    PERFORM public.delete_message_secure(v_expired_message);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected OR EXISTS (
    SELECT 1 FROM public.chat_messages WHERE id=v_expired_message AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Secure delete accepted a message outside the 15-minute window';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.edit_message_secure(v_expired_message,'Expired message edited',0);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  SELECT content INTO v_content FROM public.chat_messages WHERE id=v_expired_message;
  IF NOT v_rejected OR v_content IS DISTINCT FROM 'Expired message runtime probe' THEN
    RAISE EXCEPTION 'Secure edit accepted a message outside the 15-minute window';
  END IF;

  -- A's hidden state remains private and B's independent pin remains intact.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_hidden_messages
    WHERE user_id=v_user_a AND message_id=v_fresh_message
  ) OR NOT EXISTS (
    SELECT 1 FROM public.user_conversation_pins
    WHERE user_id=v_user_a AND conversation_id=v_conversation
  ) OR NOT EXISTS (
    SELECT 1 FROM public.user_conversation_pins
    WHERE user_id=v_user_b AND conversation_id=v_conversation
  ) THEN
    RAISE EXCEPTION 'Per-user hidden/pin state changed unexpectedly after deletion';
  END IF;
END;
$message_visibility_runtime$;

RESET ROLE;
ROLLBACK;
