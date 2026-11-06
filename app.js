const SUPABASE_URL = 'https://lvkeohpuocuklagvwpnq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_3OM0vlZU0dkqK4X6aoGZsA_ZBawbyDR';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const messagesBox = document.getElementById('messagesBox');
const usernameInput = document.getElementById('username');
const receiverInput = document.getElementById('receiver');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

usernameInput.value = localStorage.getItem('chat_username') || '';
receiverInput.value = localStorage.getItem('chat_receiver') || '';

usernameInput.addEventListener('input', () => {
  localStorage.setItem('chat_username', usernameInput.value.trim());
});

receiverInput.addEventListener('input', () => {
  localStorage.setItem('chat_receiver', receiverInput.value.trim());
});

async function sendMessage() {
  const sender = usernameInput.value.trim();
  const receiver = receiverInput.value.trim();
  const content = messageInput.value.trim();

  if (!sender || !content) {
    alert('يرجى كتابة اسمك والرسالة أولاً');
    return;
  }

  messageInput.value = '';

  const { error } = await supabaseClient
    .from('messages')
    .insert([{ sender, receiver, content }]);

  if (error) {
    console.error('خطأ في الإرسال:', error);
  }
}

function renderMessage(msg) {
  const currentUser = usernameInput.value.trim();
  const isSentByMe = msg.sender === currentUser;

  const wrapper = document.createElement('div');
  wrapper.classList.add('message-wrapper', isSentByMe ? 'sent' : 'received');

  const timeStr = msg.created_at 
    ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  wrapper.innerHTML = `
    <span class="message-sender">${msg.sender}</span>
    <div class="message-bubble">
      ${msg.content}
      <div class="message-time">${timeStr}</div>
    </div>
  `;

  messagesBox.appendChild(wrapper);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

async function fetchMessages() {
  const { data, error } = await supabaseClient
    .from('messages')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('خطأ في جلب الرسائل:', error);
    return;
  }

  messagesBox.innerHTML = '';
  data.forEach(renderMessage);
}

supabaseClient
  .channel('public:messages')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
    renderMessage(payload.new);
  })
  .subscribe();

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});

fetchMessages();
