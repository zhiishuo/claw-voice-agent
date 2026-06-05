import { $ } from "../../core/dom.js";
import { makeId } from "../../core/ids.js";

const MODAL_HTML = `
<div id="voiceprint-modal" class="hidden fixed inset-0 z-[120] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center">
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" id="voiceprint-modal-content">
    <div class="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/80">
      <h3 class="text-sm font-bold text-gray-800 flex items-center gap-2"><i class="fa-solid fa-fingerprint text-gray-500"></i> 声纹注册</h3>
      <button id="vp-close-btn" class="text-gray-400 hover:text-gray-600 w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-200"><i class="fa-solid fa-xmark text-sm"></i></button>
    </div>
    <div class="p-5 space-y-4">
      <!-- 推荐短语 -->
      <div id="vp-phrase-section" class="text-center">
        <div class="text-xs text-gray-400 mb-1">请说出以下内容</div>
        <div class="text-base font-medium text-gray-800">"你好，我是管理员"</div>
      </div>

      <!-- 录音区 -->
      <div id="vp-record-section" class="text-center">
        <button id="vp-record-btn" class="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center mx-auto shadow-lg transition-colors">
          <i class="fa-solid fa-microphone text-xl"></i>
        </button>
        <div id="vp-hint" class="text-xs text-gray-400 mt-2">点击开始录音</div>
      </div>

      <!-- 确认区 (录音完成后显示) -->
      <div id="vp-confirm-section" class="hidden text-center space-y-3">
        <audio id="vp-audio" controls class="w-full rounded-lg" preload="auto"></audio>
        <input type="text" id="vp-speaker-name" class="w-full bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" placeholder="角色名（不填则默认 owner）">
        <div class="flex gap-2 justify-center">
          <button id="vp-cancel-btn" class="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">取消</button>
          <button id="vp-submit-btn" class="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">确认注册</button>
        </div>
      </div>

      <!-- 状态 -->
      <div id="vp-status" class="text-xs text-center text-gray-400"></div>
    </div>
  </div>
</div>
`;

/**
 * @param {object} opts
 * @param {object} opts.speakerService - from services.speaker
 * @param {object} opts.context - appContext
 */
export function initVoiceprint({ speakerService, context } = {}) {
  if (!document.getElementById("voiceprint-modal")) {
    document.body.insertAdjacentHTML("beforeend", MODAL_HTML);
  }

  const modal = $("voiceprint-modal");
  const closeBtn = $("vp-close-btn");
  const speakerNameInput = $("vp-speaker-name");
  const recordBtn = $("vp-record-btn");
  const hintEl = $("vp-hint");
  const statusEl = $("vp-status");
  const recordSection = $("vp-record-section");
  const confirmSection = $("vp-confirm-section");
  const audioEl = $("vp-audio");
  const cancelBtn = $("vp-cancel-btn");
  const submitBtn = $("vp-submit-btn");
  const phraseSection = $("vp-phrase-section");

  let mediaRecorder = null;
  let mediaChunks = [];
  let stream = null;
  let recording = false;
  let pendingBlob = null;

  function open() {
    resetUi();
    modal?.classList.remove("hidden");
  }

  function close() {
    modal?.classList.add("hidden");
    stopRecording();
  }

  function resetUi() {
    statusEl.textContent = "";
    statusEl.className = "text-xs text-center text-gray-400";
    hintEl.textContent = "点击开始录音";
    hintEl.className = "text-xs text-gray-400 mt-2";
    recordBtn.innerHTML = '<i class="fa-solid fa-microphone text-xl"></i>';
    recordBtn.classList.remove("bg-gray-400");
    recordBtn.classList.add("bg-red-500", "hover:bg-red-600");
    recordBtn.disabled = false;
    recording = false;
    pendingBlob = null;
    // 显示录音区，隐藏确认区
    recordSection.classList.remove("hidden");
    confirmSection.classList.add("hidden");
    speakerNameInput.value = "";
    phraseSection.classList.remove("hidden");
  }

  function showConfirm(blob) {
    pendingBlob = blob;
    recordSection.classList.add("hidden");
    confirmSection.classList.remove("hidden");
    phraseSection.classList.add("hidden");
    audioEl.src = URL.createObjectURL(blob);
    speakerNameInput.focus();
  }

  async function startRecording() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    } catch (err) {
      statusEl.textContent = "麦克风访问失败";
      statusEl.className = "text-xs text-center text-red-500";
      return;
    }

    mediaChunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) mediaChunks.push(e.data); };
    mediaRecorder.onstop = () => handleRecordingDone();
    mediaRecorder.start();
    recording = true;

    recordBtn.innerHTML = '<i class="fa-solid fa-stop text-xl"></i>';
    recordBtn.classList.remove("bg-red-500", "hover:bg-red-600");
    recordBtn.classList.add("bg-gray-400");
    hintEl.textContent = "录音中... 再次点击停止";
    hintEl.className = "text-xs text-blue-500 font-medium mt-2";

    // 最长 10 秒自动停止
    setTimeout(() => {
      if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    }, 10000);
  }

  function stopRecording() {
    if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    cleanupStream();
  }

  function cleanupStream() {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }

  function handleRecordingDone() {
    recording = false;
    cleanupStream();

    const blob = new Blob(mediaChunks, { type: mediaRecorder?.mimeType || "audio/webm" });

    if (blob.size < 1000) {
      statusEl.textContent = "录音太短，请重试";
      statusEl.className = "text-xs text-center text-amber-500";
      resetUi();
      return;
    }

    showConfirm(blob);
  }

  async function handleSubmit() {
    if (!pendingBlob || !speakerService) return;
    const speakerId = speakerNameInput.value.trim() || "owner";

    submitBtn.disabled = true;
    submitBtn.textContent = "注册中...";
    statusEl.textContent = "";
    cancelBtn.disabled = true;

    try {
      await speakerService.enroll({
        blob: pendingBlob,
        filename: `voiceprint-${Date.now()}.webm`,
        speakerId,
        requestId: makeId("speaker"),
      });
      statusEl.textContent = `✅ 声纹注册成功（角色: ${speakerId}）`;
      statusEl.className = "text-xs text-center text-green-600 font-medium";
      confirmSection.classList.add("hidden");
      setTimeout(close, 1200);
    } catch (err) {
      statusEl.textContent = `注册失败：${err.message}`;
      statusEl.className = "text-xs text-center text-red-500";
      submitBtn.disabled = false;
      submitBtn.textContent = "确认注册";
      cancelBtn.disabled = false;
    }
  }

  function handleCancel() {
    pendingBlob = null;
    resetUi();
  }

  // Events
  recordBtn?.addEventListener("click", () => {
    if (recording) stopRecording();
    else startRecording();
  });
  submitBtn?.addEventListener("click", handleSubmit);
  cancelBtn?.addEventListener("click", handleCancel);
  closeBtn?.addEventListener("click", close);
  modal?.addEventListener("click", (e) => { if (e.target === modal) close(); });

  return { open, close };
}
