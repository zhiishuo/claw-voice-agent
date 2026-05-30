import { $ } from "../../core/dom.js";
import { makeId } from "../../core/ids.js";

/**
 * @param {object} opts
 * @param {HTMLTextAreaElement} opts.textarea
 * @param {object} opts.transcriptionService - from services.transcription
 * @param {object} opts.transcriptReview - from createTranscriptReview()
 */
export function initAudioImport({ textarea, transcriptionService, transcriptReview } = {}) {
  const audioImportBtn = $("audio-import-btn");
  const audioFileInput = $("audio-file-input");
  let isActive = false;

  async function handleFileImport() {
    const file = audioFileInput.files?.[0];
    audioFileInput.value = "";
    if (!file || isActive) return;

    isActive = true;
    const requestId = makeId("tx");
    const filename = file.name || `upload-${Date.now()}.webm`;

    try {
      const data = await transcriptionService.transcribe({ blob: file, filename, requestId });
      const text = (data.text || "").trim();
      transcriptReview.show(text);
    } catch (err) {
      console.error("音频转写失败:", err);
      alert(`音频识别失败: ${err.message || err}`);
    } finally {
      isActive = false;
    }
  }

  // --- 事件绑定 ---
  audioImportBtn?.addEventListener("click", () => audioFileInput?.click());
  audioFileInput?.addEventListener("change", handleFileImport);
}
