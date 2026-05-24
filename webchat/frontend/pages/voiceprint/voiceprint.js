// Voiceprint Collection Module
// 声纹采集功能的独立模块

export function initVoiceprintModule(state, dom) {
  // 初始化声纹采集模块
  // state: 应用状态对象
  // dom: DOM 元素引用对象
  
  function openVoiceprintModal() {
    if (!dom.voiceprintModalEl) return;
    state.voiceprintCurrentStep = 0;
    state.voiceprintSegments = [];
    dom.voiceprintModalEl.classList.remove("hidden");
    initVoiceprintStep();
  }

  function closeVoiceprintModal() {
    if (!dom.voiceprintModalEl) return;
    dom.voiceprintModalEl.classList.add("hidden");
    stopVoiceprintRecording();
    if (state.voiceprintRecordingTimer) {
      clearInterval(state.voiceprintRecordingTimer);
      state.voiceprintRecordingTimer = null;
    }
  }

  function initVoiceprintStep() {
    const step = state.voiceprintCurrentStep;
    const totalSteps = state.voiceprintPhrases.length;
    
    if (step >= totalSteps) {
      showVoiceprintCollectionComplete();
      return;
    }

    const progressPercent = ((step + 1) / totalSteps) * 100;
    dom.voiceprintProgressFillEl.style.width = progressPercent + "%";
    dom.voiceprintProgressTextEl.textContent = `第 ${step + 1} 步，共 ${totalSteps} 步`;
    dom.voiceprintPhraseEl.textContent = state.voiceprintPhrases[step];
    dom.voiceprintPromptEl.textContent = "请阅读以下短语";
    dom.voiceprintHintEl.textContent = "清晰地读出上面的短语";
    
    resetVoiceprintStepUI();
    dom.voiceprintReviewContainerEl.classList.add("hidden");
    dom.voiceprintCollectionCompleteEl.classList.add("hidden");
  }

  function resetVoiceprintStepUI() {
    dom.voiceprintRecordBtnEl.classList.remove("recording");
    dom.voiceprintStatusEl.textContent = "准备就绪";
    dom.voiceprintTimerEl.textContent = "00:00";
    state.voiceprintMediaChunks = [];
    state.voiceprintRecording = false;
    state.voiceprintRecordingTime = 0;
  }

  async function ensureAudioStream() {
    if (state.stream && state.stream.active) {
      return true;
    }
    
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: state.selectedDeviceId ? { exact: state.selectedDeviceId } : undefined,
          channelCount: 1,
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
      });
      if (state.startLevelMonitor) {
        state.startLevelMonitor(state.stream);
      }
      return true;
    } catch (err) {
      console.error("麦克风权限请求失败:", err);
      if (err.name === "NotAllowedError") {
        throw new Error("未获得麦克风权限，请在浏览器设置中允许访问");
      } else if (err.name === "NotFoundError") {
        throw new Error("未找到麦克风设备");
      } else {
        throw new Error("无法访问麦克风：" + err.message);
      }
    }
  }

  async function startVoiceprintRecording() {
    try {
      await ensureAudioStream();
      
      state.voiceprintMediaChunks = [];
      state.voiceprintRecording = true;
      state.voiceprintRecordingTime = 0;
      state.voiceprintStartTime = Date.now();
      
      state.voiceprintMediaRecorder = new MediaRecorder(state.stream, { 
        mimeType: "audio/webm;codecs=opus" 
      });
      
      state.voiceprintMediaRecorder.ondataavailable = (event) => {
        state.voiceprintMediaChunks.push(event.data);
      };
      
      state.voiceprintMediaRecorder.start();
      dom.voiceprintRecordBtnEl.classList.add("recording");
      dom.voiceprintStatusEl.textContent = "录音中...";
      
      startVoiceprintTimer();
      
    } catch (err) {
      console.error("声纹录音启动失败:", err);
      dom.voiceprintStatusEl.textContent = "启动失败";
      state.voiceprintRecording = false;
      
      if (err.message.includes("未获得麦克风权限")) {
        dom.voiceprintHintEl.textContent = "⚠️ " + err.message;
      } else {
        dom.voiceprintHintEl.textContent = "⚠️ " + err.message;
      }
    }
  }

  function startVoiceprintTimer() {
    if (state.voiceprintRecordingTimer) {
      clearInterval(state.voiceprintRecordingTimer);
    }
    
    state.voiceprintRecordingTimer = setInterval(() => {
      state.voiceprintRecordingTime++;
      const minutes = Math.floor(state.voiceprintRecordingTime / 60);
      const seconds = state.voiceprintRecordingTime % 60;
      dom.voiceprintTimerEl.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
      
      if (state.voiceprintRecordingTime > 30) {
        stopVoiceprintRecording();
      }
    }, 1000);
  }

  function stopVoiceprintRecording() {
    if (!state.voiceprintRecording || !state.voiceprintMediaRecorder) return;
    
    state.voiceprintRecording = false;
    
    if (state.voiceprintRecordingTimer) {
      clearInterval(state.voiceprintRecordingTimer);
      state.voiceprintRecordingTimer = null;
    }
    
    if (dom.voiceprintRecordBtnEl) {
      dom.voiceprintRecordBtnEl.classList.remove("recording");
    }
    
    state.voiceprintMediaRecorder.onstop = () => {
      const blob = new Blob(state.voiceprintMediaChunks, { type: "audio/webm" });
      dom.voiceprintReviewAudioEl.src = URL.createObjectURL(blob);
      dom.voiceprintReviewContainerEl.classList.remove("hidden");
      dom.voiceprintStatusEl.textContent = "录音完成";
      state.voiceprintCurrentSegmentBlob = blob;
    };
    
    state.voiceprintMediaRecorder.stop();
  }

  function toggleVoiceprintRecording() {
    if (state.voiceprintRecording) {
      stopVoiceprintRecording();
    } else {
      startVoiceprintRecording();
    }
  }

  function confirmVoiceprintSegment() {
    if (!state.voiceprintCurrentSegmentBlob) return;
    
    state.voiceprintSegments.push({
      step: state.voiceprintCurrentStep,
      phrase: state.voiceprintPhrases[state.voiceprintCurrentStep],
      blob: state.voiceprintCurrentSegmentBlob,
      recordingTime: state.voiceprintRecordingTime
    });
    
    state.voiceprintCurrentStep++;
    state.voiceprintCurrentSegmentBlob = null;
    
    if (state.voiceprintCurrentStep < state.voiceprintPhrases.length) {
      initVoiceprintStep();
    } else {
      showVoiceprintCollectionComplete();
    }
  }

  function retryVoiceprintSegment() {
    resetVoiceprintStepUI();
    dom.voiceprintReviewContainerEl.classList.add("hidden");
    state.voiceprintCurrentSegmentBlob = null;
  }

  function showVoiceprintCollectionComplete() {
    dom.voiceprintRecordBtnEl.classList.remove("recording");
    dom.voiceprintReviewContainerEl.classList.add("hidden");
    dom.voiceprintCollectionCompleteEl.classList.remove("hidden");
    dom.voiceprintCompleteDetailEl.textContent = `已采集 ${state.voiceprintSegments.length} 段语音`;
  }

  async function finalizeVoiceprintCollection() {
    try {
      dom.voiceprintStatusEl.textContent = "处理中...";
      dom.voiceprintFinalConfirmBtnEl.disabled = true;
      
      const wavBlob = await combineSegmentsToWav(state.voiceprintSegments);
      await submitVoiceprintToBackend(wavBlob, state.voiceprintSegments);
      
      dom.voiceprintStatusEl.textContent = "采集成功！";
      setTimeout(() => {
        closeVoiceprintModal();
        if (state.statusEl) state.statusEl.textContent = "声纹采集完成";
      }, 1500);
      
    } catch (err) {
      console.error("声纹采集失败:", err);
      dom.voiceprintStatusEl.textContent = "采集失败：" + err.message;
    } finally {
      dom.voiceprintFinalConfirmBtnEl.disabled = false;
    }
  }

  async function combineSegmentsToWav(segments) {
    console.log("正在合并 WebM 段落为 WAV:", segments.length, "段");
    
    const allData = [];
    for (const seg of segments) {
      const buffer = await seg.blob.arrayBuffer();
      allData.push(new Uint8Array(buffer));
    }
    
    return new Blob(allData, { type: "audio/wav" });
  }

  async function submitVoiceprintToBackend(wavBlob, segments) {
    const formData = new FormData();
    formData.append("voiceprint_wav", wavBlob, "voiceprint.wav");
    formData.append("segments_count", segments.length);
    formData.append("phrases", JSON.stringify(segments.map(s => s.phrase)));
    formData.append("recording_times", JSON.stringify(segments.map(s => s.recordingTime)));
    
    console.log("[待实现] POST /api/voiceprint/enroll");
    console.log("请求体:", {
      voiceprint_wav: `Blob(${wavBlob.size} bytes)`,
      segments_count: segments.length,
      phrases: segments.map(s => s.phrase),
      recording_times: segments.map(s => s.recordingTime)
    });
    
    // TODO: 实现真实的 API 调用
    // const response = await apiClient.post("/api/voiceprint/enroll", formData);
    // return response;
  }

  function restartVoiceprintCollection() {
    state.voiceprintCurrentStep = 0;
    state.voiceprintSegments = [];
    openVoiceprintModal();
  }

  // 绑定事件监听器
  function setupEventListeners() {
    if (dom.voiceprintBtn) {
      dom.voiceprintBtn.addEventListener("click", () => openVoiceprintModal());
    }
    if (dom.voiceprintCloseBtnEl) {
      dom.voiceprintCloseBtnEl.addEventListener("click", () => closeVoiceprintModal());
    }
    if (dom.voiceprintRecordBtnEl) {
      dom.voiceprintRecordBtnEl.addEventListener("click", () => toggleVoiceprintRecording());
    }
    if (dom.voiceprintSegmentConfirmBtnEl) {
      dom.voiceprintSegmentConfirmBtnEl.addEventListener("click", () => confirmVoiceprintSegment());
    }
    if (dom.voiceprintSegmentRetryBtnEl) {
      dom.voiceprintSegmentRetryBtnEl.addEventListener("click", () => retryVoiceprintSegment());
    }
    if (dom.voiceprintFinalConfirmBtnEl) {
      dom.voiceprintFinalConfirmBtnEl.addEventListener("click", () => finalizeVoiceprintCollection());
    }
    if (dom.voiceprintStartOverBtnEl) {
      dom.voiceprintStartOverBtnEl.addEventListener("click", () => restartVoiceprintCollection());
    }
    if (dom.voiceprintModalEl) {
      dom.voiceprintModalEl.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.dataset.closeVoiceprint === "1") {
          closeVoiceprintModal();
        }
      });
    }
  }

  // 返回公开接口
  return {
    open: openVoiceprintModal,
    close: closeVoiceprintModal,
    setupEventListeners,
  };
}
