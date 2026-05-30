import { makeId } from "../../core/ids.js";
import { normalizeWakeText, wakeLanguageCode, wakeChunkMs, base64Utf8 } from "./wake-utils.js";
import { encodeWavBlobFromFloat32 } from "./audio-codec.js";

const WAKE_REARM_MS = 2500;

/**
 * @param {object} opts
 * @param {object} opts.wakeService - from services.wake
 * @param {object} opts.context - appContext
 * @param {Function} opts.onWakeMatched - callback when wake word is detected
 */
export function initWakeListener({ wakeService, context, onWakeMatched } = {}) {
  let wakeEnabled = false;
  let wakeListening = false;
  let wakePending = false;
  let wakeLastTriggerAt = 0;
  let wakeStream = null;
  let wakeProcessor = null;
  let wakeSilentGain = null;
  let wakeAudioCtx = null;
  let wakeAnalyser = null;
  let wakeChunkBuffers = [];
  let wakeChunkSamplesTarget = 0;
  let wakeFlushTimer = null;

  function getWakePhrase() {
    return context?.settings?.wakePhrase || "你好";
  }

  function startWakeListener() {
    if (wakeListening || !wakeEnabled) return;
    if (!navigator.mediaDevices?.getUserMedia) return;

    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      .then((stream) => {
        wakeStream = stream;
        wakeAudioCtx = new AudioContext();
        const source = wakeAudioCtx.createMediaStreamSource(stream);
        wakeAnalyser = wakeAudioCtx.createAnalyser();
        wakeAnalyser.fftSize = 2048;
        source.connect(wakeAnalyser);

        // Silent gain to prevent feedback
        wakeSilentGain = wakeAudioCtx.createGain();
        wakeSilentGain.gain.value = 0;
        wakeSilentGain.connect(wakeAudioCtx.destination);

        wakeProcessor = wakeAudioCtx.createScriptProcessor(4096, 1, 1);
        wakeProcessor.onaudioprocess = (event) => {
          if (!wakeEnabled || wakePending) return;
          const input = event.inputBuffer.getChannelData(0);
          if (input) wakeChunkBuffers.push(new Float32Array(input));
        };
        source.connect(wakeProcessor);
        wakeProcessor.connect(wakeSilentGain);

        const phrase = getWakePhrase();
        const chunkMs = wakeChunkMs(phrase);
        wakeChunkSamplesTarget = Math.floor((wakeAudioCtx.sampleRate * chunkMs) / 1000);
        wakeListening = true;

        // Periodic flush check
        wakeFlushTimer = setInterval(flushWakeChunkIfReady, 500);
      })
      .catch((err) => {
        console.warn("唤醒词监听启动失败:", err);
      });
  }

  function stopWakeListener() {
    wakeEnabled = false;
    wakeListening = false;
    clearInterval(wakeFlushTimer);
    wakeFlushTimer = null;
    if (wakeProcessor) {
      wakeProcessor.disconnect();
      wakeProcessor = null;
    }
    if (wakeSilentGain) {
      wakeSilentGain.disconnect();
      wakeSilentGain = null;
    }
    if (wakeStream) {
      wakeStream.getTracks().forEach((t) => t.stop());
      wakeStream = null;
    }
    if (wakeAudioCtx && wakeAudioCtx.state !== "closed") {
      wakeAudioCtx.close().catch(() => {});
      wakeAudioCtx = null;
    }
    wakeAnalyser = null;
    wakeChunkBuffers = [];
  }

  function flushWakeChunkIfReady() {
    if (wakePending || !wakeListening) return;
    const totalSamples = wakeChunkBuffers.reduce((sum, buf) => sum + buf.length, 0);
    if (totalSamples < wakeChunkSamplesTarget) return;

    // Take enough samples
    const samples = new Float32Array(wakeChunkSamplesTarget);
    let offset = 0;
    while (offset < wakeChunkSamplesTarget && wakeChunkBuffers.length) {
      const buf = wakeChunkBuffers.shift();
      const remaining = wakeChunkSamplesTarget - offset;
      const take = Math.min(buf.length, remaining);
      samples.set(buf.subarray(0, take), offset);
      offset += take;
      if (buf.length > take) wakeChunkBuffers.unshift(buf.subarray(take));
    }

    const sampleRate = wakeAudioCtx?.sampleRate || 16000;
    const wavBlob = encodeWavBlobFromFloat32(samples, sampleRate);
    checkWakeWord(wavBlob);
  }

  async function checkWakeWord(blob) {
    if (!wakeService || !context) return;
    wakePending = true;
    try {
      const phrase = getWakePhrase();
      const language = wakeLanguageCode(phrase);
      const requestId = makeId("wake");
      const data = await wakeService.checkWake({
        blob,
        filename: `wake-${Date.now()}.wav`,
        wakePhrase: phrase,
        language,
        requestId,
      });

      // Frontend double-check: verify text contains wake phrase
      const wakeText = normalizeWakeText(data?.text || "");
      const wakeTarget = normalizeWakeText(phrase);
      const wakeMatched = wakeText.includes(wakeTarget) || !!data?.wake_matched;
      const speakerMatched = data?.speaker_matched !== false; // default true if speaker not enabled
      const matched = wakeMatched && speakerMatched;

      if (matched) {
        const now = Date.now();
        if (now - wakeLastTriggerAt > WAKE_REARM_MS) {
          wakeLastTriggerAt = now;
          stopWakeListener();
          onWakeMatched?.({ text: data?.text, requestId });
        }
      }
    } catch (err) {
      console.warn("唤醒词检测失败:", err);
    } finally {
      wakePending = false;
    }
  }

  function enable() {
    wakeEnabled = true;
    startWakeListener();
  }

  function disable() {
    wakeEnabled = false;
    stopWakeListener();
  }

  function scheduleResume(delay = 2200) {
    setTimeout(() => {
      if (wakeEnabled && context?.token) startWakeListener();
    }, delay);
  }

  // Expose for external control
  return {
    enable,
    disable,
    start: startWakeListener,
    stop: stopWakeListener,
    scheduleResume,
    isEnabled: () => wakeEnabled,
    isListening: () => wakeListening,
  };
}
