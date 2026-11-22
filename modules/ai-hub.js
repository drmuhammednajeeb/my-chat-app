(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BizmindAIHub = api;
  if (root.document) api.mount(root.document, root);
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const TASKS = Object.freeze({
    reply: "اكتب رداً مهنياً واضحاً ومناسباً للسياق التالي. حافظ على نبرة ودودة ومختصرة، ولا تضف معلومات غير موجودة.",
    polish: "أعد صياغة النص التالي بأسلوب احترافي وطبيعي، مع الحفاظ على المعنى وعدم اختلاق معلومات.",
    translate: "ترجم النص التالي ترجمة دقيقة إلى العربية الفصحى، مع الحفاظ على المصطلحات والمعنى.",
    summarize: "لخّص النص التالي في نقاط عملية واضحة، مع إبراز أهم المعلومات والإجراءات."
  });

  function validatePoeUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      if (url.protocol !== "https:" || url.origin !== "https://poe.com") return null;
      if (!url.pathname || url.pathname === "/" || url.username || url.password || url.search || url.hash) return null;
      return url;
    } catch (_) {
      return null;
    }
  }

  function storageKey(userId) {
    return "bizmind-ai-hub:v1:" + encodeURIComponent(String(userId || ""));
  }

  function readConfig(win, userId) {
    try {
      const raw = win.localStorage.getItem(storageKey(userId));
      const value = raw ? JSON.parse(raw) : {};
      return {
        enabled: value?.enabled === true,
        botUrl: validatePoeUrl(value?.botUrl)?.href || ""
      };
    } catch (_) {
      return { enabled: false, botUrl: "" };
    }
  }

  function writeConfig(win, userId, config) {
    const url = validatePoeUrl(config?.botUrl);
    if (!userId || (config?.enabled === true && !url)) return false;
    try {
      win.localStorage.setItem(storageKey(userId), JSON.stringify({
        enabled: config.enabled === true,
        botUrl: url?.href || ""
      }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function buildPrompt(task, input) {
    const instruction = TASKS[task] || TASKS.reply;
    const source = String(input || "").trim();
    if (!source) return "";
    return instruction + "\n\nالنص المطلوب العمل عليه:\n" + source;
  }

  function currentUserId() {
    try {
      return typeof state !== "undefined" && state.user?.id ? String(state.user.id) : null;
    } catch (_) {
      return null;
    }
  }

  function notify(message) {
    try {
      if (typeof toast === "function") toast(message);
    } catch (_) {}
  }

  function mount(doc, win) {
    const opener = doc.getElementById("aiHubOpenBtn");
    if (!opener || opener.dataset.aiHubBound === "true") return;
    opener.dataset.aiHubBound = "true";

    let overlay = null;
    let previousFocus = null;

    const element = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };

    function close() {
      if (!overlay) return;
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
      previousFocus?.focus?.();
    }

    function setStatus(message) {
      const node = overlay?.querySelector("[data-ai-status]");
      if (node) node.textContent = message || "";
    }

    function createDialog() {
      if (overlay) return overlay;
      overlay = element("div", "ai-hub-overlay");
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
      const dialog = element("section", "ai-hub-dialog");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "aiHubTitle");

      const header = element("header", "ai-hub-header");
      const headingWrap = element("div", "ai-hub-heading");
      const eyebrow = element("span", "ai-hub-eyebrow", "BIZMIND · AI HUB");
      const heading = element("h2", "", "مركز الذكاء الاصطناعي");
      heading.id = "aiHubTitle";
      const subtitle = element("p", "", "اربط مساعد Poe الذي تستخدمه، واستعن به في صياغة الردود وتحسينها وترجمتها.");
      headingWrap.append(eyebrow, heading, subtitle);
      const closeButton = element("button", "ai-hub-close", "×");
      closeButton.type = "button";
      closeButton.setAttribute("aria-label", "إغلاق");
      closeButton.addEventListener("click", close);
      header.append(headingWrap, closeButton);

      const body = element("div", "ai-hub-body");
      const notice = element("p", "ai-hub-privacy", "الخصوصية أولاً: لا يرسل التطبيق رسائلك أو بيانات محادثاتك إلى Poe تلقائياً. أنت تختار النص الذي تنسخه وترسله بنفسك.");
      const enabledLabel = element("label", "ai-hub-toggle");
      const enabled = element("input");
      enabled.type = "checkbox";
      enabled.id = "aiHubEnabled";
      const toggleText = element("span", "", "تفعيل مساعد Poe لهذا الحساب على هذا الجهاز");
      enabledLabel.append(enabled, toggleText);

      const urlLabel = element("label", "ai-hub-label", "رابط بوت Poe الخاص بك");
      urlLabel.htmlFor = "aiHubBotUrl";
      const urlInput = element("input", "ai-hub-input");
      urlInput.id = "aiHubBotUrl";
      urlInput.type = "url";
      urlInput.autocomplete = "url";
      urlInput.placeholder = "https://poe.com/YourBotName";
      urlInput.spellcheck = false;

      const scope = element("p", "ai-hub-scope", "إعدادات الربط محفوظة محلياً لهذا الحساب على هذا الجهاز فقط. لا تدخل كلمة مرور Poe أو أي مفتاح API هنا.");
      const sourceLabel = element("label", "ai-hub-label", "النص الذي تريد مساعدة الذكاء الاصطناعي فيه");
      sourceLabel.htmlFor = "aiHubSourceText";
      const source = element("textarea", "ai-hub-textarea");
      source.id = "aiHubSourceText";
      source.rows = 5;
      source.maxLength = 12000;
      source.placeholder = "اكتب النص بنفسك أو الصق الجزء الذي تريد مراجعته…";

      const taskLabel = element("label", "ai-hub-label", "نوع المساعدة");
      taskLabel.htmlFor = "aiHubTask";
      const task = element("select", "ai-hub-input");
      task.id = "aiHubTask";
      [["reply","صياغة رد"],["polish","تحسين الصياغة"],["translate","ترجمة إلى العربية"],["summarize","تلخيص عملي"]].forEach(([value,label]) => {
        const option = element("option", "", label);
        option.value = value;
        task.append(option);
      });

      const actions = element("div", "ai-hub-actions");
      const save = element("button", "ai-hub-save", "حفظ الإعدادات");
      save.type = "button";
      const launch = element("button", "ai-hub-launch", "نسخ النص وفتح Poe");
      launch.type = "button";
      const status = element("p", "ai-hub-status");
      status.dataset.aiStatus = "true";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");

      save.addEventListener("click", () => {
        const userId = currentUserId();
        const config = { enabled: enabled.checked, botUrl: urlInput.value };
        if (!userId) return setStatus("سجّل الدخول أولاً.");
        if (config.enabled && !validatePoeUrl(config.botUrl)) return setStatus("أدخل رابط بوت صحيحاً يبدأ بـ https://poe.com/.");
        if (!config.enabled && config.botUrl && !validatePoeUrl(config.botUrl)) return setStatus("رابط Poe غير صالح.");
        if (!writeConfig(win, userId, config)) return setStatus("تعذر حفظ الإعدادات على هذا الجهاز.");
        setStatus(config.enabled ? "تم حفظ إعدادات مساعد Poe لهذا الحساب." : "تم حفظ الإعدادات مع إيقاف المساعد.");
      });

      launch.addEventListener("click", async () => {
        const userId = currentUserId();
        if (!userId) return setStatus("سجّل الدخول أولاً.");
        const config = { enabled: enabled.checked, botUrl: urlInput.value };
        const url = validatePoeUrl(config.botUrl);
        if (!config.enabled) return setStatus("فعّل المساعد أولاً ثم احفظ الإعدادات.");
        if (!url) return setStatus("أدخل رابط بوت Poe صحيحاً.");
        const prompt = buildPrompt(task.value, source.value);
        if (!prompt) return setStatus("أدخل النص الذي تريد معالجته أولاً.");
        if (!writeConfig(win, userId, config)) return setStatus("تعذر حفظ الإعدادات على هذا الجهاز.");
        try { win.open(url.href, "_blank", "noopener,noreferrer"); }
        catch (_) { return setStatus("تعذر فتح نافذة Poe؛ اسمح بالنوافذ المنبثقة ثم أعد المحاولة."); }
        try {
          await win.navigator.clipboard.writeText(prompt);
          setStatus("فُتح Poe ونُسخت التعليمات. الصقها في محادثة البوت لإكمال الطلب.");
        } catch (_) {
          source.focus();
          source.select();
          setStatus("فُتح Poe. تعذر النسخ التلقائي؛ انسخ النص يدوياً ثم الصقه في البوت.");
        }
      });

      actions.append(save, launch);
      body.append(notice, enabledLabel, urlLabel, urlInput, scope, taskLabel, task, sourceLabel, source, actions, status);
      dialog.append(header, body);
      overlay.append(dialog);
      overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
      doc.addEventListener("keydown", event => {
        if (event.key === "Escape" && overlay && !overlay.hidden) close();
      });
      doc.body.append(overlay);
      return overlay;
    }

    function open() {
      const userId = currentUserId();
      if (!userId) return notify("سجّل الدخول لاستخدام مركز الذكاء الاصطناعي.");
      previousFocus = doc.activeElement;
      const modal = createDialog();
      const config = readConfig(win, userId);
      modal.querySelector("#aiHubEnabled").checked = config.enabled;
      modal.querySelector("#aiHubBotUrl").value = config.botUrl;
      modal.querySelector("#aiHubSourceText").value = "";
      setStatus("");
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
      modal.querySelector("#aiHubBotUrl").focus();
    }

    opener.addEventListener("click", open);
    try {
      if (typeof supabaseClient !== "undefined" && supabaseClient.auth?.onAuthStateChange) {
        supabaseClient.auth.onAuthStateChange((_event, session) => {
          if (!session?.user?.id) close();
        });
      }
    } catch (_) {}

    return { open, close };
  }

  return Object.freeze({ validatePoeUrl, storageKey, readConfig, writeConfig, buildPrompt, mount });
});