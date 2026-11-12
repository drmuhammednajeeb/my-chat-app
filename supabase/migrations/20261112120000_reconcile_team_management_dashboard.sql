-- Forward reconciliation migration for production objects that existed outside
-- the recorded 62-migration history.
-- Recovered from the live production catalog on 2026-11-12.
-- No administrator identity is hardcoded or seeded here. Bootstrap/assignment of the
-- first team administrator is a separate controlled operational step.
-- Safe to apply to production after review: table/function creation is idempotent and
-- the current team_admins rows are preserved.

BEGIN;

CREATE TABLE IF NOT EXISTS app_private.team_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_private.team_admins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.team_admins FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS "Deny direct team admin table access" ON app_private.team_admins;
CREATE POLICY "Deny direct team admin table access"
ON app_private.team_admins FOR ALL TO authenticated
USING (false) WITH CHECK (false);

GRANT USAGE ON SCHEMA app_private TO authenticated;

CREATE OR REPLACE FUNCTION app_private.enforce_group_member_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_type text;
  current_members integer;
begin
  if tg_op = 'UPDATE'
     and new.conversation_id = old.conversation_id
     and new.user_id = old.user_id then
    return new;
  end if;

  select c.type into target_type
  from public.conversations c
  where c.id = new.conversation_id
  for update;

  if target_type = 'group' then
    select count(*) into current_members
    from public.conversation_members m
    where m.conversation_id = new.conversation_id;

    if current_members >= 200 then
      raise exception 'وصلت المجموعة إلى الحد الأقصى وهو 200 عضو'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION app_private.enforce_group_member_limit() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.get_team_dashboard_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  result jsonb;
begin
  if not app_private.is_team_admin() then
    raise exception 'غير مصرح لك بعرض لوحة إدارة الفريق'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'registered_count', (select count(*) from auth.users),
    'profile_count', (select count(*) from public.profiles),
    'active_7d', (
      select count(distinct m.sender_id)::integer
      from public.chat_messages m
      where m.created_at >= now() - interval '7 days'
    ),
    'inactive_7d', greatest(
      (select count(*) from auth.users) - (
        select count(distinct m.sender_id)
        from public.chat_messages m
        where m.created_at >= now() - interval '7 days'
      ), 0
    ),
    'messages_total', (select count(*) from public.chat_messages),
    'messages_7d', (select count(*) from public.chat_messages where created_at >= now() - interval '7 days'),
    'messages_30d', (select count(*) from public.chat_messages where created_at >= now() - interval '30 days'),
    'groups_count', (select count(*) from public.conversations where type = 'group'),
    'channels_count', (select count(*) from public.conversations where type = 'channel'),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'title', g.title,
        'created_at', g.created_at,
        'member_count', (select count(*) from public.conversation_members cm where cm.conversation_id = g.id),
        'last_message_at', (select max(m.created_at) from public.chat_messages m where m.conversation_id = g.id)
      ) order by coalesce(g.last_message_at,g.created_at) desc)
      from public.conversations g
      where g.type = 'group'
    ), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'display_name', p.display_name,
        'created_at', p.created_at,
        'last_active_at', (select max(m.created_at) from public.chat_messages m where m.sender_id = p.id),
        'group_count', (select count(*) from public.conversation_members cm join public.conversations c on c.id = cm.conversation_id where cm.user_id = p.id and c.type = 'group')
      ) order by p.created_at desc)
      from public.profiles p
    ), '[]'::jsonb),
    'daily_messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day::date,
        'count', (select count(*) from public.chat_messages m where m.created_at >= d.day and m.created_at < d.day + interval '1 day')
      ) order by d.day)
      from generate_series(
        date_trunc('day', now()) - interval '6 days',
        date_trunc('day', now()),
        interval '1 day'
      ) as d(day)
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$function$;
REVOKE ALL ON FUNCTION app_private.get_team_dashboard_stats() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.get_team_dashboard_stats() TO authenticated;

CREATE OR REPLACE FUNCTION app_private.is_team_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app_private.is_active_member()
     and exists (
       select 1
       from app_private.team_admins a
       where a.user_id = (select auth.uid())
     );
$function$;
REVOKE ALL ON FUNCTION app_private.is_team_admin() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.is_team_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_team_dashboard_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select app_private.get_team_dashboard_stats();
$function$;
REVOKE ALL ON FUNCTION public.get_team_dashboard_stats() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_dashboard_stats() TO authenticated, service_role;

DROP TRIGGER IF EXISTS enforce_group_member_limit ON public.conversation_members;
CREATE TRIGGER enforce_group_member_limit
BEFORE INSERT OR UPDATE OF conversation_id, user_id
ON public.conversation_members
FOR EACH ROW EXECUTE FUNCTION app_private.enforce_group_member_limit();

COMMIT;
