import { $ } from "../../core/dom.js";

/**
 * Manages the transcript review overlay UI.
 * Shared between recorder and audio-import controllers.
 *
 * Usage:
 *   const review = createTranscriptReview({ textarea, onConfirm });
 *   review.show("识别文本");
 *   review.hide();
 */
export function createTranscriptReview({ textarea, onConfirm } = {}) {
  const transcriptReview = $("transcript-review");
  const transcriptEditor = $("transcript-editor");
  const transcriptConfirmBtn = $("transcript-confirm-btn");
  const transcriptCancelBtn = $("transcript-cancel-btn");

  let visible = false;
  let currentAudioUrl = "";

  const audioContainer = $("transcript-audio-container");

  function show(text, audioUrl) {
    if (!transcriptReview) return;
    visible = true;
    currentAudioUrl = audioUrl || "";
    textarea?.classList.add("opacity-0");
    transcriptEditor.value = text || "";
    // 插入音频播放器
    if (audioContainer) {
      if (audioUrl) {
        audioContainer.innerHTML = `
          <audio id="transcript-audio" controls class="w-full h-9 rounded-lg" src="${audioUrl}"></audio>
        `;
        audioContainer.classList.remove("hidden");
      } else {
        audioContainer.innerHTML = "";
        audioContainer.classList.add("hidden");
      }
    }
    transcriptReview.classList.remove("hidden");
    transcriptReview.classList.add("flex");
    transcriptEditor.focus();
  }

  function hide() {
    if (!transcriptReview) return;
    visible = false;
    currentAudioUrl = "";
    // 停止并清理音频
    const audio = transcriptReview.querySelector("audio");
    if (audio) { audio.pause(); audio.src = ""; }
    if (audioContainer) { audioContainer.innerHTML = ""; audioContainer.classList.add("hidden"); }
    transcriptReview.classList.add("hidden");
    transcriptReview.classList.remove("flex");
    textarea?.classList.remove("opacity-0");
  }

  function isVisible() {
    return visible;
  }

  function handleConfirm() {
    if (!visible) return;
    const text = transcriptEditor.value.trim();
    const url = currentAudioUrl;
    hide();
    if (text) onConfirm?.(text, url);
  }

  function handleCancel() {
    if (!visible) return;
    hide();
  }

  transcriptConfirmBtn?.addEventListener("click", handleConfirm);
  transcriptCancelBtn?.addEventListener("click", handleCancel);

  transcriptEditor?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      handleConfirm();
    }
  });

  return { show, hide, isVisible };
}
