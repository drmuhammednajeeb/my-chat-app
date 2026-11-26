/* Complete message-loading lifecycle.
 * Owns the initial fetch, reconciliation, safe timeline commit and rollback.
 * The application supplies its existing renderer and Supabase client.
 */
(function (root) {
  'use strict';
  const logger = root.console || { warn() {}, error() {} };

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

  function messageRevisionTime(message) {
    const values = [message?.updated_at, message?.edited_at, message?.deleted_at]
      .map(value => Date.parse(value || ''))
      .filter(Number.isFinite);
    return values.length ? Math.max(...values) : (Date.parse(message?.created_at || '') || 0);
  }

  function mergeWindow(currentRows, fetchedRows, conversationId, syncStartedAt, clearedBefore, compare, loadedHistoryIds) {
    const fetchedIds = new Set((fetchedRows || []).map(row => row.id));
    const newestFetched = fetchedRows?.[0] || null;
    const oldestFetched = fetchedRows?.[fetchedRows.length - 1] || null;
    const loadedHistory = loadedHistoryIds && typeof loadedHistoryIds.has === 'function' ? loadedHistoryIds : new Set();
    const merged = new Map();

    for (const row of currentRows || []) {
      if (!row || row.conversation_id !== conversationId || !isAfterClear(row, clearedBefore)) continue;
      const isFetched = fetchedIds.has(row.id);
      const isNewerRealtime = !!newestFetched && compare(row, newestFetched) > 0;
      const isExplicitlyLoadedHistory = loadedHistory.has(row.id);
      const isOlderLoadedHistory = fetchedRows?.length === 50 && !!oldestFetched && compare(row, oldestFetched) < 0;
      const arrivedDuringEmptyFetch = !newestFetched && Date.parse(row.created_at) >= Date.parse(syncStartedAt);
      if (isFetched || isNewerRealtime || isExplicitlyLoadedHistory || isOlderLoadedHistory || arrivedDuringEmptyFetch) {
        merged.set(row.id, row);
      }
    }

    // Refresh from the server, but do not overwrite a newer realtime edit or
    // tombstone that arrived while the request was in flight.
    for (const row of fetchedRows || []) {
      if (!row || row.conversation_id !== conversationId || !isAfterClear(row, clearedBefore)) continue;
      const existing = merged.get(row.id);
      if (existing && messageRevisionTime(existing) > messageRevisionTime(row)) continue;
      merged.set(row.id, row);
    }

    return Array.from(merged.values()).sort(compare);
  }
  function loadMessages(deps) {
    const state = deps?.state;
    const requestedConversationId = state?.active?.id;
    if (!requestedConversationId) return Promise.resolve(false);
    const requestId = (Number(state.messageLoadVersion) || 0) + 1;
    state.messageLoadVersion = requestId;

    // Serialize commits to the same timeline. A newer request invalidates the
    // active request immediately, then starts only after its rollback completes.
    const previous = state.messageLoadPromise;
    const operation = Promise.resolve(previous)
      .catch(() => false)
      .then(() => {
        if (state.messageLoadVersion !== requestId || state.active?.id !== requestedConversationId) return false;
        return runLoadMessages(deps, requestId, requestedConversationId);
      });
    state.messageLoadPromise = operation;
    return operation.finally(() => {
      if (state.messageLoadPromise === operation) state.messageLoadPromise = null;
    });
  }

  async function runLoadMessages(deps, requestId, requestedConversationId) {
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

    const conversationId = requestedConversationId;
    if (!conversationId || typeof renderMessage !== 'function' || typeof compare !== 'function') return false;

    const startedAt = performanceRef.now();
    const syncStartedAt = new Date(Date.now() - 60000).toISOString();
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
    const originalTimelineId = state.messageTimelineConversationId;

    const rollbackOwnedRender = () => {
      if (state.active?.id !== conversationId || state.messageTimelineRenderOwner !== requestId) return false;
      area.replaceChildren(...(sameConversationTimeline ? originalNodes : [
        makeStatus(documentRef, 'تعذر عرض الرسائل', 'اضغط تحديث لإعادة المحاولة.', false)
      ]));
      state.messages = originalMessages;
      state.messageIds.clear();
      originalIds.forEach(id => state.messageIds.add(id));
      state.replyMessages = originalReplyMessages;
      state.messageTimelineConversationId = originalTimelineId;
      state.messageTimelineRenderOwner = null;
      state.isLoadingMessages = false;
      return true;
    };

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
        compare,
        state.loadedHistoryIds
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
          logger.warn('Optional reply-parent lookup failed:', error?.message || error);
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
          logger.warn('Optional message metadata failed:', index, outcome.reason?.message || outcome.reason);
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
        compare,
        state.loadedHistoryIds
      );
      if (!isCurrent()) return false;

      const wasNearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 160;
      const anchor = Array.from(area.querySelectorAll?.('.message') || [])
        .find(node => node.getBoundingClientRect().bottom > area.getBoundingClientRect().top);
      const anchorId = anchor?.dataset?.messageId || null;
      const anchorTop = anchor?.getBoundingClientRect?.().top ?? 0;

      // Commit the new model and rebuild only after the authoritative fetch succeeded.
      state.messageTimelineRenderOwner = requestId;
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
          if (!isCurrent()) { rollbackOwnedRender(); return false; }
          const rendered = await renderMessage(message, conversationId, requestId);
          if (!rendered && !state.messageIds.has(message.id)) allMessagesRendered = false;
        }
        if (!isCurrent()) { rollbackOwnedRender(); return false; }

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
          rollbackOwnedRender();
          state.diagnostics.lastFetchError = 'message_render_incomplete';
          diagLog('render-rollback', { conversationId, requestId });
          toast('تعذر إكمال عرض الرسائل؛ احتفظنا بالعرض السابق دون فقد البيانات.');
        }
        return false;
      }

      if (!isCurrent()) { rollbackOwnedRender(); return false; }
      state.messageTimelineConversationId = conversationId;
      state.messageTimelineCommitVersion = requestId;
      state.messageTimelineRenderOwner = null;
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
          logger.warn('Message receipt update failed:', error?.message || error);
        }
      }

      recordPerf('message_load_total', performanceRef.now() - startedAt, {
        success: true,
        rows: messages.length
      });
      return true;
    } catch (error) {
      recordPerf('message_load_total', performanceRef.now() - startedAt, { success: false });
      logger.error('Message loading failed:', error);
      rollbackOwnedRender();
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


  function isCurrentRequest(state, requestId, conversationId) {
    return !!conversationId && state?.active?.id === conversationId &&
      Number(state.messageLoadVersion) === requestId;
  }

  function mergeTimeline(currentRows, incomingRows, compare) {
    const rows = new Map();
    for (const row of currentRows || []) if (row?.id) rows.set(row.id, row);
    for (const row of incomingRows || []) {
      if (!row?.id) continue;
      const previous = rows.get(row.id);
      if (!previous || messageRevisionTime(row) >= messageRevisionTime(previous)) rows.set(row.id, row);
    }
    return Array.from(rows.values()).sort(compare);
  }

  async function renderMessage(deps) {
    const { state, message, conversationId = state?.active?.id, requestId = null, render } = deps || {};
    if (!state || !message?.id || !conversationId || typeof render !== 'function' ||
        state.active?.id !== conversationId ||
        (requestId !== null && requestId !== state.messageLoadVersion)) return false;
    if (state.messageIds?.has(message.id)) return true;
    state.messageRenderPromises ||= new Map();
    const pending = state.messageRenderPromises.get(message.id);
    if (pending) {
      const rendered = await pending;
      if (rendered || state.messageIds?.has(message.id)) return true;
      if (state.active?.id !== conversationId ||
          (requestId !== null && requestId !== state.messageLoadVersion)) return false;
      const latest = (state.messages || []).find(item => item.id === message.id);
      if (!latest) return false;
      return renderMessage({ ...deps, message: latest });
    }
    const task = Promise.resolve().then(() => render(message, conversationId, requestId));
    state.messageRenderPromises.set(message.id, task);
    try { return await task; }
    finally {
      if (state.messageRenderPromises.get(message.id) === task) state.messageRenderPromises.delete(message.id);
    }
  }

  function rollbackCancelledOlderHistory(deps, conversationId, olderIds, renderedHistoryIds,
      area, requestId, originalMessageIdSet, requestRowsById, originalLoadedHistoryIds) {
    const { state } = deps;
    if (state.active?.id !== conversationId) return false;
    const newerTimelineAlreadyCommitted = Number(state.messageTimelineCommitVersion) > requestId;
    const newerRenderOwnsTimeline = !!state.messageTimelineRenderOwner &&
      state.messageTimelineRenderOwner !== requestId;
    if (newerTimelineAlreadyCommitted || newerRenderOwnsTimeline) return false;
    const before = state.messages || [];
    const removedIds = new Set();
    state.messages = before.filter(message => {
      if (!olderIds.has(message.id) || originalMessageIdSet?.has(message.id)) return true;
      if (requestRowsById?.get(message.id) !== message) return true;
      removedIds.add(message.id);
      return false;
    });
    removedIds.forEach(id => {
      Array.from(area.querySelectorAll('.message'))
        .filter(node => node.dataset.messageId === id).forEach(node => node.remove());
      state.messageIds.delete(id);
      if (!originalLoadedHistoryIds?.has(id)) state.loadedHistoryIds?.delete(id);
    });
    return true;
  }

  async function loadOlderMessages(deps) {
    const {
      state, $, supabaseClient, document: documentRef,
      loadMessagePins = async () => true,
      loadPrivateReplyContexts = async () => true,
      loadMessageReactions = async () => true,
      renderMessage: render,
      reconcileMessageTimeline: reconcile,
      compareMessagesChronologically: compare,
      toast = () => {},
      logger: log = logger
    } = deps || {};
    const conversationId = state?.active?.id, area = $('messages');
    if (!conversationId || !area || state.loadingOlderMessages || !state.hasMoreMessages ||
        !state.messages?.length || typeof render !== 'function' ||
        typeof reconcile !== 'function' || typeof compare !== 'function') return false;
    const oldest = state.messages[0];
    if (!oldest?.created_at || !oldest?.id) return false;
    const originalMessages = state.messages.slice(), originalHasMore = state.hasMoreMessages;
    const originalMessageIdSet = new Set(originalMessages.map(message => message.id));
    state.loadingOlderMessages = true;
    const requestId = state.messageLoadVersion;
    state.loadingOlderRequestId = requestId;
    const isCurrent = () => isCurrentRequest(state, requestId, conversationId);
    const anchor = Array.from(area.querySelectorAll('.message'))
      .find(node => node.getBoundingClientRect().bottom > area.getBoundingClientRect().top);
    const anchorId = anchor?.dataset.messageId;
    const anchorTop = anchor?.getBoundingClientRect().top ?? 0;
    const oldTop = area.scrollTop;
    const loader = documentRef.createElement('div');
    loader.className = 'messages-history-loader';
    loader.textContent = 'جارٍ تحميل الرسائل الأقدم…';
    area.prepend(loader);
    const originalFirstChild = loader.nextSibling;
    let olderIds = new Set(), renderedHistoryIds = new Set(), requestRowsById = new Map();
    state.loadedHistoryIds ||= new Set();
    const originalLoadedHistoryIds = new Set(state.loadedHistoryIds);
    try {
      const cursorFilter = 'created_at.lt.' + oldest.created_at +
        ',and(created_at.eq.' + oldest.created_at + ',id.lt.' + oldest.id + ')';
      let olderQuery = supabaseClient.from('chat_messages').select('*')
        .eq('conversation_id', conversationId).or(cursorFilter);
      if (state.activeChatPreference?.cleared_before) {
        olderQuery = olderQuery.gt('created_at', state.activeChatPreference.cleared_before);
      }
      const { data, error } = await olderQuery.order('created_at', { ascending: false })
        .order('id', { ascending: false }).limit(50);
      if (error) throw error;
      if (!isCurrent()) return false;
      const older = (data || []).slice().reverse();
      if (!older.length) { state.hasMoreMessages = false; return false; }
      olderIds = new Set(older.map(message => message.id));
      requestRowsById = new Map(older.map(message => [message.id, message]));
      const replyIds = [...new Set(older.map(message => message.reply_to)
        .filter(id => id && !state.messages.some(item => item.id === id)))];
      const replyTask = replyIds.length
        ? supabaseClient.from('chat_messages').select('id,conversation_id,sender_id,content,deleted_at,created_at')
          .eq('conversation_id', conversationId).in('id', replyIds)
        : Promise.resolve({ data: [], error: null });
      const [, , , replyResult] = await Promise.all([
        loadMessagePins(conversationId, requestId),
        loadPrivateReplyContexts(conversationId, older, requestId),
        loadMessageReactions(conversationId, older, requestId),
        replyTask
      ]);
      if (!isCurrent()) {
        rollbackCancelledOlderHistory(deps, conversationId, olderIds, renderedHistoryIds,
          area, requestId, originalMessageIdSet, requestRowsById, originalLoadedHistoryIds);
        return false;
      }
      if (replyResult?.error) log.warn('Older reply metadata unavailable:', replyResult.error.message);
      else (replyResult?.data || []).forEach(parent => state.replyMessages.set(parent.id, parent));
      older.forEach(message => state.loadedHistoryIds.add(message.id));
      state.messages = mergeTimeline(older, state.messages, compare);
      state.hasMoreMessages = older.length === 50;
      state.isLoadingMessages = true;
      state.batchRenderingMessages = true;
      state.batchRenderingConversationId = conversationId;
      area.style.overflowAnchor = 'none';
      const beforeRenderNodes = new Set(Array.from(area.childNodes));
      for (const message of older) {
        if (!isCurrent()) {
          rollbackCancelledOlderHistory(deps, conversationId, olderIds, renderedHistoryIds,
            area, requestId, originalMessageIdSet, requestRowsById, originalLoadedHistoryIds);
          return false;
        }
        if (state.messageIds.has(message.id)) continue;
        if (!originalMessageIdSet.has(message.id)) renderedHistoryIds.add(message.id);
        const rendered = await render(message, conversationId, requestId);
        if (!rendered && !state.messageIds.has(message.id)) {
          throw new Error('Older message rendering did not complete');
        }
      }
      if (!isCurrent()) {
        rollbackCancelledOlderHistory(deps, conversationId, olderIds, renderedHistoryIds,
          area, requestId, originalMessageIdSet, requestRowsById, originalLoadedHistoryIds);
        return false;
      }
      state.batchRenderingMessages = false;
      state.batchRenderingConversationId = null;
      reconcile(area);
      const addedSet = new Set(Array.from(area.querySelectorAll('.message'))
        .filter(node => olderIds.has(node.dataset.messageId) && !beforeRenderNodes.has(node)));
      addedSet.forEach(node => {
        const previous = node.previousElementSibling;
        if (previous?.classList.contains('day-divider') && !beforeRenderNodes.has(previous)) addedSet.add(previous);
      });
      const addedNodes = Array.from(area.childNodes).filter(node => addedSet.has(node));
      const fragment = documentRef.createDocumentFragment();
      addedNodes.forEach(node => fragment.append(node));
      if (fragment.childNodes.length) area.insertBefore(fragment, originalFirstChild);
      loader.remove();
      const restoredAnchor = anchorId
        ? Array.from(area.querySelectorAll('.message')).find(node => node.dataset.messageId === anchorId)
        : null;
      area.scrollTop = restoredAnchor
        ? oldTop + (restoredAnchor.getBoundingClientRect().top - anchorTop)
        : oldTop;
      state.isLoadingMessages = false;
      area.style.overflowAnchor = '';
      return true;
    } catch (error) {
      log.error('Older message loading failed:', error);
      if (isCurrent()) {
        const rollbackApplied = rollbackCancelledOlderHistory(deps, conversationId, olderIds,
          renderedHistoryIds, area, requestId, originalMessageIdSet, requestRowsById, originalLoadedHistoryIds);
        if (rollbackApplied) {
          const restored = new Map(originalMessages.map(message => [message.id, message]));
          for (const message of state.messages || []) {
            if (!originalMessageIdSet.has(message.id)) restored.set(message.id, message);
          }
          state.messages = Array.from(restored.values()).sort(compare);
          state.hasMoreMessages = originalHasMore;
          state.batchRenderingMessages = false;
          state.batchRenderingConversationId = null;
          state.isLoadingMessages = false;
          area.style.overflowAnchor = '';
          reconcile(area);
          toast('تعذر تحميل الرسائل الأقدم؛ احتفظنا بالمحادثة الحالية دون فقد الرسائل.');
        }
      }
      return false;
    } finally {
      if (state.loadingOlderRequestId === requestId) {
        if (state.batchRenderingMessages && state.batchRenderingConversationId === conversationId) {
          state.batchRenderingMessages = false;
          state.batchRenderingConversationId = null;
          if (state.active?.id === conversationId &&
              Number(state.messageTimelineCommitVersion) <= requestId &&
              (!state.messageTimelineRenderOwner || state.messageTimelineRenderOwner === requestId)) {
            reconcile(area);
          }
        }
        state.loadingOlderMessages = false;
        state.loadingOlderRequestId = null;
        if (isCurrent()) state.isLoadingMessages = false;
        area.style.overflowAnchor = '';
      }
      loader.remove();
    }
  }

  root.BizmindMessageLoader = Object.freeze({ loadMessages, loadOlderMessages, renderMessage, mergeWindow, mergeTimeline, isCurrentRequest });
})(typeof window !== 'undefined' ? window : globalThis);
