# Application release and update procedure

The application compares the version embedded in the loaded page with the public `version.json` file. The version endpoint is requested with a cache-busting query and `cache: no-store`; it is deliberately not cached by the service worker.

## Publishing a new release

For every application release:

1. Choose a version greater than the previous release, using numeric dot-separated components (for example, `2026.11.12.3`).
2. Set the same value in the `app-version` meta tag in `index.html` and the `version` property in `version.json`.
3. Add concise release notes to `version.json`.
4. Increment `CACHE_VERSION` in `service-worker.js` so the new shell cache is isolated from the previous cache.
5. Merge and deploy through the approved production workflow. Do not edit production files or databases manually.

## Client behavior

- The client checks on startup, when the app becomes visible or focused, and every five minutes.
- A higher published version opens the in-app update dialog.
- The new service worker remains waiting until the user selects **تحديث الآن**. The client then sends the explicit `SKIP_WAITING` message, waits for controller takeover, and reloads.
- Supabase/API requests, authenticated records, and chat messages are never cached by this update mechanism.
- If service workers are unavailable, the version prompt still offers a normal page reload; offline clients cannot download a release.

Both the page version and `version.json` must be updated together. A new release must be deployed before clients can discover it.


## 2026.11.12.5 — تحسين مشغل الرسائل الصوتية

- إظهار مدة الرسالة كاملة بعد تحميل بيانات الملف وقبل بدء التشغيل.
- عرض الوقت المتبقي تنازليًا أثناء التشغيل وبعد الإيقاف المؤقت، وإعادة عرض المدة الكاملة عند نهاية الملف.
- عدم إظهار `00:00` مضللة أثناء انتظار بيانات المدة.
- مزامنة حالة زر التشغيل مع أحداث التشغيل والإيقاف والنهاية، وتحسين تمركز الأيقونة داخل الدائرة.
- لا تغييرات على التسجيل أو التخزين أو قاعدة البيانات.


## 2026.11.12.7 — قسم الحالة المستقل والوسائط المؤقتة

- إضافة زر تنقل مستقل للحالة بعيداً عن المحادثات والمجموعات والقنوات.
- إنشاء مساحة حالة مستقلة مع عرض حالات المستخدم الحالي وبقية الأعضاء، والعودة إلى المحادثات من داخل الصفحة.
- دعم نشر نص حتى 280 حرفاً أو صورة أو فيديو MP4/WebM/MOV، مع حد 25 ميجابايت للوسائط.
- الإبقاء على جدول `profile_statuses` المنفصل، وإضافة `media_type` لتمييز الصور عن الفيديو مع التحقق من امتداد المسار.
- توسيع قيود التخزين الخاص `profile-status-media` دون جعله عاماً، مع الإبقاء على سياسات الملكية وقراءة الحالات النشطة.
- استمرار انتهاء الحالة تلقائياً بعد 24 ساعة والمزامنة عبر Supabase Realtime.
- لا يتم عرض الحالات ضمن سجل المحادثات ولا تُخزّن ملفات الوسائط في ذاكرة Service Worker.
