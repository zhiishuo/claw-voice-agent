import { createAppContext, renderAppContextStatus, renderAuthCheckStatus } from "./app-context.js";
import { initAudioPlaybackGlobals } from "../features/chat/audio-playback-controller.js";
import { initAuthTokenCard } from "../features/auth/auth-token-card.js";
import { initCitationTabGlobals } from "../features/chat/citation-tabs.js";
import { createRealChatFlow } from "../features/chat/real-chat-flow.js";
import { initComposer } from "../features/composer/composer-controller.js";
import { initKnowledgeLab } from "../features/knowledge/knowledge-lab-controller.js";
import { initKnowledgeToggle, isKnowledgeEnabled } from "../features/knowledge/knowledge-toggle-controller.js";
import { initNavigation } from "../features/navigation/navigation-controller.js";
import { initSessionContextMenu } from "../features/sessions/session-context-menu.js";
import { initSessionList } from "../features/sessions/session-list-controller.js";
import { initSettingsModal } from "../features/settings/settings-controller.js";
import { initSidebar } from "../features/shell/sidebar-controller.js";
import { initMicDropdown } from "../features/voice/mic-dropdown-controller.js";
import { initRecorder } from "../features/voice/recorder-controller.js";
import { initAudioImport } from "../features/voice/audio-import-controller.js";
import { createTranscriptReview } from "../features/voice/transcript-review.js";
import { initVoiceModeToggle } from "../features/voice/voice-mode-controller.js";
import { initWakeListener } from "../features/wake/wake-listener-controller.js";
import { initWakeCard } from "../features/wake/wake-card-controller.js";
import { initVoiceprint } from "../features/voiceprint/voiceprint-controller.js";
import { STORAGE_KEYS, writeLocal } from "../core/storage.js";
import { createServices } from "../services/index.js";

document.addEventListener("DOMContentLoaded", () => {
  const textarea = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-btn");
  const chatContainer = document.getElementById("chat-container");
  const context = createAppContext();
  const services = createServices(context);

  renderAppContextStatus(context);
  if (!context.token) renderAuthCheckStatus("warn", "未认证");

  // 知识库激活回调：navigation controller 切换到知识库视图时触发
  let kbActivateCallback = null;
  const registerKbActivate = (fn) => { kbActivateCallback = fn; };

  initNavigation({
    onSwitchTo: (view) => {
      if (view === "knowledge-lab" && kbActivateCallback) kbActivateCallback();
    },
  });
  initKnowledgeLab({
    knowledgeService: services.knowledge,
    onSwitchTo: registerKbActivate,
  });
  initKnowledgeToggle({
    initialEnabled: context.settings.knowledgeEnabled,
    onChange: (enabled) => {
      context.settings.knowledgeEnabled = enabled;
      writeLocal(STORAGE_KEYS.knowledgeEnabled, enabled ? "1" : "0");
    },
  });
  initSidebar();

  const micDropdown = initMicDropdown();

  // --- 唤醒卡片 (首次会话验证) ---
  const wakeCard = initWakeCard({
    wakeService: services.wake,
    context,
    getDeviceId: () => micDropdown.getSelectedDeviceId(),
    onWakeSuccess: ({ text, audioBlob }) => {
      // 标记当前 session 已验证
      context.sessionVerified.set(context.session, true);
      // 直接发送第一条消息（带语音条）
      const audioUrl = audioBlob ? URL.createObjectURL(audioBlob) : undefined;
      chatFlow.sendMessage(text, audioUrl);
    },
  });

  const sessionList = initSessionList({
    context,
    sessionService: services.sessions,
    chatContainer,
    enabled: !!context.token,
    onSessionChange: () => {
      // 切换会话后，隐藏当前唤醒卡片并检查新会话是否需要唤醒
      wakeCard.hide();
      checkAndShowWakeCard();
    },
  });
  const sessionContextMenu = initSessionContextMenu({
    onDelete: (session) => void sessionList.deleteSession(session),
  });

  const settingsCtrl = initSettingsModal({ context, debugService: services.debug, speakerService: services.speaker });
  initAudioPlaybackGlobals();
  initCitationTabGlobals();
  initVoiceModeToggle();
  const authCard = initAuthTokenCard({
    context,
    authService: services.auth,
    onAuthenticated: () => {
      composer.setEnabled(true);
      sessionList.setEnabled(true);
      void sessionList.refresh();
      // 认证完成后加载知识库状态，确保 token 已就绪
      if (kbActivateCallback) kbActivateCallback();
      // 检查是否需要显示唤醒卡片
      checkAndShowWakeCard();
    },
  });
  if (context.token) void authCard.verifyCurrentToken({ silent: true });

  document.addEventListener("click", (event) => {
    sessionContextMenu.close();
    const micDropdownContainer = document.getElementById("mic-dropdown-container");
    if (micDropdownContainer && !micDropdownContainer.contains(event.target)) micDropdown.close();
  });

  const chatFlow = createRealChatFlow({
    chatContainer,
    chatService: services.chat,
    ttsService: services.tts,
    context,
    isKnowledgeEnabled,
    onAfterSend: () => void sessionList.refresh(),
    onTrace: (record) => settingsCtrl.addTrace(record),
  });

  const composer = initComposer({
    textarea,
    sendBtn,
    chatContainer,
    onSubmit: (text, opts) => chatFlow.sendMessage(text, undefined, opts),
    context,
  });

  // 未认证时禁用关键操作
  if (!context.token) composer.setEnabled(false);

  // Shared transcript review for recorder and audio import
  const transcriptReview = createTranscriptReview({
    textarea,
    onConfirm: (text, audioUrl) => {
      // 直接发送，不再填入输入框
      chatFlow.sendMessage(text, audioUrl);
    },
  });

  initRecorder({
    textarea,
    transcriptionService: services.transcription,
    transcriptReview,
    getDeviceId: () => micDropdown.getSelectedDeviceId(),
  });
  initAudioImport({
    textarea,
    transcriptionService: services.transcription,
    transcriptReview,
  });

  // --- 唤醒词监听 ---
  const wakeListener = initWakeListener({
    wakeService: services.wake,
    context,
    onWakeMatched: ({ text, requestId }) => {
      // 唤醒后自动录音并发送
      textarea.value = text || "";
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
      composer.refreshSendState();
      // 自动发送唤醒词转写文本
      if (text) {
        chatFlow.sendMessage(text);
      }
    },
  });

  // 认证成功后，检查是否需要显示唤醒卡片
  function checkAndShowWakeCard() {
    if (!context.token) return;
    if (!context.settings?.wakeDetection) return;
    if (context.sessionVerified.get(context.session)) return;
    wakeCard.show();
  }

  // --- 声纹注册 ---
  const voiceprint = initVoiceprint({
    speakerService: services.speaker,
    context,
  });

  document.getElementById("voiceprint-btn")?.addEventListener("click", () => {
    voiceprint.open();
  });
});
