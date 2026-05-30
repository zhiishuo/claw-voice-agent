import { $ } from "../../core/dom.js";
import { makeId } from "../../core/ids.js";

const PHRASES = [
  "你好，我是语音助手",
  "请识别我的声纹特征",
  "谢谢你的配合",
];

const MODAL_HTML = `
<div id="voiceprint-modal" class="hidden fixed inset-0 z-[120] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center">
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" id="voiceprint-modal-content">
    <div class="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/80">
      <h3 class="text-sm font-bold text-gray-800 flex items-center gap-2"><i class="fa-solid fa-fingerprint text-gray-500"></i> 声纹注册</h3>
      <button id="vp-close-btn" class="text-gray-400 hover:text-gray-600 w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-200"><i class="fa-solid fa-xmark text-sm"></i></button>
    </div>
    <div class="p-5">
      <div id="vp-progress" class="flex items-center gap-2 mb-4">
        <div class="text-xs text-gray-500">步骤 <span id="vp-step-num">1</span> / ${PHRASES.length}</div>
        <div class="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div id="vp-step-bar" class="h-full bg-blue-500 rounded-full transition-all" style="width:33%"></div></div>
      </div>
      <div id="vp-phrase" class="text-center text-lg font-medium text-gray-800 mb-4">${PHRASES[0]}</div>
      <div id="vp-recording-ui" class="text-center">
        <button id="vp-record-btn" class="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center mx-auto shadow-lg transition-colors">
          <i class="fa-solid fa-microphone text-xl"></i>
        </button>
        <div class="text-xs text-gray-400 mt-2">点击开始录音</div>
      </div>
      <div id="vp-playback-ui" class="hidden text-center">
        <audio id="vp-audio" controls class="w-full mb-3"></audio>
        <div class="flex gap-2 justify-center">
          <button id="vp-retry-btn" class="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">重录</button>
          <button id="vp-confirm-btn" class="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">确认</button>
        </div>
      </div>
      <div id="vp-done-ui" class="hidden text-center">
        <div class="text-green-600 mb-3"><i class="fa-solid fa-circle-check text-3xl"></i></div>
        <div class="text-sm text-gray-700 mb-4">已采集 <span id="vp-count">0</span> 段语音</div>
        <button id="vp-submit-btn" class="px-6 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">完成注册</button>
      </div>
      <div id="vp-status" class="text-xs text-center text-gray-400 mt-3"></div>
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
  // Inject modal HTML
  if (!document.getElementById("voiceprint-modal")) {
    document.body.insertAdjacentHTML("beforeend", MODAL_HTML);
  }

  const modal = $("voiceprint-modal");
  const closeBtn = $("vp-close-btn");
  const phraseEl = $("vp-phrase");
  const stepNum = $("vp-step-num");
  const stepBar = $("vp-step-bar");
  const recordingUi = $("vp-recording-ui");
  const playbackUi = $("vp-playback-ui");
  const doneUi = $("vp-done-ui");
  const recordBtn = $("vp-record-btn");
  const retryBtn = $("vp-retry-btn");
  const confirmBtn = $("vp-confirm-btn");
  const submitBtn = $("vp-submit-btn");
  const audioEl = $("vp-audio");
  const countEl = $("vp-count");
  const statusEl = $("vp-status");

  let currentStep = 0;
  let segments = [];
  let mediaRecorder = null;
  let mediaChunks = [];
  let stream = null;
  let currentBlob = null;

  function open() {
    currentStep = 0;
    segments = [];
    showStep();
    modal?.classList.remove("hidden");
  }

  function close() {
    modal?.classList.add("hidden");
    stopRecording();
  }

  function showStep() {
    if (currentStep >= PHRASES.length) {
      // All done
      recordingUi.classList.add("hidden");
      playbackUi.classList.add("hidden");
      doneUi.classList.remove("hidden");
      countEl.textContent = segments.length;
      return;
    }

    recordingUi.classList.remove("hidden");
    playbackUi.classList.add("hidden");
    doneUi.classList.add("hidden");
    phraseEl.textContent = PHRASES[currentStep];
    stepNum.textContent = currentStep + 1;
    stepBar.style.width = `${((currentStep + 1) / PHRASES.length) * 100}%`;
    statusEl.textContent = "";
  }

  async function startRecording() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      mediaChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) mediaChunks.push(e.data); };
      mediaRecorder.onstop = () => {
        currentBlob = new Blob(mediaChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        const url = URL.createObjectURL(currentBlob);
        audioEl.src = url;
        recordingUi.classList.add("hidden");
        playbackUi.classList.remove("hidden");
        cleanupStream();
      };
      mediaRecorder.start();

      recordBtn.innerHTML = '<i class="fa-solid fa-stop text-xl"></i>';
      recordBtn.classList.remove("bg-red-500", "hover:bg-red-600");
      recordBtn.classList.add("bg-gray-400");

      // Auto-stop after 30s
      setTimeout(() => {
        if (mediaRecorder?.state === "recording") mediaRecorder.stop();
      }, 30000);
    } catch (err) {
      statusEl.textContent = "麦克风访问失败";
      statusEl.className = "text-xs text-center text-red-500 mt-3";
    }
  }

  function stopRecording() {
    if (mediaRecorder?.state === "recording") mediaRecorder.stop();
    cleanupStream();
    recordBtn.innerHTML = '<i class="fa-solid fa-microphone text-xl"></i>';
    recordBtn.classList.remove("bg-gray-400");
    recordBtn.classList.add("bg-red-500", "hover:bg-red-600");
  }

  function cleanupStream() {
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }

  function confirmSegment() {
    if (currentBlob) {
      segments.push(currentBlob);
      currentStep++;
      showStep();
    }
  }

  async function submitEnrollment() {
    if (!speakerService || !segments.length) return;
    statusEl.textContent = "注册中...";
    statusEl.className = "text-xs text-center text-blue-500 mt-3";
    submitBtn.disabled = true;

    try {
      // Send each segment
      for (let i = 0; i < segments.length; i++) {
        const blob = segments[i];
        const filename = `voiceprint-${i + 1}-${Date.now()}.webm`;
        await speakerService.enroll({
          blob,
          filename,
          speakerId: "owner",
          requestId: makeId("speaker"),
        });
      }
      statusEl.textContent = "声纹注册成功！";
      statusEl.className = "text-xs text-center text-green-600 mt-3";
      setTimeout(close, 1500);
    } catch (err) {
      statusEl.textContent = `注册失败：${err.message}`;
      statusEl.className = "text-xs text-center text-red-500 mt-3";
    } finally {
      submitBtn.disabled = false;
    }
  }

  // Events
  recordBtn?.addEventListener("click", () => {
    if (mediaRecorder?.state === "recording") stopRecording();
    else startRecording();
  });
  retryBtn?.addEventListener("click", showStep);
  confirmBtn?.addEventListener("click", confirmSegment);
  submitBtn?.addEventListener("click", submitEnrollment);
  closeBtn?.addEventListener("click", close);
  modal?.addEventListener("click", (e) => { if (e.target === modal) close(); });

  return { open, close };
}
