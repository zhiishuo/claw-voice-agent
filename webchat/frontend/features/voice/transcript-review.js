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

  function show(text) {
    if (!transcriptReview) return;
    visible = true;
    textarea?.classList.add("opacity-0");
    transcriptEditor.value = text || "";
    transcriptReview.classList.remove("hidden");
    transcriptReview.classList.add("flex");
    transcriptEditor.focus();
    transcriptEditor.select();
  }

  function hide() {
    if (!transcriptReview) return;
    visible = false;
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
    hide();
    if (text) onConfirm?.(text);
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
