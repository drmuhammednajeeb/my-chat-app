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


## 2026.11.12.6 — إعادة تفعيل تفاعلات الرسائل

- إعادة بناء قائمة تفاعلات الرسالة كوحدة مستقلة تدعم الفتح بالنقر والتمرير على سطح المكتب واللمس على الهواتف.
- حفظ تفاعل واحد لكل مستخدم ورسالة باستخدام المفتاح الفريد الحالي، مع إمكانية تغييره أو إزالته.
- عرض ملخص التفاعلات وعددها أسفل الرسالة، وتمييز تفاعل المستخدم الحالي.
- تحميل التفاعلات ضمن بيانات الرسائل، ومزامنتها عبر أحداث INSERT وUPDATE وDELETE في Supabase Realtime.
- إبقاء أنواع التفاعل متوافقة مع قيد قاعدة البيانات الحالي (like وheart)، دون تعديل قاعدة البيانات.
- إضافة ملفات الوحدة إلى Service Worker shell cache مع رفع إصدار الذاكرة المؤقتة.


## 2026.11.12.7 — إعادة بناء مساحة الحالة

- فصل منطق الحالة عن وحدة صور المحادثات وإعادة تنظيمه كوحدة مستقلة.
- إنشاء مساحة حالة مستقلة عن سجل المحادثات مع مسار رجوع واضح.
- دعم نشر نص حتى 280 حرفاً أو صورة أو فيديو MP4/WebM/MOV، بحد أقصى 25 ميجابايت.
- عرض الحالات حسب صاحبها، مع روابط وسائط موقعة قصيرة الأجل وتحديث عبر Supabase Realtime.
- الإبقاء على انتهاء الحالة بعد 24 ساعة وعلى سياسات RLS والتخزين الخاص.
- لا تُخزّن وسائط الحالة في Service Worker، ولا تُعرض كرسائل داخل المحادثات.


## 2026.11.12.8 — فصل مساحة الحالة ودعم المحتوى المركّب

- فصل واجهة الحالة ومنطقها عن وحدة صور المحادثات في ملفات مستقلة.
- دعم نشر نص مع صورة أو فيديو في الحالة الواحدة، مع حد 280 حرفاً و25 ميجابايت للوسائط.
- ربط بيانات صاحب الحالة بعلاقة الملف الشخصي الصريحة، وتحسين تحديث القائمة عند تزامن أحداث Realtime.
- الإبقاء على التخزين الخاص وروابط الوسائط الموقعة وحد انتهاء الحالة البالغ 24 ساعة.
