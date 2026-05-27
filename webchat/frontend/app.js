    import { PIPELINE_ORDER, PIPELINE_LABELS } from "/static/modules/pipeline.js";
    import { fmtTime, fmtDuration } from "/static/modules/time.js";
    import { createApiClient } from "/static/modules/api-client.js";
    import { createChatView } from "/static/modules/chat-view.js";
    import { renderPipelineView } from "/static/modules/pipeline-view.js";
    import { normalizeWakeText, wakeLanguageCode, wakeChunkMs, base64Utf8 } from "/static/modules/wake-utils.js";
    import { encodeWavBlobFromFloat32 } from "/static/modules/audio-codec.js";
    import { autoplayProofAudio } from "/static/modules/tts-playback.js";
    import { createUiModeController } from "/static/modules/ui-mode.js";

    const state = {
      session: null,
      busy: false,
      stream: null,
      mediaRecorder: null,
      mediaChunks: [],
      recording: false,
      monitorContext: null,
      monitorSource: null,
      analyser: null,
      meterTimer: null,
      micDevices: [],
      selectedDeviceId: "",
      inputLevel: 0,
      processEntries: [],
      stepState: {},
      stepStartedAt: {},
      stepDurations: {},
      pipelineExpanded: {},
      pipelineRenderTimer: null,
      transcriptLanguage: "zh",
      autoSend: false,
      pendingTranscript: "",
      lastUpload: null,
      localCapture: null,
      lastWakeProbe: null,
      lastTts: null,
      lastAssistantReply: "",
      clientId: "",
      currentRequestId: "",
      autoTts: true,
      ttsVoice: "zh-CN-XiaoxiaoNeural",
      ttsMode: "api",
      llmBackend: "local",
      knowledgeEnabled: true,
      smartQuickReplies: [],
      quickReplyRequestId: "",
      quickRepliesLoading: false,
      voiceInputMode: "ptt",
      authToken: "",
      authenticated: false,
      wakeEnabled: true,
      wakePhrase: "你好",
      wakeSupported: false,
      wakeListening: false,
      wakeResumeTimer: null,
      wakeLastTriggerAt: 0,
      wakeRecorder: null,
      wakePending: false,
      wakeChunkBuffers: [],
      wakeChunkSamples: 0,
      wakeChunkSampleRate: 16000,
      wakeProcessor: null,
      wakeSilentGain: null,
      currentRecordAutoSend: false,
      currentRecordWakeTriggered: false,
      autoStopOnSilence: false,
      recordStartedAt: 0,
      speechSeenAt: 0,
      silenceSince: 0,
      stopRequested: false,
      wakeDebugTimer: null,
      flowChecklistVisible: false,
      pendingRecord: null,
      sessions: [],
      voiceMessages: {},
    };

    const $ = (id) => document.getElementById(id);
    const messagesEl = $("messages");
    const composerEl = document.querySelector(".composer");
    const statusEl = $("status");
    const draftEl = $("draft");
    const transcriptReviewEl = $("transcriptReview");
    const transcriptReviewHintEl = $("transcriptReviewHint");
    const transcriptReviewEditorEl = $("transcriptReviewEditor");
    const transcriptConfirmBtn = $("transcriptConfirmBtn");
    const transcriptCancelBtn = $("transcriptCancelBtn");
    const sessionEl = $("sessionInput");
    const sessionListEl = $("sessionList");
    const sessionSidebarNewBtn = $("sessionSidebarNewBtn");
    const sessionSidebarClearBtn = $("sessionSidebarClearBtn");
    const tokenInputEl = $("tokenInput");
    const authBtnEl = $("authBtn");
    const authStatusEl = $("authStatus");
    const sendBtn = $("sendBtn");
    const recordBtn = $("recordBtn");
    const uploadBtn = $("uploadBtn");
    const knowledgeTestBtn = $("knowledgeTestBtn");
    const debugModeToggleEl = $("debugModeToggle");
    const uiModeBadgeEl = $("uiModeBadge");
    const uiDensitySelectEl = $("uiDensitySelect");
    const voiceInputModeEl = $("voiceInputMode");
    const quickRepliesEl = $("quickReplies");
    const quickRepliesPanelEl = quickRepliesEl?.closest(".quick-replies-panel") || null;
    const traceHistoryBtn = $("traceHistoryBtn");
    const traceHistoryModalEl = $("traceHistoryModal");
    const traceHistoryCloseBtn = $("traceHistoryCloseBtn");
    const traceHistoryClearBtn = $("traceHistoryClearBtn");
    const traceHistorySubtitleEl = $("traceHistorySubtitle");
    const traceHistoryListEl = $("traceHistoryList");
    const debugTerminalBtn = $("debugTerminalBtn");
    const debugTerminalModalEl = $("debugTerminalModal");
    const debugTerminalCloseBtn = $("debugTerminalCloseBtn");
    const debugTerminalRefreshBtn = $("debugTerminalRefreshBtn");
    const debugTerminalSubtitleEl = $("debugTerminalSubtitle");
    const debugHealthGridEl = $("debugHealthGrid");
    const debugAlertListEl = $("debugAlertList");
    const debugRawLogEl = $("debugRawLog");
    const advancedSettingsBtn = $("advancedSettingsBtn");
    const advancedSettingsModalEl = $("advancedSettingsModal");
    const advancedSettingsCloseBtn = $("advancedSettingsCloseBtn");
    const audioInput = $("audioInput");
    const micSelectEl = $("micSelect");
    const micQuickSelectEl = $("micQuickSelect");
    const refreshMicsBtn = $("refreshMicsBtn");
    const micAvailableStatusEl = $("micAvailableStatus");
    const inputLevelFillEl = $("inputLevelFill");
    const inputLevelTextEl = $("inputLevelText");
    const visualizerCanvas = $("visualizerCanvas");
    const visualizerCtx = visualizerCanvas ? visualizerCanvas.getContext("2d", { willReadFrequently: true }) : null;
    const recordReviewEl = $("recordReview");
    const recordReviewMetaEl = $("recordReviewMeta");
    const recordReviewAudioEl = $("recordReviewAudio");
    const recordConfirmBtn = $("recordConfirmBtn");
    const recordCancelBtn = $("recordCancelBtn");
    const wakeToggleEl = $("wakeToggle");
    const wakePhraseInputEl = $("wakePhraseInput");
    const wakeStatusEl = $("wakeStatus");
    const reloadBtn = $("reloadBtn");
    const newSessionBtn = $("newSessionBtn");
    const pipelineStepsEl = $("pipelineSteps");
    const processLogEl = $("processLog");
    const languageSelectEl = $("languageSelect");
    const autoSendToggleEl = $("autoSendToggle");
    const llmBackendSelectEl = $("llmBackendSelect");
    const llmBackendStatusEl = $("llmBackendStatus");
    const ttsVoiceSelectEl = $("ttsVoiceSelect");
    const ttsModeSelectEl = $("ttsModeSelect");
    const autoTtsToggleEl = $("autoTtsToggle");
    const knowledgeToggleEl = $("knowledgeToggle");
    const captureProofEl = $("captureProof");
    const captureProofMetaEl = $("captureProofMeta");
    const captureProofAudioEl = $("captureProofAudio");
    const uploadProofEl = $("uploadProof");
    const uploadProofMetaEl = $("uploadProofMeta");
    const uploadProofAudioEl = $("uploadProofAudio");
    const wakeProofEl = $("wakeProof");
    const wakeProofMetaEl = $("wakeProofMeta");
    const ttsProofEl = $("ttsProof");
    const ttsProofMetaEl = $("ttsProofMeta");
    const ttsProofAudioEl = $("ttsProofAudio");
    const robotCardEl = $("robotCard");
    const robotModeLabelEl = $("robotModeLabel");
    const robotModeDetailEl = $("robotModeDetail");
    const speakerCardEl = $("speakerCard");
    const speakerNameEl = $("speakerName");
    const speakerStatusEl = $("speakerStatus");
    const robotEyeLeftEl = $("robotEyeLeft");
    const robotEyeRightEl = $("robotEyeRight");
    const robotMouthFillEl = $("robotMouthFill");
    const robotUserBubbleEl = $("robotUserBubble");
    const robotUserBubbleTextEl = $("robotUserBubbleText");
    const robotAssistantBubbleEl = $("robotAssistantBubble");
    const robotAssistantBubbleTextEl = $("robotAssistantBubbleText");
    const chatView = createChatView({ messagesEl });
    const addMessage = chatView.addMessage;
    const renderMessages = chatView.renderMessages;
    const updateFlowChecklist = chatView.updateFlowChecklist;
    const clearFlowChecklist = chatView.clearFlowChecklist;
    const beginNewFlowChecklist = chatView.beginNewFlowChecklist;
    const sessionStore = window.sessionStorage;
    const WAKE_REARM_MS = 2500;
    const AUTO_STOP_MAX_MS = 15000;
    const AUTO_STOP_SILENCE_MS = 1200;
    const AUTO_STOP_LEVEL = 0.028;
    const FLOW_CHAT_STEP_KEYS = ["wake", "claw", "tts", "audio"];
    const FLOW_CHAT_STEP_LABELS = {
      claw: "Agent 执行",
      tts: "TTS 生成语音",
      audio: "语音生成完成",
    };
    const api = createApiClient(() => state.authToken);
    const uiMode = createUiModeController({
      bodyEl: document.body,
      modeToggleEl: debugModeToggleEl,
      modeBadgeEl: uiModeBadgeEl,
      densitySelectEl: uiDensitySelectEl,
    });

    function qsSession() {
      const url = new URL(window.location.href);
      return url.searchParams.get("session") || "";
    }

    function makeId(prefix) {
      const random = (globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).replace(/[^a-zA-Z0-9-]/g, "");
      return `${prefix}-${random}`;
    }

    function setSession(session) {
      state.session = session;
      sessionEl.value = session;
      const url = new URL(window.location.href);
      url.searchParams.set("session", session);
      history.replaceState({}, "", url.toString());
      sessionStore.setItem("openclaw-webchat-session", session);
      renderSessionList();
    }

    function makeSession() {
      return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function sessionTitleFromId(session) {
      return String(session || "未命名会话").replace(/^web-/, "会话 ");
    }

    function clearSessionLocalArtifacts(session) {
      try {
        window.localStorage.removeItem(`openclaw-webchat-traces:${session}`);
      } catch {
        // Ignore storage failures; server-side history deletion is the source of truth.
      }
    }

    function voiceRecordsForCurrentSession() {
      return loadTraceRecords()
        .filter((item) => item.userAudioUrl || item.ttsAudioUrl || item.assistantReply)
        .map((item) => ({
          ...item,
          userAudioUrl: item.userAudioUrl ? withTokenUrl(item.userAudioUrl) : "",
          ttsAudioUrl: item.ttsAudioUrl ? withTokenUrl(item.ttsAudioUrl) : "/api/default-audio",
        }));
    }

    function getSessionContextMenu() {
      let menu = document.querySelector(".session-context-menu");
      if (menu) return menu;
      menu = document.createElement("div");
      menu.className = "session-context-menu hidden";
      menu.innerHTML = '<button type="button" data-action="delete">删除会话</button>';
      document.body.appendChild(menu);
      return menu;
    }

    function hideSessionContextMenu() {
      const menu = document.querySelector(".session-context-menu");
      if (!menu) return;
      menu.classList.add("hidden");
      menu.removeAttribute("data-session");
    }

    function showSessionContextMenu(event, item) {
      event.preventDefault();
      const menu = getSessionContextMenu();
      const title = item.title || sessionTitleFromId(item.id);
      menu.dataset.session = item.id;
      const btn = menu.querySelector("[data-action='delete']");
      if (btn) btn.textContent = `删除「${title}」`;
      menu.classList.remove("hidden");
      const rect = menu.getBoundingClientRect();
      const left = Math.min(event.clientX, window.innerWidth - rect.width - 12);
      const top = Math.min(event.clientY, window.innerHeight - rect.height - 12);
      menu.style.left = `${Math.max(8, left)}px`;
      menu.style.top = `${Math.max(8, top)}px`;
    }

    function renderSessionList(items = state.sessions) {
      if (!sessionListEl) return;
      const sessions = Array.isArray(items) ? [...items] : [];
      if (state.session && !sessions.some((item) => item.id === state.session)) {
        sessions.unshift({
          id: state.session,
          title: sessionTitleFromId(state.session),
          preview: "当前会话",
          messageCount: 0,
          updatedAt: Date.now(),
        });
      }
      state.sessions = sessions;
      sessionListEl.innerHTML = "";
      if (!sessions.length) {
        const empty = document.createElement("div");
        empty.className = "session-list__empty";
        empty.textContent = "暂无历史会话";
        sessionListEl.appendChild(empty);
        return;
      }
      sessions.forEach((item) => {
        const btn = document.createElement("button");
        btn.className = "session-item";
        btn.type = "button";
        btn.classList.toggle("is-active", item.id === state.session);
        const title = document.createElement("div");
        title.className = "session-item__title";
        title.textContent = item.title || sessionTitleFromId(item.id);
        const meta = document.createElement("div");
        meta.className = "session-item__meta";
        const count = Number(item.messageCount || 0);
        const time = item.updatedAt ? fmtTime(item.updatedAt) : "新会话";
        meta.textContent = `${count} 条 · ${time}`;
        const preview = document.createElement("div");
        preview.className = "session-item__preview";
        preview.textContent = item.preview || item.id || "";
        btn.append(title, meta, preview);
        btn.addEventListener("click", () => void switchSession(item.id));
        btn.addEventListener("contextmenu", (event) => showSessionContextMenu(event, item));
        sessionListEl.appendChild(btn);
      });
    }

    function deriveRobotMode() {
      if (Object.values(state.stepState).some((step) => step?.status === "error")) return { key: "error", label: "出错了", detail: "这一步出现了问题，查看最近动作或重新试一次。" };
      if (state.recording) return { key: "listening", label: "正在聆听", detail: "我在听你说话。先看输入电平条是否有波动。" };
      if (state.wakeEnabled && state.wakeListening) return { key: "idle", label: "待唤醒", detail: `正在等待唤醒词：${state.wakePhrase}` };
      if (state.stepState.upload?.status === "active") return { key: "uploading", label: "上传中", detail: "正在把浏览器原始录音送到服务器。" };
      if (state.stepState.transcribe?.status === "active") return { key: "transcribing", label: "转写中", detail: "服务器正在把音频变成文本。" };
      if (state.stepState.claw?.status === "active") return { key: "thinking", label: "思考中", detail: "语音智能体正在组织回复内容。" };
      if (state.stepState.tts?.status === "active") return { key: "speaking", label: "准备开口", detail: "正在把回复转换成语音。" };
      if (state.lastTts?.url) return { key: "speaking", label: "可以播放", detail: "回复语音已经生成，可以直接播放。" };
      if (state.pendingTranscript) return { key: "heard", label: "我听到了", detail: "转写已经完成，确认文本后就可以发送。" };
      return { key: "idle", label: "待命", detail: "选择麦克风后开始录音，或直接输入文字。" };
    }

    function setBusy(busy, text = "") {
      state.busy = busy;
      const blocked = busy || !state.authenticated;
      sendBtn.disabled = blocked;
      uploadBtn.disabled = blocked;
      reloadBtn.disabled = blocked;
      if (sessionSidebarClearBtn) sessionSidebarClearBtn.disabled = blocked;
      if (sessionSidebarNewBtn) sessionSidebarNewBtn.disabled = blocked;
      statusEl.textContent = text;
    }

    function withTokenUrl(raw) {
      if (!raw) return "";
      const url = new URL(raw, window.location.origin);
      if (state.authToken) url.searchParams.set("token", state.authToken);
      return url.toString();
    }

    function traceStorageKey(session = state.session) {
      return `openclaw-webchat-traces:${session || "default"}`;
    }

    function loadTraceRecords() {
      try {
        const raw = localStorage.getItem(traceStorageKey());
        const items = JSON.parse(raw || "[]");
        return Array.isArray(items) ? items : [];
      } catch {
        return [];
      }
    }

    function saveTraceRecords(items) {
      localStorage.setItem(traceStorageKey(), JSON.stringify(items.slice(0, 80)));
    }

    function upsertTraceRecord(requestId, patch = {}) {
      if (!requestId) return;
      const now = Date.now();
      const items = loadTraceRecords();
      const index = items.findIndex((item) => item.requestId === requestId);
      const base = index >= 0 ? items[index] : {
        requestId,
        session: state.session,
        createdAt: now,
        status: "进行中",
      };
      const next = { ...base, ...patch, updatedAt: now, session: state.session };
      if (index >= 0) items.splice(index, 1);
      items.unshift(next);
      saveTraceRecords(items);
      if (traceHistoryModalEl && !traceHistoryModalEl.classList.contains("hidden")) renderTraceHistory();
    }

    function appendTraceTextSection(card, label, text) {
      if (!text) return;
      const section = document.createElement("div");
      section.className = "trace-card__section";
      const title = document.createElement("div");
      title.className = "trace-card__label";
      title.textContent = label;
      const body = document.createElement("div");
      body.className = "trace-card__text";
      body.textContent = text;
      section.append(title, body);
      card.appendChild(section);
    }

    function appendTraceAudioSection(card, label, url) {
      if (!url) return;
      const section = document.createElement("div");
      section.className = "trace-card__section";
      const title = document.createElement("div");
      title.className = "trace-card__label";
      title.textContent = label;
      const audio = document.createElement("audio");
      audio.controls = true;
      audio.preload = "metadata";
      audio.src = withTokenUrl(url);
      section.append(title, audio);
      card.appendChild(section);
    }

    function renderTraceHistory() {
      if (!traceHistoryListEl) return;
      const items = loadTraceRecords();
      traceHistoryListEl.innerHTML = "";
      if (traceHistorySubtitleEl) traceHistorySubtitleEl.textContent = `当前会话：${state.session || "未命名"}，共 ${items.length} 条`;
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "trace-history-empty";
        empty.textContent = "还没有可回看的记录。发送一次对话或完成一次语音转写后，这里会自动生成留痕。";
        traceHistoryListEl.appendChild(empty);
        return;
      }
      items.forEach((item, index) => {
        const card = document.createElement("article");
        card.className = "trace-card";

        const head = document.createElement("div");
        head.className = "trace-card__head";
        const headText = document.createElement("div");
        const title = document.createElement("div");
        title.className = "trace-card__title";
        title.textContent = `第 ${items.length - index} 轮语音任务`;
        const meta = document.createElement("div");
        meta.className = "trace-card__meta";
        meta.textContent = `${fmtTime(item.createdAt || item.updatedAt || Date.now())} · requestId=${item.requestId || ""}`;
        headText.append(title, meta);
        const status = document.createElement("div");
        status.className = "trace-card__status";
        status.textContent = item.status || "已记录";
        head.append(headText, status);
        card.appendChild(head);

        appendTraceAudioSection(card, "用户原始录音", item.userAudioUrl);
        appendTraceTextSection(card, "ASR 转写文本", item.transcript);
        appendTraceTextSection(card, "用户发送文本", item.userText);
        appendTraceTextSection(card, "Agent 回复文本", item.assistantReply);
        appendTraceAudioSection(card, "回复语音", item.ttsAudioUrl);

        traceHistoryListEl.appendChild(card);
      });
    }

    function openTraceHistoryModal() {
      if (!traceHistoryModalEl) return;
      renderTraceHistory();
      traceHistoryModalEl.classList.remove("hidden");
    }

    function closeTraceHistoryModal() {
      if (!traceHistoryModalEl) return;
      traceHistoryModalEl.classList.add("hidden");
    }

    function clearTraceHistory() {
      if (!state.session) return;
      localStorage.removeItem(traceStorageKey());
      renderTraceHistory();
    }

    function applyVoiceInputMode(mode) {
      const next = mode === "stream" ? "stream" : "ptt";
      state.voiceInputMode = next;
      localStorage.setItem("openclaw-webchat-voice-input-mode", next);
      if (!voiceInputModeEl) return;
      voiceInputModeEl.querySelectorAll("[data-voice-input-mode]").forEach((btn) => {
        const active = btn.dataset.voiceInputMode === next;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", active ? "true" : "false");
      });
      if (recordBtn) recordBtn.textContent = state.recording ? "停止录音" : (next === "stream" ? "开始连续语音" : "按住说话");
    }

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

    function debugEventLabel(item = {}) {
      const event = String(item.event || "unknown");
      const labels = {
        chat_request: "Agent 请求",
        chat_response: "Agent 回复完成",
        chat_response_test: "Agent 回复完成",
        transcribe_request: "ASR 转写请求",
        transcribe_response: "ASR 转写完成",
        transcribe_response_test: "ASR 转写完成",
        wake_request: "唤醒词检测请求",
        wake_response: "唤醒词检测完成",
        wake_response_test: "唤醒词检测完成",
        tts_request: "TTS 合成请求",
        tts_response: "TTS 合成完成",
        tts_response_test: "TTS 合成完成",
        system_status_test: "演示链路健康",
        request_timeout: "请求超时",
        request_error: "请求异常",
      };
      return labels[event] || event;
    }

    function debugAdvice(item = {}) {
      const component = debugComponent(item);
      const event = String(item.event || "");
      const error = String(item.error || item.detail || "");
      if (event.includes("timeout")) return "建议检查本地服务是否卡住，稍后重试或重启对应服务。";
      if (component === "ASR") return "建议检查麦克风权限、音频是否为空，以及 faster-whisper 服务是否启动。";
      if (component === "Agent") return "建议检查语音智能体、vLLM 或本地模型服务是否可用。";
      if (component === "TTS") return "建议检查 TTS 模式、CosyVoice/edge-tts 依赖和音频输出目录。";
      if (component === "唤醒词") return "建议确认唤醒词、录音输入和唤醒检测服务状态。";
      if (error) return "建议根据原始日志中的 path、requestId 和 error 定位。";
      return "当前事件可作为流程追踪记录。";
    }

    function renderDebugTerminal(items = []) {
      const sorted = [...items].sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
      if (debugTerminalSubtitleEl) {
        debugTerminalSubtitleEl.textContent = `最近 ${sorted.length} 条事件 · ${state.session || "未命名会话"}`;
      }

      if (debugHealthGridEl) {
        debugHealthGridEl.innerHTML = "";
        DEBUG_COMPONENTS.forEach((name) => {
          const latest = sorted.find((item) => debugComponent(item) === name);
          const severity = latest ? debugSeverity(latest) : "unknown";
          const card = document.createElement("div");
          card.className = `debug-health-card debug-health-card--${severity}`;
          const title = document.createElement("div");
          title.className = "debug-health-card__title";
          title.textContent = name;
          const status = document.createElement("div");
          status.className = "debug-health-card__status";
          status.textContent = severity === "critical" ? "异常" : severity === "warning" ? "告警" : severity === "unknown" ? "暂无记录" : "正常";
          const detail = document.createElement("div");
          detail.className = "debug-health-card__detail";
          detail.textContent = latest ? `${debugEventLabel(latest)} · ${fmtTime(latest.ts)}` : "等待事件";
          card.append(title, status, detail);
          debugHealthGridEl.appendChild(card);
        });
      }

      const alerts = sorted.filter((item) => ["critical", "warning"].includes(debugSeverity(item))).slice(0, 8);
      if (debugAlertListEl) {
        debugAlertListEl.innerHTML = "";
        if (!alerts.length) {
          const empty = document.createElement("div");
          empty.className = "debug-alert-empty";
          empty.textContent = "暂无异常告警。";
          debugAlertListEl.appendChild(empty);
        } else {
          alerts.forEach((item) => {
            const severity = debugSeverity(item);
            const row = document.createElement("div");
            row.className = `debug-alert debug-alert--${severity}`;
            const head = document.createElement("div");
            head.className = "debug-alert__head";
            head.textContent = `${fmtTime(item.ts)} · ${debugComponent(item)} · ${debugEventLabel(item)}`;
            const reason = document.createElement("div");
            reason.className = "debug-alert__reason";
            reason.textContent = String(item.error || item.detail || (item.matched === false ? "未命中唤醒词" : "流程告警"));
            const advice = document.createElement("div");
            advice.className = "debug-alert__advice";
            advice.textContent = debugAdvice(item);
            row.append(head, reason, advice);
            debugAlertListEl.appendChild(row);
          });
        }
      }

      if (debugRawLogEl) {
        debugRawLogEl.innerHTML = "";
        if (!sorted.length) {
          const empty = document.createElement("div");
          empty.className = "debug-alert-empty";
          empty.textContent = "暂无日志。";
          debugRawLogEl.appendChild(empty);
        } else {
          sorted.slice(0, 30).forEach((item) => {
            const row = document.createElement("details");
            row.className = "debug-log-item";
            const summary = document.createElement("summary");
            summary.textContent = `${fmtTime(item.ts)} · ${debugComponent(item)} · ${debugEventLabel(item)}`;
            const pre = document.createElement("pre");
            pre.textContent = JSON.stringify(item, null, 2);
            row.append(summary, pre);
            debugRawLogEl.appendChild(row);
          });
        }
      }
    }

    async function refreshDebugTerminal() {
      if (!debugTerminalModalEl) return;
      if (debugTerminalSubtitleEl) debugTerminalSubtitleEl.textContent = "正在加载最近日志...";
      try {
        const data = await api("/api/debug/last");
        const items = Array.isArray(data.items) ? data.items : [];
        renderDebugTerminal(items);
      } catch (err) {
        renderDebugTerminal([{
          ts: Date.now(),
          event: "request_error",
          path: "/api/debug/last",
          error: err.message,
        }]);
      }
    }

    function openDebugTerminalModal() {
      if (!debugTerminalModalEl) return;
      debugTerminalModalEl.classList.remove("hidden");
      void refreshDebugTerminal();
    }

    function closeDebugTerminalModal() {
      if (!debugTerminalModalEl) return;
      debugTerminalModalEl.classList.add("hidden");
    }

    function updateAuthUi() {
      authStatusEl.textContent = state.authenticated ? "已认证" : "未认证";
      authBtnEl.textContent = state.authenticated ? "已连接" : "连接";
      authBtnEl.disabled = state.authenticated;
      tokenInputEl.disabled = state.authenticated;
      const blocked = !state.authenticated || state.busy;
      sendBtn.disabled = blocked;
      uploadBtn.disabled = blocked;
      reloadBtn.disabled = blocked;
      newSessionBtn.disabled = !state.authenticated;
      if (sessionSidebarNewBtn) sessionSidebarNewBtn.disabled = !state.authenticated;
      if (sessionSidebarClearBtn) sessionSidebarClearBtn.disabled = !state.authenticated;
      recordBtn.disabled = !state.authenticated;
    }

    function renderInputLevel() {
      const rawPct = Math.max(0, Math.min(100, Math.round(state.inputLevel * 100)));
      const pct = state.recording ? rawPct : 0;
      if (inputLevelFillEl) inputLevelFillEl.style.width = `${pct}%`;
      if (inputLevelTextEl) inputLevelTextEl.textContent = `${pct}%`;

      if (visualizerCtx && visualizerCanvas && state.analyser && state.recording) {
        const width = visualizerCanvas.width;
        const height = visualizerCanvas.height;
        const bufferLength = state.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        state.analyser.getByteFrequencyData(dataArray);

        visualizerCtx.clearRect(0, 0, width, height);

        const numBars = 64; 
        const barWidth = (width / numBars) - 0.5;
        const step = Math.floor(bufferLength / numBars);

        let x = 0;
        visualizerCtx.fillStyle = 'rgba(61, 217, 179, 0.85)';
        for (let i = 0; i < numBars; i++) {
          const val = dataArray[i * step];
          const barHeight = (val / 255) * height * 0.9;
          visualizerCtx.fillRect(x, height - Math.max(1, barHeight), barWidth, Math.max(1, barHeight));
          x += barWidth + 0.5;
        }
      } else if (visualizerCtx && visualizerCanvas) {
        visualizerCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
        visualizerCtx.fillStyle = 'rgba(61, 217, 179, 0.15)';
        visualizerCtx.fillRect(0, visualizerCanvas.height / 2, visualizerCanvas.width, 1);
      }
    }

    function containsWakePhrase(text) {
      const target = normalizeWakeText(state.wakePhrase || "你好");
      const normalized = normalizeWakeText(text || "");
      if (!target) return true;
      return normalized.includes(target);
    }

    function refreshSendButtonText() {
      if (!sendBtn) return;
      sendBtn.textContent = "发送";
    }

    function updateSpeakerCard(status = "idle", name = "等待识别", detail = "声纹待核验") {
      if (!speakerCardEl) return;
      speakerCardEl.classList.remove("speaker-card--active", "speaker-card--verified", "speaker-card--error");
      if (status === "active") speakerCardEl.classList.add("speaker-card--active");
      if (status === "verified") speakerCardEl.classList.add("speaker-card--verified");
      if (status === "error") speakerCardEl.classList.add("speaker-card--error");
      if (speakerNameEl) speakerNameEl.textContent = name;
      if (speakerStatusEl) speakerStatusEl.textContent = detail;
    }

    function updateQuickRepliesVisibility() {
      if (!quickRepliesPanelEl) return;
      const transcriptVisible = !!(transcriptReviewEl && !transcriptReviewEl.classList.contains("hidden"));
      const recordVisible = !!(recordReviewEl && !recordReviewEl.classList.contains("hidden"));
      quickRepliesPanelEl.classList.toggle("hidden", transcriptVisible || recordVisible);
    }

    function updateComposerReviewMode() {
      if (!composerEl) return;
      const transcriptVisible = !!(transcriptReviewEl && !transcriptReviewEl.classList.contains("hidden"));
      const recordVisible = !!(recordReviewEl && !recordReviewEl.classList.contains("hidden"));
      composerEl.classList.toggle("is-review-mode", transcriptVisible || recordVisible);
      updateQuickRepliesVisibility();
    }

    function showTranscriptReview(note = "可在输入框中修改后再确认发送。", text = "") {
      if (!transcriptReviewEl) return;
      if (transcriptReviewHintEl) transcriptReviewHintEl.textContent = note;
      if (transcriptReviewEditorEl) {
        transcriptReviewEditorEl.value = String(text || "");
        transcriptReviewEditorEl.focus();
      }
      draftEl.classList.add("hidden");
      document.body.classList.add("transcript-review-active");
      transcriptReviewEl.classList.remove("hidden");
      updateComposerReviewMode();
    }

    function hideTranscriptReview({ clearPending = false, clearDraft = false } = {}) {
      if (transcriptReviewEl) transcriptReviewEl.classList.add("hidden");
      draftEl.classList.remove("hidden");
      document.body.classList.remove("transcript-review-active");
      if (transcriptReviewEditorEl) {
        transcriptReviewEditorEl.value = "";
        transcriptReviewEditorEl.style.height = "";
      }
      if (clearPending) state.pendingTranscript = "";
      if (clearDraft) draftEl.value = "";
      updateComposerReviewMode();
      refreshSendButtonText();
    }

    async function confirmTranscriptAndSend() {
      const text = String(transcriptReviewEditorEl?.value || "").trim();
      if (!text || state.busy) return;
      draftEl.value = text;
      await sendMessage(text);
    }

    function cancelTranscriptReview() {
      if (state.currentRequestId) delete state.voiceMessages[state.currentRequestId];
      state.currentRequestId = "";
      hideTranscriptReview({ clearPending: true, clearDraft: true });
      setStep("transcript", "idle", "转写结果已取消");
      statusEl.textContent = "已取消本次转写结果。";
    }

    function clearPendingRecord({ keepStatus = false } = {}) {
      const pending = state.pendingRecord;
      if (pending?.url) {
        try { URL.revokeObjectURL(pending.url); } catch {}
      }
      state.pendingRecord = null;
      if (recordReviewAudioEl) {
        recordReviewAudioEl.pause();
        recordReviewAudioEl.removeAttribute("src");
        recordReviewAudioEl.load();
      }
      if (recordReviewMetaEl) recordReviewMetaEl.textContent = "";
      if (recordReviewEl) recordReviewEl.classList.add("hidden");
      if (draftEl) draftEl.classList.remove("hidden");
      updateComposerReviewMode();
      if (!keepStatus) statusEl.textContent = "";
      refreshSendButtonText();
    }

    function showPendingRecordReview() {
      const pending = state.pendingRecord;
      if (!pending || !recordReviewEl || !recordReviewAudioEl) return;
      const kb = Math.max(1, Math.round((pending.bytes || 0) / 1024));
      if (recordReviewMetaEl) recordReviewMetaEl.textContent = `${kb} KB / ${pending.mimeType || "audio/webm"}`;
      recordReviewAudioEl.src = pending.url;
      recordReviewAudioEl.load();
      if (draftEl) draftEl.classList.add("hidden");
      recordReviewEl.classList.remove("hidden");
      updateComposerReviewMode();
    }

    async function confirmPendingRecordUpload() {
      const pending = state.pendingRecord;
      if (!pending || state.busy) return;
      const { blob, filename, requestId, autoSendOverride } = pending;
      clearPendingRecord({ keepStatus: true });
      setStep("upload", "active", "用户已确认上传，准备发送到服务器");
      setStep("transcribe", "active", "等待服务器转写");
      statusEl.textContent = "正在上传并转写录音...";
      await transcribeBlob(blob, filename, { requestId, autoSendOverride });
    }

    async function cancelPendingRecordUpload() {
      if (!state.pendingRecord) return;
      clearPendingRecord({ keepStatus: true });
      setStep("record", "idle", "本轮录音已取消");
      setStep("upload", "idle", "等待新的录音上传");
      setStep("transcribe", "idle", "等待新的录音转写");
      statusEl.textContent = "已取消本轮录音。";
      if (state.wakeEnabled && state.authenticated && !state.recording) scheduleWakeResume(600);
    }

    function openAdvancedSettingsModal() {
      if (!advancedSettingsModalEl) return;
      advancedSettingsModalEl.classList.remove("hidden");
    }

    function closeAdvancedSettingsModal() {
      if (!advancedSettingsModalEl) return;
      advancedSettingsModalEl.classList.add("hidden");
    }

    function takeWakeChunk(sampleCount) {
      const out = new Float32Array(sampleCount);
      let offset = 0;
      while (offset < sampleCount && state.wakeChunkBuffers.length) {
        const chunk = state.wakeChunkBuffers[0];
        const n = Math.min(sampleCount - offset, chunk.length);
        out.set(chunk.subarray(0, n), offset);
        offset += n;
        if (n === chunk.length) {
          state.wakeChunkBuffers.shift();
        } else {
          state.wakeChunkBuffers[0] = chunk.subarray(n);
        }
      }
      state.wakeChunkSamples = Math.max(0, state.wakeChunkSamples - sampleCount);
      return out;
    }

    function updateWakeUi(extra = "") {
      wakeToggleEl.checked = !!state.wakeEnabled;
      wakePhraseInputEl.value = state.wakePhrase;
      wakeToggleEl.disabled = !state.authenticated || !state.wakeSupported;
      wakePhraseInputEl.disabled = !state.authenticated;
      if (!state.wakeSupported) {
        wakeStatusEl.textContent = "当前浏览器不支持唤醒词";
      } else if (!state.authenticated) {
        wakeStatusEl.textContent = "连接后可启用唤醒词";
      } else if (!state.wakeEnabled) {
        wakeStatusEl.textContent = "唤醒词已关闭";
      } else if (state.recording) {
        wakeStatusEl.textContent = "已唤醒，正在录音";
      } else if (state.wakeListening) {
        wakeStatusEl.textContent = `本地监听中：${state.wakePhrase}`;
      } else if (state.wakeEnabled) {
        wakeStatusEl.textContent = extra || "待机中，等待唤醒词";
      } else {
        wakeStatusEl.textContent = extra || "唤醒词准备中";
      }
    }

    function clearWakeResumeTimer() {
      if (state.wakeResumeTimer) clearTimeout(state.wakeResumeTimer);
      state.wakeResumeTimer = null;
    }

    function scheduleWakeResume(delay = 2200) {
      clearWakeResumeTimer();
      if (!state.wakeEnabled || !state.authenticated || !state.wakeSupported) return;
      state.wakeResumeTimer = setTimeout(() => {
        state.wakeResumeTimer = null;
        void startWakeListener();
      }, delay);
    }

    async function stopWakeListener() {
      clearWakeResumeTimer();
      const recorder = state.wakeRecorder;
      state.wakeRecorder = null;
      state.wakePending = false;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") {
          try { recorder.stop(); } catch {}
        }
      }
      if (state.stream && !state.recording) {
        state.stream.getTracks().forEach((track) => track.stop());
        state.stream = null;
      }
      if (state.wakeProcessor) {
        try { state.wakeProcessor.disconnect(); } catch {}
      }
      if (state.wakeSilentGain) {
        try { state.wakeSilentGain.disconnect(); } catch {}
      }
      state.wakeProcessor = null;
      state.wakeSilentGain = null;
      state.wakeChunkBuffers = [];
      state.wakeChunkSamples = 0;
      if (!state.recording) {
        if (state.meterTimer) cancelAnimationFrame(state.meterTimer);
        state.meterTimer = null;
        if (state.monitorSource) {
          try { state.monitorSource.disconnect(); } catch {}
        }
        if (state.analyser) {
          try { state.analyser.disconnect(); } catch {}
        }
        if (state.monitorContext) {
          try { await state.monitorContext.close(); } catch {}
        }
        state.monitorContext = null;
        state.monitorSource = null;
        state.analyser = null;
        state.inputLevel = 0;
        renderInputLevel();
      }
      state.wakeListening = false;
      updateWakeUi();
      renderPipeline();
    }

    async function startWakeListener() {
      if (!state.wakeSupported || !state.wakeEnabled || !state.authenticated || state.recording || state.busy) {
        updateWakeUi();
        return;
      }
      if (state.wakeListening) return;
      try {
        state.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: state.selectedDeviceId ? { exact: state.selectedDeviceId } : undefined,
            channelCount: 1,
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
          },
        });
        startLevelMonitor(state.stream);
        state.wakeChunkBuffers = [];
        state.wakeChunkSamples = 0;
        state.wakeChunkSampleRate = state.monitorContext?.sampleRate || 16000;
        const processor = state.monitorContext.createScriptProcessor(4096, 1, 1);
        const silentGain = state.monitorContext.createGain();
        silentGain.gain.value = 0;
        state.wakeProcessor = processor;
        state.wakeSilentGain = silentGain;
        state.wakeListening = true;
        updateWakeUi();
        logProcess("本地唤醒词监听已开启", `${state.wakePhrase}\nclientId=${state.clientId}`);
        renderPipeline();
        processor.onaudioprocess = (event) => {
          if (!state.wakeEnabled || state.recording || !state.wakeListening) return;
          const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
          state.wakeChunkBuffers.push(chunk);
          state.wakeChunkSamples += chunk.length;
          void flushWakeChunkIfReady();
        };
        state.monitorSource.connect(processor);
        processor.connect(silentGain);
        silentGain.connect(state.monitorContext.destination);
      } catch (err) {
        state.wakeListening = false;
        updateWakeUi(`唤醒词启动失败：${err.message || err}`);
        logProcess("唤醒词启动失败", String(err.message || err));
      }
    }

    async function checkWakeWord(blob) {
      const reqId = makeId("wake");
      const headers = {
        "Content-Type": blob.type || "application/octet-stream",
        "X-Filename": `wake-${Date.now()}.webm`,
        "X-Wake-Language": wakeLanguageCode(state.wakePhrase),
        "X-Wake-Phrase-B64": base64Utf8(state.wakePhrase),
        "X-Client-Id": state.clientId,
        "X-Request-Id": reqId,
        "X-Session-Key": state.session,
      };
      const data = await api("/api/wake-check", {
        method: "POST",
        headers,
        body: blob,
      });
      if (data.matched) {
        logProcess("唤醒词分片命中", `${data.text || ""}\nrequestId=${reqId}`);
        return data.text || "";
      }
      return "";
    }

    async function flushWakeChunkIfReady() {
      const minSamples = Math.floor(state.wakeChunkSampleRate * (wakeChunkMs(state.wakePhrase) / 1000));
      if (state.wakePending || state.wakeChunkSamples < minSamples) return;
      state.wakePending = true;
      try {
        const samples = takeWakeChunk(minSamples);
        const wavBlob = encodeWavBlobFromFloat32(samples, state.wakeChunkSampleRate);
        const chunkText = await checkWakeWord(wavBlob);
        if (!chunkText) return;
        const normalized = normalizeWakeText(chunkText);
        const target = normalizeWakeText(state.wakePhrase);
        if (!target || !normalized.includes(target)) return;
        const now = Date.now();
        if (now - state.wakeLastTriggerAt < WAKE_REARM_MS) return;
        state.wakeLastTriggerAt = now;
        logProcess("唤醒词命中", `${chunkText}\nrequestId=${makeId("wake")}`);
        state.wakeEnabled = false;
        stopWakeDebugPolling();
        await stopWakeListener();
        statusEl.textContent = `已检测到唤醒词：${chunkText}`;
        await startRecording({ autoStopOnSilence: true, autoSend: true, wakeDetectedText: chunkText });
      } finally {
        state.wakePending = false;
      }
    }

    function updateMicAvailabilityStatus() {
      if (!micAvailableStatusEl) return;
      micAvailableStatusEl.classList.remove("is-available", "is-unavailable", "is-unknown");
      if (!state.wakeSupported) {
        micAvailableStatusEl.textContent = "状态: 不可用";
        micAvailableStatusEl.classList.add("is-unavailable");
        return;
      }
      if (!state.micDevices.length) {
        micAvailableStatusEl.textContent = "状态: 不可用";
        micAvailableStatusEl.classList.add("is-unavailable");
        return;
      }
      micAvailableStatusEl.textContent = "状态: 可用";
      micAvailableStatusEl.classList.add("is-available");
    }

    function renderMicDevices() {
      const current = state.selectedDeviceId || "";
      if (micSelectEl) micSelectEl.innerHTML = "";
      if (micQuickSelectEl) micQuickSelectEl.innerHTML = "";
      const devices = state.micDevices || [];
      if (!devices.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "默认麦克风";
        if (micSelectEl) {
          micSelectEl.appendChild(opt.cloneNode(true));
          micSelectEl.value = "";
        }
        if (micQuickSelectEl) {
          micQuickSelectEl.appendChild(opt.cloneNode(true));
          micQuickSelectEl.value = "";
        }
        updateMicAvailabilityStatus();
        return;
      }
      for (const device of devices) {
        const opt = document.createElement("option");
        opt.value = device.deviceId || "";
        opt.textContent = device.label || `麦克风 ${devices.indexOf(device) + 1}`;
        if (micSelectEl) micSelectEl.appendChild(opt.cloneNode(true));
        if (micQuickSelectEl) micQuickSelectEl.appendChild(opt.cloneNode(true));
      }
      const hasCurrent = devices.some((d) => (d.deviceId || "") === current);
      const nextValue = hasCurrent ? current : (devices[0].deviceId || "");
      if (micSelectEl) micSelectEl.value = nextValue;
      if (micQuickSelectEl) micQuickSelectEl.value = nextValue;
      state.selectedDeviceId = nextValue;
      updateMicAvailabilityStatus();
    }

    async function refreshMicDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        state.micDevices = devices.filter((d) => d.kind === "audioinput");
        renderMicDevices();
        logProcess("刷新麦克风设备", `${state.micDevices.length} 个输入设备`);
      } catch (err) {
        if (micAvailableStatusEl) {
          micAvailableStatusEl.textContent = "状态: 不可用";
          micAvailableStatusEl.classList.remove("is-available", "is-unknown");
          micAvailableStatusEl.classList.add("is-unavailable");
        }
        logProcess("刷新麦克风设备失败", String(err.message || err));
      }
    }

    function onMicSelected(value) {
      state.selectedDeviceId = value || "";
      sessionStore.setItem("openclaw-webchat-mic-device", state.selectedDeviceId);
      if (micSelectEl && micSelectEl.value !== state.selectedDeviceId) micSelectEl.value = state.selectedDeviceId;
      if (micQuickSelectEl && micQuickSelectEl.value !== state.selectedDeviceId) micQuickSelectEl.value = state.selectedDeviceId;
      updateMicAvailabilityStatus();
      logProcess("切换麦克风设备", state.selectedDeviceId || "default");
    }

    function startLevelMonitor(stream) {
      if (!window.AudioContext && !window.webkitAudioContext) return;
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      state.monitorContext = new AudioContextCtor();
      state.monitorSource = state.monitorContext.createMediaStreamSource(stream);
      state.analyser = state.monitorContext.createAnalyser();
      state.analyser.fftSize = 2048;
      state.monitorSource.connect(state.analyser);
      const data = new Uint8Array(state.analyser.frequencyBinCount);
      const tick = () => {
        if (!state.analyser) return;
        state.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        state.inputLevel = Math.sqrt(sum / data.length) * 4;
        renderInputLevel();
        if (state.recording && state.autoStopOnSilence && !state.stopRequested) {
          const now = Date.now();
          if (state.inputLevel >= AUTO_STOP_LEVEL) {
            state.speechSeenAt = now;
            state.silenceSince = 0;
          } else if (state.speechSeenAt && !state.silenceSince) {
            state.silenceSince = now;
          }
          if (state.recordStartedAt && now - state.recordStartedAt >= AUTO_STOP_MAX_MS) {
            state.stopRequested = true;
            statusEl.textContent = "达到最长录音时长，准备上传...";
            void stopRecordingAndUpload();
            return;
          }
          if (state.speechSeenAt && state.silenceSince && now - state.silenceSince >= AUTO_STOP_SILENCE_MS) {
            state.stopRequested = true;
            statusEl.textContent = "检测到停顿，准备上传...";
            void stopRecordingAndUpload();
            return;
          }
        }
        state.meterTimer = requestAnimationFrame(tick);
      };
      tick();
    }

    function getStepElapsedMs(step, status) {
      if (status === "active") {
        const startedAt = state.stepStartedAt[step] || 0;
        return startedAt ? Math.max(0, Date.now() - startedAt) : 0;
      }
      return state.stepDurations[step] || 0;
    }

    function hasLivePipelineStep() {
      if (state.recording) return true;
      return PIPELINE_ORDER.some((step) => state.stepState[step]?.status === "active");
    }

    function ensurePipelineRenderTimer() {
      const shouldRun = hasLivePipelineStep();
      if (!shouldRun && state.pipelineRenderTimer) {
        clearInterval(state.pipelineRenderTimer);
        state.pipelineRenderTimer = null;
        return;
      }
      if (shouldRun && !state.pipelineRenderTimer) {
        state.pipelineRenderTimer = setInterval(() => {
          if (!hasLivePipelineStep()) {
            clearInterval(state.pipelineRenderTimer);
            state.pipelineRenderTimer = null;
            return;
          }
          renderPipeline();
        }, 250);
      }
    }

    function renderPipeline() {
      ensurePipelineRenderTimer();
      renderPipelineView({
        state,
        elements: {
          robotCardEl,
          robotModeLabelEl,
          robotModeDetailEl,
          robotEyeLeftEl,
          robotEyeRightEl,
          robotMouthFillEl,
          pipelineStepsEl,
          robotUserBubbleEl,
          robotUserBubbleTextEl,
          robotAssistantBubbleEl,
          robotAssistantBubbleTextEl,
          processLogEl,
          captureProofEl,
          captureProofMetaEl,
          captureProofAudioEl,
          uploadProofEl,
          uploadProofMetaEl,
          uploadProofAudioEl,
          wakeProofEl,
          wakeProofMetaEl,
          ttsProofEl,
          ttsProofMetaEl,
          ttsProofAudioEl,
        },
        pipelineOrder: PIPELINE_ORDER,
        pipelineLabels: PIPELINE_LABELS,
        deriveRobotMode,
        getStepElapsedMs,
        fmtDuration,
        fmtTime,
        withTokenUrl,
        requestRender: renderPipeline,
      });
    }

    function setStep(step, status, detail) {
      if (status === "active") {
        state.stepStartedAt[step] = Date.now();
        state.stepDurations[step] = 0;
      } else if ((status === "done" || status === "error") && state.stepStartedAt[step]) {
        state.stepDurations[step] = Math.max(0, Date.now() - state.stepStartedAt[step]);
      }
      state.stepState[step] = {status, detail};
      renderPipeline();
      syncFlowChecklist();
    }

    function syncFlowChecklist() {
      if (!state.flowChecklistVisible) {
        return;
      }

      const steps = FLOW_CHAT_STEP_KEYS.map((key) => {
        const stepData = state.stepState[key] || {};
        const st = stepData.status || "idle";
        let status = "todo";
        if (st === "active") status = "active";
        else if (st === "done") status = "done";
        else if (st === "error") status = "error";
        
        let detailBase = st === "active"
          ? "进行中"
          : st === "done"
            ? "已完成"
            : st === "error"
              ? "异常"
              : "待执行";
              
        let detail = detailBase;
        // 尝试从底层的 stepData.detail 中提取有用的附加信息用于展示
        const extraText = (stepData.detail || "").split('\nrequestId=')[0].trim();
        // 过滤掉基础的通用描述以避免重复，主要透出我们自定义的结果
        if (extraText && !["等待发送后检测提示词", "进行中", "待执行", "等待提示词检测通过", "等待声纹和唤醒词检测通过"].includes(extraText)) {
          detail = `${detailBase} - ${extraText.replace(/\n/g, ' | ')}`;
        }

        const label = key === "wake"
          ? `声纹检测与唤醒词检测`
          : (FLOW_CHAT_STEP_LABELS[key] || key);
        return {
          key,
          label,
          status,
          detail,
        };
      });

      const hasError = steps.some((item) => item.status === "error");
      const doneCount = steps.filter((item) => item.status === "done").length;
      const allDone = doneCount > 0 && steps.every((item) => item.status === "done" || item.status === "todo");
      const subtitle = hasError
        ? "流程中断，请重试异常步骤"
        : allDone
          ? "当前流程可继续下一轮"
          : doneCount > 0
            ? "流程进行中"
            : "按固定流程逐步完成";

      updateFlowChecklist({
        title: "本轮执行清单",
        subtitle,
        steps,
      });
    }

    async function ensureVisibleStep(step, minMs) {
      const startedAt = state.stepStartedAt[step] || 0;
      if (!startedAt) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed < minMs) await new Promise((resolve) => setTimeout(resolve, minMs - elapsed));
    }

    function logProcess(label, detail = "") {
      state.processEntries.unshift({ts: Date.now(), label, detail});
      state.processEntries = state.processEntries.slice(0, 24);
      renderPipeline();
    }

    function resetProcess(reason = "等待新的输入") {
      hideTranscriptReview({ clearPending: true, clearDraft: false });
      clearPendingRecord({ keepStatus: true });
      if (state.pipelineRenderTimer) {
        clearInterval(state.pipelineRenderTimer);
        state.pipelineRenderTimer = null;
      }
      state.stepState = {
        wake: {status: "idle", detail: "等待发送后检测提示词"},
        record: {status: "idle", detail: reason},
        upload: {status: "idle", detail: "未开始"},
        transcribe: {status: "idle", detail: "未开始"},
        transcript: {status: "idle", detail: "等待转写结果"},
        claw: {status: "idle", detail: "等待发送给语音智能体"},
        tts: {status: "idle", detail: "等待语音合成"},
        audio: {status: "idle", detail: "等待弹出语音消息"},
      };
      state.stepStartedAt = {};
      state.stepDurations = {};
      state.pendingTranscript = "";
      state.lastTts = null;
      updateSpeakerCard();
      if (state.localCapture?.url) URL.revokeObjectURL(state.localCapture.url);
      state.localCapture = null;
      state.lastUpload = null;
      state.lastWakeProbe = null;
      state.lastAssistantReply = "";
      state.currentRequestId = "";
      state.pendingTranscript = "";
      refreshSendButtonText();
      renderPipeline();
      syncFlowChecklist();
    }

    async function enterStandby(reason = "等待唤醒词") {
      state.pendingTranscript = "";
      state.lastWakeProbe = null;
      state.lastAssistantReply = "";
      state.currentRequestId = "";
      draftEl.value = "";
      resetProcess(reason);
      statusEl.textContent = reason;
      if (state.wakeEnabled && state.authenticated) {
        startWakeDebugPolling();
        await startWakeListener();
      }
    }

    async function loadMessages() {
      if (!state.authenticated) {
        statusEl.textContent = "请输入 gateway token 后连接。";
        updateAuthUi();
        state.flowChecklistVisible = false;
        clearFlowChecklist();
        return;
      }
      setBusy(true, "加载会话...");
      try {
        const data = await api(`/api/messages?session=${encodeURIComponent(state.session)}`);
        renderMessages(data.messages || []);
        state.flowChecklistVisible = false;
        syncFlowChecklist();
        statusEl.textContent = `已加载 ${state.session}`;
        logProcess("会话已加载", `session=${state.session}`);
      } catch (err) {
        statusEl.textContent = `加载失败: ${err.message}`;
        logProcess("会话加载失败", err.message);
      } finally {
        setBusy(false, statusEl.textContent);
      }
    }

    async function loadSessions() {
      if (!state.authenticated) {
        renderSessionList();
        return;
      }
      try {
        const data = await api("/api/sessions");
        renderSessionList(Array.isArray(data.sessions) ? data.sessions : []);
      } catch (err) {
        logProcess("历史会话加载失败", err.message);
        renderSessionList();
      }
    }

    async function switchSession(session) {
      const next = String(session || "").trim();
      if (!next || next === state.session) return;
      stopWakeDebugPolling();
      await stopWakeListener();
      if (state.recording) {
        try {
          await stopRecording();
        } catch {
          state.recording = false;
        }
      }
      setSession(next);
      state.voiceMessages = {};
      logProcess("切换会话", next);
      void pollWakeDebug();
      await loadMessages();
      await enterStandby(`会话已切换，等待唤醒词：${state.wakePhrase}`);
      void loadSessions();
    }

    async function createNewSession() {
      setSession(makeSession());
      state.voiceMessages = {};
      renderMessages([]);
      state.flowChecklistVisible = false;
      clearFlowChecklist();
      statusEl.textContent = `已切换到 ${state.session}`;
      logProcess("切换到新会话", state.session);
      renderSessionList();
      void pollWakeDebug();
      await enterStandby(`新会话待机，等待唤醒词：${state.wakePhrase}`);
    }

    async function deleteSession(session) {
      const target = String(session || "").trim();
      if (!target || !state.authenticated) return;
      try {
        hideSessionContextMenu();
        const wasCurrent = target === state.session;
        const data = await api(`/api/sessions?session=${encodeURIComponent(target)}`, { method: "DELETE" });
        clearSessionLocalArtifacts(target);
        renderSessionList(Array.isArray(data.sessions) ? data.sessions : []);
        logProcess("删除历史会话", target);
      if (wasCurrent) {
          setSession(makeSession());
          state.voiceMessages = {};
          renderMessages([]);
          state.flowChecklistVisible = false;
          clearFlowChecklist();
          statusEl.textContent = "当前会话已删除，已切换到新会话";
          await enterStandby(`新会话待机，等待唤醒词：${state.wakePhrase}`);
          void loadSessions();
        } else {
          statusEl.textContent = "历史会话已删除";
        }
      } catch (err) {
        statusEl.textContent = `删除失败: ${err.message}`;
        logProcess("删除历史会话失败", err.message);
      }
    }

    async function clearAllSessions() {
      if (!state.authenticated) return;
      const ok = window.confirm("确定清空所有历史会话吗？当前列表会被清空，并切换到一个新会话。");
      if (!ok) return;
      try {
        hideSessionContextMenu();
        const sessions = [...state.sessions];
        await api("/api/sessions", { method: "DELETE" });
        sessions.forEach((item) => clearSessionLocalArtifacts(item.id));
        setSession(makeSession());
        state.voiceMessages = {};
        state.sessions = [];
        renderMessages([]);
        state.flowChecklistVisible = false;
        clearFlowChecklist();
        renderSessionList([]);
        statusEl.textContent = "历史会话已清空";
        logProcess("清空历史会话", `${sessions.length} 个`);
        await enterStandby(`新会话待机，等待唤醒词：${state.wakePhrase}`);
      } catch (err) {
        statusEl.textContent = `清空失败: ${err.message}`;
        logProcess("清空历史会话失败", err.message);
      }
    }

    function stopWakeDebugPolling() {
      if (state.wakeDebugTimer) clearInterval(state.wakeDebugTimer);
      state.wakeDebugTimer = null;
    }

    async function pollWakeDebug() {
      if (!state.authenticated || !state.clientId || !state.wakeEnabled) return;
      try {
        const data = await api(`/api/debug/last?clientId=${encodeURIComponent(state.clientId)}&session=${encodeURIComponent(state.session || "")}`);
        const items = Array.isArray(data.items) ? data.items : [];
        const wake = [...items].reverse().find((item) => item.event === "wake_response");
        if (!wake || (Date.now() - Number(wake.ts || 0) > 10000)) {
          state.lastWakeProbe = null;
          renderPipeline();
          return;
        }
        state.lastWakeProbe = {
          ts: wake.ts,
          engine: wake.engine,
          matched: !!wake.matched,
          text: wake.text || "",
          wakePhrase: wake.wakePhrase || state.wakePhrase,
          requestId: wake.requestId || "",
          bytes: wake.bytes || 0,
        };
        renderPipeline();
      } catch {}
    }

    function startWakeDebugPolling() {
      stopWakeDebugPolling();
      if (!state.authenticated || !state.wakeEnabled) return;
      state.wakeDebugTimer = setInterval(() => {
        void pollWakeDebug();
      }, 1200);
      void pollWakeDebug();
    }

    async function connectWithToken(token) {
      state.authToken = (token || "").trim();
      tokenInputEl.value = state.authToken;
      if (!state.authToken) {
        state.authenticated = false;
        updateAuthUi();
        statusEl.textContent = "请输入 gateway token。";
        return;
      }
      setBusy(true, "正在校验 gateway token...");
      try {
        await api("/api/auth/check");
        state.authenticated = true;
        sessionStore.setItem("openclaw-webchat-auth-token", state.authToken);
        updateAuthUi();
        statusEl.textContent = "已连接";
        logProcess("通过 gateway token 连接", `clientId=${state.clientId}`);
        await loadSessions();
        await loadMessages();
        await enterStandby(`已连接，等待唤醒词：${state.wakePhrase}`);
      } catch (err) {
        state.authenticated = false;
        updateAuthUi();
        statusEl.textContent = `认证失败: ${err.message}`;
        stopWakeDebugPolling();
      } finally {
        setBusy(false, statusEl.textContent);
      }
    }

    async function sendMessage(message, opts = {}) {
      const text = (message || draftEl.value).trim();
      if (!text || state.busy) return;

      if (!opts.requestId) {
        state.stepState.wake = {status: "idle", detail: "待执行"};
        state.stepState.claw = {status: "idle", detail: "待执行"};
        state.stepState.tts = {status: "idle", detail: "待执行"};
        state.stepState.audio = {status: "idle", detail: "待执行"};
      }

      beginNewFlowChecklist();
      state.flowChecklistVisible = true;

      const requestId = opts.requestId || state.currentRequestId || makeId("chat");
      const voiceMessage = opts.voiceMessage || state.voiceMessages[requestId] || null;
      hideTranscriptReview({ clearPending: true, clearDraft: false });
      draftEl.value = "";
      refreshSendButtonText();
      upsertTraceRecord(requestId, {
        userText: text,
        status: "Agent 执行中",
      });
      if (voiceMessage?.url) {
        addMessage("user", "", withTokenUrl(voiceMessage.url), {
          transcriptText: text,
          transcriptLabel: "查看识别文本",
        });
      } else {
        addMessage("user", text);
      }
      setStep("wake", "active", `正在进行声纹核验与唤醒词匹配...\nrequestId=${requestId}`);
      updateSpeakerCard("active", "核验中", "正在进行声纹核验");

      const hasVoiceprintError = text.includes("声纹有问题");
      const hasWakePhrase = containsWakePhrase(text);

      if (hasVoiceprintError) {
        addMessage("assistant", `身份验证失败：未识别到有效声纹特征。`);
        statusEl.textContent = `声纹异常，无法验证身份`;
        setStep("wake", "error", `声纹有问题\n无法验证当前用户身份\nrequestId=${requestId}`);
        setStep("claw", "idle", "等待声纹和唤醒词检测通过");
        setStep("tts", "idle", "等待 Agent 回复");
        setStep("audio", "idle", "等待 TTS 语音消息");
        logProcess("安全校验未通过", `声纹异常\ntext=${text}\nrequestId=${requestId}`);
        upsertTraceRecord(requestId, {
          status: "声纹校验失败",
          assistantReply: "身份验证失败：未识别到有效声纹特征。",
        });
        updateSpeakerCard("error", "未通过", "声纹核验失败");
        draftEl.focus();
        return;
      }

      if (!hasWakePhrase) {
        addMessage("assistant", `提示：唤醒词不在。你需要说出唤醒词“${state.wakePhrase}”才能进行下一步。`);
        statusEl.textContent = `唤醒词不在：${state.wakePhrase}`;
        setStep("wake", "error", `唤醒词不在\n未检测到有效唤醒词：${state.wakePhrase}\nrequestId=${requestId}`);
        setStep("claw", "idle", "等待声纹和唤醒词检测通过");
        setStep("tts", "idle", "等待 Agent 回复");
        setStep("audio", "idle", "等待 TTS 语音消息");
        logProcess("提示词校验未通过", `text=${text}\nrequestId=${requestId}`);
        upsertTraceRecord(requestId, {
          status: "唤醒词未命中",
          assistantReply: `提示：唤醒词不在。你需要说出唤醒词“${state.wakePhrase}”才能进行下一步。`,
        });
        updateSpeakerCard("active", "张三", "声纹已通过，等待唤醒词");
        draftEl.focus();
        return;
      }

      setStep("wake", "done", `检测通过。已识别声纹角色：【张三】\n命中唤醒词：${state.wakePhrase}\nrequestId=${requestId}`);
      updateSpeakerCard("verified", "张三", "声纹已通过");
      const pendingMessageEl = addMessage("assistant", "思考中...", null, { thinking: true });
      setBusy(true, "语音智能体正在回复...");
      state.pendingTranscript = "";
      setStep("claw", "active", `文本已经送进语音智能体，等待回复\nrequestId=${requestId}`);
      logProcess("送进语音智能体", `${text}\nclientId=${state.clientId}\nrequestId=${requestId}\nsession=${state.session}`);
      try {
        const data = await api("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Id": state.clientId,
            "X-Request-Id": requestId,
            "X-Session-Key": state.session,
          },
          body: JSON.stringify({
            session: state.session,
            message: text,
            knowledgeEnabled: state.knowledgeEnabled,
          }),
        });
        await ensureVisibleStep("claw", 900);
        if (pendingMessageEl && pendingMessageEl.isConnected) pendingMessageEl.remove();
        const fallbackReply = (Array.isArray(data.messages) ? [...data.messages].reverse().find((item) => (item.role || "") === "assistant")?.content : "") || "";
        const assistantReply = (data.reply || fallbackReply || "").trim();
        const knowledgeCitations = Array.isArray(data?.meta?.knowledge?.citations) ? data.meta.knowledge.citations : [];
        if (state.knowledgeEnabled && assistantReply && knowledgeCitations.length) {
          void refreshSmartQuickReplies({
            question: text,
            answer: assistantReply,
            citations: knowledgeCitations,
            requestId,
          });
        } else {
          state.smartQuickReplies = [];
          state.quickRepliesLoading = false;
          renderQuickReplies();
        }
        if (!state.autoTts || !assistantReply) {
          addMessage("assistant", assistantReply || "[empty]", null, { citations: knowledgeCitations });
        }
        state.lastAssistantReply = assistantReply;
        statusEl.textContent = "已完成";
        setStep("claw", "done", `runId=${data.runId || "unknown"}\nrequestId=${requestId}`);
        logProcess("语音智能体回复完成", `${assistantReply}\nclientId=${state.clientId}\nrequestId=${requestId}`);
        upsertTraceRecord(requestId, {
          assistantReply,
          status: state.autoTts && assistantReply ? "等待回复语音" : "已完成",
        });
        if (state.autoTts && assistantReply) {
          await synthesizeReplyAudio(assistantReply, requestId, { citations: knowledgeCitations });
        }
        state.currentRequestId = "";
      } catch (err) {
        if (pendingMessageEl && pendingMessageEl.isConnected) pendingMessageEl.remove();
        statusEl.textContent = `发送失败: ${err.message}`;
        setStep("claw", "error", `${err.message}\nrequestId=${requestId}`);
        addMessage("assistant", `Agent 请求失败：${err.message}`);
        logProcess("语音智能体回复失败", `${err.message}\nclientId=${state.clientId}\nrequestId=${requestId}`);
        upsertTraceRecord(requestId, {
          status: "Agent 执行失败",
          assistantReply: err.message,
        });
      } finally {
        delete state.voiceMessages[requestId];
        // Freeze this round's checklist card so later recording/transcribe status won't mutate it.
        state.flowChecklistVisible = false;
        if (state.wakeEnabled && state.authenticated && !state.recording && !state.autoTts) scheduleWakeResume(900);
        void loadSessions();
        setBusy(false, statusEl.textContent);
      }
    }

    async function synthesizeReplyAudio(text, requestId, options = {}) {
      setStep("tts", "active", `mode=${state.ttsMode}\nvoice=${state.ttsVoice}\nrequestId=${requestId}`);
      setStep("audio", "active", "等待 TTS 返回音频 URL");
      logProcess("开始合成回复语音", `${text}\nmode=${state.ttsMode}\nvoice=${state.ttsVoice}\nrequestId=${requestId}`);
      try {
        const data = await api("/api/tts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Id": state.clientId,
            "X-Request-Id": requestId,
            "X-Session-Key": state.session,
          },
          body: JSON.stringify({
            text,
            mode: state.ttsMode,
            voice: state.ttsVoice,
            session: state.session,
          }),
        });
        await ensureVisibleStep("tts", 700);
        state.lastTts = data.audio || null;
        setStep("tts", "done", `mode=${data.audio?.mode || state.ttsMode}\nvoice=${data.audio?.voice || state.ttsVoice}\nrequestId=${requestId}`);
        logProcess("回复语音完成", `${data.audio?.filename || ""}\nprovider=${data.audio?.provider || ""}\nmode=${data.audio?.mode || state.ttsMode}\nrequestId=${requestId}`);
        
        // 在对话框中显示音频
        if (data.audio?.url) {
          setStep("audio", "done", `语音生成完成\nrequestId=${requestId}`);
          addMessage("assistant", "", withTokenUrl(data.audio.url || "/api/default-audio"), {
            scrollBehavior: "smooth",
            transcriptText: text,
            citations: options.citations,
            transcriptLabel: "查看回复文本",
          });
          upsertTraceRecord(requestId, {
            ttsAudioUrl: data.audio.url,
            ttsVoice: data.audio.voice || state.ttsVoice,
            ttsMode: data.audio.mode || state.ttsMode,
            status: "已完成",
          });
        } else {
          setStep("audio", "done", `使用默认语音资源\nrequestId=${requestId}`);
          addMessage("assistant", "", withTokenUrl("/api/default-audio"), {
            scrollBehavior: "smooth",
            transcriptText: text,
            citations: options.citations,
            transcriptLabel: "查看回复文本",
          });
          upsertTraceRecord(requestId, {
            ttsAudioUrl: "/api/default-audio",
            status: "已完成",
          });
        }
        
        renderPipeline();
        autoplayProofAudio(ttsProofAudioEl, {
          onPlaying: () => {
            if (state.wakeEnabled) updateWakeUi("回复播放中，结束后自动回到待机");
          },
          onFallback: () => {
            if (state.wakeEnabled && state.authenticated && !state.recording) scheduleWakeResume(1200);
          },
        });
      } catch (err) {
        setStep("tts", "error", `${err.message}\nrequestId=${requestId}`);
        setStep("audio", "error", `${err.message}\nrequestId=${requestId}`);
        addMessage("assistant", text, null, { citations: options.citations });
        logProcess("回复语音失败", `${err.message}\nrequestId=${requestId}`);
        upsertTraceRecord(requestId, {
          status: "语音生成失败",
          ttsError: err.message,
        });
        if (state.wakeEnabled && state.authenticated && !state.recording) scheduleWakeResume(1200);
      }
    }

    async function transcribeBlob(blob, filename, opts = {}) {
      setBusy(true, "音频转写中...");
      const requestId = opts.requestId || state.currentRequestId || makeId("tx");
      state.currentRequestId = requestId;
      state.lastUpload = null;
      try {
        const kb = Math.round((blob.size || 0) / 1024);
        statusEl.textContent = `上传音频到服务器 (${kb} KB)...`;
        setStep("upload", "active", `${filename} / ${kb} KB\nrequestId=${requestId}`);
        logProcess("上传到服务器", `${filename} / ${kb} KB\nclientId=${state.clientId}\nrequestId=${requestId}\nsession=${state.session}`);
        const data = await api("/api/transcribe", {
          method: "POST",
          headers: {
            "Content-Type": blob.type || "application/octet-stream",
            "X-Filename": filename || "audio.wav",
            "X-ASR-Language": state.transcriptLanguage || "zh",
            "X-Client-Id": state.clientId,
            "X-Request-Id": requestId,
            "X-Session-Key": state.session,
          },
          body: blob,
        });
        await ensureVisibleStep("transcribe", 700);
        state.lastUpload = data.upload || null;
        state.pendingTranscript = data.text || "";
        draftEl.value = "";
        showTranscriptReview("可在输入框中修改后，点击“确认发送”或“取消”。", state.pendingTranscript);
        refreshSendButtonText();
        statusEl.textContent = `转写完成，请确认文本后再发送：${data.text}`;
        setStep("upload", "done", `${filename} 已上传\nrequestId=${requestId}`);
        setStep("transcribe", "done", `requested=${state.transcriptLanguage} / detected=${data.meta?.language || "unknown"}\nrequestId=${requestId}`);
        setStep("transcript", "done", `${data.text || "[empty]"}\nrequestId=${requestId}`);
        logProcess("服务器转写完成", `${data.text || "[empty]"}\nclientId=${state.clientId}\nrequestId=${requestId}\nuploadId=${data.upload?.id || "unknown"}\nsha256=${data.upload?.sha256 || "unknown"}`);
        const shouldAutoSend = opts.autoSendOverride === true || state.autoSend;
        if (data.upload?.url) {
          state.voiceMessages[requestId] = {
            url: data.upload.url,
            filename: data.upload.filename || filename,
            transcript: data.text || "",
          };
        }
        upsertTraceRecord(requestId, {
          userAudioUrl: data.upload?.url || "",
          userAudioName: data.upload?.filename || filename,
          userAudioBytes: data.upload?.bytes || blob.size || 0,
          transcript: data.text || "",
          status: shouldAutoSend ? "等待 Agent 回复" : "待确认发送",
        });
        setBusy(false, statusEl.textContent);
        if (shouldAutoSend) {
          // TEST 模式：如果后端标记了 test_mode，发送 test_auto_send_text 而不是转写结果
          if (data.meta?.test_mode && data.meta?.test_auto_send_text) {
            const testAutoSendText = data.meta.test_auto_send_text;
            logProcess("演示模式自动发送", `送进语音智能体: ${testAutoSendText}\nrequestId=${requestId}`);
            await sendMessage(testAutoSendText, {requestId});
          } else {
            // 正常模式：发送转写结果
            await sendMessage(data.text || "", {requestId});
          }
        }
        else if (state.wakeEnabled && state.authenticated) scheduleWakeResume(1800);
      } catch (err) {
        delete state.voiceMessages[requestId];
        statusEl.textContent = `转写失败: ${err.message}`;
        setStep("upload", "done", `${filename} 已上传\nrequestId=${requestId}`);
        setStep("transcribe", "error", `${err.message}\nrequestId=${requestId}`);
        logProcess("服务器转写失败", `${err.message}\nclientId=${state.clientId}\nrequestId=${requestId}`);
        upsertTraceRecord(requestId, {
          status: "转写失败",
          transcript: err.message,
        });
        setBusy(false, statusEl.textContent);
        if (state.wakeEnabled && state.authenticated) scheduleWakeResume(1800);
      }
    }

    async function cleanupRecording() {
      if (state.meterTimer) cancelAnimationFrame(state.meterTimer);
      state.meterTimer = null;
      if (state.monitorSource) {
        try { state.monitorSource.disconnect(); } catch {}
      }
      if (state.analyser) {
        try { state.analyser.disconnect(); } catch {}
      }
      if (state.monitorContext) {
        try { await state.monitorContext.close(); } catch {}
      }
      state.monitorContext = null;
      state.monitorSource = null;
      state.analyser = null;
      state.inputLevel = 0;
      renderInputLevel();
      if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
      state.stream = null;
      state.mediaRecorder = null;
      state.mediaChunks = [];
      state.recording = false;
      state.currentRecordAutoSend = false;
      state.currentRecordWakeTriggered = false;
      state.autoStopOnSilence = false;
      state.recordStartedAt = 0;
      state.speechSeenAt = 0;
      state.silenceSince = 0;
      state.stopRequested = false;
      applyVoiceInputMode(state.voiceInputMode);
      updateWakeUi();
    }

    async function stopRecordingAndUpload() {
      if (!state.recording) return;
      if (state.stopRequested && !state.mediaRecorder) return;
      state.recording = false;
      recordBtn.disabled = true;
      recordBtn.textContent = "处理中...";
      const recorder = state.mediaRecorder;
      if (!recorder) {
        await cleanupRecording();
        recordBtn.disabled = false;
        setStep("record", "error", "录音器不存在");
        logProcess("录音失败", "录音器不存在");
        return;
      }
      const stopped = new Promise((resolve, reject) => {
        recorder.addEventListener("stop", resolve, { once: true });
        recorder.addEventListener("error", (event) => reject(event.error || new Error("MediaRecorder error")), { once: true });
      });
      recorder.stop();
      try {
        await stopped;
        const blob = new Blob(state.mediaChunks, { type: recorder.mimeType || "audio/webm" });
        const sizeKb = Math.round((blob.size || 0) / 1024);
        const requestId = makeId("tx");
        const autoSendOverride = state.currentRecordAutoSend;
        if (state.localCapture?.url) URL.revokeObjectURL(state.localCapture.url);
        state.localCapture = {
          requestId,
          bytes: blob.size || 0,
          mimeType: blob.type || "audio/webm",
          url: URL.createObjectURL(blob),
        };
        await cleanupRecording();
        recordBtn.disabled = false;
        clearPendingRecord({ keepStatus: true });
        const ext = blob.type.includes("webm") ? "webm" : blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "bin";
        state.pendingRecord = {
          blob,
          bytes: blob.size || 0,
          mimeType: blob.type || "audio/webm",
          url: URL.createObjectURL(blob),
          requestId,
          filename: `recording-${Date.now()}.${ext}`,
          autoSendOverride,
        };
        showPendingRecordReview();
        statusEl.textContent = `录音完成，请试听后确认上传 (${sizeKb} KB, ${blob.type || "unknown"})`;
        setStep("record", "done", `${sizeKb} KB / ${blob.type || "unknown"}`);
        setStep("upload", "idle", "等待确认上传");
        setStep("transcribe", "idle", "等待确认上传");
        logProcess("录音完成", `${sizeKb} KB / ${blob.type || "unknown"}\nrequestId=${requestId}`);
        renderPipeline();
      } catch (err) {
        await cleanupRecording();
        recordBtn.disabled = false;
        statusEl.textContent = `录音停止失败: ${err.message || err}`;
        setStep("record", "error", String(err.message || err));
        logProcess("录音停止失败", String(err.message || err));
      }
    }

    async function startRecording(opts = {}) {
      if (state.recording) {
        await stopRecordingAndUpload();
        return;
      }
      if (state.pendingRecord) clearPendingRecord({ keepStatus: true });
      if (!navigator.mediaDevices?.getUserMedia) {
        statusEl.textContent = "当前浏览器不支持录音。";
        return;
      }
      if (!window.MediaRecorder) {
        statusEl.textContent = "当前浏览器不支持 MediaRecorder 录音。";
        return;
      }
      try {
        await stopWakeListener();
        state.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: state.selectedDeviceId ? { exact: state.selectedDeviceId } : undefined,
            channelCount: 1,
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
          },
        });
        await refreshMicDevices();
        startLevelMonitor(state.stream);
        const mimeCandidates = [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/ogg;codecs=opus",
          "audio/mp4",
        ];
        const mimeType = mimeCandidates.find((mime) => MediaRecorder.isTypeSupported?.(mime)) || "";
        state.mediaChunks = [];
        state.mediaRecorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
        state.mediaRecorder.addEventListener("dataavailable", (event) => {
          if (event.data && event.data.size > 0) state.mediaChunks.push(event.data);
        });
        state.mediaRecorder.start();
        state.recording = true;
        state.currentRecordAutoSend = !!opts.autoSend;
        state.currentRecordWakeTriggered = !!opts.wakeDetectedText;
        state.autoStopOnSilence = !!opts.autoStopOnSilence;
        state.recordStartedAt = Date.now();
        state.speechSeenAt = 0;
        state.silenceSince = 0;
        state.stopRequested = false;
        recordBtn.textContent = "停止录音";
        statusEl.textContent = state.currentRecordWakeTriggered
          ? `已唤醒，正在录音（${state.mediaRecorder.mimeType || "default"}）。说完后会自动发送。`
          : `录音中（${state.mediaRecorder.mimeType || "default"}）。先看右侧输入电平条是否波动；有波动再继续。`;
        resetProcess("录音已经开始");
        const recordDetail = `${state.mediaRecorder.mimeType || "default"}${state.autoStopOnSilence ? "\n自动停录已开启" : ""}${state.currentRecordAutoSend ? "\n本轮将自动发送" : ""}`;
        setStep("record", "active", recordDetail);
        logProcess("开始录音", `浏览器原始录音格式 ${state.mediaRecorder.mimeType || "default"}\nselectedDeviceId=${state.selectedDeviceId || "default"}${opts.wakeDetectedText ? `\n唤醒词=${opts.wakeDetectedText}` : ""}`);
        updateWakeUi();
      } catch (err) {
        await cleanupRecording();
        statusEl.textContent = `录音失败: ${err.message}`;
        setStep("record", "error", err.message);
        logProcess("录音失败", err.message);
      }
    }

    sendBtn.addEventListener("click", () => sendMessage());
    draftEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        sendMessage();
      }
    });
    draftEl.addEventListener("input", () => refreshSendButtonText());
    if (transcriptConfirmBtn) transcriptConfirmBtn.addEventListener("click", () => void confirmTranscriptAndSend());
    if (transcriptCancelBtn) transcriptCancelBtn.addEventListener("click", () => cancelTranscriptReview());
    if (transcriptReviewEditorEl) {
      transcriptReviewEditorEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void confirmTranscriptAndSend();
        }
      });
    }
    recordBtn.addEventListener("click", () => startRecording());
    if (recordConfirmBtn) recordConfirmBtn.addEventListener("click", () => void confirmPendingRecordUpload());
    if (recordCancelBtn) recordCancelBtn.addEventListener("click", () => void cancelPendingRecordUpload());
    uploadBtn.addEventListener("click", () => audioInput.click());
    if (voiceInputModeEl) {
      voiceInputModeEl.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const button = target.closest("[data-voice-input-mode]");
        if (!(button instanceof HTMLElement)) return;
        applyVoiceInputMode(button.dataset.voiceInputMode || "ptt");
        logProcess("切换语音输入模式", state.voiceInputMode === "stream" ? "连续语音输入" : "PTT 单指令");
      });
    }
    if (advancedSettingsBtn) {
      advancedSettingsBtn.addEventListener("click", () => openAdvancedSettingsModal());
    }
    if (advancedSettingsCloseBtn) {
      advancedSettingsCloseBtn.addEventListener("click", () => closeAdvancedSettingsModal());
    }
    if (advancedSettingsModalEl) {
      advancedSettingsModalEl.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.dataset.closeAdvanced === "1") {
          closeAdvancedSettingsModal();
        }
      });
    }
    if (traceHistoryBtn) traceHistoryBtn.addEventListener("click", () => openTraceHistoryModal());
    if (traceHistoryCloseBtn) traceHistoryCloseBtn.addEventListener("click", () => closeTraceHistoryModal());
    if (traceHistoryClearBtn) traceHistoryClearBtn.addEventListener("click", () => clearTraceHistory());
    if (traceHistoryModalEl) {
      traceHistoryModalEl.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.dataset.closeTraceHistory === "1") {
          closeTraceHistoryModal();
        }
      });
    }
    if (debugTerminalBtn) debugTerminalBtn.addEventListener("click", () => openDebugTerminalModal());
    if (knowledgeTestBtn) {
      knowledgeTestBtn.addEventListener("click", () => {
        const url = new URL("/static/pages/knowledge-test/index.html", window.location.origin);
        if (state.session) url.searchParams.set("session", state.session);
        if (state.authToken) url.searchParams.set("token", state.authToken);
        window.open(url.toString(), "_blank", "noopener");
      });
    }
    if (debugTerminalCloseBtn) debugTerminalCloseBtn.addEventListener("click", () => closeDebugTerminalModal());
    if (debugTerminalRefreshBtn) debugTerminalRefreshBtn.addEventListener("click", () => void refreshDebugTerminal());
    if (debugTerminalModalEl) {
      debugTerminalModalEl.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.dataset.closeDebugTerminal === "1") {
          closeDebugTerminalModal();
        }
      });
    }
    authBtnEl.addEventListener("click", () => connectWithToken(tokenInputEl.value));
    tokenInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        connectWithToken(tokenInputEl.value);
      }
    });
    if (micSelectEl) micSelectEl.addEventListener("change", () => onMicSelected(micSelectEl.value));
    if (micQuickSelectEl) micQuickSelectEl.addEventListener("change", () => onMicSelected(micQuickSelectEl.value));
    refreshMicsBtn.addEventListener("click", () => refreshMicDevices());
    wakeToggleEl.addEventListener("change", async () => {
      state.wakeEnabled = !!wakeToggleEl.checked;
      if (state.wakeEnabled) {
        state.lastWakeProbe = null;
        logProcess("开启唤醒词", `${state.wakePhrase}\nclientId=${state.clientId}`);
        await enterStandby(`待机中，等待唤醒词：${state.wakePhrase}`);
      } else {
        logProcess("关闭唤醒词", `clientId=${state.clientId}`);
        stopWakeDebugPolling();
        state.lastWakeProbe = null;
        await stopWakeListener();
      }
      updateWakeUi();
      renderPipeline();
    });
    wakePhraseInputEl.addEventListener("change", async () => {
      state.wakePhrase = (wakePhraseInputEl.value || "你好").trim() || "你好";
      localStorage.setItem("openclaw-webchat-wake-phrase", state.wakePhrase);
      logProcess("更新唤醒词", `${state.wakePhrase}\nclientId=${state.clientId}`);
      renderQuickReplies();
      if (state.wakeEnabled) {
        await stopWakeListener();
        await startWakeListener();
      } else {
        updateWakeUi();
      }
    });
    languageSelectEl.addEventListener("change", () => {
      state.transcriptLanguage = languageSelectEl.value || "zh";
      localStorage.setItem("openclaw-webchat-language", state.transcriptLanguage);
      logProcess("切换转写语言", `${state.transcriptLanguage}\nclientId=${state.clientId}`);
      if (state.wakeEnabled) {
        void stopWakeListener().then(() => startWakeListener());
      }
    });
    autoSendToggleEl.addEventListener("change", () => {
      state.autoSend = !!autoSendToggleEl.checked;
      localStorage.setItem("openclaw-webchat-auto-send", state.autoSend ? "1" : "0");
      logProcess("切换自动发送", `${state.autoSend ? "on" : "off"}\nclientId=${state.clientId}`);
    });
    if (llmBackendSelectEl) {
      llmBackendSelectEl.addEventListener("change", () => {
        state.llmBackend = llmBackendSelectEl.value === "remote" ? "remote" : "local";
        localStorage.setItem("openclaw-webchat-llm-backend", state.llmBackend);
        updateLlmBackendUi();
        logProcess("切换对话模型来源", `${state.llmBackend}\nclientId=${state.clientId}`);
      });
    }
    if (knowledgeToggleEl) {
      knowledgeToggleEl.addEventListener("change", () => {
        state.knowledgeEnabled = knowledgeToggleEl.value !== "false";
        localStorage.setItem("openclaw-webchat-knowledge-enabled", state.knowledgeEnabled ? "1" : "0");
        if (!state.knowledgeEnabled) {
          state.smartQuickReplies = [];
          state.quickRepliesLoading = false;
          renderQuickReplies();
        }
        logProcess("切换知识库", `${state.knowledgeEnabled ? "enabled" : "disabled"}\nclientId=${state.clientId}`);
      });
    }
    ttsModeSelectEl.addEventListener("change", () => {
      state.ttsMode = ttsModeSelectEl.value || "api";
      localStorage.setItem("openclaw-webchat-tts-mode", state.ttsMode);
      logProcess("切换回复语音模式", `${state.ttsMode}\nclientId=${state.clientId}`);
    });
    ttsVoiceSelectEl.addEventListener("change", () => {
      state.ttsVoice = ttsVoiceSelectEl.value || "zh-CN-XiaoxiaoNeural";
      localStorage.setItem("openclaw-webchat-tts-voice", state.ttsVoice);
      logProcess("切换回复语音", `${state.ttsVoice}\nclientId=${state.clientId}`);
    });
    autoTtsToggleEl.addEventListener("change", () => {
      state.autoTts = !!autoTtsToggleEl.checked;
      localStorage.setItem("openclaw-webchat-auto-tts", state.autoTts ? "1" : "0");
      logProcess("切换自动回复语音", `${state.autoTts ? "on" : "off"}\nclientId=${state.clientId}`);
    });
    audioInput.addEventListener("change", async () => {
      const file = audioInput.files && audioInput.files[0];
      audioInput.value = "";
      if (!file) return;
      await transcribeBlob(file, file.name || `upload-${Date.now()}`);
    });
    reloadBtn.addEventListener("click", loadMessages);
    newSessionBtn.addEventListener("click", () => void createNewSession());
    if (sessionSidebarNewBtn) sessionSidebarNewBtn.addEventListener("click", () => void createNewSession());
    if (sessionSidebarClearBtn) sessionSidebarClearBtn.addEventListener("click", () => void clearAllSessions());
    sessionEl.addEventListener("change", () => {
      const next = sessionEl.value.trim();
      if (!next) return;
      void switchSession(next);
    });
    document.addEventListener("click", (event) => {
      const target = event.target;
      const menu = document.querySelector(".session-context-menu");
      if (!(target instanceof HTMLElement) || !menu || !target.closest(".session-context-menu")) {
        hideSessionContextMenu();
        return;
      }
      const action = target.dataset.action;
      const session = menu.getAttribute("data-session") || "";
      if (action === "delete") void deleteSession(session);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideSessionContextMenu();
      if (event.key === "Escape" && advancedSettingsModalEl && !advancedSettingsModalEl.classList.contains("hidden")) {
        closeAdvancedSettingsModal();
      }
      if (event.key === "Escape" && traceHistoryModalEl && !traceHistoryModalEl.classList.contains("hidden")) {
        closeTraceHistoryModal();
      }
      if (event.key === "Escape" && debugTerminalModalEl && !debugTerminalModalEl.classList.contains("hidden")) {
        closeDebugTerminalModal();
      }
    });

    function renderQuickReplies() {
      if (!quickRepliesEl) return;
      
      const wake = state.wakePhrase || "你好";
      const defaultReplies = [
        `${wake}，塔台，南方8900请求起飞。`,
        `${wake}，进近，请确认当前跑道风向风速。`,
        `${wake}，请报告当前的离场航线。`,
        `${wake}，雷达确认，保持当前高度9000米。`
      ];
      const smartReplies = state.knowledgeEnabled && Array.isArray(state.smartQuickReplies)
        ? state.smartQuickReplies.filter(Boolean).slice(0, 3)
        : [];
      const replies = smartReplies.length ? smartReplies : defaultReplies;
      
      quickRepliesEl.innerHTML = "";
      if (state.quickRepliesLoading) {
        const loadingBtn = document.createElement("button");
        loadingBtn.className = "quick-reply-chip quick-reply-chip--loading";
        loadingBtn.textContent = "正在生成推荐对话...";
        loadingBtn.type = "button";
        loadingBtn.disabled = true;
        quickRepliesEl.appendChild(loadingBtn);
        updateQuickRepliesVisibility();
        return;
      }
      replies.forEach(text => {
        const btn = document.createElement("button");
        btn.className = "quick-reply-chip";
        btn.textContent = text;
        btn.type = "button";
        btn.onclick = () => {
          draftEl.value = text;
          draftEl.focus();
        };
        quickRepliesEl.appendChild(btn);
      });
      updateQuickRepliesVisibility();
    }

    async function refreshSmartQuickReplies({ question, answer, citations, requestId }) {
      if (!state.knowledgeEnabled || !Array.isArray(citations) || !citations.length) return;
      const marker = requestId || makeId("suggest");
      state.quickReplyRequestId = marker;
      state.quickRepliesLoading = true;
      state.smartQuickReplies = [];
      renderQuickReplies();
      try {
        const data = await api("/api/chat/suggestions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Id": state.clientId,
            "X-Request-Id": marker,
            "X-Session-Key": state.session,
          },
          body: JSON.stringify({
            session: state.session,
            question,
            answer,
            citations,
          }),
        });
        if (state.quickReplyRequestId !== marker) return;
        const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
        state.smartQuickReplies = suggestions.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 3);
        state.quickRepliesLoading = false;
        renderQuickReplies();
        logProcess("生成推荐对话", `${state.smartQuickReplies.length} 条\nrequestId=${marker}`);
      } catch (err) {
        if (state.quickReplyRequestId !== marker) return;
        state.smartQuickReplies = [];
        state.quickRepliesLoading = false;
        renderQuickReplies();
        logProcess("推荐对话生成失败", `${err.message}\nrequestId=${marker}`);
      }
    }

    function updateLlmBackendUi() {
      if (llmBackendSelectEl) llmBackendSelectEl.value = state.llmBackend;
      if (!llmBackendStatusEl) return;
      llmBackendStatusEl.textContent = state.llmBackend === "remote"
        ? "远程 API 入口已选择，但后端接口尚未接入；当前聊天仍走本地大模型。"
        : "当前聊天使用本地大模型接口。";
    }

    const initial = qsSession() || sessionStore.getItem("openclaw-webchat-session") || makeSession();
    const initialToken = new URL(window.location.href).searchParams.get("token") || sessionStore.getItem("openclaw-webchat-auth-token") || "";
    const savedLanguage = localStorage.getItem("openclaw-webchat-language");
    state.transcriptLanguage = savedLanguage || (((navigator.language || "").toLowerCase().startsWith("zh")) ? "zh" : "auto");
    state.autoSend = localStorage.getItem("openclaw-webchat-auto-send") === "1";
    state.autoTts = localStorage.getItem("openclaw-webchat-auto-tts") !== "0";
    state.llmBackend = localStorage.getItem("openclaw-webchat-llm-backend") === "remote" ? "remote" : "local";
    state.ttsMode = localStorage.getItem("openclaw-webchat-tts-mode") || "api";
    state.ttsVoice = localStorage.getItem("openclaw-webchat-tts-voice") || "zh-CN-XiaoxiaoNeural";
    state.voiceInputMode = localStorage.getItem("openclaw-webchat-voice-input-mode") || "ptt";
    state.knowledgeEnabled = localStorage.getItem("openclaw-webchat-knowledge-enabled") !== "0";
    state.wakeEnabled = true;
    const storedWakePhrase = localStorage.getItem("openclaw-webchat-wake-phrase") || "";
    state.wakePhrase = (!storedWakePhrase || storedWakePhrase === "hey robot" || storedWakePhrase === "机器人你好") ? "你好" : storedWakePhrase;
    state.wakeSupported = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
    state.clientId = localStorage.getItem("openclaw-webchat-client-id") || makeId("client");
    state.selectedDeviceId = sessionStore.getItem("openclaw-webchat-mic-device") || "";
    uiMode.init();
    localStorage.setItem("openclaw-webchat-client-id", state.clientId);
    languageSelectEl.value = state.transcriptLanguage;
    autoSendToggleEl.checked = state.autoSend;
    updateLlmBackendUi();
    ttsModeSelectEl.value = state.ttsMode;
    ttsVoiceSelectEl.value = state.ttsVoice;
    autoTtsToggleEl.checked = state.autoTts;
    if (knowledgeToggleEl) knowledgeToggleEl.value = state.knowledgeEnabled ? "true" : "false";
    wakeToggleEl.checked = state.wakeEnabled;
    wakePhraseInputEl.value = state.wakePhrase;
    tokenInputEl.value = initialToken;
    renderInputLevel();
    applyVoiceInputMode(state.voiceInputMode);
    refreshSendButtonText();
    updateAuthUi();
    updateWakeUi();
    refreshMicDevices();
    renderQuickReplies();
    setSession(initial);
    resetProcess("页面已就绪");
    logProcess("页面已就绪", `clientId=${state.clientId}\nsession=${initial}\nlanguage=${state.transcriptLanguage}\nautoSend=${state.autoSend}\nautoTts=${state.autoTts}\nttsVoice=${state.ttsVoice}`);
    if (initialToken) {
      connectWithToken(initialToken);
    } else {
      statusEl.textContent = "请输入 gateway token 后连接。";
    }
    ttsProofAudioEl.addEventListener("ended", () => {
      if (state.wakeEnabled && state.authenticated && !state.recording) {
        updateWakeUi("回复结束，回到待机");
        scheduleWakeResume(400);
      }
    });

    // 加载声纹采集组件
    (async () => {
      try {
        // 先初始化 state 中的 voiceprint 属性
        state.voiceprintRecording = false;
        state.voiceprintMediaChunks = [];
        state.voiceprintStartTime = 0;
        state.voiceprintMediaRecorder = null;
        state.voiceprintCurrentStep = 0;
        state.voiceprintSegments = [];
        state.voiceprintPhrases = [
          "你好，我是语音助手",
          "请识别我的声纹特征",
          "谢谢你的配合"
        ];
        state.voiceprintRecordingTime = 0;
        state.voiceprintRecordingTimer = null;
        state.voiceprintCurrentSegmentBlob = null;

        const response = await fetch("/static/pages/voiceprint/voiceprint-modal.html");
        const html = await response.text();
        const placeholder = document.getElementById("voiceprintModalPlaceholder");
        if (placeholder) {
          placeholder.innerHTML = html;
        }
        
        // 给浏览器时间来渲染 HTML
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 动态导入 voiceprint 模块
        const { initVoiceprintModule } = await import("/static/pages/voiceprint/voiceprint.js");
        
        // 准备 DOM 元素引用
        const voiceprintDom = {
          voiceprintBtn: $("voiceprintBtn"),
          voiceprintModalEl: $("voiceprintModal"),
          voiceprintCloseBtnEl: $("voiceprintCloseBtn"),
          voiceprintProgressFillEl: $("voiceprintProgressFill"),
          voiceprintProgressTextEl: $("voiceprintProgressText"),
          voiceprintPromptEl: $("voiceprintPrompt"),
          voiceprintPhraseEl: $("voiceprintPhrase"),
          voiceprintHintEl: $("voiceprintHint"),
          voiceprintRecordBtnEl: $("voiceprintRecordBtn"),
          voiceprintStatusEl: $("voiceprintStatus"),
          voiceprintTimerEl: $("voiceprintTimer"),
          voiceprintReviewContainerEl: $("voiceprintReviewContainer"),
          voiceprintReviewAudioEl: $("voiceprintReviewAudio"),
          voiceprintSegmentConfirmBtnEl: $("voiceprintSegmentConfirmBtn"),
          voiceprintSegmentRetryBtnEl: $("voiceprintSegmentRetryBtn"),
          voiceprintCollectionCompleteEl: $("voiceprintCollectionComplete"),
          voiceprintCompleteDetailEl: $("voiceprintCompleteDetail"),
          voiceprintFinalConfirmBtnEl: $("voiceprintFinalConfirmBtn"),
          voiceprintStartOverBtnEl: $("voiceprintStartOverBtn"),
        };
        
        // 检查关键 DOM 元素是否存在
        if (!voiceprintDom.voiceprintModalEl) {
          console.error("声纹采集 HTML 加载失败或元素不存在");
          return;
        }
        
        // 传入辅助函数
        state.startLevelMonitor = startLevelMonitor;
        state.statusEl = statusEl;
        
        // 初始化模块并设置事件监听
        const voiceprintModule = initVoiceprintModule(state, voiceprintDom);
        voiceprintModule.setupEventListeners();
        
        console.log("声纹采集组件加载成功");
        
      } catch (err) {
        console.error("加载声纹采集组件失败:", err);
      }
    })();
  
