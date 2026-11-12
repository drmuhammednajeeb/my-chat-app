(() => {
  'use strict';

  const STATUS_BUCKET = 'profile-status-media';
  const CONVERSATION_BUCKET = 'conversation-avatars';
  const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
  const SIGNED_URL_TTL_SECONDS = 3600;
  const signedImageCache = new Map();
  let statusRows = [];
  let statusesByUser = new Map();
  let statusRequestVersion = 0;
  let statusChannel = null;
  let conversationImageChannel = null;
  let statusExpiryTimer = null;
  let statusPreviewUrl = null;
  let statusViewerUserId = null;
  let statusViewerIndex = 0;
  let statusViewerRenderVersion = 0;

  const byId = id => document.getElementById(id);
  const safeText = (value, fallback = '') => String(value || fallback);
  const initials = value => safeText(value, 'U').trim().slice(0, 1).toUpperCase() || 'U';
  const currentUserId = () => state.user?.id || null;

  function makeModal(id, className, title) {
    let modal = byId(id);
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = id;
    modal.className = 'bz-feature-modal ' + className;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = '<section class="bz-feature-dialog" role="dialog" aria-modal="true" aria-labelledby="' + id + 'Title"><header><strong id="' + id + 'Title"></strong><button type="button" class="bz-feature-close" aria-label="إغلاق">×</button></header><div class="bz-feature-body"></div></section>';
    modal.querySelector('#' + id + 'Title').textContent = title;
    modal.querySelector('.bz-feature-close').addEventListener('click', () => closeModal(modal));
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(modal); });
    document.body.append(modal);
    return modal;
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function openModal(modal) {
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function getStatusModal() {
    const modal = makeModal('profileStatusComposer', 'bz-status-composer', 'إضافة حالة');
    const body = modal.querySelector('.bz-feature-body');
    if (!body.dataset.ready) {
      body.dataset.ready = '1';
      body.innerHTML = '<p class="bz-feature-hint">اختر كتابة حالة أو نشر صورة. تختفي الحالة تلقائياً بعد 24 ساعة.</p><textarea id="profileStatusText" maxlength="280" rows="4" placeholder="بماذا تفكر؟"></textarea><label class="bz-file-pick">اختيار صورة <input id="profileStatusImage" type="file" accept="image/jpeg,image/png,image/webp"></label><div id="profileStatusPreview" class="bz-image-preview" hidden></div><div class="bz-feature-actions"><button id="profileStatusCancel" type="button" class="bz-secondary">إلغاء</button><button id="profileStatusPublish" type="button" class="bz-primary">نشر الحالة</button></div><p id="profileStatusMessage" class="bz-feature-message" role="status"></p>';
      const text = byId('profileStatusText');
      const image = byId('profileStatusImage');
      text.addEventListener('input', () => { if (text.value.trim()) image.disabled = true; else image.disabled = false; });
      image.addEventListener('change', () => {
        const file = image.files?.[0];
        if (!file) { clearStatusPreview(); text.disabled = false; return; }
        if (!IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) {
          image.value = '';
          toast('اختر JPG أو PNG أو WebP بحجم لا يتجاوز 3 ميجابايت');
          return;
        }
        text.value = '';
        text.disabled = true;
        showStatusPreview(file);
      });
      byId('profileStatusCancel').onclick = () => { clearStatusComposer(); closeModal(modal); };
      byId('profileStatusPublish').onclick = publishProfileStatus;
    }
    return modal;
  }

  function clearStatusPreview() {
    if (statusPreviewUrl) URL.revokeObjectURL(statusPreviewUrl);
    statusPreviewUrl = null;
    const preview = byId('profileStatusPreview');
    if (preview) { preview.replaceChildren(); preview.hidden = true; }
  }

  function showStatusPreview(file) {
    clearStatusPreview();
    statusPreviewUrl = URL.createObjectURL(file);
    const preview = byId('profileStatusPreview');
    const image = document.createElement('img');
    image.src = statusPreviewUrl;
    image.alt = 'معاينة الحالة';
    preview.replaceChildren(image);
    preview.hidden = false;
  }

  function clearStatusComposer() {
    clearStatusPreview();
    if (byId('profileStatusText')) { byId('profileStatusText').value = ''; byId('profileStatusText').disabled = false; }
    if (byId('profileStatusImage')) { byId('profileStatusImage').value = ''; byId('profileStatusImage').disabled = false; }
    if (byId('profileStatusMessage')) byId('profileStatusMessage').textContent = '';
    if (byId('profileStatusPublish')) byId('profileStatusPublish').disabled = false;
  }

  async function publishProfileStatus() {
    const userId = currentUserId();
    if (!userId) return toast('سجّل الدخول أولاً');
    const text = byId('profileStatusText').value.trim();
    const file = byId('profileStatusImage').files?.[0] || null;
    if ((!text && !file) || (text && file)) return toast('اختر كتابة الحالة أو صورة فقط');
    if (text.length > 280) return toast('الحد الأقصى للحالة النصية 280 حرفاً');
    if (file && (!IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES)) return toast('الصورة غير مدعومة أو أكبر من 3 ميجابايت');
    const button = byId('profileStatusPublish');
    const message = byId('profileStatusMessage');
    button.disabled = true;
    message.textContent = 'جارٍ نشر الحالة…';
    const statusId = crypto.randomUUID();
    let path = null;
    try {
      if (file) {
        const prepared = await prepareAvatarImage(file);
        const extension = prepared.type === 'image/png' ? 'png' : prepared.type === 'image/jpeg' ? 'jpg' : 'webp';
        path = userId + '/' + statusId + '.' + extension;
        const upload = await supabaseClient.storage.from(STATUS_BUCKET).upload(path, prepared.blob, {
          contentType: prepared.type, cacheControl: '60', upsert: false
        });
        if (upload.error) throw upload.error;
      }
      const { data, error } = await supabaseClient.from('profile_statuses').insert({
        id: statusId, user_id: userId, content: text || null, image_path: path
      }).select('id,user_id,content,image_path,created_at,expires_at').single();
      if (error) throw error;
      if (!data) throw new Error('لم يتم استلام الحالة بعد الحفظ');
      clearStatusComposer();
      closeModal(byId('profileStatusComposer'));
      toast('تم نشر الحالة وستنتهي بعد 24 ساعة');
      await loadProfileStatuses();
    } catch (error) {
      if (path) await supabaseClient.storage.from(STATUS_BUCKET).remove([path]).catch(() => {});
      console.error('Profile status publish failed:', error);
      message.textContent = error.message || 'تعذر نشر الحالة. حاول مرة أخرى';
      toast('تعذر نشر الحالة');
    } finally {
      button.disabled = false;
    }
  }

  function groupStatuses(rows) {
    const grouped = new Map();
    (rows || []).forEach(row => {
      if (!grouped.has(row.user_id)) grouped.set(row.user_id, []);
      grouped.get(row.user_id).push(row);
    });
    grouped.forEach(items => items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
    return grouped;
  }

  async function loadProfileStatuses() {
    const userId = currentUserId();
    if (!userId) return;
    const request = ++statusRequestVersion;
    const now = new Date().toISOString();
    const { data, error } = await supabaseClient.from('profile_statuses')
      .select('id,user_id,content,image_path,created_at,expires_at,profiles(id,username,display_name,avatar_url)')
      .gt('expires_at', now)
      .order('created_at', { ascending: false })
      .limit(250);
    if (request !== statusRequestVersion || currentUserId() !== userId) return;
    if (error) {
      console.warn('Profile statuses unavailable:', error);
      return;
    }
    statusRows = data || [];
    statusesByUser = groupStatuses(statusRows);
    renderStatusStrip();
  }

  function renderStatusStrip() {
    const profile = document.querySelector('.profile');
    if (!profile || !currentUserId()) return;
    let strip = byId('profileStatusStrip');
    if (!strip) {
      strip = document.createElement('div');
      strip.id = 'profileStatusStrip';
      strip.className = 'bz-status-strip';
      profile.insertAdjacentElement('afterend', strip);
    }
    strip.replaceChildren();
    const own = statusesByUser.get(currentUserId()) || [];
    strip.append(makeStatusButton(state.profile, own, true));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'bz-status-add';
    add.textContent = '+ إضافة حالة';
    add.onclick = () => { clearStatusComposer(); openModal(getStatusModal()); };
    strip.append(add);
    const otherUsers = [...statusesByUser.keys()].filter(id => id !== currentUserId());
    otherUsers.sort((a, b) => {
      const aa = statusesByUser.get(a)?.at(-1)?.created_at || '';
      const bb = statusesByUser.get(b)?.at(-1)?.created_at || '';
      return new Date(bb) - new Date(aa);
    });
    otherUsers.forEach(id => {
      const rows = statusesByUser.get(id) || [];
      const profileRow = rows[0]?.profiles || {};
      strip.append(makeStatusButton(profileRow, rows, false));
    });
  }

  function makeStatusButton(profile, rows, own) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bz-status-user';
    button.title = own ? 'مشاهدة حالتي' : 'مشاهدة حالة ' + safeText(profile?.display_name, 'المستخدم');
    const ring = document.createElement('span');
    ring.className = 'bz-status-ring' + (rows.length ? ' has-status' : '');
    if (profile?.avatar_url && /^https:\/\//i.test(profile.avatar_url)) {
      const image = document.createElement('img');
      image.src = profile.avatar_url;
      image.alt = '';
      image.loading = 'lazy';
      ring.append(image);
    } else {
      const fallback = document.createElement('span');
      fallback.textContent = initials(profile?.display_name || profile?.username);
      ring.append(fallback);
    }
    const name = document.createElement('small');
    name.textContent = own ? 'حالتي' : safeText(profile?.display_name || profile?.username, 'مستخدم');
    button.append(ring, name);
    button.onclick = () => rows.length ? openStatusViewer(rows[0]?.user_id || profile?.id || currentUserId()) : openModal(getStatusModal());
    return button;
  }

  async function openStatusViewer(userId) {
    const rows = statusesByUser.get(userId) || [];
    if (!rows.length) { await loadProfileStatuses(); }
    const refreshed = statusesByUser.get(userId) || [];
    if (!refreshed.length) return toast('لا توجد حالة نشطة لهذا المستخدم');
    statusViewerUserId = userId;
    statusViewerIndex = 0;
    await renderStatusViewer();
  }

  async function renderStatusViewer() {
    const renderVersion = ++statusViewerRenderVersion;
    const rows = statusesByUser.get(statusViewerUserId) || [];
    if (!rows.length) { closeModal(byId('profileStatusViewer')); await loadProfileStatuses(); return; }
    statusViewerIndex = Math.max(0, Math.min(statusViewerIndex, rows.length - 1));
    const row = rows[statusViewerIndex];
    const profile = row.profiles || {};
    const modal = makeModal('profileStatusViewer', 'bz-status-viewer', 'الحالة الشخصية');
    const body = modal.querySelector('.bz-feature-body');
    body.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'bz-status-viewer-heading';
    heading.textContent = safeText(profile.display_name || profile.username, 'مستخدم') + ' · ' + new Date(row.created_at).toLocaleString('ar-SA');
    const content = document.createElement('div');
    content.className = 'bz-status-content';
    if (row.image_path) {
      const { data, error } = await supabaseClient.storage.from(STATUS_BUCKET).createSignedUrl(row.image_path, 60);
      if (renderVersion !== statusViewerRenderVersion) return;
      if (error || !data?.signedUrl) {
        toast('انتهت صلاحية الصورة أو تعذر تحميلها');
        await loadProfileStatuses();
        return;
      }
      const image = document.createElement('img');
      image.src = data.signedUrl;
      image.alt = 'حالة شخصية';
      content.append(image);
    } else {
      const paragraph = document.createElement('p');
      paragraph.textContent = row.content || '';
      content.append(paragraph);
    }
    const footer = document.createElement('div');
    footer.className = 'bz-feature-actions';
    const previous = document.createElement('button');
    previous.type = 'button'; previous.className = 'bz-secondary'; previous.textContent = 'السابق';
    previous.disabled = statusViewerIndex === 0;
    previous.onclick = () => { statusViewerIndex--; renderStatusViewer(); };
    const next = document.createElement('button');
    next.type = 'button'; next.className = 'bz-primary'; next.textContent = statusViewerIndex === rows.length - 1 ? 'إغلاق' : 'التالي';
    next.onclick = () => { if (statusViewerIndex < rows.length - 1) { statusViewerIndex++; renderStatusViewer(); } else closeModal(modal); };
    footer.append(previous, next);
    if (statusViewerUserId === currentUserId()) {
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'bz-danger'; remove.textContent = 'حذف الحالة';
      remove.onclick = async () => {
        remove.disabled = true;
        const { error } = await supabaseClient.from('profile_statuses').delete().eq('id', row.id).eq('user_id', currentUserId());
        if (error) { remove.disabled = false; toast('تعذر حذف الحالة'); return; }
        if (row.image_path) await supabaseClient.storage.from(STATUS_BUCKET).remove([row.image_path]);
        toast('تم حذف الحالة');
        await loadProfileStatuses();
        const remaining = statusesByUser.get(statusViewerUserId) || [];
        if (!remaining.length) closeModal(modal);
        else { statusViewerIndex = Math.min(statusViewerIndex, remaining.length - 1); renderStatusViewer(); }
      };
      footer.append(remove);
    }
    body.append(heading, content, footer);
    openModal(modal);
  }

  function canManageConversation(conversation) {
    if (!conversation || !['group', 'channel'].includes(conversation.type) || !currentUserId()) return false;
    const member = (conversation.members || []).find(item => item.user_id === currentUserId());
    return conversation.created_by === currentUserId() || ['owner', 'admin'].includes(member?.role);
  }

  async function getConversationImageUrl(path) {
    if (!path) return null;
    const cached = signedImageCache.get(path);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    const { data, error } = await supabaseClient.storage.from(CONVERSATION_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      signedImageCache.delete(path);
      return null;
    }
    signedImageCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + (SIGNED_URL_TTL_SECONDS - 60) * 1000 });
    return data.signedUrl;
  }

  async function decorateConversationAvatar(container, conversation) {
    if (!container || !conversation?.image_path) return;
    const path = conversation.image_path;
    const url = await getConversationImageUrl(path);
    if (!url || !container.isConnected || conversation.image_path !== path) return;
    if (container.id === 'chatAvatar' && state.active?.id !== conversation.id) return;
    if (container.dataset.conversationId && container.dataset.conversationId !== conversation.id) return;
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    container.replaceChildren(image);
    container.classList.add('has-conversation-image');
  }

  function refreshConversationListImages() {
    document.querySelectorAll('.swipe-conversation[data-conversation-id]').forEach(row => {
      const conversation = state.conversations.find(item => item.id === row.dataset.conversationId);
      const avatar = row.querySelector('.conv-avatar');
      if (conversation?.image_path) decorateConversationAvatar(avatar, conversation);
    });
  }

  function openConversationImageEditor() {
    const conversation = state.active;
    if (!canManageConversation(conversation)) return toast('تغيير الصورة متاح لمالك المجموعة أو القناة أو المشرف فقط');
    const modal = makeModal('conversationImageEditor', 'bz-conversation-image-editor', 'صورة المحادثة');
    const body = modal.querySelector('.bz-feature-body');
    body.replaceChildren();
    const hint = document.createElement('p');
    hint.className = 'bz-feature-hint';
    hint.textContent = 'اختر صورة JPG أو PNG أو WebP بحجم لا يتجاوز 3 ميجابايت.';
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
    const preview = document.createElement('div'); preview.className = 'bz-image-preview'; preview.hidden = true;
    let previewUrl = null;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) { input.value = ''; toast('الصورة غير مدعومة أو أكبر من 3 ميجابايت'); return; }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(file);
      const image = document.createElement('img'); image.src = previewUrl; image.alt = 'معاينة صورة المحادثة';
      preview.replaceChildren(image); preview.hidden = false;
    };
    const actions = document.createElement('div'); actions.className = 'bz-feature-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'bz-secondary'; cancel.textContent = 'إلغاء';
    cancel.onclick = () => { if (previewUrl) URL.revokeObjectURL(previewUrl); closeModal(modal); };
    const save = document.createElement('button'); save.type = 'button'; save.className = 'bz-primary'; save.textContent = 'حفظ الصورة';
    save.onclick = async () => {
      const file = input.files?.[0];
      if (!file) return toast('اختر صورة أولاً');
      save.disabled = true;
      let newPath = null;
      try {
        const prepared = await prepareAvatarImage(file);
        const extension = prepared.type === 'image/png' ? 'png' : prepared.type === 'image/jpeg' ? 'jpg' : 'webp';
        newPath = conversation.id + '/' + currentUserId() + '/' + crypto.randomUUID() + '.' + extension;
        const { error: uploadError } = await supabaseClient.storage.from(CONVERSATION_BUCKET).upload(newPath, prepared.blob, {
          contentType: prepared.type, cacheControl: '3600', upsert: false
        });
        if (uploadError) throw uploadError;
        const oldPath = conversation.image_path || null;
        const { error: updateError } = await supabaseClient.rpc('set_conversation_image', {
          p_conversation_id: conversation.id, p_image_path: newPath
        });
        if (updateError) throw updateError;
        conversation.image_path = newPath;
        state.conversations.forEach(item => { if (item.id === conversation.id) item.image_path = newPath; });
        if (oldPath) await supabaseClient.storage.from(CONVERSATION_BUCKET).remove([oldPath]);
        signedImageCache.delete(oldPath);
        signedImageCache.delete(newPath);
        renderConversations();
        renderChatAvatar(conversation);
        toast('تم تحديث صورة المحادثة');
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        closeModal(modal);
      } catch (error) {
        if (newPath) await supabaseClient.storage.from(CONVERSATION_BUCKET).remove([newPath]);
        console.error('Conversation image update failed:', error);
        toast(error.message || 'تعذر تحديث صورة المحادثة');
        save.disabled = false;
      }
    };
    if (conversation.image_path) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'bz-danger'; remove.textContent = 'إزالة الصورة';
      remove.onclick = async () => {
        remove.disabled = true;
        const oldPath = conversation.image_path;
        const { error } = await supabaseClient.rpc('set_conversation_image', { p_conversation_id: conversation.id, p_image_path: null });
        if (error) { remove.disabled = false; toast('تعذر إزالة الصورة'); return; }
        conversation.image_path = null;
        state.conversations.forEach(item => { if (item.id === conversation.id) item.image_path = null; });
        await supabaseClient.storage.from(CONVERSATION_BUCKET).remove([oldPath]);
        signedImageCache.delete(oldPath);
        renderConversations(); renderChatAvatar(conversation); closeModal(modal); toast('تمت إزالة الصورة');
      };
      actions.append(remove);
    }
    actions.append(cancel, save);
    body.append(hint, input, preview, actions);
    openModal(modal);
  }

  function setupConversationImageControls() {
    const chatAvatar = byId('chatAvatar');
    if (chatAvatar) {
      chatAvatar.title = 'فتح الملف الشخصي أو إدارة صورة المجموعة/القناة';
      chatAvatar.onclick = () => {
        if (['group', 'channel'].includes(state.active?.type)) openConversationImageEditor();
        else if (state.active?.type === 'direct') openProfileModal(otherMember(state.active), false);
      };
    }
    const originalRenderAvatar = renderChatAvatar;
    renderChatAvatar = function(conversation) {
      originalRenderAvatar(conversation);
      if (conversation?.image_path) {
        const target = byId('chatAvatar');
        if (target) target.dataset.conversationId = conversation.id;
        decorateConversationAvatar(target, conversation);
      }
    };
    const originalRenderConversations = renderConversations;
    renderConversations = function() {
      const result = originalRenderConversations.apply(this, arguments);
      refreshConversationListImages();
      return result;
    };
    const originalRenderMyChannels = renderMyChannels;
    renderMyChannels = function() {
      const result = originalRenderMyChannels.apply(this, arguments);
      document.querySelectorAll('.channel-card[data-conversation-id]').forEach(card => {
        const conversation = state.conversations.find(item => item.id === card.dataset.conversationId);
        const icon = card.querySelector('.channel-card-icon');
        if (conversation?.image_path && icon) decorateConversationAvatar(icon, conversation);
      });
      return result;
    };
    const originalOpenGroupManagement = openGroupManagement;
    openGroupManagement = async function() {
      const result = await originalOpenGroupManagement.apply(this, arguments);
      const body = byId('groupManagementBody');
      const conversation = state.active;
      if (body && conversation?.type === 'group' && canManageConversation(conversation) && !body.querySelector('[data-conversation-image-control]')) {
        const section = document.createElement('section');
        section.className = 'group-management-section';
        section.dataset.conversationImageControl = '1';
        const title = document.createElement('h3'); title.textContent = 'صورة المجموعة';
        const button = document.createElement('button'); button.type = 'button'; button.className = 'group-management-btn'; button.textContent = 'تغيير صورة المجموعة';
        button.onclick = openConversationImageEditor;
        section.append(title, button); body.prepend(section);
      }
      return result;
    };
  }

  function subscribeConversationImageRealtime() {
    if (!currentUserId() || conversationImageChannel) return;
    conversationImageChannel = supabaseClient.channel('conversation-images:' + currentUserId())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, payload => {
        const updated = payload?.new;
        if (!updated?.id) return;
        const conversation = state.conversations.find(item => item.id === updated.id);
        if (!conversation || conversation.image_path === updated.image_path) return;
        conversation.image_path = updated.image_path || null;
        if (state.active?.id === updated.id) {
          state.active.image_path = updated.image_path || null;
          renderChatAvatar(state.active);
        }
        renderConversations();
        if (state.sidebarView === 'channels') renderMyChannels();
      })
      .subscribe(status => { if (status !== 'SUBSCRIBED') console.warn('Conversation image realtime:', status); });
  }

  function subscribeStatusRealtime() {
    if (!currentUserId() || statusChannel) return;
    statusChannel = supabaseClient.channel('profile-statuses:' + currentUserId())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profile_statuses' }, () => loadProfileStatuses())
      .subscribe(status => { if (status !== 'SUBSCRIBED') console.warn('Profile status realtime:', status); });
  }

  function initStatusSurface() {
    const profile = document.querySelector('.profile');
    if (profile && !byId('profileStatusStrip')) {
      const strip = document.createElement('div');
      strip.id = 'profileStatusStrip'; strip.className = 'bz-status-strip';
      profile.insertAdjacentElement('afterend', strip);
    }
    setupConversationImageControls();
    if (!statusExpiryTimer) statusExpiryTimer = setInterval(() => {
      if (currentUserId() && document.visibilityState === 'visible') loadProfileStatuses();
    }, 60000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && currentUserId()) loadProfileStatuses();
    });
    window.addEventListener('focus', () => { if (currentUserId()) loadProfileStatuses(); });
    if (currentUserId()) { subscribeStatusRealtime(); loadProfileStatuses(); }
  }

  const originalEnterApp = enterApp;
  enterApp = async function(user) {
    const result = await originalEnterApp.apply(this, arguments);
    if (result) {
      subscribeStatusRealtime();
      subscribeConversationImageRealtime();
      await loadProfileStatuses();
      refreshConversationListImages();
    }
    return result;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initStatusSurface, { once: true });
  else initStatusSurface();

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      setTimeout(() => { subscribeStatusRealtime(); subscribeConversationImageRealtime(); loadProfileStatuses(); }, 0);
    } else {
      statusRows = []; statusesByUser = new Map(); statusRequestVersion++;
      if (statusChannel) supabaseClient.removeChannel(statusChannel);
      if (conversationImageChannel) supabaseClient.removeChannel(conversationImageChannel);
      statusChannel = null;
      conversationImageChannel = null;
      byId('profileStatusStrip')?.remove();
    }
  });
})();
