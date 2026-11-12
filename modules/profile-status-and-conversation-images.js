(() => {
  'use strict';

  const CONVERSATION_BUCKET = 'conversation-avatars';
  const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
  const SIGNED_URL_TTL_SECONDS = 3600;
  const signedImageCache = new Map();
  let conversationImageChannel = null;

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

  function initConversationImageSurface() {
    setupConversationImageControls();
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const opened = [...document.querySelectorAll('.bz-feature-modal.open')].at(-1);
      if (opened) closeModal(opened);
    });
    if (currentUserId()) subscribeConversationImageRealtime();
  }

  const originalEnterApp = enterApp;
  enterApp = async function(user) {
    const result = await originalEnterApp.apply(this, arguments);
    if (result) { subscribeConversationImageRealtime(); refreshConversationListImages(); }
    return result;
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initConversationImageSurface, { once: true });
  else initStatusSurface();

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (session?.user) setTimeout(subscribeConversationImageRealtime, 0);
    else {
      if (conversationImageChannel) supabaseClient.removeChannel(conversationImageChannel);
      conversationImageChannel = null;
      signedImageCache.clear();
    }
  });
})();
