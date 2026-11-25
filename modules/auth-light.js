(function (root) {
  'use strict';

  const STATES = Object.freeze({
    idle: 'أدخل بياناتك للبدء',
    checking: 'نتحقق من بيانات الدخول بأمان…',
    success: 'تم التحقق بنجاح — أهلاً بك في BizmindMakers',
    error: 'تعذر التحقق من البيانات — المصباح متوقف'
  });

  function createController(nodes) {
    const rootNode = nodes && nodes.rootNode;
    const statusNode = nodes && nodes.statusNode;
    if (!rootNode || !statusNode) throw new TypeError('Auth light requires root and status nodes');

    function setState(nextState) {
      const state = Object.prototype.hasOwnProperty.call(STATES, nextState) ? nextState : 'idle';
      rootNode.dataset.state = state;
      if (rootNode.classList) {
        rootNode.classList.toggle('is-checking', state === 'checking');
        rootNode.classList.toggle('is-lit', state === 'success');
        rootNode.classList.toggle('has-error', state === 'error');
      }
      statusNode.textContent = STATES[state];
      statusNode.setAttribute('data-state', state);
      statusNode.setAttribute('aria-live', state === 'error' ? 'assertive' : 'polite');
      return state;
    }

    setState('idle');
    return Object.freeze({ setState });
  }

  let activeController = null;

  function mount(documentRef) {
    if (!documentRef || !documentRef.createElement) return null;
    const authRoot = documentRef.getElementById('auth');
    const form = documentRef.getElementById('authForm');
    if (!authRoot || !form) return null;
    if (documentRef.getElementById('authLightStage')) return activeController;

    const layout = documentRef.createElement('div');
    layout.className = 'auth-light-layout';

    const stage = documentRef.createElement('section');
    stage.className = 'auth-light-stage';
    stage.id = 'authLightStage';
    stage.setAttribute('aria-label', 'BizmindMakers Smart Login');

    stage.innerHTML = `
      <div class="auth-light-brand">
        <span class="auth-light-brand-mark" aria-hidden="true">✦</span>
        <span><strong>BizmindMakers</strong><small>THINK SMART. CONNECT. GROW.</small></span>
      </div>
      <div class="auth-light-art" aria-hidden="true">
        <div class="auth-light-halo"></div>
        <div class="auth-light-particles"><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <svg class="auth-desk-lamp" viewBox="0 0 360 520" role="presentation" focusable="false">
          <defs>
            <linearGradient id="bzm-metal" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stop-color="#080a0d"/><stop offset=".32" stop-color="#55514a"/>
              <stop offset=".52" stop-color="#24272b"/><stop offset=".78" stop-color="#080a0d"/><stop offset="1" stop-color="#35312a"/>
            </linearGradient>
            <linearGradient id="bzm-shade" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stop-color="#080a0d"/><stop offset=".36" stop-color="#35383b"/>
              <stop offset=".62" stop-color="#171b20"/><stop offset="1" stop-color="#050608"/>
            </linearGradient>
            <linearGradient id="bzm-gold" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="#fff0c4"/><stop offset=".42" stop-color="#ffc15d"/><stop offset="1" stop-color="#9c581e"/>
            </linearGradient>
            <radialGradient id="bzm-bulb"><stop offset="0" stop-color="#fff8d9"/><stop offset=".32" stop-color="#ffd078"/><stop offset="1" stop-color="#e79a32"/></radialGradient>
            <filter id="bzm-glow"><feGaussianBlur stdDeviation="13"/></filter>
          </defs>
          <ellipse class="lamp-floor-glow" cx="182" cy="477" rx="118" ry="18" fill="#f4ad4b" opacity=".08" filter="url(#bzm-glow)"/>
          <path class="lamp-light-beam" d="M112 174 L256 174 L337 462 L22 462 Z" fill="#f4b45c" opacity="0"/>
          <g class="lamp-shade-group" transform="rotate(-8 176 150)">
            <rect x="144" y="32" width="66" height="48" rx="13" fill="url(#bzm-metal)" stroke="#55504a" stroke-width="2"/>
            <path d="M172 25 Q174 12 185 12 Q195 12 197 25 L197 35 L172 35Z" fill="url(#bzm-metal)" stroke="#6a604f" stroke-width="2"/>
            <path d="M69 170 C80 77 114 58 177 58 C239 58 274 80 286 170 C248 205 108 205 69 170Z" fill="url(#bzm-shade)" stroke="#4a4945" stroke-width="3"/>
            <path d="M72 168 C112 194 244 194 283 168" fill="none" stroke="#d69a4d" stroke-width="7"/>
            <path class="lamp-inner-rim" d="M75 169 C115 195 241 195 280 169" fill="none" stroke="#f2b55c" stroke-width="5"/>
            <ellipse class="lamp-bulb-glow" cx="177" cy="157" rx="17" ry="12" fill="#f4b04b" opacity="0" filter="url(#bzm-glow)"/>
            <circle class="lamp-bulb" cx="177" cy="157" r="9" fill="#8e7046"/>
          </g>
          <path d="M113 197 L81 315 L128 423" fill="none" stroke="url(#bzm-metal)" stroke-width="17" stroke-linecap="round"/>
          <path d="M121 196 L92 313 L139 420" fill="none" stroke="#777064" stroke-opacity=".35" stroke-width="2"/>
          <path d="M93 314 L155 427" fill="none" stroke="url(#bzm-metal)" stroke-width="12" stroke-linecap="round"/>
          <path d="M126 423 L126 458" stroke="url(#bzm-metal)" stroke-width="20" stroke-linecap="round"/>
          <g fill="url(#bzm-metal)" stroke="#8b754f" stroke-width="3">
            <circle cx="111" cy="199" r="13"/><circle cx="81" cy="315" r="16"/><circle cx="128" cy="423" r="13"/>
          </g>
          <g fill="#c69b57"><circle cx="111" cy="199" r="4"/><circle cx="81" cy="315" r="5"/><circle cx="128" cy="423" r="4"/></g>
          <ellipse cx="180" cy="466" rx="111" ry="25" fill="url(#bzm-metal)" stroke="#514b40" stroke-width="3"/>
          <ellipse cx="180" cy="459" rx="85" ry="13" fill="#11151a" opacity=".9"/>
          <path d="M126 453 Q180 442 234 453" stroke="#b48b4c" stroke-opacity=".5" stroke-width="2" fill="none"/>
        </svg>
      </div>
      <div class="auth-light-caption">
        <span class="auth-light-status-dot" aria-hidden="true"></span>
        <span id="authLightStatus" role="status" aria-live="polite">أدخل بياناتك للبدء</span>
      </div>
      <p class="auth-light-tagline">A brighter way to connect.</p>
    `;

    authRoot.replaceChildren(layout);
    layout.append(stage, form);
    activeController = createController({
      rootNode: stage,
      statusNode: stage.querySelector('#authLightStatus')
    });
    return activeController;
  }

  const api = Object.freeze({
    createController,
    mount,
    setState(state) {
      return activeController ? activeController.setState(state) : 'idle';
    }
  });

  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BizmindAuthLight = api;
  if (root.document) mount(root.document);
})(typeof globalThis !== 'undefined' ? globalThis : window);
