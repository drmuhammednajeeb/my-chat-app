// التهيئة ومفاتيح الاتصال
const SUPABASE_URL = 'https://lvkeohpuocuklagvwpnq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_3OM0vlZU0dkqK4X6aoGZsA_ZBawbyDR';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// عناصر الشاشة
const messagesContainer = document.getElementById('messagesContainer');
const usernameInput = document.getElementById('username');
const roomInput = document.getElementById('roomInput');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const statusIndicator = document.getElementById('statusIndicator');
const typingIndicator = document.getElementById('typingIndicator');
const emptyState = document.getElementById('emptyState');
const soundToggle = document.getElementById('soundToggle');
const toast = document.getElementById('toast');

let isSoundMuted = false;
let typingTimeout = null;
let currentChannel = null;
const loadedMsgIds = new Set();

// تنظيف النصوص ضد ثغرات XSS
function escapeHTML(str) {
  const p = document.createElement('p');
  p.textContent = str;
  return p.innerHTML;
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

// إنشاء صوت تنبيه عند استقبال رسالة
function playNotificationSound() {
  if (isSoundMuted) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = 600;
  gain.gain.setValueAtTime(0.1, ctx.currentTime);
  osc.start();
  osc.stop(ctx.currentTime + 0.15);
}

// استعادة بيانات الجلسة المحلية
usernameInput.value = localStorage.getItem('ultra_username') || '';
roomInput.value = localStorage.getItem('ultra_room') || 'general';

usernameInput.addEventListener('input', () => {
  localStorage.setItem('ultra_username', usernameInput.value.trim());
  validateForm();
});

roomInput.addEventListener('change', () => {
  localStorage.setItem('ultra_room', roomInput.value.trim());
  initChatRoom();
});

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
  validateForm();
  sendTypingSignal();
});

function validateForm() {
  const hasUser = usernameInput.value.trim().length > 0;
  const hasText = messageInput.value.trim().length > 0;
  sendBtn.disabled = !(hasUser && hasText);
}

// رسم الرسائل على الصفحة
function renderMessage(msg) {
  if (loadedMsgIds.has(msg.id)) return;
  if (msg.id) loadedMsgIds.add(msg.id);

  if (emptyState) emptyState.classList.add('hidden');

  const me = usernameInput.value.trim();
  const isMe = msg.sender === me;

  const wrapper = document.createElement('div');
  wrapper.className = `msg-wrapper ${isMe ? 'me' : 'other'}`;

  const timeStr = msg.created_at
    ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  wrapper.innerHTML = `
    <span class="msg-header">${escapeHTML(msg.sender || 'مجهول')}</span>
    <div class="msg-bubble">
      ${escapeHTML(msg.content)}
      <div class="msg-meta">
        <span>${timeStr}</span>
        ${isMe ? '<span>✓</span>' : ''}
      </div>
    </div>
  `;

  messagesContainer.appendChild(wrapper);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  if (!isMe) playNotificationSound();
}

// جلب الرسائل من قاعدة البيانات
async function fetchRoomMessages() {
  messagesContainer.innerHTML = '';
  loadedMsgIds.clear();

  const currentRoom = roomInput.value.trim() || 'general';

  const { data, error } = await supabaseClient
    .from('messages')
    .select('*')
    .or(`receiver.eq.${currentRoom},receiver.is.null`)
    .order('created_at', { ascending: true });

  if (error) {
    showToast('خطأ في جلب بيانات المحادثة');
    return;
  }

  if (data.length === 0) {
    emptyState.classList.remove('hidden');
    messagesContainer.appendChild(emptyState);
  } else {
    data.forEach(renderMessage);
  }
}

// إرسال الرسالة
async function sendMessage() {
  const sender = usernameInput.value.trim();
  const receiver = roomInput.value.trim() || 'general';
  const content = messageInput.value.trim();

  if (!sender || !content) return;

  messageInput.value = '';
  messageInput.style.height = 'auto';
  validateForm();

  const { error } = await supabaseClient
    .from('messages')
    .insert([{ sender, receiver, content }]);

  if (error) {
    showToast('فشل الإرسال، اعد المحاولة');
  }
}

// الاتصال المباشر (Realtime Broadcast & Presence)
function initChatRoom() {
  if (currentChannel) {
    supabaseClient.removeChannel(currentChannel);
  }

  const room = roomInput.value.trim() || 'general';
  
  currentChannel = supabaseClient.channel(`room:${room}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      renderMessage(payload.new);
    })
    .on('broadcast', { event: 'typing' }, payload => {
      if (payload.payload.sender !== usernameInput.value.trim()) {
        showTypingIndicator();
      }
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        statusIndicator.classList.add('connected');
      } else {
        statusIndicator.classList.remove('connected');
      }
    });

  fetchRoomMessages();
}

// إرسال إشارة جاري الكتابة
function sendTypingSignal() {
  if (!currentChannel) return;
  currentChannel.send({
    type: 'broadcast',
    event: 'typing',
    payload: { sender: usernameInput.value.trim() }
  });
}

function showTypingIndicator() {
  typingIndicator.classList.remove('hidden');
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    typingIndicator.classList.add('hidden');
  }, 2000);
}

// الأزرار والأحداث
sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

soundToggle.addEventListener('click', () => {
  isSoundMuted = !isSoundMuted;
  soundToggle.textContent = isSoundMuted ? '🔕' : '🔔';
});

// بدء التشغيل
validateForm();
initChatRoom();
