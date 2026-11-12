(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BizmindAppUpdater = api.create();
  root.BizmindAppUpdater.compareVersions = api.compareVersions;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  "use strict";

  function compareVersions(left, right) {
    const a = String(left || "0").replace(/^v/i, "").split(".");
    const b = String(right || "0").replace(/^v/i, "").split(".");
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      const x = a[index] === undefined ? "0" : a[index];
      const y = b[index] === undefined ? "0" : b[index];
      const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
      if (xn && yn) {
        const difference = Number(x) - Number(y);
        if (difference) return difference > 0 ? 1 : -1;
      } else {
        const difference = x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" });
        if (difference) return difference > 0 ? 1 : -1;
      }
    }
    return 0;
  }

  function create(options) {
    const config = options || {};
    const doc = config.document || (typeof document !== "undefined" ? document : null);
    const win = config.window || (typeof window !== "undefined" ? window : null);
    const fetcher = config.fetch || (win && win.fetch ? win.fetch.bind(win) : null);
    if (!doc || !win) return { start: async () => null, compareVersions };

    let registration = null;
    let overlay = null;
    let latestRelease = null;
    let started = false;
    let reloadAfterControllerChange = false;

    const currentVersion = () => doc.querySelector('meta[name="app-version"]')?.content || "0.0.0";
    const dismissedKey = "bizmindmakers-dismissed-update";

    function wasDismissed(version) {
      try { return win.sessionStorage.getItem(dismissedKey) === version; } catch (_) { return false; }
    }

    function dismiss(version) {
      try { win.sessionStorage.setItem(dismissedKey, version); } catch (_) {}
      overlay?.remove();
      overlay = null;
    }

    function showUpdate(release) {
      const version = String(release?.version || "تحديث جديد");
      if (wasDismissed(version) || overlay) return;
      latestRelease = release || { version };
      const backdrop = doc.createElement("div");
      backdrop.className = "app-update-overlay";
      backdrop.setAttribute("role", "presentation");
      const dialog = doc.createElement("section");
      dialog.className = "app-update-dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "appUpdateTitle");
      const icon = doc.createElement("div");
      icon.className = "app-update-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "↻";
      const title = doc.createElement("h2");
      title.id = "appUpdateTitle";
      title.textContent = "يتوفر تحديث جديد";
      const description = doc.createElement("p");
      description.className = "app-update-description";
      description.textContent = "أصبح إصدار أحدث من BizmindMakers Chat Pro جاهزاً. حدّث التطبيق للحصول على التحسينات الأخيرة.";
      const versionLabel = doc.createElement("p");
      versionLabel.className = "app-update-version";
      versionLabel.textContent = "الإصدار الحالي: " + currentVersion() + " · الإصدار الجديد: " + version;
      const actions = doc.createElement("div");
      actions.className = "app-update-actions";
      const later = doc.createElement("button");
      later.type = "button";
      later.className = "app-update-later";
      later.textContent = "لاحقاً";
      const update = doc.createElement("button");
      update.type = "button";
      update.className = "app-update-now";
      update.textContent = "تحديث الآن";
      update.addEventListener("click", () => void applyUpdate(update));
      later.addEventListener("click", () => dismiss(version));
      actions.append(later, update);
      dialog.append(icon, title, description, versionLabel, actions);
      backdrop.append(dialog);
      doc.body.append(backdrop);
      overlay = backdrop;
      update.focus();
    }

    async function waitForInstall(worker) {
      if (!worker || worker.state === "installed" || worker.state === "activated" || worker.state === "redundant") return;
      await new Promise(resolve => {
        const finish = () => { worker.removeEventListener("statechange", onChange); resolve(); };
        const onChange = () => {
          if (worker.state === "installed" || worker.state === "activated" || worker.state === "redundant") finish();
        };
        worker.addEventListener("statechange", onChange);
        win.setTimeout(finish, 12000);
      });
    }

    async function applyUpdate(button) {
      if (button) { button.disabled = true; button.textContent = "جارٍ تجهيز التحديث..."; }
      try {
        if (registration) {
          await registration.update().catch(() => {});
          if (registration.installing) await waitForInstall(registration.installing);
          if (registration.waiting) {
            reloadAfterControllerChange = true;
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
            if (button) button.textContent = "جارٍ تفعيل التحديث...";
            return;
          }
        }
      } catch (error) {
        console.warn("App update activation failed:", error);
      }
      win.location.reload();
    }

    async function checkLatest() {
      if (!fetcher) return null;
      try {
        const url = new URL("./version.json", doc.baseURI);
        url.searchParams.set("check", String(Date.now()));
        const response = await fetcher(url.toString(), {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" }
        });
        if (!response.ok) throw new Error("Version endpoint returned " + response.status);
        const release = await response.json();
        if (!release || typeof release.version !== "string" || !release.version.trim()) {
          throw new Error("Invalid version metadata");
        }
        if (compareVersions(release.version, currentVersion()) > 0) showUpdate(release);
        return release;
      } catch (error) {
        console.warn("App version check unavailable:", error);
        return null;
      }
    }

    async function start() {
      if (started) return registration;
      started = true;
      if (win.navigator?.serviceWorker && win.location.protocol === "https:") {
        try {
          registration = await win.navigator.serviceWorker.register(new URL("./service-worker.js", doc.baseURI).toString(), { updateViaCache: "none" });
          registration.addEventListener("updatefound", () => {
            const worker = registration.installing;
            if (!worker) return;
            worker.addEventListener("statechange", () => {
              if (worker.state === "installed" && win.navigator.serviceWorker.controller) {
                void checkLatest().then(release => showUpdate(release || { version: "تحديث جديد" }));
              }
            });
          });
          if (registration.waiting) void checkLatest().then(release => showUpdate(release || { version: "تحديث جديد" }));
          win.navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (reloadAfterControllerChange) win.location.reload();
          });
          await registration.update().catch(() => {});
        } catch (error) {
          console.warn("Service worker registration failed:", error);
        }
      }
      await checkLatest();
      win.addEventListener("focus", checkLatest);
      doc.addEventListener("visibilitychange", () => {
        if (doc.visibilityState === "visible") checkLatest();
      });
      win.setInterval(checkLatest, 5 * 60 * 1000);
      return registration;
    }

    return { start, checkLatest, compareVersions, getRegistration: () => registration };
  }

  return { create, compareVersions };
});
