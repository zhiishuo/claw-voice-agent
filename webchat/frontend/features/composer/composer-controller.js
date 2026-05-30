import { $ } from "../../core/dom.js";

function renderUserAudio({ duration, waveformHtml }) {
  return `
    <div class="audio-message-btn bg-blue-50 border border-blue-100 px-3 py-2 rounded-2xl flex items-center gap-3 cursor-pointer hover:bg-blue-100 transition-colors shadow-sm w-fit self-end" data-duration="${duration}" onclick="window.toggleAudioPlay(this)">
      <div class="play-icon-container w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white shadow-sm shrink-0 transition-colors">
        <i class="fa-solid fa-play ml-0.5 text-xs"></i>
      </div>
      <div class="waveform-container flex items-center gap-1 h-5 px-1 shrink-0 opacity-70 transition-opacity">
        ${waveformHtml}
      </div>
      <span class="text-xs font-medium text-blue-600 shrink-0 min-w-[20px] text-right">${duration}"</span>
    </div>
  `;
}

function renderUserText(text) {
  if (!text) return "";
  return `<div class="bg-[#f4f4f4] text-gray-800 px-5 py-3 rounded-2xl rounded-tr-sm text-[15px] leading-relaxed w-fit self-end mt-1">${text}</div>`;
}

export function initComposer({ textarea, sendBtn, chatContainer, onSubmit, context } = {}) {
  const attachContainer = $("audio-attachment-container");
  let currentAudioDuration = 0;
  let currentAudioWaveform = "";
  let sending = false;
  let enabled = true;

  function refreshSendState() {
    if (!enabled || sending) {
      sendBtn.classList.add("bg-gray-300", "cursor-not-allowed");
      sendBtn.classList.remove("bg-blue-600", "hover:bg-blue-700", "cursor-pointer");
      return;
    }
    const hasText = textarea.value.trim().length > 0;
    const hasAudio = !attachContainer.classList.contains("hidden");
    if (hasText || hasAudio) {
      sendBtn.classList.remove("bg-gray-300", "cursor-not-allowed");
      sendBtn.classList.add("bg-blue-600", "hover:bg-blue-700", "cursor-pointer");
    } else {
      sendBtn.classList.add("bg-gray-300", "cursor-not-allowed");
      sendBtn.classList.remove("bg-blue-600", "hover:bg-blue-700", "cursor-pointer");
    }
  }

  function removeAudioAttachment() {
    attachContainer.classList.add("hidden");
    attachContainer.innerHTML = "";
    currentAudioDuration = 0;
    currentAudioWaveform = "";
    refreshSendState();
  }

  window.removeAudioAttachment = removeAudioAttachment;

  function setAudioAttachment({ duration, waveformHtml }) {
    currentAudioDuration = duration;
    currentAudioWaveform = waveformHtml;
    refreshSendState();
  }

  function setEnabled(value) {
    enabled = value;
    if (!enabled) {
      textarea.disabled = true;
      textarea.classList.add("opacity-50", "cursor-not-allowed");
    } else {
      textarea.disabled = false;
      textarea.classList.remove("opacity-50", "cursor-not-allowed");
    }
    refreshSendState();
  }

  async function sendMessage() {
    const text = textarea.value.trim();
    const hasAudio = !attachContainer.classList.contains("hidden");
    if (!text && !hasAudio) return;
    if (sending) return;

    sending = true;
    sendBtn.classList.add("bg-gray-300", "cursor-not-allowed");
    sendBtn.classList.remove("bg-blue-600", "hover:bg-blue-700", "cursor-pointer");
    sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    let audioHtml = "";
    if (hasAudio) {
      audioHtml = renderUserAudio({
        duration: currentAudioDuration,
        waveformHtml: currentAudioWaveform,
      });
      removeAudioAttachment();
    }

    const userMsgHTML = `
      <div class="flex justify-end message-anim mt-2">
        <div class="flex flex-col max-w-[80%]">
          ${audioHtml}
          ${renderUserText(text)}
        </div>
      </div>
    `;

    chatContainer.insertAdjacentHTML("beforeend", userMsgHTML);
    const welcome = document.getElementById("empty-welcome");
    if (welcome) welcome.classList.add("hidden");
    textarea.value = "";
    textarea.style.height = "auto";
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" });

    try {
      await onSubmit?.(text || "[语音消息]");
    } finally {
      sending = false;
      sendBtn.innerHTML = '<i class="fa-solid fa-arrow-up"></i>';
      refreshSendState();
    }
  }

  textarea.addEventListener("input", function onInput() {
    this.style.height = "auto";
    this.style.height = `${this.scrollHeight}px`;
    refreshSendState();
  });

  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!sendBtn.classList.contains("cursor-not-allowed")) sendMessage();
    }
  });

  sendBtn.addEventListener("click", () => {
    if (!sendBtn.classList.contains("cursor-not-allowed")) sendMessage();
  });

  chatContainer.addEventListener("click", (event) => {
    const btn = event.target.closest(".dyn-sug-btn");
    if (!btn) return;
    const sugText = btn.querySelector("span").innerText;
    // 自动在推荐对话前补唤醒词（受设置控制）
    const autoPrepend = context?.settings?.autoPrependWake !== false;
    const wakePhrase = autoPrepend ? (context?.settings?.wakePhrase || "") : "";
    textarea.value = wakePhrase ? `${wakePhrase}，${sugText}` : sugText;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    refreshSendState();
  });

  return { refreshSendState, setAudioAttachment, removeAudioAttachment, setEnabled };
}
