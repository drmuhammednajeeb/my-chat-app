/* Complete message-loading lifecycle.
 * Owns the initial fetch, reconciliation, safe timeline commit and rollback.
 * The application supplies its existing renderer and Supabase client.
 */
(function (root) {
  'use strict';

  function makeStatus(documentRef, title, description, loading) {
    const box = documentRef.createElement('div');
    box.className = 'welcome';
    if (loading) {
      const icon = documentRef.createElement('div');
      icon.className = 'welcome-icon';
      const glyph = documentRef.createElement('i');
      glyph.className = 'ph ph-spinner-gap';
      icon.append(glyph);
      box.append(icon);
    }
    const heading = documentRef.createElement('h2');
    heading.textContent = title;
    const detail = documentRef.createElement('p');
    detail.textContent = description;
    box.append(heading, detail);
    return box;
  }

  function isAfterClear(message, clearedBefore) {
    if (!clearedBefore) return true;
    const created = Date.parse(message.created_at);
    const boundary = Date.parse(clearedBefore);
    return Number.isFinite(created) && Number.isFinite(boundary) && created > boundary;
  }

  function mergeWindow(currentRows, fetchedRows, conversationId, syncStartedAt, clearedBefore, compare) {
    const fetchedIds = new Set(fetchedRows.map(row => row.id));
    const newestFetched = fetchedRows[0] || null;
    const oldestFetched = fetchedRows[fetchedRows.length - 1] || null;
    const merged = new Map();

    for (const row of currentRows || []) {
      if (!row || row.conversation_id !== conversationId || !isAfterClear(row, clearedBefore)) continue;
      const isFetched = fetchedIds.has(row.id);
      const isNewerRealtime = !!newestFetched && compare(row, newestFetched) > 0;
      const isOlderLoadedHistory = fetchedRows.length === 50 && !!oldestFetched && compare(row, oldestFetched) < 0;
      const arrivedDuringEmptyFetch = !newestFetched && Date.parse(row.created_at) >= Date.parse(syncStartedAt);
      if (isFetched || isNewerRealtime || isOlderLoadedHistory || arrivedDuringEmptyFetch) merged.set(row.id, row);
    }

    for (const row of fetchedRows) merged.set(row.id, row);
    return Array.from(merged.values()).sort(compare).slice(-100);
  }

  async function loadMessages(deps) {
    const {
      state, $, supabaseClient, document: documentRef,
      updateNewMessagesIndicator = () => {},
      diagLog = () => {},
      recordPerf = () => {},
      compareMessagesChronologically: compare,
      loadMessageReactions = async () => true,
      loadMessagePins = async () => true,
      loadPrivateReplyContexts = async () => true,
      renderMessage,
      markConversationReceipt = async () => {},
      toast = () => {},
      performance: performanceRef = root.performance
    } = deps || {};

    const conversationId = state?.active?.id;
    if (!conversationId || typeof renderMessage !== 'function' || typeof compare !== 'function') return false;

    const startedAt = performanceRef.now();
    const syncStartedAt = new Date(Date.now() - 60000).toISOString();
    const requestId = (Number(state.messageLoadVersion) || 0) + 1;
    state.messageLoadVersion = requestId;
    state.diagnostics ||= {};
    state.messageIds ||= new Set();
    state.messages ||= [];
    state.replyMessages ||= new Map();

    const area = $('messages');
    if (!area) return false;

    const sameConversationTimeline = state.messageTimelineConversationId === conversationId;
    const isCurrent = () => state.messageLoadVersion === requestId && state.active?.id === conversationId;
    const originalNodes = Array.from(area.childNodes || area.children || []);
    const originalMessages = state.messages;
    const originalIds = new Set(state.messageIds);
    const originalReplyMessages = state.replyMessages;

    state.isLoadingMessages = true;
    if (!sameConversationTimeline) {
      area.replaceChildren(makeStatus(documentRef, 'جارٍ تحميل الرسائل', 'يرجى الانتظار...', true));
      state.messageIds.clear();
    }
    updateNewMessagesIndicator();
    diagLog('fetch-start', { conversationId, requestId });

    let fetchedRows = [];
    let allMessagesRendered = true;

    try {
      const fetchStartedAt = performanceRef.now();
      let query = supabaseClient.from('chat_messages')
        .select('*')
        .eq('conversation_id', conversationId);
      const clearedBefore = state.activeChatPreference?.cleared_before;
      if (clearedBefore) query = query.gt('created_at', clearedBefore);

      const result = await query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(50);

      recordPerf('message_fetch', performanceRef.now() - fetchStartedAt, {
        success: !result?.error,
        rows: result?.data?.length || 0
      });
      if (result?.error) throw result.error;
      if (!isCurrent()) return false;

      fetchedRows = Array.isArray(result?.data) ? result.data : [];
      let messages = mergeWindow(
        state.messages,
        fetchedRows,
        conversationId,
        syncStartedAt,
        clearedBefore,
        compare
      );

      // Reply parents and auxiliary metadata are enrichments, never prerequisites
      // for displaying the authoritative chat_messages rows.
      const replyIds = [...new Set(messages
        .map(message => message.reply_to)
        .filter(id => id && !messages.some(message => message.id === id)))];
      const nextReplyMessages = new Map();

      if (replyIds.length) {
        try {
          const parentsResult = await supabaseClient.from('chat_messages')
            .select('id,conversation_id,sender_id,content,deleted_at,created_at')
            .eq('conversation_id', conversationId)
            .in('id', replyIds);
          if (isCurrent() && !parentsResult?.error) {
            (parentsResult?.data || []).forEach(parent => nextReplyMessages.set(parent.id, parent));
          }
        } catch (error) {
          console.warn('Optional reply-parent lookup failed:', error?.message || error);
        }
      }
      if (!isCurrent()) return false;

      const enrichments = await Promise.allSettled([
        Promise.resolve().then(() => loadMessageReactions(conversationId, messages, requestId)),
        Promise.resolve().then(() => loadMessagePins(conversationId, requestId)),
        Promise.resolve().then(() => loadPrivateReplyContexts(conversationId, messages, requestId))
      ]);
      enrichments.forEach((outcome, index) => {
        if (outcome.status === 'rejected') {
          console.warn('Optional message metadata failed:', index, outcome.reason?.message || outcome.reason);
        }
      });
      if (!isCurrent()) return false;

      // Reconcile inserts received while the database and metadata requests were in flight.
      messages = mergeWindow(
        messages.concat(state.messages || []),
        fetchedRows,
        conversationId,
        syncStartedAt,
        clearedBefore,
        compare
      );
      if (!isCurrent()) return false;

      const wasNearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 160;
      const anchor = Array.from(area.querySelectorAll?.('.message') || [])
        .find(node => node.getBoundingClientRect().bottom > area.getBoundingClientRect().top);
      const anchorId = anchor?.dataset?.messageId || null;
      const anchorTop = anchor?.getBoundingClientRect?.().top ?? 0;

      // Commit the new model and rebuild only after the authoritative fetch succeeded.
      state.messages = messages;
      state.replyMessages = nextReplyMessages;
      area.replaceChildren();
      state.messageIds.clear();

      if (!messages.length) {
        area.replaceChildren(makeStatus(
          documentRef,
          'بداية محادثة جديدة',
          'أرسل أول رسالة لبدء التواصل.',
          false
        ));
      } else {
        const renderStartedAt = performanceRef.now();
        for (const message of messages) {
          if (!isCurrent()) return false;
          const rendered = await renderMessage(message, conversationId, requestId);
          if (!rendered && !state.messageIds.has(message.id)) allMessagesRendered = false;
        }
        if (!isCurrent()) return false;

        if (allMessagesRendered) {
          if (wasNearBottom || !sameConversationTimeline) {
            area.scrollTop = area.scrollHeight;
          } else if (anchorId) {
            const restored = Array.from(area.querySelectorAll?.('.message') || [])
              .find(node => node.dataset?.messageId === anchorId);
            if (restored) area.scrollTop += restored.getBoundingClientRect().top - anchorTop;
          }
        }
        recordPerf('message_render_batch', performanceRef.now() - renderStartedAt, {
          rows: messages.length,
          complete: allMessagesRendered
        });
      }

      if (!allMessagesRendered) {
        // Roll back the entire DOM/model commit; a partial timeline is not a valid state.
        if (isCurrent()) {
          area.replaceChildren(...(sameConversationTimeline ? originalNodes : [
            makeStatus(documentRef, 'تعذر عرض الرسائل', 'اضغط تحديث لإعادة المحاولة.', false)
          ]));
          state.messages = originalMessages;
          state.messageIds.clear();
          originalIds.forEach(id => state.messageIds.add(id));
          state.replyMessages = originalReplyMessages;
          state.messageTimelineConversationId = sameConversationTimeline
            ? conversationId
            : null;
          state.isLoadingMessages = false;
          state.diagnostics.lastFetchError = 'message_render_incomplete';
          diagLog('render-rollback', { conversationId, requestId });
          toast('تعذر إكمال عرض الرسائل؛ احتفظنا بالعرض السابق دون فقد البيانات.');
        }
        return false;
      }

      if (!isCurrent()) return false;
      state.messageTimelineConversationId = conversationId;
      state.hasMoreMessages = fetchedRows.length === 50;
      state.messagePollLastCheckedAt = syncStartedAt;
      state.messagePollCursor = fetchedRows[0]
        ? { conversationId, created_at: fetchedRows[0].created_at, id: fetchedRows[0].id }
        : null;
      state.diagnostics.lastFetchAt = new Date().toLocaleTimeString('en-GB');
      state.diagnostics.lastFetchCount = fetchedRows.length;
      state.diagnostics.lastFetchError = null;
      state.isLoadingMessages = false;
      diagLog('fetch-success', { count: fetchedRows.length, rendered: messages.length, requestId });

      if (allMessagesRendered) {
        try {
          await markConversationReceipt(
            conversationId,
            documentRef.visibilityState === 'visible',
            requestId
          );
        } catch (error) {
          console.warn('Message receipt update failed:', error?.message || error);
        }
      }

      recordPerf('message_load_total', performanceRef.now() - startedAt, {
        success: true,
        rows: messages.length
      });
      return true;
    } catch (error) {
      recordPerf('message_load_total', performanceRef.now() - startedAt, { success: false });
      console.error('Message loading failed:', error);
      if (isCurrent()) {
        state.isLoadingMessages = false;
        state.diagnostics.lastFetchError = String(error?.message || error);
        diagLog('fetch-error', { error: state.diagnostics.lastFetchError, requestId });

        if (!sameConversationTimeline) {
          area.replaceChildren(makeStatus(
            documentRef,
            'تعذر تحميل الرسائل',
            'لم نفقد بياناتك. اضغط تحديث لإعادة المحاولة.',
            false
          ));
        }
        toast('تعذر استرجاع الرسائل؛ لم يتم مسح المحادثة السابقة.');
      }
      return false;
    } finally {
      if (isCurrent()) state.isLoadingMessages = false;
    }
  }

  root.BizmindMessageLoader = Object.freeze({ loadMessages });
})(typeof window !== 'undefined' ? window : globalThis);
