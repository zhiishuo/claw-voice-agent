export function renderPipelineView({
  state,
  elements,
  pipelineOrder,
  pipelineLabels,
  deriveRobotMode,
  getStepElapsedMs,
  fmtDuration,
  fmtTime,
  withTokenUrl,
  requestRender,
}) {
  const {
    robotCardEl,
    robotModeLabelEl,
    robotModeDetailEl,
    robotEyeLeftEl,
    robotEyeRightEl,
    robotMouthFillEl,
    pipelineStepsEl,
    robotUserBubbleEl,
    robotUserBubbleTextEl,
    robotAssistantBubbleEl,
    robotAssistantBubbleTextEl,
    processLogEl,
    captureProofEl,
    captureProofMetaEl,
    captureProofAudioEl,
    uploadProofEl,
    uploadProofMetaEl,
    uploadProofAudioEl,
    wakeProofEl,
    wakeProofMetaEl,
    ttsProofEl,
    ttsProofMetaEl,
    ttsProofAudioEl,
  } = elements;

  const robotMode = deriveRobotMode();
  robotCardEl.className = `robot-card robot-card--${robotMode.key}`;
  robotModeLabelEl.textContent = robotMode.label;
  robotModeDetailEl.textContent = robotMode.detail;
  const blink = robotMode.key === "idle" || robotMode.key === "thinking";
  robotEyeLeftEl.classList.toggle("robot-shell-figure__eye--blink", blink);
  robotEyeRightEl.classList.toggle("robot-shell-figure__eye--blink", blink);
  robotMouthFillEl.style.width = robotMode.key === "speaking"
    ? "72%"
    : robotMode.key === "listening"
      ? `${Math.max(18, Math.min(86, Math.round(state.inputLevel * 160)))}%`
      : robotMode.key === "thinking"
        ? "44%"
        : "26%";

  pipelineStepsEl.innerHTML = "";
  if (!state.pipelineExpanded) state.pipelineExpanded = {};
  for (const key of pipelineOrder) {
    const meta = state.stepState[key] || { status: "idle", detail: "等待" };
    const elapsedMs = getStepElapsedMs(key, meta.status);
    const timeText = meta.status === "active"
      ? `已耗时 ${fmtDuration(elapsedMs)}`
      : (meta.status === "done" || meta.status === "error") && elapsedMs > 0
        ? `耗时 ${fmtDuration(elapsedMs)}`
        : "";
    const wrapper = document.createElement("div");
    wrapper.className = `robot-flow__item ${meta.status}`;

    const dot = document.createElement("div");
    dot.className = "robot-flow__dot";

    const content = document.createElement("div");
    const labelRow = document.createElement("div");
    labelRow.className = "robot-flow__label-row";

    const label = document.createElement("div");
    label.className = "robot-flow__label";
    label.textContent = pipelineLabels[key];

    const actions = document.createElement("div");
    actions.className = "robot-flow__actions";

    if (timeText) {
      const eta = document.createElement("div");
      eta.className = "robot-flow__eta";
      eta.textContent = timeText;
      actions.appendChild(eta);
    }

    const hasDetail = !!(meta.detail || "");
    let expanded = !!state.pipelineExpanded[key];
    if (!hasDetail) expanded = false;
    if (hasDetail) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = `robot-flow__toggle ${expanded ? "expanded" : ""}`;
      toggle.setAttribute("aria-label", expanded ? "收起详情" : "展开详情");
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggle.textContent = expanded ? "▾" : "▸";
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.pipelineExpanded[key] = !state.pipelineExpanded[key];
        if (typeof requestRender === "function") requestRender();
      });
      actions.appendChild(toggle);
    }

    const detail = document.createElement("div");
    detail.className = `robot-flow__detail ${expanded ? "" : "robot-flow__detail--collapsed"}`.trim();
    detail.textContent = meta.detail || "";

    labelRow.appendChild(label);
    labelRow.appendChild(actions);
    content.appendChild(labelRow);
    content.appendChild(detail);
    wrapper.appendChild(dot);
    wrapper.appendChild(content);
    pipelineStepsEl.appendChild(wrapper);
  }

  if (state.pendingTranscript) {
    robotUserBubbleEl.classList.remove("hidden");
    robotUserBubbleTextEl.textContent = state.pendingTranscript;
  } else {
    robotUserBubbleEl.classList.add("hidden");
    robotUserBubbleTextEl.textContent = "";
  }

  if (state.lastAssistantReply) {
    robotAssistantBubbleEl.classList.remove("hidden");
    robotAssistantBubbleTextEl.textContent = state.lastAssistantReply;
  } else {
    robotAssistantBubbleEl.classList.add("hidden");
    robotAssistantBubbleTextEl.textContent = "";
  }

  processLogEl.innerHTML = "";
  for (const entry of state.processEntries) {
    const div = document.createElement("div");
    div.className = "process-log__item";
    div.innerHTML = `<div class=\"process-log__time\">${fmtTime(entry.ts)}</div><div class=\"process-log__label\">${entry.label}</div><div class=\"process-log__detail\">${entry.detail || ""}</div>`;
    processLogEl.appendChild(div);
  }

  if (state.localCapture && state.localCapture.url) {
    captureProofEl.classList.remove("hidden");
    captureProofMetaEl.textContent = `requestId=${state.localCapture.requestId}\nbytes=${state.localCapture.bytes}\nmimeType=${state.localCapture.mimeType}`;
    if (captureProofAudioEl.src !== state.localCapture.url) {
      captureProofAudioEl.src = state.localCapture.url;
      captureProofAudioEl.load();
    }
  } else {
    captureProofEl.classList.add("hidden");
    captureProofMetaEl.textContent = "";
    captureProofAudioEl.removeAttribute("src");
  }

  if (state.lastUpload && state.lastUpload.url) {
    uploadProofEl.classList.remove("hidden");
    uploadProofMetaEl.textContent = `clientId=${state.lastUpload.clientId || state.clientId}\nrequestId=${state.lastUpload.requestId || state.currentRequestId}\nsession=${state.lastUpload.session || state.session}\nuploadId=${state.lastUpload.id}\nfilename=${state.lastUpload.filename}\nbytes=${state.lastUpload.bytes}\nsha256=${state.lastUpload.sha256}`;
    const newUploadUrl = withTokenUrl(state.lastUpload.url);
    if (uploadProofAudioEl.src !== newUploadUrl) {
      uploadProofAudioEl.src = newUploadUrl;
      uploadProofAudioEl.load();
    }
  } else {
    uploadProofEl.classList.add("hidden");
    uploadProofMetaEl.textContent = "";
    uploadProofAudioEl.removeAttribute("src");
  }

  if (state.lastWakeProbe) {
    wakeProofEl.classList.remove("hidden");
    wakeProofMetaEl.textContent = `engine=${state.lastWakeProbe.engine || "unknown"}\nmatched=${state.lastWakeProbe.matched ? "yes" : "no"}\nphrase=${state.lastWakeProbe.wakePhrase || state.wakePhrase}\ntext=${state.lastWakeProbe.text || "[empty]"}\nrequestId=${state.lastWakeProbe.requestId || ""}\nbytes=${state.lastWakeProbe.bytes || ""}\nts=${state.lastWakeProbe.ts ? fmtTime(state.lastWakeProbe.ts) : ""}`;
  } else {
    wakeProofEl.classList.add("hidden");
    wakeProofMetaEl.textContent = "";
  }

  if (state.lastTts && state.lastTts.url) {
    ttsProofEl.classList.remove("hidden");
    ttsProofMetaEl.textContent = `requestId=${state.lastTts.requestId}\nvoice=${state.lastTts.voice}\nprovider=${state.lastTts.provider}\nbytes=${state.lastTts.bytes}\nfilename=${state.lastTts.filename}`;
    const newTtsUrl = withTokenUrl(state.lastTts.url);
    if (ttsProofAudioEl.src !== newTtsUrl) {
      ttsProofAudioEl.src = newTtsUrl;
      ttsProofAudioEl.load();
    }
  } else {
    ttsProofEl.classList.add("hidden");
    ttsProofMetaEl.textContent = "";
    ttsProofAudioEl.removeAttribute("src");
  }
}
