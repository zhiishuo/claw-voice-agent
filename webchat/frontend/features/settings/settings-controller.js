import { $ } from "../../core/dom.js";
import { STORAGE_KEYS, readLocal, writeLocal } from "../../core/storage.js";

const TRACE_KEY = "openclaw-webchat-traces";

function loadTraces(session) {
  try {
    const raw = readLocal(`${TRACE_KEY}:${session}`, "");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTraces(session, traces) {
  writeLocal(`${TRACE_KEY}:${session}`, JSON.stringify(traces));
}

function addTrace(session, record) {
  const traces = loadTraces(session);
  traces.unshift(record);
  if (traces.length > 50) traces.length = 50;
  saveTraces(session, traces);
}

function fmtTs(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function openModal(modalEl, contentEl) {
  if (!modalEl) return;
  modalEl.classList.remove("hidden");
  void modalEl.offsetWidth;
  modalEl.classList.remove("opacity-0");
  if (contentEl) {
    contentEl.classList.remove("scale-95", "opacity-0");
    contentEl.classList.add("scale-100", "opacity-100");
  }
}

function closeModal(modalEl, contentEl) {
  if (!modalEl) return;
  modalEl.classList.add("opacity-0");
  if (contentEl) {
    contentEl.classList.remove("scale-100", "opacity-100");
    contentEl.classList.add("scale-95", "opacity-0");
  }
  setTimeout(() => modalEl.classList.add("hidden"), 300);
}

/**
 * @param {object} opts
 * @param {object} opts.context - appContext
 * @param {object} opts.debugService - from services.debug
 */
export function initSettingsModal({ context, debugService } = {}) {
  // Settings modal elements
  const settingsBtn = $("open-settings-btn");
  const settingsModal = $("settings-modal");
  const settingsModalContent = $("settings-modal-content");
  const closeSettingsTop = $("close-settings-top");
  const closeSettingsBtn = $("close-settings-btn");
  const saveSettingsBtn = $("save-settings-btn");

  // Settings fields
  const wakeWordInput = $("setting-wake-word");
  const languageSelect = $("setting-language");
  const ttsModeSelect = $("setting-tts-mode");
  const voiceTypeSelect = $("setting-voice-type");
  const voiceModeSelect = $("setting-voice-mode");
  const autoTtsCheckbox = $("setting-auto-tts");
  const autoPlayCheckbox = $("setting-auto-play");
  const autoSendCheckbox = $("setting-auto-send");
  const autoPrependWakeCheckbox = $("setting-auto-prepend-wake");

  // Debug modal elements
  const openDebugBtn = $("open-debug-btn");
  const debugModal = $("debug-modal");
  const debugModalContent = $("debug-modal-content");
  const debugCloseBtn = $("debug-close-btn");
  const debugRefreshBtn = $("debug-refresh-btn");
  const debugFilter = $("debug-filter");
  const debugLogList = $("debug-log-list");
  const debugSubtitle = $("debug-subtitle");
  const debugHealthGrid = $("debug-health-grid");
  const debugAlertList = $("debug-alert-list");

  // Trace modal elements
  const openTraceBtn = $("open-trace-btn");
  const traceModal = $("trace-modal");
  const traceModalContent = $("trace-modal-content");
  const traceCloseBtn = $("trace-close-btn");
  const traceRefreshBtn = $("trace-refresh-btn");
  const traceClearBtn = $("trace-clear-btn");
  const traceList = $("trace-list");
  const traceSubtitle = $("trace-subtitle");

  // --- Settings read/write ---
  function loadSettingsToForm() {
    if (wakeWordInput) wakeWordInput.value = readLocal(STORAGE_KEYS.wakePhrase, "南方8900");
    if (languageSelect) languageSelect.value = readLocal(STORAGE_KEYS.language, "zh");
    if (ttsModeSelect) ttsModeSelect.value = readLocal(STORAGE_KEYS.ttsMode, "api");
    if (voiceTypeSelect) voiceTypeSelect.value = readLocal(STORAGE_KEYS.ttsVoice, "zh-CN-XiaoxiaoNeural");
    if (voiceModeSelect) voiceModeSelect.value = readLocal(STORAGE_KEYS.voiceInputMode, "ptt");
    if (autoTtsCheckbox) autoTtsCheckbox.checked = readLocal(STORAGE_KEYS.autoTts, "1") !== "0";
    if (autoPlayCheckbox) autoPlayCheckbox.checked = readLocal("openclaw-webchat-auto-play", "1") !== "0";
    if (autoSendCheckbox) autoSendCheckbox.checked = readLocal(STORAGE_KEYS.autoSend, "0") !== "0";
    if (autoPrependWakeCheckbox) autoPrependWakeCheckbox.checked = readLocal(STORAGE_KEYS.autoPrependWake, "1") !== "0";
  }

  function saveFormToSettings() {
    const wakePhrase = wakeWordInput?.value?.trim() || "南方8900";
    const language = languageSelect?.value || "zh";
    const ttsMode = ttsModeSelect?.value || "api";
    const ttsVoice = voiceTypeSelect?.value || "zh-CN-XiaoxiaoNeural";
    const voiceInputMode = voiceModeSelect?.value || "ptt";
    const autoTts = autoTtsCheckbox?.checked ?? true;
    const autoPlay = autoPlayCheckbox?.checked ?? true;
    const autoSend = autoSendCheckbox?.checked ?? false;
    const autoPrependWake = autoPrependWakeCheckbox?.checked ?? true;

    writeLocal(STORAGE_KEYS.wakePhrase, wakePhrase);
    writeLocal(STORAGE_KEYS.language, language);
    writeLocal(STORAGE_KEYS.ttsMode, ttsMode);
    writeLocal(STORAGE_KEYS.ttsVoice, ttsVoice);
    writeLocal(STORAGE_KEYS.voiceInputMode, voiceInputMode);
    writeLocal(STORAGE_KEYS.autoTts, autoTts ? "1" : "0");
    writeLocal("openclaw-webchat-auto-play", autoPlay ? "1" : "0");
    writeLocal(STORAGE_KEYS.autoSend, autoSend ? "1" : "0");
    writeLocal(STORAGE_KEYS.autoPrependWake, autoPrependWake ? "1" : "0");

    if (context?.settings) {
      context.settings.transcriptLanguage = language;
      context.settings.ttsMode = ttsMode;
      context.settings.ttsVoice = ttsVoice;
      context.settings.autoTts = autoTts;
      context.settings.autoPlay = autoPlay;
      context.settings.autoPrependWake = autoPrependWake;
    }
  }

  // --- Debug classification ---
  const DEBUG_COMPONENTS = ["ASR", "Agent", "TTS", "唤醒词", "Web"];

  function debugComponent(item = {}) {
    const event = String(item.event || "");
    const path = String(item.path || "");
    const engine = String(item.engine || "");
    if (event.includes("transcribe") || path.includes("/api/transcribe")) return "ASR";
    if (event.includes("chat") || path.includes("/api/chat")) return "Agent";
    if (event.includes("tts") || path.includes("/api/tts")) return "TTS";
    if (event.includes("wake") || path.includes("/api/wake") || engine.includes("wake")) return "唤醒词";
    return "Web";
  }

  function debugSeverity(item = {}) {
    const event = String(item.event || "");
    const error = String(item.error || item.detail || "");
    if (event.includes("timeout")) return "critical";
    if (event.includes("error") || error) return "critical";
    if (event === "wake_response" && item.matched === false) return "warning";
    if (event.includes("request")) return "info";
    return "ok";
  }

  function fmtTime(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function renderHealthGrid(items) {
    if (!debugHealthGrid) return;
    debugHealthGrid.innerHTML = "";
    DEBUG_COMPONENTS.forEach((name) => {
      const latest = items.find((item) => debugComponent(item) === name);
      const severity = latest ? debugSeverity(latest) : "unknown";
      const colors = {
        ok: "bg-green-50 border-green-200 text-green-700",
        info: "bg-blue-50 border-blue-200 text-blue-700",
        warning: "bg-amber-50 border-amber-200 text-amber-700",
        critical: "bg-red-50 border-red-200 text-red-700",
        unknown: "bg-gray-50 border-gray-200 text-gray-500",
      };
      const labels = { ok: "正常", info: "活跃", warning: "告警", critical: "异常", unknown: "暂无记录" };
      const card = document.createElement("div");
      card.className = `rounded-lg border p-2.5 text-center ${colors[severity]}`;
      card.innerHTML = `
        <div class="text-[11px] font-bold mb-0.5">${name}</div>
        <div class="text-[10px] font-medium">${labels[severity]}</div>
        <div class="text-[9px] opacity-70 mt-0.5 truncate" title="${latest ? `${latest.event || ""} · ${fmtTime(latest.ts)}` : "等待事件"}">${latest ? fmtTime(latest.ts) : "等待事件"}</div>
      `;
      debugHealthGrid.appendChild(card);
    });
  }

  function renderAlerts(items) {
    if (!debugAlertList) return;
    const alerts = items.filter((item) => {
      const s = debugSeverity(item);
      return s === "critical" || s === "warning";
    }).slice(0, 8);

    if (!alerts.length) {
      debugAlertList.innerHTML = '<div class="text-gray-400 py-2 text-center text-[11px]">暂无告警</div>';
      return;
    }

    debugAlertList.innerHTML = alerts.map((item) => {
      const severity = debugSeverity(item);
      const color = severity === "critical" ? "text-red-600 bg-red-50" : "text-amber-600 bg-amber-50";
      const icon = severity === "critical" ? "fa-circle-xmark" : "fa-triangle-exclamation";
      return `
        <div class="flex items-start gap-2 px-3 py-2 rounded-lg ${color}">
          <i class="fa-solid ${icon} text-[10px] mt-0.5 flex-shrink-0"></i>
          <div class="min-w-0">
            <div class="font-medium text-[11px]">${fmtTime(item.ts)} · ${escapeHtml(debugComponent(item))} · ${escapeHtml(item.event || "")}</div>
            <div class="text-[10px] opacity-80 truncate">${escapeHtml(item.error || item.detail || "")}</div>
          </div>
        </div>
      `;
    }).join("");
  }

  // --- Debug logs ---
  async function loadDebugLogs() {
    if (!debugService) {
      if (debugLogList) debugLogList.innerHTML = '<div class="text-gray-400 py-4 text-center">调试服务不可用</div>';
      return;
    }
    if (debugLogList) debugLogList.innerHTML = '<div class="text-gray-400 py-4 text-center">加载中...</div>';
    try {
      const data = await debugService.last({
        clientId: context?.clientId || "",
        session: context?.session || "",
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      renderDebugLogs(items);
    } catch (err) {
      if (debugLogList) debugLogList.innerHTML = `<div class="text-red-500 py-4 text-center">加载失败：${escapeHtml(err.message)}</div>`;
    }
  }

  function renderDebugLogs(items) {
    if (!debugLogList) return;

    // Render health grid and alerts from ALL items (unfiltered)
    renderHealthGrid(items);
    renderAlerts(items);

    // Apply filter for raw log
    const filter = debugFilter?.value || "all";
    const filtered = filter === "all" ? items : items.filter((item) => {
      const event = String(item.event || "").toLowerCase();
      return event.includes(filter);
    });

    if (debugSubtitle) debugSubtitle.textContent = `最近 ${filtered.length} 条事件 · ${context?.session || ""}`;

    if (!filtered.length) {
      debugLogList.innerHTML = '<div class="text-gray-400 py-4 text-center">暂无日志</div>';
      return;
    }

    debugLogList.innerHTML = filtered.map((item, index) => {
      const ts = fmtTs(item.ts);
      const event = escapeHtml(item.event || "unknown");
      const isError = String(item.event || "").includes("error") || !!item.error;
      const json = escapeHtml(JSON.stringify(item, null, 2));
      return `
        <div class="border-b border-gray-50 last:border-0 ${isError ? "text-red-600" : ""}">
          <button class="debug-toggle-btn w-full flex items-center gap-2 py-1.5 text-left hover:bg-gray-50 rounded px-1 transition-colors" data-idx="${index}">
            <span class="text-gray-400 flex-shrink-0 w-16">${ts}</span>
            <span class="font-semibold flex-shrink-0 w-24 truncate">${event}</span>
            <span class="text-gray-400 flex-shrink-0"><i class="fa-solid fa-chevron-down text-[8px] transition-transform"></i></span>
          </button>
          <pre class="hidden text-[10px] text-gray-500 bg-gray-50 rounded p-2 mb-1 overflow-x-auto max-h-40 overflow-y-auto"><code>${json}</code></pre>
        </div>
      `;
    }).join("");

    // Bind toggle events
    debugLogList.querySelectorAll(".debug-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pre = btn.nextElementSibling;
        const icon = btn.querySelector("i");
        pre?.classList.toggle("hidden");
        icon?.classList.toggle("rotate-180");
      });
    });
  }

  // --- Trace history ---
  function loadTracesList() {
    const session = context?.session || "";
    const traces = loadTraces(session);
    renderTraces(traces);
  }

  function renderTraces(traces) {
    if (!traceList) return;
    if (traceSubtitle) traceSubtitle.textContent = `当前会话 · ${traces.length} 条记录`;

    if (!traces.length) {
      traceList.innerHTML = '<div class="text-gray-400 py-4 text-center">暂无留痕记录</div>';
      return;
    }

    traceList.innerHTML = traces.map((t) => {
      const ts = fmtTs(t.ts);
      const text = escapeHtml((t.text || "").slice(0, 80));
      const reply = escapeHtml((t.reply || "").slice(0, 80));
      const status = t.status || "ok";
      const statusColor = status === "error" ? "text-red-500" : "text-green-600";
      const statusIcon = status === "error" ? "fa-circle-xmark" : "fa-circle-check";
      return `
        <div class="py-2 border-b border-gray-100 last:border-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-gray-400 text-[11px]">${ts}</span>
            <i class="fa-solid ${statusIcon} text-[10px] ${statusColor}"></i>
            <span class="${statusColor} text-[11px] font-medium">${status}</span>
          </div>
          ${text ? `<div class="text-gray-700 text-[12px] ml-0.5">📝 ${text}</div>` : ""}
          ${reply ? `<div class="text-gray-500 text-[12px] mt-0.5 ml-0.5">💬 ${reply}</div>` : ""}
        </div>
      `;
    }).join("");
  }

  function clearTraces() {
    const session = context?.session || "";
    saveTraces(session, []);
    renderTraces([]);
  }

  // --- Settings modal open/close ---
  function openSettings() {
    if (!settingsModal) return;
    loadSettingsToForm();
    settingsModal.classList.remove("hidden");
    void settingsModal.offsetWidth;
    settingsModal.classList.remove("opacity-0");
    if (settingsModalContent) {
      settingsModalContent.classList.remove("scale-95", "opacity-0");
      settingsModalContent.classList.add("scale-100", "opacity-100");
    }
  }

  function closeSettings() {
    if (!settingsModal) return;
    settingsModal.classList.add("opacity-0");
    if (settingsModalContent) {
      settingsModalContent.classList.remove("scale-100", "opacity-100");
      settingsModalContent.classList.add("scale-95", "opacity-0");
    }
    setTimeout(() => settingsModal.classList.add("hidden"), 300);
  }

  // --- Event binding ---
  settingsBtn?.addEventListener("click", openSettings);
  closeSettingsTop?.addEventListener("click", closeSettings);
  closeSettingsBtn?.addEventListener("click", closeSettings);
  settingsModal?.addEventListener("click", (e) => { if (e.target === settingsModal) closeSettings(); });

  saveSettingsBtn?.addEventListener("click", () => {
    saveSettingsBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 保存中...';
    saveSettingsBtn.classList.add("opacity-80", "cursor-not-allowed");
    setTimeout(() => {
      saveFormToSettings();
      saveSettingsBtn.innerHTML = '<i class="fa-solid fa-check"></i> 已保存';
      saveSettingsBtn.classList.remove("bg-blue-600", "hover:bg-blue-700", "opacity-80", "cursor-not-allowed");
      saveSettingsBtn.classList.add("bg-green-500", "hover:bg-green-600");
      setTimeout(() => {
        closeSettings();
        setTimeout(() => {
          saveSettingsBtn.innerHTML = "保存设置";
          saveSettingsBtn.classList.remove("bg-green-500", "hover:bg-green-600");
          saveSettingsBtn.classList.add("bg-blue-600", "hover:bg-blue-700");
        }, 300);
      }, 600);
    }, 500);
  });

  // Debug modal
  openDebugBtn?.addEventListener("click", () => {
    openModal(debugModal, debugModalContent);
    loadDebugLogs();
  });
  debugCloseBtn?.addEventListener("click", () => closeModal(debugModal, debugModalContent));
  debugRefreshBtn?.addEventListener("click", loadDebugLogs);
  debugFilter?.addEventListener("change", loadDebugLogs);
  debugModal?.addEventListener("click", (e) => { if (e.target === debugModal) closeModal(debugModal, debugModalContent); });

  // Trace modal
  openTraceBtn?.addEventListener("click", () => {
    openModal(traceModal, traceModalContent);
    loadTracesList();
  });
  traceCloseBtn?.addEventListener("click", () => closeModal(traceModal, traceModalContent));
  traceRefreshBtn?.addEventListener("click", loadTracesList);
  traceClearBtn?.addEventListener("click", () => {
    if (window.confirm("确定清空当前会话的留痕记录吗？")) clearTraces();
  });
  traceModal?.addEventListener("click", (e) => { if (e.target === traceModal) closeModal(traceModal, traceModalContent); });

  return {
    addTrace: (record) => addTrace(context?.session || "", record),
    openSettings,
    closeSettings,
  };
}
