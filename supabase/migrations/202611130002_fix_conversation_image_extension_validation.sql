-- Forward reconciliation: correct the literal-dot extension check for conversation images.
-- The historical migration used a double-backslash regex under standard_conforming_strings=on,
-- which did not match ordinary .jpg/.png/.webp suffixes. Preserve all existing authorization checks.

BEGIN;

CREATE OR REPLACE FUNCTION app_private.validate_conversation_image_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  expected_prefix text;
BEGIN
  IF NEW.image_path IS NOT DISTINCT FROM OLD.image_path THEN
    RETURN NEW;
  END IF;

  IF actor IS NULL
     OR NOT app_private.is_active_member()
     OR NOT app_private.can_manage_conversation(NEW.id) THEN
    RAISE EXCEPTION 'تغيير صورة المحادثة غير مصرح به' USING errcode = '42501';
  END IF;

  IF NEW.image_path IS NOT NULL THEN
    expected_prefix := NEW.id::text || '/' || actor::text || '/';
    IF LEFT(NEW.image_path, LENGTH(expected_prefix)) <> expected_prefix
       OR NEW.image_path !~* '\.(jpg|png|webp)$'
       OR NOT EXISTS (
         SELECT 1
         FROM storage.objects o
         WHERE o.bucket_id = 'conversation-avatars'
           AND o.name = NEW.image_path
       ) THEN
      RAISE EXCEPTION 'مسار صورة المحادثة غير صالح' USING errcode = '22023';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app_private.validate_conversation_image_path()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_conversation_image(
  p_conversation_id uuid,
  p_image_path text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor uuid := (SELECT auth.uid());
  expected_prefix text;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لتغيير صورة المحادثة' USING errcode = '28000';
  END IF;

  IF NOT app_private.is_active_member() THEN
    RAISE EXCEPTION 'هذه العملية متاحة للأعضاء النشطين فقط' USING errcode = '42501';
  END IF;

  IF NOT app_private.can_manage_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'تغيير الصورة متاح لمالك المحادثة أو مشرفها فقط' USING errcode = '42501';
  END IF;

  IF p_image_path IS NOT NULL THEN
    expected_prefix := p_conversation_id::text || '/' || actor::text || '/';
    IF LEFT(p_image_path, LENGTH(expected_prefix)) <> expected_prefix
       OR p_image_path !~* '\.(jpg|png|webp)$'
       OR NOT EXISTS (
         SELECT 1
         FROM storage.objects o
         WHERE o.bucket_id = 'conversation-avatars'
           AND o.name = p_image_path
       ) THEN
      RAISE EXCEPTION 'مسار صورة المحادثة غير صالح' USING errcode = '22023';
    END IF;
  END IF;

  UPDATE public.conversations
  SET image_path = p_image_path, updated_at = now()
  WHERE id = p_conversation_id
    AND type IN ('group','channel');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المجموعة أو القناة غير موجودة' USING errcode = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_conversation_image(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_conversation_image(uuid,text) TO authenticated;

COMMIT;
