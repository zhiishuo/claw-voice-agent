import { $ } from "../../core/dom.js";
import { makeSessionId } from "../../core/ids.js";
import { setAppSession } from "../../app/app-context.js";

function fmtTime(value) {
  if (!value) return "新会话";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "新会话";
  return date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

function titleFromSession(session) {
  const text = String(session || "");
  return text.length > 18 ? `会话 ${text.slice(0, 15)}...` : `会话 ${text}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeSessions(items, currentSession) {
  const sessions = Array.isArray(items) ? [...items] : [];
  if (currentSession && !sessions.some((item) => item.id === currentSession)) {
    sessions.unshift({
      id: currentSession,
      title: titleFromSession(currentSession),
      preview: "当前会话",
      messageCount: 0,
      updatedAt: Date.now(),
    });
  }
  return sessions;
}

function renderWelcome(chatContainer) {
  chatContainer.innerHTML = `
    <div id="empty-welcome" class="flex-1 flex flex-col items-center justify-center min-h-[60vh] text-center message-anim">
      <h2 class="text-3xl font-bold text-gray-800 mb-3">新会话已就绪</h2>
      <p class="text-gray-500 text-sm">可以直接发送文本，或录音/上传音频。</p>
    </div>
  `;
}

function renderMessages(chatContainer, messages = []) {
  const rows = Array.isArray(messages) ? messages : [];
  if (!rows.length) {
    renderWelcome(chatContainer);
    return;
  }

  chatContainer.innerHTML = rows.map((message) => {
    const role = message.role || "assistant";
    const rawContent = message.content || message.text || "";
    const ts = message.ts ? new Date(message.ts).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" }) : "";

    if (role === "user") {
      const content = escapeHtml(rawContent);
      return `
        <div class="flex justify-end message-anim mt-2">
          <div class="flex flex-col max-w-[80%] items-end">
            <div class="bg-[#f4f4f4] text-gray-800 px-5 py-3 rounded-2xl rounded-tr-sm text-[15px] leading-relaxed w-fit">${content}</div>
            ${ts ? `<div class="text-[10px] text-gray-400 mt-1 mr-1">${ts}</div>` : ""}
          </div>
        </div>
      `;
    }
    const html = rawContent
      ? (typeof marked !== "undefined" ? marked.parse(rawContent) : escapeHtml(rawContent).replace(/\n/g, "<br>"))
      : "";
    return `
      <div class="flex items-start gap-4 message-anim mt-2">
        <div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex-shrink-0 flex items-center justify-center font-bold text-xs">ATC</div>
        <div class="flex-1 flex flex-col gap-1 min-w-0">
          <div class="text-[15px] leading-relaxed p-1 text-gray-800"><div class="markdown-body">${html}</div></div>
          ${ts ? `<div class="text-[10px] text-gray-400 ml-1">${ts}</div>` : ""}
        </div>
      </div>
    `;
  }).join("");
  chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" });
}

export function initSessionList({ context, sessionService, chatContainer, enabled = true } = {}) {
  const historyList = $("history-list");
  const newSessionBtn = $("new-session-btn");
  const clearSessionsBtn = $("clear-sessions-btn");
  let sessions = [];
  let isEnabled = enabled;

  function render(items = sessions) {
    if (!historyList) return;
    sessions = normalizeSessions(items, context.session);
    historyList.innerHTML = "";
    if (!sessions.length) {
      historyList.innerHTML = '<li class="px-2 py-2 text-sm text-gray-400">暂无历史会话</li>';
      return;
    }

    sessions.forEach((item) => {
      const active = item.id === context.session;
      const li = document.createElement("li");
      li.dataset.session = item.id;
      li.innerHTML = `
        <button class="w-full text-left px-2 py-2 rounded-md ${active ? "bg-gray-200 font-medium" : "hover:bg-gray-200"} text-sm text-gray-700 transition-colors group relative">
          <div class="truncate">${escapeHtml(item.title || titleFromSession(item.id))}</div>
          <div class="text-xs text-gray-500 mt-0.5 flex justify-between gap-2">
            <span>${Number(item.messageCount || 0)}条</span>
            <span>${fmtTime(item.updatedAt)}</span>
          </div>
          ${item.preview ? `<div class="text-xs text-gray-500 mt-0.5 truncate">${escapeHtml(item.preview)}</div>` : ""}
        </button>
      `;
      li.querySelector("button")?.addEventListener("click", () => void switchTo(item.id));
      historyList.appendChild(li);
    });
  }

  async function loadSessions() {
    if (!isEnabled || !sessionService) {
      render();
      return;
    }
    try {
      const data = await sessionService.list();
      render(Array.isArray(data?.sessions) ? data.sessions : []);
    } catch {
      render();
    }
  }

  async function switchTo(session) {
    const next = String(session || "").trim();
    if (!next || next === context.session) return;
    setAppSession(context, next);
    render(sessions);
    if (!isEnabled || !sessionService) {
      renderWelcome(chatContainer);
      return;
    }
    try {
      const data = await sessionService.loadMessages(next);
      renderMessages(chatContainer, data?.messages || []);
    } catch (err) {
      chatContainer.innerHTML = `<div class="text-sm text-red-600">加载会话失败：${escapeHtml(err?.message || err)}</div>`;
    }
  }

  async function createNewSession() {
    setAppSession(context, makeSessionId());
    renderWelcome(chatContainer);
    render(sessions);
  }

  async function deleteSession(session) {
    const target = String(session || "").trim();
    if (!target) return;
    if (isEnabled && sessionService) {
      try {
        const data = await sessionService.delete(target);
        sessions = Array.isArray(data?.sessions) ? data.sessions : sessions.filter((item) => item.id !== target);
      } catch {
        sessions = sessions.filter((item) => item.id !== target);
      }
    } else {
      sessions = sessions.filter((item) => item.id !== target);
    }
    if (target === context.session) await createNewSession();
    render(sessions);
  }

  async function clearAll() {
    const ok = window.confirm("确定清空所有历史会话吗？");
    if (!ok) return;
    if (isEnabled && sessionService) {
      try {
        await sessionService.clearAll();
      } catch {
        // Keep the UI responsive even if the backend rejects a dev-time clear.
      }
    }
    sessions = [];
    await createNewSession();
  }

  newSessionBtn?.addEventListener("click", () => void createNewSession());
  clearSessionsBtn?.addEventListener("click", () => void clearAll());

  render();
  void loadSessions();

  return {
    refresh: loadSessions,
    deleteSession,
    setEnabled(nextEnabled) {
      isEnabled = !!nextEnabled;
    },
  };
}
