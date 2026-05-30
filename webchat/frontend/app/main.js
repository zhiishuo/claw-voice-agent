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

  initNavigation();
  initKnowledgeLab({ knowledgeService: services.knowledge });
  initKnowledgeToggle({
    initialEnabled: context.settings.knowledgeEnabled,
    onChange: (enabled) => {
      context.settings.knowledgeEnabled = enabled;
      writeLocal(STORAGE_KEYS.knowledgeEnabled, enabled ? "1" : "0");
    },
  });
  initSidebar();

  const sessionList = initSessionList({
    context,
    sessionService: services.sessions,
    chatContainer,
    enabled: !!context.token,
  });
  const sessionContextMenu = initSessionContextMenu({
    onDelete: (session) => void sessionList.deleteSession(session),
  });
  const micDropdown = initMicDropdown();

  const settingsCtrl = initSettingsModal({ context, debugService: services.debug });
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
    onSubmit: (text) => chatFlow.sendMessage(text),
    context,
  });

  // 未认证时禁用关键操作
  if (!context.token) composer.setEnabled(false);

  // Shared transcript review for recorder and audio import
  const transcriptReview = createTranscriptReview({
    textarea,
    onConfirm: (text) => {
      textarea.value = text;
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
      composer.refreshSendState();
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

  // 认证成功后启动唤醒监听
  const origOnAuthenticated = authCard.verifyCurrentToken;
  // Wake is enabled by default after auth if wakePhrase is set
  if (context.token && context.settings?.wakePhrase) {
    // Delay wake start to avoid conflict with initial load
    setTimeout(() => wakeListener.enable(), 3000);
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
