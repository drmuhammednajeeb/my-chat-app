(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BizmindAudioPlayer = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  function createPlaybackCoordinator() {
    let activeAudio = null;

    return {
      activate(audio) {
        if (!audio) return;
        if (activeAudio && activeAudio !== audio) {
          const previous = activeAudio;
          activeAudio = null;
          try { previous.pause(); } catch (_) {}
        }
        activeAudio = audio;
      },
      release(audio) {
        if (activeAudio === audio) activeAudio = null;
      },
      getActive() {
        return activeAudio;
      },
      stop() {
        const previous = activeAudio;
        activeAudio = null;
        if (previous) {
          try { previous.pause(); } catch (_) {}
        }
      }
    };
  }

  function formatTime(seconds) {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    return String(Math.floor(value / 60)).padStart(2, "0")
      + ":" + String(value % 60).padStart(2, "0");
  }

  // Show the full duration until playback starts, then count down the remaining time.
  // Unknown metadata is deliberately not rendered as a misleading 00:00.
  function formatPlaybackTime(duration, currentTime, hasStarted, ended, metadataReady, fallbackDuration) {
    const mediaDuration = Number(duration);
    const fallback = Number(fallbackDuration);
    const total = metadataReady && Number.isFinite(mediaDuration) && mediaDuration > 0
      ? mediaDuration
      : Number.isFinite(fallback) && fallback > 0 ? fallback : mediaDuration;
    if (!Number.isFinite(total) || total < 0 || (!metadataReady && !(Number.isFinite(fallback) && fallback > 0))) return "--:--";
    const elapsed = Math.max(0, Number(currentTime) || 0);
    return formatTime(hasStarted && !ended ? Math.max(0, total - elapsed) : total);
  }

  function create(options) {
    const config = options || {};
    const documentRef = config.document || (typeof document !== "undefined" ? document : null);
    if (!documentRef) throw new Error("Audio player requires a document");
    const coordinator = config.coordinator || createPlaybackCoordinator();

    function createPlayer(playerOptions) {
      const settings = playerOptions || {};
      const audio = documentRef.createElement("audio");
      audio.preload = "metadata";
      audio.src = settings.src || "";
      audio.setAttribute("playsinline", "");
      audio.setAttribute("aria-label", "تشغيل الصوت عبر عناصر المتصفح");
      audio.className = "voice-player-native-audio";
      audio.tabIndex = -1;

      const wrapper = documentRef.createElement("div");
      wrapper.className = "voice-message-player";
      wrapper.dataset.messageId = String(settings.messageId || "");
      wrapper.setAttribute("role", "group");
      wrapper.setAttribute("aria-label", "مشغل الرسالة الصوتية");

      const playButton = documentRef.createElement("button");
      playButton.type = "button";
      playButton.className = "voice-player-toggle";
      playButton.setAttribute("aria-label", "تشغيل الرسالة الصوتية");
      playButton.innerHTML = '<span class="voice-player-glyph voice-player-glyph-play" aria-hidden="true">▶</span>';

      const waveform = documentRef.createElement("div");
      waveform.className = "voice-player-waveform";
      waveform.setAttribute("role", "slider");
      waveform.setAttribute("aria-label", "موضع تشغيل الرسالة الصوتية");
      waveform.setAttribute("aria-valuemin", "0");
      waveform.setAttribute("aria-valuemax", "0");
      waveform.setAttribute("aria-valuenow", "0");
      waveform.setAttribute("aria-valuetext", "٠٠:٠٠");
      waveform.tabIndex = 0;

      let seed = 0;
      for (const character of String(settings.messageId || settings.src || "voice")) {
        seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
      }
      const bars = [];
      for (let index = 0; index < 48; index += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const bar = documentRef.createElement("span");
        bar.className = "voice-player-waveform-bar";
        bar.style.height = (5 + (seed % 20)) + "px";
        bar.setAttribute("aria-hidden", "true");
        waveform.append(bar);
        bars.push(bar);
      }

      const fallbackMessage = documentRef.createElement("span");
      fallbackMessage.className = "voice-player-fallback-message";
      fallbackMessage.setAttribute("role", "status");
      fallbackMessage.textContent = "تعذر تشغيل الصوت بالمشغل المخصص. استخدم المشغل البديل أدناه.";

      const timerLabel = documentRef.createElement("span");
      timerLabel.className = "voice-player-time voice-player-timer";
      timerLabel.textContent = "--:--";
      timerLabel.setAttribute("aria-live", "off");

      const timeline = documentRef.createElement("div");
      timeline.className = "voice-player-timeline";
      timeline.append(waveform, timerLabel);
      wrapper.append(playButton, timeline, audio, fallbackMessage);

      let signedAt = Date.now();
      let refreshing = false;
      let retried = false;
      let destroyed = false;
      let fallbackVisible = false;
      let hasStarted = false;

      function showFallback(error) {
        if (destroyed) return;
        fallbackVisible = true;
        wrapper.classList.add("has-playback-error");
        audio.controls = true;
        audio.tabIndex = 0;
        fallbackMessage.hidden = false;
        playButton.disabled = true;
        playButton.setAttribute("aria-label", "تعذر تشغيل المشغل المخصص");
        if (typeof settings.onError === "function") settings.onError(error || new Error("تعذر تشغيل الرسالة الصوتية"));
      }

      function render() {
        if (destroyed) return;
        const mediaMetadataReady = audio.readyState >= 1
          && Number.isFinite(audio.duration) && audio.duration > 0;
        const persistedDuration = Number(settings.durationSeconds);
        const persistedDurationReady = Number.isFinite(persistedDuration) && persistedDuration > 0;
        const metadataReady = mediaMetadataReady || persistedDurationReady;
        const total = mediaMetadataReady ? audio.duration : persistedDurationReady ? persistedDuration : 0;
        const elapsed = Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
        const ratio = metadataReady && total > 0 ? Math.max(0, Math.min(1, elapsed / total)) : 0;
        const playing = !audio.paused && !audio.ended;
        if (playing) hasStarted = true;
        wrapper.classList.toggle("is-playing", playing);
        if (!fallbackVisible) playButton.disabled = false;
        playButton.innerHTML = playing
          ? '<span class="voice-player-glyph voice-player-glyph-pause" aria-hidden="true">Ⅱ</span>'
          : '<span class="voice-player-glyph voice-player-glyph-play" aria-hidden="true">▶</span>';
        playButton.dataset.playbackState = playing ? "playing" : "paused";
        playButton.setAttribute("aria-pressed", playing ? "true" : "false");
        playButton.setAttribute("aria-label", playing ? "إيقاف الرسالة الصوتية مؤقتاً" : "تشغيل الرسالة الصوتية");
        timerLabel.textContent = formatPlaybackTime(
          mediaMetadataReady ? audio.duration : persistedDuration,
          elapsed,
          hasStarted,
          audio.ended,
          metadataReady,
          persistedDuration
        );
        timerLabel.setAttribute("aria-label", metadataReady
          ? (hasStarted && !audio.ended ? "الوقت المتبقي " : "مدة الرسالة الصوتية ") + timerLabel.textContent
          : "جار تحميل مدة الرسالة الصوتية");
        waveform.setAttribute("aria-valuemax", String(Math.floor(total)));
        waveform.setAttribute("aria-valuenow", String(Math.floor(elapsed)));
        waveform.setAttribute("aria-valuetext", metadataReady
          ? formatTime(elapsed) + " من " + formatTime(total)
          : "مدة الرسالة الصوتية قيد التحميل");
        bars.forEach((bar, index) => bar.classList.toggle("is-played", (index + 1) / bars.length <= ratio));
      }

      async function refreshAudioUrl(resume) {
        if (refreshing || typeof settings.refreshUrl !== "function") return false;
        refreshing = true;
        try {
          const nextUrl = await settings.refreshUrl();
          if (!nextUrl || destroyed || !wrapper.isConnected) return false;
          audio.src = nextUrl;
          signedAt = Date.now();
          audio.load();
          if (resume) {
            coordinator.activate(audio);
            await audio.play();
          }
          return true;
        } catch (error) {
          showFallback(error);
          return false;
        } finally {
          refreshing = false;
        }
      }

      async function startPlayback() {
        if (destroyed) return;
        if (Date.now() - signedAt > 50 * 60 * 1000) {
          await refreshAudioUrl(true);
          return;
        }
        if (audio.ended) audio.currentTime = 0;
        try {
          coordinator.activate(audio);
          audio.muted = false;
          audio.volume = 1;
          await audio.play();
          render();
        } catch (error) {
          coordinator.release(audio);
          showFallback(error);
        }
      }

      playButton.addEventListener("click", () => {
        if (!audio.paused && !audio.ended) {
          audio.pause();
          render();
        } else {
          void startPlayback();
        }
      });

      function seek(clientX) {
        const total = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (!total) return;
        const rect = waveform.getBoundingClientRect();
        if (!rect.width) return;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        audio.currentTime = ratio * total;
        if (audio.currentTime > 0) hasStarted = true;
        render();
      }

      waveform.addEventListener("click", event => seek(event.clientX));
      waveform.addEventListener("keydown", event => {
        const total = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (!total) return;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          audio.currentTime = Math.max(0, Math.min(total, audio.currentTime + (event.key === "ArrowRight" ? 5 : -5)));
          render();
        } else if (event.key === "Home") {
          event.preventDefault();
          audio.currentTime = 0;
          render();
        } else if (event.key === "End") {
          event.preventDefault();
          audio.currentTime = total;
          render();
        }
      });

      audio.addEventListener("play", () => {
        hasStarted = true;
        coordinator.activate(audio);
        if (Date.now() - signedAt > 50 * 60 * 1000) {
          audio.pause();
          void refreshAudioUrl(true);
        }
        render();
      });
      audio.addEventListener("pause", () => {
        coordinator.release(audio);
        render();
      });
      audio.addEventListener("ended", () => {
        coordinator.release(audio);
        render();
      });
      ["loadedmetadata", "durationchange", "timeupdate", "seeking", "seeked"].forEach(name => {
        audio.addEventListener(name, render);
      });
      audio.addEventListener("error", () => {
        if (!retried) {
          retried = true;
          void refreshAudioUrl(false).then(refreshed => {
            if (!refreshed) showFallback(new Error("تعذر تحميل ملف الصوت من التخزين"));
          });
        } else {
          showFallback(new Error("صيغة الصوت غير مدعومة أو تعذر تحميل الملف"));
        }
      });

      wrapper.destroy = () => {
        destroyed = true;
        coordinator.release(audio);
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      };
      render();
      // Explicit load initialises metadata for dynamically-created media elements.
      try { audio.load(); } catch (_) {}
      return wrapper;
    }

    return { createPlayer, stopAll: () => coordinator.stop(), coordinator };
  }

  return { create, createPlaybackCoordinator, formatTime, formatPlaybackTime };
});
