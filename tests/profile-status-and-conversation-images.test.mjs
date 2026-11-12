import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const client = readFileSync(new URL('../modules/profile-status-and-conversation-images.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261112091557_profile_status_and_conversation_images.sql', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../modules/profile-status-and-conversation-images.css', import.meta.url), 'utf8');

test('feature client module parses as a classic browser script', () => {
  assert.doesNotThrow(() => new vm.Script(client, { filename: 'profile-status-and-conversation-images.js' }));
});

test('feature assets are wired into the application shell', () => {
  assert.match(html, /\.\/modules\/profile-status-and-conversation-images\.css/);
  assert.match(html, /<script src="\.\/modules\/profile-status-and-conversation-images\.js" defer><\/script>/);
  assert.match(html, /row\.dataset\.conversationId=c\.id/);
  assert.match(html, /card\.dataset\.conversationId=channel\.id/);
  assert.match(styles, /\.bz-status-strip/);
  assert.match(styles, /\.has-conversation-image/);
});

test('status records are append-only, owner-scoped and visible only for 24 hours', () => {
  assert.match(migration, /create table if not exists public\.profile_statuses/);
  assert.match(migration, /new\.expires_at := new\.created_at \+ interval '24 hours'/);
  assert.match(migration, /expires_at > now\(\)/);
  assert.match(migration, /Users create own profile statuses[\s\S]*?user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /Users delete own profile statuses[\s\S]*?user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /grant select, insert, delete on public\.profile_statuses to authenticated/);
  assert.doesNotMatch(migration, /grant [^;]*update on public\.profile_statuses to authenticated/i);
});

test('status media uses a private bucket and reads require a live status row', () => {
  assert.match(migration, /values \('profile-status-media', 'profile-status-media', false/);
  assert.match(migration, /s\.image_path = storage\.objects\.name[\s\S]*?s\.expires_at > now\(\)/);
  assert.match(client, /createSignedUrl\(row\.image_path, 60\)/);
  assert.match(client, /\.gt\('expires_at', now\)/);
});

test('conversation images use private storage and a manager-checked RPC', () => {
  assert.match(migration, /values \('conversation-avatars', 'conversation-avatars', false/);
  assert.match(migration, /app_private\.can_manage_conversation\(\(\(storage\.foldername\(name\)\)\[1\]\)::uuid\)/);
  assert.match(migration, /create or replace function public\.set_conversation_image/);
  assert.match(migration, /if not app_private\.can_manage_conversation\(p_conversation_id\)/);
  assert.match(migration, /grant execute on function public\.set_conversation_image\(uuid,text\) to authenticated/);
  assert.match(client, /rpc\('set_conversation_image'/);
  assert.match(client, /canManageConversation\(conversation\)/);
});

test('security-definer conversation image mutation paths require active membership', () => {
  const triggerStart = migration.indexOf('create or replace function app_private.validate_conversation_image_path()');
  const rpcStart = migration.indexOf('create or replace function public.set_conversation_image(');
  assert.ok(triggerStart >= 0 && rpcStart > triggerStart);
  const triggerEnd = migration.indexOf('$;', triggerStart);
  const rpcEnd = migration.indexOf('$;', rpcStart);
  const trigger = migration.slice(triggerStart, triggerEnd);
  const rpc = migration.slice(rpcStart, rpcEnd);
  assert.ok(trigger.includes('actor is null or not app_private.is_active_member()'));
  assert.ok(rpc.includes('if not app_private.is_active_member() then'));
});

test('client limits status and conversation image uploads and keeps status text/image exclusive', () => {
  assert.match(client, /MAX_IMAGE_BYTES = 3 \* 1024 \* 1024/);
  assert.match(client, /IMAGE_TYPES = new Set\(\['image\/jpeg', 'image\/png', 'image\/webp'\]\)/);
  assert.match(client, /\(text && file\)/);
  assert.match(client, /statusId \+ '\.' \+ extension/);
  assert.match(client, /upsert: false/);
});

test('conversation image changes are published and reconciled for all active members', () => {
  assert.ok(migration.includes("tablename = 'conversations'") && migration.includes('alter publication supabase_realtime add table public.conversations'));
  assert.ok(client.includes("table: 'conversations'") && client.includes('conversation.image_path = updated.image_path'));
  assert.ok(client.includes('subscribeConversationImageRealtime'));
});

test('status list refreshes on realtime changes and app visibility restoration', () => {
  assert.match(client, /table: 'profile_statuses'/);
  assert.match(client, /setInterval\(\(\) => \{[\s\S]*?loadProfileStatuses\(\)/);
  assert.match(client, /document\.addEventListener\('visibilitychange'/);
  assert.match(client, /window\.addEventListener\('focus'/);
});
