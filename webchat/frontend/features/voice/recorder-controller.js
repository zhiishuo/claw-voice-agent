import { $ } from "../../core/dom.js";
import { makeId } from "../../core/ids.js";

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

function pickSupportedMime() {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * @param {object} opts
 * @param {HTMLTextAreaElement} opts.textarea
 * @param {object} opts.transcriptionService - from services.transcription
 * @param {object} opts.transcriptReview - from createTranscriptReview()
 * @param {Function} opts.getDeviceId - returns selected mic device ID
 */
export function initRecorder({ textarea, transcriptionService, transcriptReview, getDeviceId } = {}) {
  const holdToTalkBtn = $("hold-to-talk-btn");
  const sendBtnGroup = $("send-btn-group");
  const recordingMask = $("recording-mask");
  const recordingTime = $("recording-time");
  const recordingDot = $("recording-dot");
  const freqContainer = $("freq-container");
  const cancelRecordBtn = $("cancel-record-btn");
  const confirmRecordBtn = $("confirm-record-btn");

  let mediaRecorder = null;
  let mediaChunks = [];
  let stream = null;
  let audioCtx = null;
  let analyser = null;
  let isRecording = false;
  let recordStartTime = 0;
  let recordTimerInterval = null;
  let freqInterval = null;

  // --- 频率条初始化 ---
  const numBars = 40;
  for (let i = 0; i < numBars; i += 1) {
    const bar = document.createElement("div");
    bar.className = "w-[2px] bg-blue-500 rounded-full transition-all duration-75";
    bar.style.height = "4px";
    freqContainer.appendChild(bar);
  }

  // --- UI 控制 ---
  function resetRecordingUi() {
    isRecording = false;
    holdToTalkBtn.classList.remove("hold-to-talk-active");
    holdToTalkBtn.innerHTML = '<i class="fa-solid fa-microphone text-sm"></i>';
    if (sendBtnGroup) sendBtnGroup.classList.remove("hidden");
    textarea.classList.remove("opacity-0");
    recordingMask.classList.add("hidden");
    recordingMask.classList.remove("flex");
  }

  function startFreqAnimation() {
    const bars = freqContainer.children;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const barCount = bars.length;
    function draw() {
      if (!isRecording) return;
      analyser.getByteFrequencyData(dataArray);
      const step = Math.floor(dataArray.length / barCount);
      for (let i = 0; i < barCount; i += 1) {
        const idx = i * step;
        const val = dataArray[idx] / 255; // 0-1
        const h = Math.max(4, val * 28);
        bars[i].style.height = `${h}px`;
      }
      freqInterval = requestAnimationFrame(draw);
    }
    freqInterval = requestAnimationFrame(draw);
  }

  function stopFreqAnimation() {
    cancelAnimationFrame(freqInterval);
    freqInterval = null;
    const bars = freqContainer.children;
    for (let i = 0; i < bars.length; i += 1) bars[i].style.height = "4px";
  }

  // --- 录音核心 ---
  async function startRecording(event) {
    if (event) event.preventDefault();
    try {
      const deviceId = getDeviceId?.();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          channelCount: 1,
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      console.error("麦克风访问失败:", err);
      alert("无法访问麦克风，请检查浏览器权限设置。");
      return;
    }

    // 创建 AnalyserNode 用于真实频谱
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    isRecording = true;
    recordStartTime = Date.now();
    mediaChunks = [];

    const mimeType = pickSupportedMime();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) mediaChunks.push(e.data);
    });
    mediaRecorder.start();

    // UI 切换
    recordingDot.classList.remove("hidden");
    recordingTime.classList.remove("animate-pulse", "text-blue-600", "font-bold");
    recordingTime.classList.add("text-gray-600");
    holdToTalkBtn.classList.add("hold-to-talk-active");
    holdToTalkBtn.innerHTML = '<i class="fa-solid fa-paper-plane text-sm"></i>';
    if (sendBtnGroup) sendBtnGroup.classList.add("hidden");
    textarea.classList.add("opacity-0");
    recordingMask.classList.remove("hidden");
    recordingMask.classList.add("flex");
    recordingTime.innerText = "0:00";

    recordTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
      recordingTime.innerText = formatDuration(elapsed);
    }, 1000);

    startFreqAnimation();
  }

  async function stopRecording(isCancel = false) {
    if (!isRecording) return;

    clearInterval(recordTimerInterval);
    recordTimerInterval = null;
    stopFreqAnimation();

    if (isCancel) {
      if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
      cleanupStream();
      resetRecordingUi();
      return;
    }

    // 停止录音 — 显示 loading
    recordingDot.classList.add("hidden");
    recordingTime.innerText = "语音识别中...";
    recordingTime.classList.remove("text-gray-600");
    recordingTime.classList.add("animate-pulse", "text-blue-600", "font-bold");
    holdToTalkBtn.classList.remove("hold-to-talk-active");
    holdToTalkBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-sm"></i>';

    const stopped = new Promise((resolve) => {
      mediaRecorder.addEventListener("stop", resolve, { once: true });
    });
    if (mediaRecorder.state !== "inactive") mediaRecorder.stop();
    await stopped;

    const blob = new Blob(mediaChunks, { type: mediaRecorder.mimeType || "audio/webm" });
    cleanupStream();

    // 调用转写 API
    const requestId = makeId("tx");
    const filename = `recording-${Date.now()}.webm`;
    try {
      const data = await transcriptionService.transcribe({ blob, filename, requestId });
      const text = (data.text || "").trim();
      isRecording = false;
      holdToTalkBtn.innerHTML = '<i class="fa-solid fa-microphone text-sm"></i>';
      holdToTalkBtn.classList.remove("hold-to-talk-active");
      recordingMask.classList.add("hidden");
      recordingMask.classList.remove("flex");
      const audioUrl = URL.createObjectURL(blob);
      transcriptReview.show(text, audioUrl);
    } catch (err) {
      console.error("转写失败:", err);
      isRecording = false;
      resetRecordingUi();
      alert(`语音识别失败: ${err.message || err}`);
    }
  }

  function cleanupStream() {
    if (audioCtx && audioCtx.state !== "closed") {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    analyser = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    mediaRecorder = null;
    mediaChunks = [];
  }

  function toggleRecording(event) {
    if (event) event.preventDefault();
    if (isRecording) stopRecording(false);
    else startRecording(event);
  }

  // --- 事件绑定 ---
  holdToTalkBtn?.addEventListener("click", toggleRecording);
  confirmRecordBtn?.addEventListener("click", () => stopRecording(false));
  cancelRecordBtn?.addEventListener("click", () => stopRecording(true));
}
