(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BizmindVoiceRecorder = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  const MAX_BYTES = 12 * 1024 * 1024;
  const MIME_TYPES = [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/webm",
    "audio/ogg"
  ];

  function formatDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const value = String(Math.floor(total / 60)).padStart(2, "0")
      + ":" + String(total % 60).padStart(2, "0");
    return value.replace(/\d/g, digit => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);
  }

  function create(options) {
    const config = options || {};
    const elements = config.elements || {};
    const now = config.now || Date.now;
    const schedule = config.setInterval || (typeof setInterval === "function" ? setInterval : null);
    const unschedule = config.clearInterval || (typeof clearInterval === "function" ? clearInterval : null);

    let phase = "idle";
    let generation = 0;
    let recorder = null;
    let stream = null;
    let chunks = [];
    let selectedMime = "";
    let activeSnapshot = null;
    let startedAt = 0;
    let elapsedBeforePause = 0;
    let sendRequested = false;
    let oversize = false;
    let timer = null;
    let pendingResolve = null;
    let completedGeneration = -1;

    function getContext() {
      return typeof config.getContext === "function" ? (config.getContext() || {}) : {};
    }

    function snapshotContext(context) {
      return {
        conversationId: context.active && context.active.id,
        userId: context.user && context.user.id
      };
    }

    function snapshotIsCurrent(snapshot) {
      const current = getContext();
      return !!snapshot && !!snapshot.conversationId && !!snapshot.userId
        && current.active && current.active.id === snapshot.conversationId
        && current.user && current.user.id === snapshot.userId;
    }

    function stopTracks(target) {
      if (!target || typeof target.getTracks !== "function") return;
      target.getTracks().forEach(track => {
        try { track.stop(); } catch (_) {}
      });
    }

    function elapsedMilliseconds() {
      if (phase === "paused" || phase === "requesting" || phase === "idle") return elapsedBeforePause;
      return elapsedBeforePause + Math.max(0, now() - startedAt);
    }

    function updateUI() {
      const active = phase !== "idle";
      const canSend = phase === "recording" || phase === "paused";
      const composer = elements.composer;
      if (composer && composer.classList) composer.classList.toggle("voice-recording-active", active);
      if (elements.controls && elements.controls.classList) elements.controls.classList.toggle("hidden", !active);
      if (elements.recordButton) {
        elements.recordButton.classList && elements.recordButton.classList.toggle("recording", active);
        elements.recordButton.disabled = active;
        elements.recordButton.title = active ? "التسجيل الصوتي جارٍ" : "تسجيل رسالة صوتية";
        elements.recordButton.setAttribute && elements.recordButton.setAttribute("aria-label", elements.recordButton.title);
      }
      if (elements.pauseButton) {
        elements.pauseButton.disabled = phase !== "recording" && phase !== "paused";
        elements.pauseButton.innerHTML = phase === "paused" ? '<i class="ph ph-play"></i>' : '<i class="ph ph-pause"></i>';
        elements.pauseButton.title = phase === "paused" ? "استئناف التسجيل" : "إيقاف مؤقت";
        elements.pauseButton.setAttribute && elements.pauseButton.setAttribute("aria-label", elements.pauseButton.title);
      }
      if (elements.trashButton) elements.trashButton.disabled = !active;
      if (elements.time) elements.time.textContent = formatDuration(Math.floor(elapsedMilliseconds() / 1000));
      if (elements.status) {
        elements.status.textContent = phase === "requesting" ? "طلب إذن الميكروفون"
          : phase === "paused" ? "متوقف مؤقتاً"
          : phase === "stopping" ? "جارٍ تجهيز الرسالة"
          : phase === "cancelling" ? "جارٍ إلغاء التسجيل"
          : "جارٍ التسجيل";
      }
      if (elements.sendButton && active) elements.sendButton.disabled = !canSend;
      if (typeof config.onStateChange === "function") config.onStateChange(phase);
    }

    function clearTimer() {
      if (timer !== null && unschedule) unschedule(timer);
      timer = null;
    }

    function releaseResources() {
      clearTimer();
      stopTracks(stream);
      stream = null;
      recorder = null;
      chunks = [];
      selectedMime = "";
      startedAt = 0;
      elapsedBeforePause = 0;
      sendRequested = false;
      oversize = false;
    }

    function settlePending(value) {
      const resolve = pendingResolve;
      pendingResolve = null;
      if (resolve) resolve(value);
    }

    function reset() {
      releaseResources();
      activeSnapshot = null;
      phase = "idle";
      updateUI();
    }

    function notifyError(message) {
      if (typeof config.toast === "function") config.toast(message);
    }

    function permissionErrorMessage(error) {
      if (error && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
        return "اسمح للمتصفح باستخدام الميكروفون من إعدادات الموقع ثم حاول مجدداً";
      }
      if (error && error.name === "NotFoundError") return "لم يتم العثور على ميكروفون متصل بالجهاز";
      if (error && error.name === "NotReadableError") return "الميكروفون مشغول بتطبيق آخر. أغلقه ثم أعد المحاولة";
      return error && error.message ? error.message : "تعذر تشغيل الميكروفون";
    }

    function mimeFor(recorderInstance, data) {
      const reported = String(recorderInstance && recorderInstance.mimeType || selectedMime || "").split(";")[0].toLowerCase();
      if (reported.startsWith("audio/")) return reported;
      const chunk = data.find(item => item && item.type && item.type.startsWith("audio/"));
      return chunk ? String(chunk.type).split(";")[0].toLowerCase() : "";
    }

    function extensionFor(mime) {
      return mime === "audio/mp4" ? "m4a"
        : mime === "audio/ogg" ? "ogg"
        : mime === "audio/wav" ? "wav"
        : mime === "audio/mpeg" ? "mp3"
        : "webm";
    }

    async function finish(run) {
      if (run !== generation || completedGeneration === run) return;
      completedGeneration = run;

      const cancelled = phase === "cancelling" && !oversize;
      const tooLarge = oversize;
      const shouldSend = sendRequested;
      const snapshot = activeSnapshot;
      const duration = Math.max(0, Math.round(elapsedBeforePause / 1000));
      const data = chunks.slice();
      const mime = mimeFor(recorder, data);

      releaseResources();
      activeSnapshot = null;
      phase = "idle";
      updateUI();

      if (cancelled) {
        settlePending(false);
        return;
      }
      if (tooLarge) {
        notifyError("حجم التسجيل تجاوز الحد الأقصى 12 ميجابايت. أرسل تسجيلاً أقصر.");
        settlePending(false);
        return;
      }
      if (!snapshotIsCurrent(snapshot)) {
        notifyError("تغيرت المحادثة أو جلسة الدخول. لم يتم إرفاق التسجيل بمحادثة أخرى.");
        settlePending(false);
        return;
      }

      const blob = new Blob(data, { type: mime || "application/octet-stream" });
      if (!blob.size) {
        notifyError("لم يتم التقاط صوت. تحقق من إذن الميكروفون وحاول مرة أخرى.");
        settlePending(false);
        return;
      }
      if (!mime || !mime.startsWith("audio/")) {
        notifyError("صيغة التسجيل الصوتي غير مدعومة في هذا المتصفح.");
        settlePending(false);
        return;
      }
      if (blob.size > MAX_BYTES) {
        notifyError("حجم التسجيل تجاوز الحد الأقصى 12 ميجابايت. أرسل تسجيلاً أقصر.");
        settlePending(false);
        return;
      }

      const file = new File([blob], "voice-" + now() + "." + extensionFor(mime), { type: mime });
      try {
        if (typeof config.onRecordingReady === "function") config.onRecordingReady({ file, duration, mimeType: mime });
      } catch (error) {
        notifyError(error && error.message ? error.message : "تعذر تجهيز الرسالة الصوتية");
        settlePending(false);
        return;
      }

      if (!shouldSend) {
        settlePending(true);
        return;
      }
      try {
        if (typeof config.send === "function") await config.send();
        settlePending(true);
      } catch (error) {
        notifyError(error && error.message ? error.message : "تعذر إرسال الرسالة الصوتية. يمكنك إعادة المحاولة.");
        settlePending(false);
      }
    }

    function fail(message, run) {
      if (run !== generation) return;
      notifyError(message);
      sendRequested = false;
      if (recorder && recorder.state !== "inactive") {
        phase = "cancelling";
        updateUI();
        try { recorder.stop(); } catch (_) { reset(); settlePending(false); }
      } else {
        reset();
        settlePending(false);
      }
    }

    async function start() {
      if (phase !== "idle") return false;
      const context = getContext();
      if (!context.active || !context.active.id || !context.user || !context.user.id) return false;
      if (context.uploading || context.attachment) return false;

      const role = (context.active.members || []).find(member => member.user_id === context.user.id)?.role;
      if (context.active.type === "channel" && !["owner", "admin"].includes(role)) {
        notifyError("التسجيل في هذه القناة مخصص للمشرفين");
        return false;
      }
      if (context.active.type === "group" && context.groupSettings?.only_admins_can_send && !["owner", "admin"].includes(role)) {
        notifyError("التسجيل في هذه المجموعة مخصص للمشرفين");
        return false;
      }

      const secure = typeof config.isSecureContext === "function" ? config.isSecureContext() : config.isSecureContext;
      if (secure === false) {
        notifyError("يلزم فتح التطبيق عبر اتصال HTTPS لتفعيل الميكروفون");
        return false;
      }
      const mediaDevices = config.mediaDevices || (typeof navigator !== "undefined" && navigator.mediaDevices);
      if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
        notifyError("الميكروفون غير متاح. افتح التطبيق في Chrome أو Safari واسمح باستخدامه");
        return false;
      }

      const run = ++generation;
      completedGeneration = -1;
      activeSnapshot = snapshotContext(context);
      phase = "requesting";
      elapsedBeforePause = 0;
      updateUI();

      let acquired;
      try {
        try {
          acquired = await mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          });
        } catch (firstError) {
          if (firstError && (firstError.name === "NotAllowedError" || firstError.name === "SecurityError")) throw firstError;
          if (run !== generation || phase !== "requesting") return false;
          acquired = await mediaDevices.getUserMedia({ audio: true });
        }
      } catch (error) {
        if (run !== generation) return false;
        reset();
        notifyError(permissionErrorMessage(error));
        return false;
      }

      if (run !== generation || phase !== "requesting" || !snapshotIsCurrent(activeSnapshot)) {
        stopTracks(acquired);
        if (run === generation) reset();
        return false;
      }

      const Recorder = config.MediaRecorder || (typeof MediaRecorder !== "undefined" ? MediaRecorder : null);
      if (typeof Recorder !== "function") {
        stopTracks(acquired);
        reset();
        notifyError("هذا المتصفح لا يدعم تسجيل الرسائل الصوتية. حدّث المتصفح ثم حاول مجدداً.");
        return false;
      }

      stream = acquired;
      const userAgent = config.userAgent || (typeof navigator !== "undefined" ? navigator.userAgent || "" : "");
      const candidates = /iPhone|iPad|iPod/i.test(userAgent)
        ? ["audio/mp4", "audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"]
        : MIME_TYPES;
      selectedMime = candidates.find(type => {
        try { return typeof Recorder.isTypeSupported !== "function" || Recorder.isTypeSupported(type); }
        catch (_) { return false; }
      }) || "";

      try {
        try {
          recorder = new Recorder(stream, selectedMime ? { mimeType: selectedMime } : undefined);
        } catch (_) {
          recorder = new Recorder(stream);
        }
        const currentRecorder = recorder;
        currentRecorder.ondataavailable = event => {
          if (run !== generation || phase === "cancelling" || !event.data || !event.data.size) return;
          chunks.push(event.data);
          const total = chunks.reduce((sum, item) => sum + (item.size || 0), 0);
          if (total > MAX_BYTES && !oversize) {
            oversize = true;
            sendRequested = false;
            phase = "cancelling";
            updateUI();
            try { currentRecorder.stop(); } catch (_) { reset(); }
          }
        };
        currentRecorder.onerror = event => {
          const error = event && (event.error || event);
          fail(error && error.message ? error.message : "تعذر تسجيل الصوت. تحقق من إذن الميكروفون ثم حاول مجدداً.", run);
        };
        currentRecorder.onstop = () => { void finish(run); };
        currentRecorder.start(1000);
        startedAt = now();
        phase = "recording";
        if (schedule) timer = schedule(() => updateUI(), 250);
        updateUI();
        return true;
      } catch (error) {
        reset();
        notifyError(error && error.message ? error.message : "تعذر بدء التسجيل الصوتي");
        return false;
      }
    }

    function pause() {
      if (phase !== "recording" || !recorder || typeof recorder.pause !== "function") return false;
      try {
        recorder.pause();
        elapsedBeforePause += Math.max(0, now() - startedAt);
        phase = "paused";
        updateUI();
        return true;
      } catch (_) {
        notifyError("تعذر إيقاف التسجيل مؤقتاً في هذا المتصفح");
        return false;
      }
    }

    function resume() {
      if (phase !== "paused" || !recorder || typeof recorder.resume !== "function") return false;
      try {
        recorder.resume();
        startedAt = now();
        phase = "recording";
        updateUI();
        return true;
      } catch (_) {
        notifyError("تعذر استئناف التسجيل");
        return false;
      }
    }

    function togglePause() {
      return phase === "paused" ? resume() : pause();
    }

    function send() {
      if (phase !== "recording" && phase !== "paused") return Promise.resolve(false);
      sendRequested = true;
      if (phase === "recording") elapsedBeforePause += Math.max(0, now() - startedAt);
      phase = "stopping";
      updateUI();

      return new Promise(resolve => {
        pendingResolve = resolve;
        try {
          if (recorder && recorder.state === "recording" && typeof recorder.requestData === "function") {
            try { recorder.requestData(); } catch (_) {}
          }
          if (!recorder) throw new Error("Recorder is no longer available");
          recorder.stop();
        } catch (error) {
          sendRequested = false;
          phase = "recording";
          startedAt = now();
          updateUI();
          settlePending(false);
          notifyError("تعذر إنهاء التسجيل. حاول الإرسال مرة أخرى.");
        }
      });
    }

    function cancel() {
      if (phase === "idle") return false;
      if (phase === "requesting") {
        generation += 1;
        reset();
        settlePending(false);
        return true;
      }
      const previousPhase = phase;
      sendRequested = false;
      phase = "cancelling";
      updateUI();
      if (recorder && recorder.state !== "inactive") {
        try { recorder.stop(); } catch (_) { reset(); settlePending(false); }
      } else if (recorder && (previousPhase === "stopping" || previousPhase === "cancelling")) {
        // stop() has already been requested; let its queued onstop event perform cleanup.
        return true;
      } else {
        reset();
        settlePending(false);
      }
      return true;
    }

    return {
      start,
      send,
      cancel,
      pause,
      resume,
      togglePause,
      isActive: () => phase !== "idle",
      getPhase: () => phase
    };
  }

  return { create, formatDuration, MAX_BYTES };
});