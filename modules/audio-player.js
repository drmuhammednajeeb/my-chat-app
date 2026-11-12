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
      audio.setAttribute("aria-hidden", "true");
      audio.tabIndex = -1;

      const wrapper = documentRef.createElement("div");
      wrapper.className = "voice-message-player";
      wrapper.dataset.messageId = String(settings.messageId || "");

      const playButton = documentRef.createElement("button");
      playButton.type = "button";
      playButton.className = "voice-player-toggle";
      playButton.setAttribute("aria-label", "تشغيل الرسالة الصوتية");
      playButton.innerHTML = '<i class="ph ph-play-fill" aria-hidden="true"></i>';

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

      const currentTime = documentRef.createElement("span");
      currentTime.className = "voice-player-time voice-player-current";
      currentTime.textContent = "00:00";
      const duration = documentRef.createElement("span");
      duration.className = "voice-player-time voice-player-duration";
      duration.textContent = "00:00";

      const timeline = documentRef.createElement("div");
      timeline.className = "voice-player-timeline";
      timeline.append(waveform, currentTime, duration);
      wrapper.append(playButton, timeline, audio);

      let signedAt = Date.now();
      let refreshing = false;
      let retried = false;
      let destroyed = false;

      function render() {
        if (destroyed) return;
        const total = Number.isFinite(audio.duration) ? audio.duration : 0;
        const elapsed = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const ratio = total > 0 ? Math.max(0, Math.min(1, elapsed / total)) : 0;
        const playing = !audio.paused && !audio.ended;
        wrapper.classList.toggle("is-playing", playing);
        playButton.innerHTML = playing
          ? '<i class="ph ph-pause-fill" aria-hidden="true"></i>'
          : '<i class="ph ph-play-fill" aria-hidden="true"></i>';
        playButton.setAttribute("aria-label", playing ? "إيقاف الرسالة الصوتية مؤقتاً" : "تشغيل الرسالة الصوتية");
        currentTime.textContent = formatTime(elapsed);
        duration.textContent = formatTime(total);
        waveform.setAttribute("aria-valuemax", String(Math.floor(total)));
        waveform.setAttribute("aria-valuenow", String(Math.floor(elapsed)));
        waveform.setAttribute("aria-valuetext", formatTime(elapsed) + " من " + formatTime(total));
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
          if (resume) await audio.play();
          return true;
        } catch (error) {
          if (typeof settings.onError === "function") settings.onError(error);
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
          await audio.play();
        } catch (error) {
          if (typeof settings.onError === "function") settings.onError(error);
        }
      }

      playButton.addEventListener("click", () => {
        if (!audio.paused && !audio.ended) audio.pause();
        else void startPlayback();
      });

      function seek(clientX) {
        const total = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (!total) return;
        const rect = waveform.getBoundingClientRect();
        if (!rect.width) return;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        audio.currentTime = ratio * total;
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
          void refreshAudioUrl(false);
        } else if (typeof settings.onError === "function") {
          settings.onError(new Error("تعذر تحميل الرسالة الصوتية"));
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
      return wrapper;
    }

    return { createPlayer, stopAll: () => coordinator.stop(), coordinator };
  }

  return { create, createPlaybackCoordinator, formatTime };
});
