// استبدل المفاتيح بمفاتيح مشروعك الجديد من Supabase
const SUPABASE_URL = 'https://lvkeohpuocuklagvwpnq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_3OM0vlZU0dkqK4X6aoGZsA_ZBawbYDR';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const messagesBox = document.getElementById('messagesBox');
const usernameInput = document.getElementById('username');
const receiverInput = document.getElementById('receiver');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

// 1. إرسال رسالة
async function sendMessage() {
  const sender = usernameInput.value.trim();
  const receiver = receiverInput.value.trim();
  const content = messageInput.value.trim();

  if (!sender || !content) {
    alert('يرجى كتابة اسمك ونح النص قبل الإرسال');
    return;
  }

  const { error } = await supabaseClient
    .from('messages')
    .insert([{ sender, receiver, content }]);

  if (error) {
    console.error('خطأ في الإرسال:', error);
  } else {
    messageInput.value = '';
  }
}

// 2. عرض الرسالة في الشاشة
function renderMessage(msg) {
  const currentSender = usernameInput.value.trim();
  const div = document.createElement('div');
  div.classList.add('message');
  
  if (msg.sender === currentSender) {
    div.classList.add('sent');
  } else {
    div.classList.add('received');
  }

  div.innerHTML = `
    <span class="sender-name">${msg.sender}</span>
    ${msg.content}
  `;
  messagesBox.appendChild(div);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

// 3. الاستماع للرسائل الجديدة فورياً (Realtime)
function listenForMessages() {
  supabaseClient
    .channel('public:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
      renderMessage(payload.new);
    })
    .subscribe();
}

// الأحداث
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// بدء الاستماع للرسائل عند فتح الصفحة
listenForMessages();