import { $ } from "../../core/dom.js";
import { makeId } from "../../core/ids.js";
import { encodeWavBlobFromFloat32 } from "../wake/audio-codec.js";

const MODAL_HTML = `
<div id="voiceprint-modal" class="hidden fixed inset-0 z-[120] bg-gray-900/40 backdrop-blur-sm flex items-center justify-center">
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" id="voiceprint-modal-content">
    <div class="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/80">
      <h3 class="text-sm font-bold text-gray-800 flex items-center gap-2"><i class="fa-solid fa-fingerprint text-gray-500"></i> 声纹注册</h3>
      <button id="vp-close-btn" class="text-gray-400 hover:text-gray-600 w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-200"><i class="fa-solid fa-xmark text-sm"></i></button>
    </div>
    <div class="p-5 space-y-4">
      <div id="vp-phrase-section" class="text-center">
        <div class="text-xs text-gray-400 mb-1">请说出以下内容</div>
        <div class="text-base font-medium text-gray-800">"你好，我是管理员"</div>
      </div>

      <div id="vp-record-section" class="text-center">
        <button id="vp-record-btn" class="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center mx-auto shadow-lg transition-colors">
          <i class="fa-solid fa-microphone text-xl"></i>
        </button>
        <div id="vp-hint" class="text-xs text-gray-400 mt-2">点击开始录音</div>
      </div>

      <div id="vp-confirm-section" class="hidden text-center space-y-3">
        <audio id="vp-audio" controls class="w-full rounded-lg" preload="auto"></audio>
        <input type="text" id="vp-speaker-name" class="w-full bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all" placeholder="角色名（不填则默认 owner）">
        <div class="flex gap-2 justify-center">
          <button id="vp-cancel-btn" class="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">取消</button>
          <button id="vp-submit-btn" class="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">确认注册</button>
        </div>
      </div>

      <div id="vp-status" class="text-xs text-center text-gray-400"></div>
    </div>
  </div>
</div>
`;

async function resampleTo16k(sourceSampleRate, samples) {
  if (sourceSampleRate === 16000) return samples;
  const offlineCtx = new OfflineAudioContext(1, Math.round(samples.length * 16000 / sourceSampleRate), 16000);
  const buffer = offlineCtx.createBuffer(1, samples.length, sourceSampleRate);
  buffer.getChannelData(0).set(samples);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

export function initVoiceprint({ speakerService } = {}) {
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

  let audioCtx = null;
  let processor = null;
  let silentGain = null;
  let stream = null;
  let recording = false;
  let pendingBlob = null;
  let previewUrl = "";
  let sampleBuffers = [];
  let sampleCount = 0;
  let sampleRate = 16000;
  let autoStopTimer = null;
  let enrollController = null;
  let submitSeq = 0;

  function cleanupStream() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
  }

  function resetSubmitState() {
    submitBtn.disabled = false;
    submitBtn.textContent = "确认注册";
    cancelBtn.disabled = false;
  }

  function resetUi() {
    submitSeq += 1;
    enrollController?.abort();
    enrollController = null;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = "";
    }
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
    sampleBuffers = [];
    sampleCount = 0;
    recordSection.classList.remove("hidden");
    confirmSection.classList.add("hidden");
    speakerNameInput.value = "";
    phraseSection.classList.remove("hidden");
    resetSubmitState();
  }

  async function stopRecording(discard = false) {
    if (!recording && !discard) return;
    recording = false;
    if (autoStopTimer) {
      clearTimeout(autoStopTimer);
      autoStopTimer = null;
    }
    if (processor) {
      processor.disconnect();
      processor = null;
    }
    if (silentGain) {
      silentGain.disconnect();
      silentGain = null;
    }
    if (audioCtx && audioCtx.state !== "closed") {
      await audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    cleanupStream();
    recordBtn.innerHTML = '<i class="fa-solid fa-microphone text-xl"></i>';
    recordBtn.classList.remove("bg-gray-400");
    recordBtn.classList.add("bg-red-500", "hover:bg-red-600");
    hintEl.textContent = "点击开始录音";
    hintEl.className = "text-xs text-gray-400 mt-2";

    if (discard) {
      sampleBuffers = [];
      sampleCount = 0;
      return;
    }

    const samples = new Float32Array(sampleCount);
    let offset = 0;
    for (const buf of sampleBuffers) {
      samples.set(buf, offset);
      offset += buf.length;
    }
    sampleBuffers = [];
    sampleCount = 0;

    const resampled = await resampleTo16k(sampleRate, samples);
    const pcmBlob = new Blob([resampled.buffer], { type: "audio/pcm-f32" });
    if (pcmBlob.size < 1000) {
      statusEl.textContent = "录音太短，请重试";
      statusEl.className = "text-xs text-center text-amber-500";
      resetUi();
      return;
    }

    pendingBlob = pcmBlob;
    recordSection.classList.add("hidden");
    confirmSection.classList.remove("hidden");
    phraseSection.classList.add("hidden");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(encodeWavBlobFromFloat32(resampled, 16000));
    audioEl.src = previewUrl;
    speakerNameInput.focus();
  }

  async function startRecording() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      console.error("microphone access failed", err);
      statusEl.textContent = "麦克风访问失败";
      statusEl.className = "text-xs text-center text-red-500";
      return;
    }

    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    sampleBuffers = [];
    sampleCount = 0;
    sampleRate = audioCtx.sampleRate || 16000;

    processor.onaudioprocess = (event) => {
      if (!recording) return;
      const input = event.inputBuffer.getChannelData(0);
      if (!input) return;
      sampleBuffers.push(new Float32Array(input));
      sampleCount += input.length;
    };
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioCtx.destination);

    recording = true;
    recordBtn.innerHTML = '<i class="fa-solid fa-stop text-xl"></i>';
    recordBtn.classList.remove("bg-red-500", "hover:bg-red-600");
    recordBtn.classList.add("bg-gray-400");
    hintEl.textContent = "录音中... 再次点击停止";
    hintEl.className = "text-xs text-blue-500 font-medium mt-2";
    autoStopTimer = setTimeout(() => {
      if (recording) void stopRecording();
    }, 10000);
  }

  function open() {
    resetUi();
    modal?.classList.remove("hidden");
  }

  function close() {
    submitSeq += 1;
    enrollController?.abort();
    modal?.classList.add("hidden");
    void stopRecording(true);
  }

  async function handleSubmit() {
    if (!pendingBlob || !speakerService || submitBtn.disabled) return;
    const speakerId = speakerNameInput.value.trim() || "owner";
    const currentSubmit = submitSeq + 1;
    submitSeq = currentSubmit;
    enrollController?.abort();
    enrollController = new AbortController();

    submitBtn.disabled = true;
    submitBtn.textContent = "注册中...";
    cancelBtn.disabled = false;
    statusEl.textContent = "";

    try {
      await speakerService.enroll({
        blob: pendingBlob,
        filename: `voiceprint-${Date.now()}.pcm`,
        speakerId,
        requestId: makeId("speaker"),
        signal: enrollController.signal,
      });
      if (currentSubmit !== submitSeq) return;
      statusEl.textContent = `✓ 声纹注册成功（角色: ${speakerId}）`;
      statusEl.className = "text-xs text-center text-green-600 font-medium";
      confirmSection.classList.add("hidden");
      setTimeout(close, 1200);
    } catch (err) {
      if (currentSubmit !== submitSeq || err?.name === "AbortError") return;
      statusEl.textContent = `注册失败：${err.message}`;
      statusEl.className = "text-xs text-center text-red-500";
      resetSubmitState();
    }
  }

  function handleCancel() {
    submitSeq += 1;
    enrollController?.abort();
    enrollController = null;
    resetUi();
  }

  recordBtn?.addEventListener("click", () => {
    if (recording) void stopRecording();
    else void startRecording();
  });
  submitBtn?.addEventListener("click", handleSubmit);
  cancelBtn?.addEventListener("click", handleCancel);
  closeBtn?.addEventListener("click", close);
  modal?.addEventListener("click", (event) => {
    if (event.target === modal) close();
  });

  return { open, close };
}
