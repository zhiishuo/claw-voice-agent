import { $ } from "../../core/dom.js";
import { makeId } from "../../core/ids.js";
import { encodeWavBlobFromFloat32 } from "./audio-codec.js";
import { wakeLanguageCode, wakeChunkMs } from "./wake-utils.js";

const CARD_HTML = (wakePhrase) => `
<div id="wake-card" class="flex-1 flex flex-col items-center justify-center min-h-[60vh] px-4 message-anim">
  <div class="w-full max-w-lg bg-gradient-to-b from-blue-50/80 to-white border border-blue-100/60 rounded-2xl shadow-sm p-8 sm:p-10 flex flex-col items-center gap-5">
    <!-- 标题区 -->
    <div class="flex items-center gap-3">
      <span class="w-3.5 h-3.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.5)]"></span>
      <span class="text-lg sm:text-xl font-bold text-blue-700 tracking-wide">持续环境监听中...</span>
    </div>

    <!-- 说明文字 -->
    <div class="text-center text-sm sm:text-base text-gray-500 leading-relaxed">
      <p>新会话已就绪。正在监听环境语音...</p>
      <p class="mt-1.5">请说出 <span class="inline-block px-2.5 py-0.5 bg-blue-100 text-blue-700 font-bold rounded-md text-sm sm:text-base">${wakePhrase}</span> 唤醒系统，以完成首次声纹校验。</p>
    </div>

    <!-- 频谱条 -->
    <div id="wake-freq-container" class="flex items-center gap-[2px] h-8 sm:h-10 w-full justify-center px-4">
    </div>

    <!-- 识别文字 -->
    <div class="w-full text-center min-h-[28px]">
      <span id="wake-transcript-label" class="text-xs sm:text-sm text-gray-400">识别结果</span>
      <div id="wake-transcript-text" class="text-sm sm:text-base text-gray-700 font-medium mt-1.5 min-h-[24px]"></div>
    </div>

    <!-- 声纹角色信息 -->
    <div id="wake-speaker-info" class="hidden w-full text-center">
      <div class="inline-flex items-center gap-2 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg text-xs sm:text-sm text-green-700">
        <i class="fa-solid fa-user-check text-green-500"></i>
        <span id="wake-speaker-text"></span>
      </div>
    </div>

    <!-- 状态提示 -->
    <div id="wake-status" class="text-xs sm:text-sm text-gray-400"></div>

    <!-- 确认区 (唤醒成功后显示) -->
    <div id="wake-confirm" class="hidden w-full flex flex-col items-center gap-3">
      <!-- 语音回放 -->
      <div id="wake-audio-review" class="hidden w-full">
        <audio id="wake-audio-el" controls class="w-full rounded-lg" preload="auto"></audio>
      </div>
      <!-- 按钮组 -->
      <div class="flex items-center gap-3">
        <button id="wake-send-btn" class="px-5 py-2 text-sm sm:text-base font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-full transition-colors shadow-sm flex items-center gap-2">
          <i class="fa-solid fa-paper-plane text-xs"></i> 发送消息
        </button>
        <button id="wake-cancel-btn" class="px-5 py-2 text-sm sm:text-base font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-full transition-colors shadow-sm">
          取消
        </button>
      </div>
    </div>

    <!-- 模拟按钮 (Mock 模式) -->
    <button id="wake-simulate-btn" class="hidden items-center gap-2 px-5 py-2.5 text-sm sm:text-base font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-full transition-colors">
      <i class="fa-solid fa-bolt text-yellow-500"></i> 模拟说出唤醒词
    </button>
  </div>
</div>
`;

/**
 * @param {object} opts
 * @param {object} opts.wakeService - from services.wake
 * @param {object} opts.context - appContext
 * @param {Function} opts.getDeviceId - returns selected mic device ID
 * @param {Function} opts.onWakeSuccess - callback({ text, audioBlob }) when wake+voiceprint verified
 */
export function initWakeCard({ wakeService, context, getDeviceId, onWakeSuccess } = {}) {
  const chatContainer = $("chat-container");
  let isActive = false;
  let audioCtx = null;
  let analyser = null;
  let processor = null;
  let silentGain = null;
  let stream = null;
  let chunkBuffers = [];
  let chunkSamples = 0;
  let chunkSampleRate = 16000;
  let flushTimer = null;
  let pendingCheck = false;
  let animFrameId = null;
  let isMockMode = false;
  let mediaRecorder = null;
  let recordedChunks = [];
  let lastChunkBlob = null;
  let pendingText = "";
  let pendingAudioBlob = null;

  function setComposerDisabled(disabled) {
    const textarea = $("chat-input");
    const sendBtn = $("send-btn");
    const holdToTalkBtn = $("hold-to-talk-btn");
    const audioImportBtn = $("audio-import-btn");
    if (textarea) textarea.disabled = disabled;
    if (sendBtn) sendBtn.disabled = disabled;
    if (holdToTalkBtn) holdToTalkBtn.disabled = disabled;
    if (audioImportBtn) audioImportBtn.disabled = disabled;
    // 灰化整个输入栏
    const composerWrap = textarea?.closest(".bg-\\[\\#f4f4f4\\]");
    if (composerWrap) composerWrap.classList.toggle("opacity-40", disabled);
  }

  function show() {
    if (isActive) return;
    isActive = true;

    // 禁用输入区
    setComposerDisabled(true);

    // 隐藏空状态欢迎
    const welcome = $("empty-welcome");
    if (welcome) welcome.classList.add("hidden");

    // 插入卡片
    const wakePhrase = context?.settings?.wakePhrase || "你好";
    chatContainer.insertAdjacentHTML("beforeend", CARD_HTML(wakePhrase));
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" });

    // 初始化频谱条
    initFreqBars();

    // 绑定模拟按钮
    const simBtn = $("wake-simulate-btn");
    simBtn?.addEventListener("click", handleSimulate);

    // 绑定确认区按钮
    $("wake-send-btn")?.addEventListener("click", handleConfirmSend);
    $("wake-cancel-btn")?.addEventListener("click", handleConfirmCancel);

    // 启动麦克风
    startMic();
  }

  function hide() {
    if (!isActive) return;
    isActive = false;
    stopMic();
    const card = $("wake-card");
    if (card) card.remove();
    // 恢复输入区
    setComposerDisabled(false);
  }

  function initFreqBars() {
    const container = $("wake-freq-container");
    if (!container) return;
    for (let i = 0; i < 40; i += 1) {
      const bar = document.createElement("div");
      bar.className = "w-[2px] sm:w-[3px] bg-blue-400 rounded-full transition-all duration-75";
      bar.style.height = "4px";
      container.appendChild(bar);
    }
  }

  function startFreqAnimation() {
    const container = $("wake-freq-container");
    if (!container || !analyser) return;
    const bars = container.children;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const barCount = bars.length;
    function draw() {
      if (!isActive) return;
      analyser.getByteFrequencyData(dataArray);
      const step = Math.floor(dataArray.length / barCount);
      for (let i = 0; i < barCount; i += 1) {
        const idx = i * step;
        const val = dataArray[idx] / 255;
        const h = Math.max(4, val * 36);
        bars[i].style.height = `${h}px`;
      }
      animFrameId = requestAnimationFrame(draw);
    }
    animFrameId = requestAnimationFrame(draw);
  }

  function stopFreqAnimation() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = null;
    const container = $("wake-freq-container");
    if (!container) return;
    const bars = container.children;
    for (let i = 0; i < bars.length; i += 1) bars[i].style.height = "4px";
  }

  async function startMic() {
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
      console.error("唤醒卡片麦克风访问失败:", err);
      updateStatus("麦克风访问失败，请检查权限", "error");
      return;
    }

    audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);

    // AnalyserNode for spectrum
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    // ScriptProcessorNode for chunk collection
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;

    chunkBuffers = [];
    chunkSamples = 0;
    chunkSampleRate = audioCtx.sampleRate || 16000;

    processor.onaudioprocess = (event) => {
      if (!isActive) return;
      const input = event.inputBuffer.getChannelData(0);
      if (input) {
        chunkBuffers.push(new Float32Array(input));
        chunkSamples += input.length;
      }
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioCtx.destination);

    // MediaRecorder 录制完整音频（用于第一条消息的语音条）
    recordedChunks = [];
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
      .find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.start();

    startFreqAnimation();

    // 定期检查是否可以发送 chunk
    flushTimer = setInterval(flushChunkIfReady, 500);
  }

  function stopMic() {
    stopFreqAnimation();
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    mediaRecorder = null;
    if (processor) {
      processor.disconnect();
      processor = null;
    }
    if (silentGain) {
      silentGain.disconnect();
      silentGain = null;
    }
    if (audioCtx && audioCtx.state !== "closed") {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
    analyser = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    chunkBuffers = [];
    chunkSamples = 0;
    pendingCheck = false;
    lastChunkBlob = null;
  }

  function flushChunkIfReady() {
    if (pendingCheck || !isActive) return;
    const targetSamples = Math.floor(chunkSampleRate * (wakeChunkMs(context?.settings?.wakePhrase) / 1000));
    if (chunkSamples < targetSamples) return;

    pendingCheck = true;
    try {
      const samples = new Float32Array(targetSamples);
      let offset = 0;
      while (offset < targetSamples && chunkBuffers.length) {
        const buf = chunkBuffers.shift();
        const remaining = targetSamples - offset;
        const take = Math.min(buf.length, remaining);
        samples.set(buf.subarray(0, take), offset);
        offset += take;
        if (buf.length > take) chunkBuffers.unshift(buf.subarray(take));
      }
      chunkSamples = Math.max(0, chunkSamples - targetSamples);

      const wavBlob = encodeWavBlobFromFloat32(samples, chunkSampleRate);
      lastChunkBlob = wavBlob;
      checkWake(wavBlob);
    } catch (err) {
      console.error("唤醒chunk处理失败:", err);
      pendingCheck = false;
    }
  }

  async function checkWake(blob) {
    if (!wakeService || !isActive) {
      pendingCheck = false;
      return;
    }
    try {
      const wakePhrase = context?.settings?.wakePhrase || "你好";
      const language = wakeLanguageCode(wakePhrase);
      const requestId = makeId("wake");

      const data = await wakeService.checkWake({
        blob,
        filename: `wake-${Date.now()}.wav`,
        wakePhrase,
        language,
        requestId,
      });

      // 检测 mock 模式：仅显示模拟按钮，不自动通过
      if (data?.meta?.engine === "mock") {
        if (!isMockMode) {
          isMockMode = true;
          const simBtn = $("wake-simulate-btn");
          if (simBtn) {
            simBtn.classList.remove("hidden");
            simBtn.classList.add("flex");
          }
          updateStatus("Mock 模式：点击下方按钮模拟唤醒", "");
        }
        return; // mock 模式下不自动验证，等用户点按钮
      }

      // 显示识别文字
      const text = data?.text || "";
      const transcriptEl = $("wake-transcript-text");
      if (transcriptEl) transcriptEl.textContent = text;

      // 检查匹配结果（仅真实模式）
      const wakeMatched = !!data?.wake_matched;
      const speakerMatched = !!data?.speaker_matched;
      const matched = !!data?.matched;

      if (matched) {
        updateStatus("✅ 唤醒词 + 声纹验证通过", "success");
        showSpeakerInfo(data?.speaker_id, data?.speaker_score, true);
        showConfirm(text, lastChunkBlob);
      } else if (wakeMatched && !speakerMatched) {
        updateStatus("唤醒词已识别，声纹不匹配", "warn");
      } else if (!wakeMatched && speakerMatched) {
        updateStatus("声纹匹配，但未检测到唤醒词", "warn");
      }
    } catch (err) {
      console.error("唤醒检测失败:", err);
    } finally {
      pendingCheck = false;
    }
  }

  function handleSimulate() {
    if (!isActive) return;
    const wakePhrase = context?.settings?.wakePhrase || "你好";
    const transcriptEl = $("wake-transcript-text");
    if (transcriptEl) transcriptEl.textContent = wakePhrase;
    updateStatus("✅ 模拟唤醒成功", "success");
    showSpeakerInfo("mock-owner", 0.95, true);
    showConfirm(wakePhrase, lastChunkBlob);
  }

  function updateStatus(text, type = "") {
    const el = $("wake-status");
    if (!el) return;
    el.textContent = text;
    el.className = "text-xs sm:text-sm ";
    if (type === "error") el.className += "text-red-500";
    else if (type === "success") el.className += "text-green-600 font-medium";
    else if (type === "warn") el.className += "text-amber-500";
    else el.className += "text-gray-400";
  }

  function showSpeakerInfo(speakerId, score, matched) {
    const container = $("wake-speaker-info");
    const textEl = $("wake-speaker-text");
    if (!container || !textEl) return;
    const scoreText = score != null ? ` (得分: ${typeof score === "number" ? score.toFixed(2) : score})` : "";
    const statusText = matched ? "验证通过" : "未匹配";
    textEl.textContent = `声纹角色: ${speakerId || "未知"} — ${statusText}${scoreText}`;
    container.classList.remove("hidden");
  }

  function showConfirm(text, audioBlob) {
    pendingText = text;
    pendingAudioBlob = audioBlob;

    // 停止频谱和麦克风
    stopFreqAnimation();
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }

    // 更新标题
    const titleEl = document.querySelector("#wake-card .tracking-wide");
    if (titleEl) titleEl.textContent = "唤醒验证完成";

    // 隐藏频谱条
    const freqContainer = $("wake-freq-container");
    if (freqContainer) freqContainer.classList.add("hidden");

    // 显示音频回放
    if (audioBlob) {
      const audioReview = $("wake-audio-review");
      const audioEl = $("wake-audio-el");
      if (audioReview && audioEl) {
        audioEl.src = URL.createObjectURL(audioBlob);
        audioReview.classList.remove("hidden");
      }
    }

    // 显示确认区
    const confirmEl = $("wake-confirm");
    if (confirmEl) confirmEl.classList.remove("hidden");

    // 隐藏模拟按钮
    const simBtn = $("wake-simulate-btn");
    if (simBtn) simBtn.classList.add("hidden");
  }

  function handleConfirmSend() {
    hide();
    onWakeSuccess?.({ text: pendingText, audioBlob: pendingAudioBlob });
  }

  function handleConfirmCancel() {
    pendingText = "";
    pendingAudioBlob = null;
    hide();
  }

  return { show, hide, isActive: () => isActive };
}
