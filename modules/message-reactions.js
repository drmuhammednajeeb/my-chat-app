/* Message reactions: isolated persistence, rendering and realtime lifecycle. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BizmindMessageReactions = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const REACTION_OPTIONS = Object.freeze([
    Object.freeze({ type: "like", emoji: "👍", label: "إعجاب" }),
    Object.freeze({ type: "heart", emoji: "❤️", label: "أحببت" })
  ]);
  const ALLOWED_TYPES = new Set(REACTION_OPTIONS.map(option => option.type));

  function normalizeRows(rows, allowedMessageIds) {
    const result = new Map();
    const allowed = allowedMessageIds ? new Set(allowedMessageIds) : null;
    (Array.isArray(rows) ? rows : []).forEach(row => {
      if (!row || !row.message_id || !row.user_id || !ALLOWED_TYPES.has(row.reaction_type)) return;
      if (allowed && !allowed.has(row.message_id)) return;
      const list = result.get(row.message_id) || [];
      if (!list.some(item => item.user_id === row.user_id)) list.push(row);
      result.set(row.message_id, list);
    });
    return result;
  }

  function applyRealtimeEvent(currentRows, payload, conversationId) {
    const event = payload?.eventType || payload?.event;
    const incoming = payload?.new;
    const old = payload?.old;
    const row = event === "DELETE" ? old : incoming;
    if (!row?.message_id || !row?.user_id) return Array.isArray(currentRows) ? currentRows.slice() : [];
    if (row.conversation_id && row.conversation_id !== conversationId) {
      return Array.isArray(currentRows) ? currentRows.slice() : [];
    }
    const next = (Array.isArray(currentRows) ? currentRows : [])
      .filter(item => item.user_id !== row.user_id);
    if (event !== "DELETE" && incoming && ALLOWED_TYPES.has(incoming.reaction_type)) next.push(incoming);
    return next;
  }

  function create(deps) {
    const state = deps?.state;
    const supabaseClient = deps?.supabaseClient;
    const documentRef = deps?.document || (typeof document !== "undefined" ? document : null);
    const toast = typeof deps?.toast === "function" ? deps.toast : () => {};
    const viewport = deps?.window || (typeof window !== "undefined" ? window : null);
    if (!state || !supabaseClient || !documentRef) {
      throw new Error("Message reactions require state, Supabase client, and document");
    }

    state.reactions ||= new Map();
    const pending = new Map();
    const revisionByConversation = new Map();
    const realtimeChanges = new Map();
    let activePicker = null;
    let hoverOpenTimer = null;
    let hoverCloseTimer = null;

    function isCurrent(conversationId, requestId) {
      return state.active?.id === conversationId
        && (requestId === null || requestId === undefined || requestId === state.messageLoadVersion);
    }

    function rowsFor(messageId) {
      return state.reactions.get(messageId) || [];
    }

    function findMessageRow(messageId) {
      return Array.from(documentRef.querySelectorAll?.(".message") || [])
        .find(row => row.dataset?.messageId === messageId) || null;
    }

    function render(row, message) {
      if (!row || !message?.id) return false;
      row.querySelector?.(".message-reactions")?.remove();
      if (message.deleted_at) return true;
      const reactions = rowsFor(message.id);
      if (!reactions.length) return true;

      const summary = documentRef.createElement("div");
      summary.className = "message-reactions";
      summary.setAttribute("aria-label", "التفاعلات على الرسالة");
      REACTION_OPTIONS.forEach(option => {
        const matching = reactions.filter(item => item.reaction_type === option.type);
        if (!matching.length) return;
        const mine = matching.some(item => item.user_id === state.user?.id);
        const chip = documentRef.createElement("button");
        chip.type = "button";
        chip.className = "message-reaction-chip" + (mine ? " is-active" : "");
        chip.dataset.reaction = option.type;
        chip.setAttribute("aria-pressed", String(mine));
        chip.setAttribute("aria-label", option.label + "، " + matching.length);
        const emoji = documentRef.createElement("span");
        emoji.className = "message-reaction-emoji";
        emoji.textContent = option.emoji;
        const count = documentRef.createElement("span");
        count.className = "message-reaction-count";
        count.textContent = String(matching.length);
        chip.append(emoji, count);
        chip.addEventListener("click", event => {
          event.stopPropagation();
          void toggle(message, option.type);
        });
        summary.append(chip);
      });
      if (summary.childNodes.length) row.append(summary);
      return true;
    }

    function positionPicker(picker, trigger) {
      const anchor = trigger.getBoundingClientRect();
      const box = picker.getBoundingClientRect();
      const width = viewport?.innerWidth || documentRef.documentElement?.clientWidth || 360;
      const height = viewport?.innerHeight || documentRef.documentElement?.clientHeight || 640;
      const pad = 8;
      const rtl = documentRef.documentElement?.dir === "rtl";
      let left = rtl ? anchor.right - box.width : anchor.left;
      let top = anchor.bottom + 8;
      if (top + box.height > height - pad) top = anchor.top - box.height - 8;
      left = Math.max(pad, Math.min(left, width - box.width - pad));
      top = Math.max(pad, Math.min(top, height - box.height - pad));
      picker.style.left = Math.round(left) + "px";
      picker.style.top = Math.round(top) + "px";
    }

    function closePicker() {
      if (hoverOpenTimer) clearTimeout(hoverOpenTimer);
      if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
      hoverOpenTimer = null;
      hoverCloseTimer = null;
      if (!activePicker) return;
      activePicker.trigger?.setAttribute("aria-expanded", "false");
      activePicker.element?.remove();
      activePicker = null;
    }

    function openPicker(row, message, trigger) {
      if (!row || !message || message.deleted_at || !trigger || !isCurrent(message.conversation_id || state.active?.id, null)) return;
      if (activePicker?.messageId === message.id) return;
      closePicker();
      const picker = documentRef.createElement("div");
      picker.className = "message-reaction-picker";
      picker.setAttribute("role", "group");
      picker.setAttribute("aria-label", "اختر رمز التفاعل");
      picker.dataset.messageId = message.id;
      REACTION_OPTIONS.forEach(option => {
        const button = documentRef.createElement("button");
        button.type = "button";
        button.className = "message-reaction-choice";
        button.textContent = option.emoji;
        button.title = option.label;
        button.setAttribute("aria-label", option.label);
        button.addEventListener("click", event => {
          event.stopPropagation();
          void toggle(message, option.type);
          closePicker();
        });
        picker.append(button);
      });
      picker.addEventListener("pointerenter", () => {
        if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
        hoverCloseTimer = null;
      });
      picker.addEventListener("pointerleave", () => {
        if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
        hoverCloseTimer = setTimeout(closePicker, 280);
      });
      documentRef.body.append(picker);
      activePicker = { element: picker, trigger, messageId: message.id };
      trigger.setAttribute("aria-expanded", "true");
      positionPicker(picker, trigger);
    }

    function attach(row, message, container) {
      if (!row || !message?.id || message.deleted_at || !container) return false;
      container.querySelector?.(".message-reaction-trigger")?.remove();
      const trigger = documentRef.createElement("button");
      trigger.type = "button";
      trigger.className = "message-reaction-trigger";
      trigger.textContent = "☺";
      trigger.title = "إضافة تفاعل";
      trigger.setAttribute("aria-label", "إضافة تفاعل");
      trigger.setAttribute("aria-haspopup", "true");
      trigger.setAttribute("aria-expanded", "false");
      trigger.addEventListener("click", event => {
        event.stopPropagation();
        openPicker(row, message, trigger);
      });
      container.prepend(trigger);
      const bubble = row.querySelector?.(".bubble");
      bubble?.addEventListener?.("click", event => {
        if (event.pointerType === "touch" || !event.detail
          || event.target?.closest?.("button,a,video,audio,img,.reply-quote,.message-menu-wrap")) return;
        openPicker(row, message, trigger);
      });

      row.addEventListener?.("pointerenter", event => {
        if (event.pointerType && event.pointerType !== "mouse") return;
        if (hoverOpenTimer) clearTimeout(hoverOpenTimer);
        hoverOpenTimer = setTimeout(() => openPicker(row, message, trigger), 520);
      });
      row.addEventListener?.("pointerleave", () => {
        if (hoverOpenTimer) clearTimeout(hoverOpenTimer);
        hoverOpenTimer = null;
        if (activePicker?.messageId === message.id) {
          if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
          hoverCloseTimer = setTimeout(() => {
            if (!activePicker?.element?.matches?.(":hover")) closePicker();
          }, 320);
        }
      });
      return true;
    }

    async function toggle(message, reactionType) {
      const conversationId = message?.conversation_id || state.active?.id;
      const userId = state.user?.id;
      if (!message?.id || message.deleted_at || !ALLOWED_TYPES.has(reactionType)
        || !conversationId || !userId || !isCurrent(conversationId, null)) return false;

      const key = message.id + ":" + userId;
      if (pending.has(key)) return false;
      const token = {};
      pending.set(key, token);
      const requestId = state.messageLoadVersion;
      const before = rowsFor(message.id).slice();
      const ownBefore = before.find(item => item.user_id === userId) || null;
      const removing = ownBefore?.reaction_type === reactionType;
      const optimistic = before.filter(item => item.user_id !== userId);
      if (!removing) optimistic.push({
        conversation_id: conversationId,
        message_id: message.id,
        user_id: userId,
        reaction_type: reactionType
      });
      if (optimistic.length) state.reactions.set(message.id, optimistic);
      else state.reactions.delete(message.id);
      const row = findMessageRow(message.id);
      if (row) render(row, message);

      try {
        let result;
        if (removing) {
          result = await supabaseClient.from("message_reactions").delete()
            .eq("conversation_id", conversationId)
            .eq("message_id", message.id)
            .eq("user_id", userId);
        } else {
          result = await supabaseClient.from("message_reactions").upsert({
            conversation_id: conversationId,
            message_id: message.id,
            user_id: userId,
            reaction_type: reactionType
          }, { onConflict: "message_id,user_id" });
        }
        if (result?.error) throw result.error;
        return true;
      } catch (error) {
        if (isCurrent(conversationId, requestId)) {
          const latest = rowsFor(message.id).filter(item => item.user_id !== userId);
          if (ownBefore) latest.push(ownBefore);
          if (latest.length) state.reactions.set(message.id, latest);
          else state.reactions.delete(message.id);
          const activeRow = findMessageRow(message.id);
          if (activeRow) render(activeRow, message);
        }
        console.error("Message reaction failed:", error?.message || error);
        toast("تعذر حفظ التفاعل. أُعيدت الحالة السابقة؛ حاول مجدداً");
        return false;
      } finally {
        if (pending.get(key) === token) pending.delete(key);
      }
    }

    function handleRealtime(payload, conversationId) {
      if (!isCurrent(conversationId, null)) return false;
      const event = payload?.eventType || payload?.event;
      const row = event === "DELETE" ? payload?.old : payload?.new;
      if (!row?.message_id || !row?.user_id) return false;
      if (row.conversation_id && row.conversation_id !== conversationId) return false;

      const revision = (revisionByConversation.get(conversationId) || 0) + 1;
      revisionByConversation.set(conversationId, revision);
      const changes = realtimeChanges.get(conversationId) || new Map();
      changes.set(row.message_id + ":" + row.user_id, { revision, payload, conversationId });
      realtimeChanges.set(conversationId, changes);

      const next = applyRealtimeEvent(rowsFor(row.message_id), payload, conversationId);
      if (next.length) state.reactions.set(row.message_id, next);
      else state.reactions.delete(row.message_id);
      const message = (state.messages || []).find(item => item.id === row.message_id);
      const messageRow = findMessageRow(row.message_id);
      if (message && messageRow) render(messageRow, message);
      return true;
    }

    async function load(conversationId, messages, requestId = null) {
      const ids = [...new Set((messages || []).filter(message => message?.id && !message.deleted_at).map(message => message.id))];
      if (!conversationId) return true;
      if (!ids.length) {
        if (isCurrent(conversationId, requestId)) state.reactions = new Map();
        return true;
      }
      const startRevision = revisionByConversation.get(conversationId) || 0;
      try {
        const { data, error } = await supabaseClient.from("message_reactions")
          .select("conversation_id,message_id,user_id,reaction_type")
          .eq("conversation_id", conversationId)
          .in("message_id", ids);
        if (error) throw error;
        if (!isCurrent(conversationId, requestId)) return false;

        const next = new Map(state.reactions || []);
        ids.forEach(id => next.delete(id));
        const fetched = normalizeRows(data, ids);
        fetched.forEach((rows, id) => next.set(id, rows));

        const changes = realtimeChanges.get(conversationId);
        if (changes) {
          changes.forEach(change => {
            if (change.revision <= startRevision) return;
            const messageId = change.payload?.eventType === "DELETE"
              ? change.payload.old?.message_id : change.payload.new?.message_id;
            if (!messageId || !ids.includes(messageId)) return;
            const current = next.get(messageId) || [];
            const updated = applyRealtimeEvent(current, change.payload, conversationId);
            if (updated.length) next.set(messageId, updated);
            else next.delete(messageId);
          });
        }
        state.reactions = next;
        messages.forEach(message => {
          const existingRow = findMessageRow(message.id);
          if (existingRow) render(existingRow, message);
        });
        return true;
      } catch (error) {
        if (isCurrent(conversationId, requestId)) {
          console.warn("Message reactions could not be loaded:", error?.message || error);
        }
        return false;
      }
    }

    function removeMessage(messageId) {
      if (!messageId) return false;
      state.reactions.delete(messageId);
      if (activePicker?.messageId === messageId) closePicker();
      findMessageRow(messageId)?.querySelector?.(".message-reactions")?.remove();
      return true;
    }

    function reset() {
      closePicker();
      state.reactions = new Map();
      revisionByConversation.clear();
      realtimeChanges.clear();
    }

    function onDocumentPointerDown(event) {
      if (!activePicker) return;
      if (activePicker.element?.contains(event.target) || activePicker.trigger?.contains(event.target)) return;
      closePicker();
    }
    function onDocumentKeyDown(event) {
      if (event.key === "Escape") closePicker();
    }
    documentRef.addEventListener?.("pointerdown", onDocumentPointerDown, true);
    documentRef.addEventListener?.("keydown", onDocumentKeyDown);
    viewport?.addEventListener?.("resize", closePicker);
    viewport?.addEventListener?.("scroll", closePicker, true);

    return Object.freeze({ load, render, attach, toggle, handleRealtime, removeMessage, reset, closePicker });
  }

  return Object.freeze({ create, REACTION_OPTIONS, normalizeRows, applyRealtimeEvent });
});
