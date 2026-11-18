(function (root) {
  'use strict';
  function toUserMessage(error, isSignup) {
    const raw = String(error && error.message || '');
    if (!isSignup) return 'تعذر تسجيل الدخول. تحقق من بيانات الدخول والاتصال ثم حاول مجدداً.';
    if (/database error saving new user/i.test(raw) || /الدعوة غير صحيحة أو منتهية أو سبق استخدامها/.test(raw)) {
      return 'تعذر إنشاء الحساب لأن بيانات التسجيل لم تجتز التحقق. تأكد من مطابقة البريد الإلكتروني ورقم العضوية ورمز الدعوة للدعوة السارية، وأن الدعوة لم تُستخدم من قبل.';
    }
    if (/already registered|user already exists|already been registered/i.test(raw)) {
      return 'تعذر إكمال التسجيل بهذه البيانات. تحقق من بياناتك أو استخدم استعادة الحساب إذا سبق لك التسجيل.';
    }
    if (/password.*(weak|short|length)|weak password/i.test(raw)) {
      return 'كلمة المرور غير مستوفية للشروط. استخدم 8 أحرف على الأقل.';
    }
    if (/duplicate key|profiles_username|username.*(taken|exists|already)/i.test(raw)) {
      return 'اسم المستخدم مستخدم بالفعل. اختر اسم مستخدم آخر.';
    }
    if (/invalid email/i.test(raw)) return 'صيغة البريد الإلكتروني غير صحيحة. راجع البريد الذي صدرت إليه الدعوة.';
    return 'تعذر إنشاء الحساب. راجع بيانات التسجيل والدعوة السارية ثم حاول مجدداً.';
  }
  const api = Object.freeze({ toUserMessage });
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BizmindAuthErrors = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
