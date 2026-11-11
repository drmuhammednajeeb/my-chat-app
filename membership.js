/* BizmindMakers Chat Pro — private membership administration */
(function () {
  "use strict";

  const byId = id => document.getElementById(id);
  let latestInvites = [];
  let loading = false;

  function make(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  // Forever IDs are 971 + nine digits. Accept the company's grouped display form
  // and normalize to digits before sending values to PostgreSQL.
  function normalizeForeverMembershipNumber(value) {
    const raw = String(value || "").trim();
    if (/^971-[0-9]{3}-[0-9]{3}-[0-9]{3}$/.test(raw)) return raw.replace(/-/g, "");
    if (/^971[0-9]{9}$/.test(raw)) return raw;
    return null;
  }

  function formatForeverMembershipNumber(value) {
    const digits = normalizeForeverMembershipNumber(value);
    return digits
      ? digits.replace(/^(971)([0-9]{3})([0-9]{3})([0-9]{3})$/, "$1-$2-$3-$4")
      : String(value || "—");
  }

  function dateLabel(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ar-SA", {
      year: "numeric", month: "short", day: "numeric"
    });
  }

  function setPanelMessage(container, message, isError) {
    if (!container) return;
    container.replaceChildren(make("div", isError ? "membership-message error" : "membership-message", message));
  }

  function addCell(row, text, className) {
    row.append(make("span", className || "", text));
  }

  function renderGeneratedInvites(rows) {
    const target = byId("membershipInviteResults");
    target.replaceChildren();
    if (!rows.length) {
      setPanelMessage(target, "لم يتم إنشاء دعوات في هذه العملية.", false);
      return;
    }
    const intro = make("div", "membership-result-note",
      "تم إنشاء الدعوات. رمز كل دعوة سري ويُستخدم مرة واحدة، ويجب إرساله إلى البريد المحدد فقط.");
    target.append(intro);
    rows.forEach(item => {
      const row = make("article", "membership-generated-row");
      const info = make("div", "membership-generated-info");
      info.append(make("strong", "", item.email));
      info.append(make("small", "", "رقم العضوية: " + item.membership_number));
      info.append(make("small", "", "ينتهي: " + dateLabel(item.expires_at)));
      const secret = make("code", "membership-invite-code", item.invitation_code);
      const copy = make("button", "membership-copy-btn", "نسخ بيانات الدعوة");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        const text = "البريد: " + item.email + "\nرقم العضوية: " + item.membership_number + "\nرمز الدعوة: " + item.invitation_code;
        try {
          await navigator.clipboard.writeText(text);
          if (typeof toast === "function") toast("تم نسخ بيانات الدعوة");
        } catch (_) {
          secret.textContent = text;
          const range = document.createRange();
          range.selectNodeContents(secret);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          if (typeof toast === "function") toast("حدد النص وانسخه يدوياً");
        }
      });
      const codeWrap = make("div", "membership-secret-wrap");
      codeWrap.append(secret, copy);
      row.append(info, codeWrap);
      target.append(row);
    });
    byId("downloadMembershipInvitesBtn").disabled = false;
  }

  function renderPendingInvites(rows) {
    const target = byId("membershipPendingInvites");
    target.replaceChildren();
    if (!rows.length) {
      setPanelMessage(target, "لا توجد دعوات معلقة حالياً.", false);
      return;
    }
    rows.forEach(item => {
      const row = make("article", "membership-list-row");
      const info = make("div", "membership-list-info");
      info.append(make("strong", "", item.email));
      info.append(make("small", "", formatForeverMembershipNumber(item.membership_number) + " · تنتهي " + dateLabel(item.expires_at)));
      const revoke = make("button", "membership-danger-btn", "إلغاء الدعوة");
      revoke.type = "button";
      revoke.addEventListener("click", async () => {
        if (!confirm("هل تريد إلغاء دعوة " + item.email + "؟")) return;
        revoke.disabled = true;
        const { error } = await supabaseClient.rpc("admin_revoke_member_invite", { p_invite_id: item.id });
        if (error) {
          revoke.disabled = false;
          if (typeof toast === "function") toast(error.message || "تعذر إلغاء الدعوة");
          return;
        }
        if (typeof toast === "function") toast("تم إلغاء الدعوة");
        await loadMembershipAdmin();
      });
      row.append(info, revoke);
      target.append(row);
    });
  }

  function renderMembers(rows) {
    const target = byId("membershipMembersList");
    target.replaceChildren();
    byId("membershipMemberCount").textContent = rows.length.toLocaleString("en-US") + " عضو";
    if (!rows.length) {
      setPanelMessage(target, "لا توجد عضويات مسجلة.", false);
      return;
    }
    rows.forEach(item => {
      const row = make("article", "membership-list-row");
      const info = make("div", "membership-list-info");
      info.append(make("strong", "", item.display_name || item.username || "عضو"));
      info.append(make("small", "", item.email || "—"));
      info.append(make("small", "membership-number-label",
        item.membership_number_verified
          ? "رقم فوريفر الرسمي: " + formatForeverMembershipNumber(item.membership_number) + " · @" + item.username
          : "رقم العضوية الرسمي غير معتمد بعد · @" + item.username));

      const isVerified = item.membership_number_verified === true;
      const statusText = !isVerified ? "بانتظار الرقم الرسمي"
        : item.membership_status === "active" ? "نشط" : "موقوف";
      const status = make("span",
        isVerified && item.membership_status === "active" ? "membership-status active" : "membership-status suspended",
        statusText);
      const controls = make("div", "membership-member-controls");

      if (!isVerified) {
        const verify = make("button", "membership-activate-btn", "اعتماد رقم فوريفر");
        verify.type = "button";
        verify.addEventListener("click", async () => {
          const officialNumber = prompt(
            "أدخل رقم العضوية الرسمي بصيغة 971-000-000-000:",
            ""
          );
          if (officialNumber === null) return;
          const normalized = normalizeForeverMembershipNumber(officialNumber);
          if (!normalized) {
            if (typeof toast === "function") toast("رقم غير صحيح. استخدم الصيغة 971-000-000-000 أو 971000000000");
            return;
          }
          verify.disabled = true;
          const { error } = await supabaseClient.rpc("admin_set_member_official_number", {
            p_user_id: item.user_id,
            p_membership_number: normalized
          });
          if (error) {
            verify.disabled = false;
            if (typeof toast === "function") toast(error.message || "تعذر اعتماد رقم العضوية");
            return;
          }
          if (typeof toast === "function") toast("تم اعتماد رقم العضوية الرسمية");
          await loadMembershipAdmin();
        });
        controls.append(status, verify);
      } else {
        const toggle = make("button", item.membership_status === "active" ? "membership-danger-btn" : "membership-activate-btn",
          item.membership_status === "active" ? "إيقاف العضوية" : "إعادة التفعيل");
        toggle.type = "button";
        toggle.addEventListener("click", async () => {
          const next = item.membership_status === "active" ? "suspended" : "active";
          const action = next === "suspended" ? "إيقاف" : "إعادة تفعيل";
          if (!confirm(action + " عضوية " + (item.display_name || item.email) + "؟")) return;
          toggle.disabled = true;
          const { error } = await supabaseClient.rpc("admin_update_membership_status", {
            p_user_id: item.user_id, p_status: next
          });
          if (error) {
            toggle.disabled = false;
            if (typeof toast === "function") toast(error.message || "تعذر تحديث العضوية");
            return;
          }
          if (typeof toast === "function") toast("تم تحديث حالة العضوية");
          await loadMembershipAdmin();
        });
        controls.append(status, toggle);
      }
      row.append(info, controls);
      target.append(row);
    });
  }

  async function loadMembershipAdmin() {
    if (loading || !state?.isTeamAdmin) return;
    loading = true;
    setPanelMessage(byId("membershipPendingInvites"), "جارٍ تحميل الدعوات…", false);
    setPanelMessage(byId("membershipMembersList"), "جارٍ تحميل الأعضاء…", false);
    try {
      const { data, error } = await supabaseClient.rpc("admin_list_memberships");
      if (error) throw error;
      renderPendingInvites(data?.pending_invites || []);
      renderMembers(data?.members || []);
    } catch (error) {
      console.error("Membership administration load failed:", error);
      setPanelMessage(byId("membershipPendingInvites"), error.message || "تعذر تحميل الدعوات.", true);
      setPanelMessage(byId("membershipMembersList"), "تعذر تحميل قائمة الأعضاء.", true);
    } finally {
      loading = false;
    }
  }

  async function createInvites() {
    const input = byId("memberInviteEmails");
    const button = byId("createMembershipInvitesBtn");
    const lines = input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const members = [];
    for (const line of lines) {
      const parts = line.split(/[\t,;]+/).map(value => value.trim());
      if (parts.length !== 2) {
        if (typeof toast === "function") toast("كل سطر يجب أن يحتوي البريد الإلكتروني ثم رقم فوريفر الرسمي، مفصولين بفاصلة");
        return;
      }
      const email = parts[0].toLowerCase();
      const membership_number = normalizeForeverMembershipNumber(parts[1]);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (typeof toast === "function") toast("بريد إلكتروني غير صحيح: " + email);
        return;
      }
      if (!membership_number) {
        if (typeof toast === "function") toast("رقم فوريفر غير صحيح: " + parts[1] + " — استخدم الصيغة 971-000-000-000 أو 971000000000");
        return;
      }
      members.push({ email, membership_number });
    }
    if (!members.length) {
      if (typeof toast === "function") toast("أدخل البريد ورقم العضوية الرسمية لكل عضو");
      return;
    }
    if (members.length > 1000) {
      if (typeof toast === "function") toast("الحد الأقصى 1,000 دعوة في الدفعة الواحدة");
      return;
    }
    const emails = members.map(item => item.email);
    const numbers = members.map(item => item.membership_number);
    if (new Set(emails).size !== emails.length || new Set(numbers).size !== numbers.length) {
      if (typeof toast === "function") toast("توجد عناوين بريد أو أرقام عضوية مكررة في القائمة");
      return;
    }
    button.disabled = true;
    button.innerHTML = '<i class="ph ph-spinner-gap"></i> جارٍ التحقق وإنشاء الدعوات…';
    try {
      const { data, error } = await supabaseClient.rpc("admin_create_official_member_invites", { p_members: members });
      if (error) throw error;
      latestInvites = data || [];
      renderGeneratedInvites(latestInvites);
      input.value = "";
      if (typeof toast === "function") toast("تم إنشاء " + latestInvites.length + " دعوة بأرقام فوريفر الرسمية");
      await loadMembershipAdmin();
    } catch (error) {
      console.error("Official membership invitation creation failed:", error);
      if (typeof toast === "function") toast(error.message || "تعذر إنشاء الدعوات");
    } finally {
      button.disabled = false;
      button.innerHTML = '<i class="ph ph-user-plus"></i> إنشاء الدعوات الرسمية';
    }
  }

  function downloadInvites() {
    if (!latestInvites.length) return;
    const rows = [["email", "membership_number", "invitation_code", "expires_at"]];
    latestInvites.forEach(item => rows.push([
      item.email, item.membership_number, item.invitation_code, item.expires_at
    ]));
    const csv = "\uFEFF" + rows.map(row => row.map(value =>
      '"' + String(value ?? "").replace(/"/g, '""') + '"'
    ).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = make("a");
    link.href = url;
    link.download = "bizmindmakers-membership-invitations.csv";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  document.addEventListener("DOMContentLoaded", () => {
    byId("createMembershipInvitesBtn")?.addEventListener("click", createInvites);
    byId("downloadMembershipInvitesBtn")?.addEventListener("click", downloadInvites);
    byId("refreshMembershipAdminBtn")?.addEventListener("click", loadMembershipAdmin);
    byId("teamTab")?.addEventListener("click", () => loadMembershipAdmin());
    byId("teamRefreshBtn")?.addEventListener("click", () => loadMembershipAdmin());
    if (state?.isTeamAdmin) loadMembershipAdmin();
  });

  // This script is loaded after the page markup and the app's main controller.
  if (document.readyState !== "loading") {
    byId("createMembershipInvitesBtn")?.addEventListener("click", createInvites);
    byId("downloadMembershipInvitesBtn")?.addEventListener("click", downloadInvites);
    byId("refreshMembershipAdminBtn")?.addEventListener("click", loadMembershipAdmin);
    byId("teamTab")?.addEventListener("click", () => loadMembershipAdmin());
    byId("teamRefreshBtn")?.addEventListener("click", () => loadMembershipAdmin());
    if (state?.isTeamAdmin) loadMembershipAdmin();
  }
})();
