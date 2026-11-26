# Conversation Lifecycle — Stage 6

## Scope
Extracts the concurrency token and stale-open protection for conversation navigation from `index.html` into `modules/conversation-lifecycle.js`.

The controller owns:
- Monotonic conversation-open generations.
- Starting a new open operation for a conversation ID.
- Verifying that an async continuation still belongs to the current open operation and active conversation.
- Invalidating pending open work when the active conversation is closed or archived.

## Deliberate boundaries
The existing `openConversation` flow remains the orchestration layer. Message loading, hidden-message preferences, starred messages, group settings, realtime subscriptions, DOM rendering, polling, and Supabase queries remain in their existing modules/functions. The controller has no Supabase, DOM, timer, or storage dependencies.

## Compatibility
The existing `openConversation(c)` function and its later wrapper remain intact. Its token creation and three async stale-result guards delegate to the extracted controller. Closing or archiving the active conversation invalidates the current open token.

## Validation
Run `node tests/conversation-lifecycle.test.js`. CI checks module load order and integration of begin/current/invalidate operations. Browser tests are still required for rapid conversation switching, close-during-load, archive-during-load, and message/realtime rendering.
