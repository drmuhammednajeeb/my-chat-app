#!/usr/bin/env node
/**
 * Regression guards for module boundaries already decoupled in PR #72.
 * Run with: node scripts/check-module-regressions.mjs
 * These checks intentionally protect specific producer/consumer event seams;
 * they do not claim to be a compiler-grade JavaScript dependency analyzer.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(path, "utf8");
const [core, auth, notifications, conversations, messages, realtime, groups, channels, admin, media, app] = await Promise.all([
  read("modules/core.js"),
  read("modules/auth.js"),
  read("modules/notifications.js"),
  read("modules/conversations.js"),
  read("modules/messages.js"),
  read("modules/realtime.js"),
  read("modules/groups.js"),
  read("modules/channels.js"),
  read("modules/admin.js"),
  read("modules/media.js"),
  read("app.js")
]);

const hasDispatch = (source, event) =>
  source.includes("dispatchEvent(new Event('" + event + "'))") ||
  source.includes('dispatchEvent(new Event("' + event + '"))') ||
  source.includes("dispatchEvent(new CustomEvent('" + event + "'");
const hasListener = (source, event) =>
  source.includes("addEventListener('" + event + "'") ||
  source.includes('addEventListener("' + event + '"');

function noDirectCall(source, name, boundary) {
  assert.doesNotMatch(
    source,
    new RegExp("\\b" + name + "\\s*\\("),
    boundary + " must not call " + name + "() directly"
  );
}
function requireEvent(source, event, boundary) {
  assert.ok(hasDispatch(source, event) || hasListener(source, event),
    boundary + " is missing event contract " + event);
}

// channels -> conversations: navigation and list refresh are event contracts.
noDirectCall(channels, "openConversation", "channels.js");
noDirectCall(conversations, "renderMyChannels", "conversations.js");
assert.ok(hasDispatch(channels, "bizmind:open-conversation"), "channels.js must publish open-conversation");
assert.ok(hasListener(conversations, "bizmind:open-conversation"), "conversations.js must own open-conversation");
assert.ok(hasDispatch(conversations, "bizmind:render-my-channels"), "conversations.js must publish render-my-channels");
assert.ok(hasListener(channels, "bizmind:render-my-channels"), "channels.js must own render-my-channels");

// groups -> media: avatar rendering remains owned by media.js.
noDirectCall(groups, "renderAvatar", "groups.js");
assert.ok(hasDispatch(groups, "bizmind:render-avatar"), "groups.js must publish render-avatar");
assert.ok(hasListener(media, "bizmind:render-avatar"), "media.js must own render-avatar");

// media -> realtime/conversations: transport and conversation presentation seams.
for (const name of ["publishTyping", "handleMessageUpdateRealtime", "renderChatAvatar"]) {
  noDirectCall(media, name, "media.js");
}
for (const event of ["bizmind:publish-typing", "bizmind:message-updated", "bizmind:render-conversations"]) {
  requireEvent(media, event, "media.js");
}
assert.ok(hasListener(realtime, "bizmind:publish-typing"), "realtime.js must own publish-typing");
assert.ok(hasListener(realtime, "bizmind:message-updated"), "realtime.js must own message-updated");
assert.ok(!hasListener(conversations, "bizmind:render-chat-avatar"), "unused render-chat-avatar listener must not remain without a producer");
assert.ok(hasListener(conversations, "bizmind:render-conversations"), "conversations.js must own render-conversations");

// conversations/realtime -> media: avatar painting and voice cancellation are media-owned commands.
noDirectCall(conversations, "renderAvatar", "conversations.js");
noDirectCall(realtime, "renderAvatar", "realtime.js");
noDirectCall(conversations, "cancelVoiceRecording", "conversations.js");
assert.ok(hasDispatch(conversations, "bizmind:render-avatar"), "conversations.js must request avatar rendering through an event");
assert.ok(hasDispatch(realtime, "bizmind:render-avatar"), "realtime.js must request avatar rendering through an event");
assert.ok(hasListener(media, "bizmind:render-avatar"), "media.js must own avatar rendering");
assert.ok(hasDispatch(conversations, "bizmind:cancel-voice-recording"), "conversations.js must publish voice cancellation");
assert.ok(hasListener(media, "bizmind:cancel-voice-recording"), "media.js must own voice cancellation");

// messages -> conversations: read-receipt refresh and menu close use synchronous DOM events.
noDirectCall(messages, "renderConversations", "messages.js");
noDirectCall(messages, "closeChatHeaderMenu", "messages.js");
assert.ok(hasDispatch(messages, "bizmind:render-conversations"), "messages.js must publish render-conversations");
assert.ok(hasDispatch(messages, "bizmind:close-chat-header-menu"), "messages.js must publish close-chat-header-menu");
assert.ok(hasListener(conversations, "bizmind:render-conversations"), "conversations.js must own render-conversations");
assert.ok(hasListener(conversations, "bizmind:close-chat-header-menu"), "conversations.js must own close-chat-header-menu");

// groups <-> messages: modal setup and selection commands are owned by their respective modules.
noDirectCall(messages, "ensureGroupModal", "messages.js");
noDirectCall(conversations, "ensureGroupModal", "conversations.js");
noDirectCall(groups, "setMessageSelectionMode", "groups.js");
assert.ok(hasDispatch(messages, "bizmind:ensure-group-modal"), "messages.js must request modal setup through an event");
assert.ok(hasDispatch(conversations, "bizmind:ensure-group-modal"), "conversations.js must request modal setup through an event");
assert.ok(hasListener(groups, "bizmind:ensure-group-modal"), "groups.js must own modal setup");
assert.ok(hasDispatch(groups, "bizmind:set-message-selection-mode"), "groups.js must publish selection commands");
assert.ok(hasListener(messages, "bizmind:set-message-selection-mode"), "messages.js must own selection mode");

// Conversation/realtime lifecycle: conversations.js publishes commands; realtime.js owns their implementation.
for (const event of ["bizmind:stop-message-polling", "bizmind:subscribe-conversation", "bizmind:subscribe-profile-updates", "bizmind:start-message-polling"]) {
  assert.ok(hasDispatch(conversations, event), "conversations.js must publish " + event);
  assert.ok(hasListener(realtime, event), "realtime.js must own " + event);
}
for (const name of ["stopMessagePolling", "subscribeConversation", "subscribeProfileUpdates", "startMessagePolling"]) {
  noDirectCall(conversations, name, "conversations.js");
}
assert.ok(hasDispatch(conversations, "bizmind:load-starred-message-ids"), "conversations.js must request starred-message state through an event");
assert.ok(hasListener(groups, "bizmind:load-starred-message-ids"), "groups.js must own starred-message loading");
noDirectCall(conversations, "loadStarredMessageIds", "conversations.js");

// Shared conversation-model primitives belong to core, not the conversations feature module.
assert.ok(core.includes("function isSelfConversation("), "core.js must own isSelfConversation");
assert.ok(core.includes("function otherMember("), "core.js must own otherMember");
assert.ok(core.includes("function convName("), "core.js must own convName");
assert.ok(!conversations.includes("function convName("), "conversations.js must not redeclare convName");
assert.ok(!app.includes("const SELF_CHAT_MARKER"), "app.js must not own the shared self-chat marker");

// Core must remain a dependency-free shared foundation.
const moduleSources = { auth, notifications, conversations, messages, realtime, groups, channels, admin, media };
const declarations = new Map();
for (const [file, source] of Object.entries(moduleSources)) {
  declarations.set(file, [...source.matchAll(new RegExp("(?:^|\\n)\\s*(?:async\\s+)?function\\s+([A-Za-z_$][\\w$]*)\\s*\\(", "g"))].map(m => m[1]));
}
for (const [owner, names] of declarations) {
  for (const name of names) {
    if (new RegExp("\\b" + name + "\\s*\\(").test(core)) {
      assert.fail("core.js must not depend on feature function " + name + " from " + owner);
    }
  }
}

// app.js is the composition root, not a runtime monkey-patching layer.
assert.doesNotMatch(app, /(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/,
  "app.js must not regain feature function declarations");
assert.doesNotMatch(app, /\b(?:setSidebarView|renderConversations|openConversation|loadConversations|saveDirectChatPreference|subscribeNotifications|renderMessage|updateConversationMenu)\s*=\s*(?:async\s*)?function\b/,
  "app.js must not reassign feature functions through wrappers");
assert.ok(messages.includes("if(state.selectionMode)decorateMessageSelection(row,m)"),
  "messages.js must own selection decoration for newly rendered messages");
assert.doesNotMatch(app, /\.observe\(\$\('messages'\)/,
  "app.js must not observe message DOM to patch message-module behavior");

console.log("Module boundary regression checks passed.");
