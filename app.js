// التهيئة والربط مع Supabase
const SUPABASE_URL = 'https://lvkeohpuocuklagvwpnq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_3OM0vlZU0dkqK4X6aoGZsA_ZBawbyDR';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// عناصر الواجهة (DOM Elements)
const messagesBox = document.getElementById('messagesBox');
const usernameInput = document.getElementById('username');
const receiverInput = document.getElementById('receiver');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const toast = document.getElementById('systemToast');
const emptyState = document.getElementById('emptyState');

// حالة التطبيق المحلي
const state = {
  renderedIds: new Set()
};

// حماية النص ضد هجمات XSS
function sanitizeHTML(str) {
  const temp = document.createElement('div');
  temp.textContent = str;
  return temp.innerHTML;
}

// عرض تنبيه للنظام
function showToast(msg, duration = 3000) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), duration);
}

// استعادة وإدارة البيانات المحلية
function initStorage() {
  usernameInput.value = localStorage.getItem('chat_user') || '';
  receiverInput.value = localStorage.getItem('chat_recv') || '';
  validateForm();
}

usernameInput.addEventListener('input', () => {
  localStorage.setItem('chat_user', usernameInput.value.trim());
  validateForm();
});

receiverInput.addEventListener('input', () => {
  localStorage.setItem('chat_recv', receiverInput.value.trim());
});

messageInput.addEventListener('input', () => {
  // ضبط ارتفاع حقل الإدخال تلقائياً
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 100)}px`;
  validateForm();
});

function validateForm() {
  const hasUser = usernameInput.value.trim().length > 0;
  const hasMsg = messageInput.value.trim().length > 0;
  sendBtn.disabled = !(hasUser && hasMsg);
}

// رسم الرسالة على الواجهة
function renderMessage(msg) {
  if (state.renderedIds.has(msg.id)) return;
  if (msg.id) state.renderedIds.add(msg.id);

  if (emptyState) emptyState.remove();

  const currentUser = usernameInput.value.trim();
  const isSent = msg.sender === currentUser;

  const row = document.createElement('div');
  row.className = `message-row ${isSent ? 'sent' : 'received'}`;

  const timeStr = msg.created_at
    ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  row.innerHTML = `
    <span class="sender-name">${sanitizeHTML(msg.sender || 'مجهول')}</span>
    <div class="bubble">
      ${sanitizeHTML(msg.content)}
      <span class="timestamp">${timeStr}</span>
    </div>
  `;

  messagesBox.appendChild(row);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

// إرسال الرسالة إلى قاعدة البيانات
async function handleSend() {
  const sender = usernameInput.value.trim();
  const receiver = receiverInput.value.trim();
  const content = messageInput.value.trim();

  if (!sender || !content) {
    showToast('يرجى تحديد الاسم وكتابة الرسالة أولاً');
    return;
  }

  // التصفير السريع للمُدخل لتجربة سريعة جداً
  messageInput.value = '';
  messageInput.style.height = 'auto';
  validateForm();

  const { error } = await supabaseClient
    .from('messages')
    .insert([{ sender, receiver, content }]);

  if (error) {
    console.error('Database Send Error:', error);
    showToast('تعذر إرسال الرسالة، تحقق من الاتصال');
  }
}

// جلب الرسائل المخزنة
async function loadMessages() {
  const { data, error } = await supabaseClient
    .from('messages')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Database Fetch Error:', error);
    showToast('فشل في تحميل الرسائل');
    return;
  }

  data.forEach(renderMessage);
}

// تفعيل الاستماع اللحظي (Realtime Subscription)
function setupRealtime() {
  supabaseClient
    .channel('public:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      renderMessage(payload.new);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('Realtime connected successfully');
      }
    });
}

// الأحداث والتأثيرات التفاعلية
sendBtn.addEventListener('click', handleSend);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) handleSend();
  }
});

// بدء التشغيل
initStorage();
loadMessages();
setupRealtime();
