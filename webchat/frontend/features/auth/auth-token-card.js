import { $ } from "../../core/dom.js";
import { renderAuthCheckStatus, setAppToken } from "../../app/app-context.js";

function setMessage(messageEl, kind, text) {
  if (!messageEl) return;
  messageEl.textContent = text || "";
  messageEl.className = `${text ? "" : "hidden "}text-xs leading-relaxed ${kind === "error" ? "text-red-600" : "text-gray-500"}`;
}

function setBusy(submitBtn, busy) {
  if (!submitBtn) return;
  submitBtn.disabled = busy;
  submitBtn.classList.toggle("opacity-80", busy);
  submitBtn.classList.toggle("cursor-not-allowed", busy);
  submitBtn.innerHTML = busy
    ? '<i class="fa-solid fa-spinner fa-spin"></i><span>校验中...</span>'
    : '<i class="fa-solid fa-plug"></i><span>连接</span>';
}

export function initAuthTokenCard({ context, authService, onAuthenticated } = {}) {
  const overlay = $("auth-card-overlay");
  const form = $("auth-card-form");
  const input = $("auth-token-input");
  const message = $("auth-card-message");
  const submit = $("auth-card-submit");

  function show() {
    if (!overlay) return;
    overlay.classList.remove("hidden");
    input?.focus();
  }

  function hide() {
    overlay?.classList.add("hidden");
  }

  async function verifyCurrentToken({ silent = false } = {}) {
    if (!context?.token) {
      show();
      return false;
    }

    try {
      if (!silent) setBusy(submit, true);
      await authService.check();
      renderAuthCheckStatus("ok", "已认证");
      hide();
      onAuthenticated?.();
      return true;
    } catch (err) {
      renderAuthCheckStatus("error", "认证失败");
      show();
      setMessage(message, "error", `认证失败：${err?.message || err}`);
      return false;
    } finally {
      if (!silent) setBusy(submit, false);
    }
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = input?.value.trim() || "";
    if (!token) {
      setMessage(message, "error", "请输入 gateway token。");
      input?.focus();
      return;
    }

    setMessage(message, "info", "正在连接后端...");
    setAppToken(context, token);
    renderAuthCheckStatus("warn", "认证中");
    await verifyCurrentToken();
  });

  if (input && context?.token) input.value = context.token;
  if (!context?.token) show();

  return {
    show,
    hide,
    verifyCurrentToken,
  };
}
