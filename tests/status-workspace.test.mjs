import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../index.html');
const client = read('../modules/status-workspace.js');
const css = read('../modules/status-workspace.css');
const videoSql = read('../supabase/migrations/20261112091605_profile_status_video_media.sql');
const combinedSql = read('../supabase/migrations/20261112103237_allow_combined_profile_status_content_and_media.sql');
const baseSql = read('../supabase/migrations/20261112091557_profile_status_and_conversation_images.sql');

test('status workspace parses as an isolated classic browser module', () => {
  assert.doesNotThrow(() => new vm.Script(client, { filename: 'status-workspace.js' }));
  assert.match(client, /window\.BizmindStatusWorkspace/);
  assert.doesNotMatch(client, /from\(['"]chat_messages['"]\)/);
});

test('status workspace is mounted with explicit navigation and a return path', () => {
  assert.match(html, /id="statusTab"/);
  assert.match(html, /id="statusPage"/);
  assert.match(html, /statusPageBack/);
  assert.match(html, /statusPagePublish/);
  assert.match(html, /status-workspace\.css/);
  assert.match(html, /status-workspace\.js/);
  assert.match(html, /setSidebarView\('status'\)/);
  assert.match(css, /\.status-page/);
});

test('publishing accepts text, media, or both and enforces client-side limits', () => {
  assert.match(client, /MAX_TEXT=280/);
  assert.match(client, /MAX_BYTES=25\*1024\*1024/);
  assert.match(client, /video\/mp4/);
  assert.match(client, /video\/webm/);
  assert.match(client, /video\/quicktime/);
  assert.match(client, /upsert:false/);
  assert.match(client, /content:content\|\|null,image_path:path,media_type:mediaType/);
  assert.doesNotMatch(client, /content&&file/);
  assert.match(client, /createSignedUrl\(row\.image_path,60\)/);
});

test('profile relation is explicit and status refreshes are not dropped during concurrent loads', () => {
  assert.match(client, /profile:profiles!profile_statuses_user_id_fkey/);
  assert.match(client, /refreshQueued=true/);
  assert.match(client, /loadEpoch\+\+/);
  assert.match(client, /table:'profile_statuses'/);
  assert.match(client, /visibilitychange/);
  assert.match(client, /window.addEventListener\('focus'/);
});

test('video migration keeps private storage and strict media/path validation', () => {
  assert.ok(videoSql.includes("media_type in ('image','video')"));
  assert.ok(videoSql.includes('file_size_limit=26214400'));
  assert.ok(videoSql.includes('public=false'));
  assert.match(videoSql, /video\/mp4[\s\S]*?video\/webm[\s\S]*?video\/quicktime/);
  assert.match(videoSql, /profile_statuses_image_path_check/);
});

test('combined content/media migration preserves active-member and owner checks', () => {
  assert.match(combinedSql, /content is not null or image_path is not null/);
  assert.match(combinedSql, /content is null or char_length\(btrim\(content\)\) between 1 and 280/);
  assert.match(combinedSql, /media_type in \('image', 'video'\)/);
  assert.match(combinedSql, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(combinedSql, /is_active_member/);
  assert.ok(combinedSql.includes(String.raw`{36}\.`));
});

test('base status schema retains 24-hour expiry, RLS, and private bucket policies', () => {
  assert.match(baseSql, /new\.expires_at := new\.created_at \+ interval '24 hours'/);
  assert.match(baseSql, /Users create own profile statuses/);
  assert.match(baseSql, /Users delete own profile statuses/);
  assert.match(baseSql, /values \('profile-status-media', 'profile-status-media', false/);
  assert.match(baseSql, /Read active profile status media/);
});

test('status module remains part of the repository storage inventory input', async () => {
  const inventory = read('../tests/staging/local-supabase/build-database-object-inventory.mjs');
  assert.match(inventory, /statusWorkspaceJs/);
  assert.match(inventory, /profileMediaJs \+ '\\n' \+ statusWorkspaceJs/);
});

test('status workspace binds Realtime to the active account and retries recoverable disconnects', () => {
  assert.match(client, /channelUserId/);
  assert.match(client, /function stopRealtime\(\)/);
  assert.match(client, /function scheduleRealtimeRetry\(uid,generation\)/);
  assert.match(client, /status==='CHANNEL_ERROR'\|\|status==='TIMED_OUT'\|\|status==='CLOSED'/);
  assert.match(client, /Math\.min\(30000,1000\*Math\.pow\(2,realtimeRetryAttempt\+\+\)\)/);
  assert.match(client, /generation===channelGeneration&&actor\(\)===uid&&isOpen\(\)/);
});

test('status loading and polling run only while the workspace is active', () => {
  assert.match(client, /if\(!uid\|\|!isOpen\(\)\)return/);
  assert.match(client, /if\(actor\(\)&&isOpen\(\)&&document\.visibilityState==='visible'\)/);
  assert.match(client, /function closeWorkspace\(\)/);
  assert.match(client, /stopRealtime\(\);clearRefreshTimer\(\)/);
  assert.doesNotMatch(client, /if\(actor\(\)\)\{subscribe\(\);ensureTimer\(\);void load\(\)\}/);
});

test('status navigation closes the workspace outside the status tab and preserves mobile return accessibility', () => {
  assert.match(html, /if\(view!=='status'\)window\.BizmindStatusWorkspace\?\.close\?\.\(\)/);
  assert.match(html, /statusPageBack/);
  assert.match(html, /id="statusPage"[\s\S]*?aria-hidden="true"/);
  assert.match(html, /\$\('statusPage'\)\.setAttribute\('aria-hidden',String\(!status\)\)/);
});

test('successful account entry restores status navigation after an auth identity transition', () => {
  assert.match(client, /if\(result&&state\.sidebarView==='status'\)\{open\(\)\}/);
  assert.match(client, /if\(actor\(\)!==session\.user\.id\)\{closeWorkspace\(\);grouped=new Map\(\);return\}/);
});
