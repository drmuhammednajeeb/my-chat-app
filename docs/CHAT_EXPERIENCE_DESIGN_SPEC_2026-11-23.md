# Bizmind Makers Chat Pro — Chat Experience Design Specification

**Revision:** 2026-11-23  
**Status:** Approved design baseline; implementation is isolated on `feat/whatsapp-chat-experience-20261123`.

## 1. Product direction

Create a WhatsApp-inspired conversation experience without copying WhatsApp branding or replacing Bizmind Makers workflows. The interface remains RTL-first, responsive, and aligned with the existing modular application architecture.

The design must preserve existing capabilities: direct and group conversations, channels, custom lists, message reactions, message pins, delivery/read receipts, voice notes, stickers, attachments, disappearing messages, local conversation themes, group accent themes, and administration tools.

## 2. Visual system

- **Primary accent:** Emerald.
- **Color intensity:** Balanced; reserve strong emerald for primary actions, active states, and meaningful status.
- **Identity:** Distinct Bizmind visual identity; no WhatsApp logo, wordmark, or copied brand assets.
- **Sidebar:** Neutral surfaces; emerald is an accent, not a large background fill.
- **Message bubbles:** Soft, rounded surfaces. Outgoing messages use calm emerald; incoming messages remain neutral.
- **Dark mode:** Layered Dark — deep blue/charcoal canvas with visibly separated raised surfaces, borders, menus, and message layers. Avoid a single flat black surface.
- **Shape language:** Modern rounded controls and panels; consistent focus rings.
- **Buttons:** Solid Emerald for primary actions; neutral secondary actions.
- **Typography:** IBM Plex Sans Arabic as the primary family, with Arabic RTL and compatible Latin fallback. Use regular, medium, semibold, and bold weights.
- **Icons:** Hybrid line icons by default; active/selected controls may use filled states.
- **Density:** Balanced. Keep conversation reading comfortable while retaining practical information density in administration surfaces.

Color-token values remain governed by `styles/theme-tokens.css`. Any future HEX adjustments must pass WCAG AA checks for text, controls, focus, hover, selected, disabled, and message metadata in Light and Layered Dark modes. Conversation-local themes and group accent overrides must continue to take precedence only within their existing scope.

## 3. Responsive conversation layout

### Desktop

- Two-pane layout: conversation list on the right in RTL and active conversation on the remaining canvas.
- The sidebar remains neutral and independently scrollable.
- The active conversation has a stable header, scrollable message timeline, and persistent composer.
- Opening conversation information uses a right-side sheet. Closing it returns to the same conversation and scroll position.

### Mobile

- Conversation list and active conversation use a single-pane navigation model.
- Selecting a conversation closes the sidebar and opens the timeline.
- The information surface becomes a full-height page/sheet with a clear close action.
- Touch targets remain accessible; swipe gestures must not block vertical timeline scrolling or composer input.
- Safe-area insets and reduced-motion preferences remain respected.

## 4. Conversation list

The list supports:
1. Search for people and groups by display name, username, and available conversation preview.
2. Message search within the active conversation through the dedicated in-chat search surface.
3. Filters: All, Unread, Favorites, and Groups. Existing Archived and custom-list workflows remain available.
4. Pin conversations to the top for the current user only.
5. Stable ordering: pinned conversations first, then most recent activity; no duplicate Realtime subscriptions or full-page reloads.
6. Search and filter changes update the list locally from already-loaded data where possible.

Conversation pins and favorites are distinct: pin controls ordering; favorite is a user-defined filter.

## 5. Conversation header and information

- Header includes avatar, conversation title, presence/context subtitle, information control, and a compact actions menu.
- The information control opens the participant profile in a side sheet on desktop and a full-height surface on mobile.
- Group administration and membership actions remain in the existing group-information workflow.
- Closing the information surface must not reset the active conversation, timeline, composer draft, or scroll position.

## 6. Message timeline and interactions

- Preserve chronological message order and date separators.
- Preserve timestamps, sender identity, edited marker, delivery/read status, reactions, and pinned-message marker.
- Support reply-by-swipe on touch devices, long-press context actions, and mouse/keyboard access to the same actions.
- Long-press menu contains only supported actions. Do not expose message copy or message forwarding.
- Multi-select supports message starring and deletion actions. No message export/copy action is available.
- Reply/quote remains in the current conversation; it is not a forwarding workflow.

## 7. Edit and delete policy

- Only the author can edit their own text-only message.
- Editing is allowed for 15 minutes from the original `created_at` timestamp.
- The deadline is not extended by subsequent edits.
- The database clock is authoritative. Client-side countdown/disabled state is presentation only.
- The secure edit RPC locks the message, checks active membership, ownership, conversation type, deadline, and expected revision, then writes the edit-history record and updates the message atomically.
- Edited messages display an edited marker; original send time remains unchanged.
- “Delete for me” creates a per-user visibility override and does not delete the message for other participants.
- “Delete for everyone” is author-only and allowed only within 15 minutes from original message creation; the database clock and secure RPC enforce the deadline.
- Deleted-for-everyone messages become a tombstone; no direct table update may bypass the secure RPC.
- Multi-message deletion applies the same permission checks independently to each selected message.

## 8. Explicitly excluded actions

These are permanent exclusions from the message experience:
- **Copy message / copy selected messages:** excluded.
- **Forward message / forward selected messages:** excluded.
- Message export/download actions are removed from the conversation and multi-select controls so they cannot act as an alternate message-copy path.

Link sharing for channel invitations is a separate invitation workflow and is not a message-copy or forwarding action.

## 9. Accessibility and interaction quality

- All actions are keyboard reachable and have Arabic accessible labels.
- Focus-visible indicators remain visible in Light and Dark themes.
- Menus expose correct expanded/pressed state and close with Escape.
- Touch gestures must distinguish horizontal reply intent from vertical scrolling.
- Respect `prefers-reduced-motion`.
- Maintain readable contrast for message metadata, outgoing text, selected rows, and destructive actions.

## 10. Data and security boundaries

- Per-user pins and per-user hidden-message state are scoped to `auth.uid()`.
- RLS remains enabled on all per-user tables.
- Message editing and global deletion are enforced in database RPCs, not merely by hidden/disabled buttons.
- Do not use client time as the authority for the 15-minute rule.
- No production SQL execution, Supabase configuration change, or deployment is implied by this design document.
- New forward migrations remain unapplied until disposable-local runtime, RLS CRUD, authenticated multi-user integration, and independent review pass.

## 11. Validation gates

Before merge:
- Run message lifecycle, conversation list, rendering, and regression suites.
- Validate Light and Layered Dark at desktop and mobile widths.
- Verify RTL layout, Arabic typography, keyboard focus, touch gestures, and reduced motion.
- Verify that copy/forward/export message actions are absent.
- Verify edit/delete deadline boundaries at just before, exactly at, and just after 15 minutes using database time.
- Verify per-user hide isolation and pin isolation with at least two authenticated users.
- Verify unauthorized users cannot edit/delete another participant's message.
- Keep main, production Supabase, and production deployment unchanged until separate approvals.
