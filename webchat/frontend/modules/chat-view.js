const DEFAULT_AUDIO_URL = "/api/default-audio";

export function createChatView({ messagesEl }) {
  let flowChecklistEl = null;

  function beginNewFlowChecklist() {
    // Drop the active pointer so the next update creates a fresh card.
    // Existing cards remain in the message history.
    flowChecklistEl = null;
  }

  function isHiddenAgentAck(role, content) {
    const text = String(content || "").trim();
    if (role !== "assistant") return false;
    return /^\[success\]\s*agent-claw\s*收到/i.test(text);
  }

  function ensureFlowChecklistEl() {
    if (flowChecklistEl && flowChecklistEl.isConnected) return flowChecklistEl;
    const div = document.createElement("div");
    div.className = "msg assistant msg--flow-checklist msg--assistant-avatar";
    div.innerHTML = [
      '<div class="msg__flow-title">执行清单</div>',
      '<div class="msg__flow-subtitle">按固定流程逐步完成</div>',
      '<div class="msg__flow-list"></div>',
    ].join("");
    messagesEl.appendChild(div);
    flowChecklistEl = div;
    return div;
  }

  function clearFlowChecklist() {
    if (flowChecklistEl && flowChecklistEl.isConnected) flowChecklistEl.remove();
    flowChecklistEl = null;
  }

  function updateFlowChecklist({ title, subtitle, steps = [] } = {}) {
    const boxEl = ensureFlowChecklistEl();
    const titleEl = boxEl.querySelector(".msg__flow-title");
    const subtitleEl = boxEl.querySelector(".msg__flow-subtitle");
    const listEl = boxEl.querySelector(".msg__flow-list");
    if (!listEl) return;

    if (titleEl) titleEl.textContent = title || "执行清单";
    if (subtitleEl) subtitleEl.textContent = subtitle || "按固定流程逐步完成";

    const validKeys = new Set();
    for (let i = 0; i < steps.length; i += 1) {
      const item = steps[i] || {};
      const key = String(item.key || i);
      validKeys.add(key);
      let itemEl = listEl.querySelector(`.msg__flow-item[data-key="${key}"]`);
      if (!itemEl) {
        itemEl = document.createElement("div");
        itemEl.className = "msg__flow-item";
        itemEl.dataset.key = key;

        const markEl = document.createElement("span");
        markEl.className = "msg__flow-mark";

        const textWrapEl = document.createElement("div");
        textWrapEl.className = "msg__flow-textwrap";

        const textEl = document.createElement("span");
        textEl.className = "msg__flow-text";
        textWrapEl.appendChild(textEl);

        const detailEl = document.createElement("span");
        detailEl.className = "msg__flow-detail";
        textWrapEl.appendChild(detailEl);

        itemEl.appendChild(markEl);
        itemEl.appendChild(textWrapEl);
        listEl.appendChild(itemEl);
      }

      itemEl.style.setProperty("--step-index", String(i));
      itemEl.dataset.status = item.status || "todo";

      const markEl = itemEl.querySelector(".msg__flow-mark");
      markEl.textContent = item.status === "done" ? "✓" : item.status === "active" ? "•" : item.status === "error" ? "!" : "";

      const textEl = itemEl.querySelector(".msg__flow-text");
      textEl.textContent = item.label || "步骤";

      const detailEl = itemEl.querySelector(".msg__flow-detail");
      detailEl.textContent = item.detail || "";
      detailEl.style.display = item.detail ? "" : "none";
    }

    const oldItems = listEl.querySelectorAll(".msg__flow-item");
    for (const old of oldItems) {
      if (!validKeys.has(old.dataset.key || "")) old.remove();
    }
  }

  function appendHistoricalFlowChecklist() {
    const div = document.createElement("div");
    div.className = "msg assistant msg--flow-checklist msg--assistant-avatar msg--flow-checklist-history";
    div.innerHTML = [
      '<div class="msg__flow-title">本轮执行清单</div>',
      '<div class="msg__flow-subtitle">历史流程已完成</div>',
      '<div class="msg__flow-list"></div>',
    ].join("");
    const listEl = div.querySelector(".msg__flow-list");
    const steps = [
      ["wake", "声纹检测与唤醒词检测", "已完成 - 检测通过。已识别声纹角色：【张三】"],
      ["claw", "Agent 执行", "已完成"],
      ["tts", "TTS 生成语音", "已完成"],
      ["audio", "语音生成完成", "已完成"],
    ];
    for (let i = 0; i < steps.length; i += 1) {
      const [key, label, detail] = steps[i];
      const itemEl = document.createElement("div");
      itemEl.className = "msg__flow-item";
      itemEl.dataset.key = key;
      itemEl.dataset.status = "done";
      itemEl.style.setProperty("--step-index", String(i));

      const markEl = document.createElement("span");
      markEl.className = "msg__flow-mark";
      markEl.textContent = "✓";

      const textWrapEl = document.createElement("div");
      textWrapEl.className = "msg__flow-textwrap";
      const textEl = document.createElement("span");
      textEl.className = "msg__flow-text";
      textEl.textContent = label;
      const detailEl = document.createElement("span");
      detailEl.className = "msg__flow-detail";
      detailEl.textContent = detail;

      textWrapEl.append(textEl, detailEl);
      itemEl.append(markEl, textWrapEl);
      listEl.appendChild(itemEl);
    }
    messagesEl.appendChild(div);
    return div;
  }

  function parseChecklistSteps(content) {
    const text = String(content || "").trim();
    if (!text) return null;

    const lines = text
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length < 2) return null;

    const listLikeCount = lines.filter((line) => /^([-*•]|\d+[.)])\s+/.test(line)).length;
    const looksLikeList = listLikeCount >= Math.ceil(lines.length / 2);
    if (!looksLikeList) return null;

    const steps = lines
      .map((line) => line.replace(/^([-*•]|\d+[.)])\s+/, "").trim())
      .filter(Boolean);

    return steps.length >= 2 ? steps : null;
  }

  function appendAssistantChecklist(div, content) {
    const steps = parseChecklistSteps(content);
    if (!steps) return false;

    div.classList.add("msg--checklist");
    const listEl = document.createElement("div");
    listEl.className = "msg__checklist";

    for (let i = 0; i < steps.length; i += 1) {
      const itemEl = document.createElement("div");
      itemEl.className = "msg__checkitem";
      itemEl.style.setProperty("--step-index", String(i));

      const markEl = document.createElement("span");
      markEl.className = "msg__checkmark";
      markEl.textContent = "✓";

      const textEl = document.createElement("span");
      textEl.className = "msg__checktext";
      textEl.textContent = steps[i];

      itemEl.appendChild(markEl);
      itemEl.appendChild(textEl);
      listEl.appendChild(itemEl);
    }

    div.appendChild(listEl);
    return true;
  }

  function citationSource(item) {
    return item.source || item.filename || item.relative_path || item.path || "未知来源";
  }

  function citationMeta(item) {
    const parts = [];
    if (item.page !== null && item.page !== undefined) parts.push(`page ${item.page}`);
    if (item.sheet_name) parts.push(`sheet ${item.sheet_name}`);
    if (item.row_start !== null && item.row_start !== undefined) parts.push(`row ${item.row_start}`);
    if (item.chunk_type) parts.push(item.chunk_type);
    if (typeof item.score === "number") parts.push(`score ${item.score.toFixed(3)}`);
    return parts.join(" / ");
  }

  function appendCitationsLegacy(div, citations = []) {
    const items = Array.isArray(citations) ? citations.filter(Boolean).slice(0, 5) : [];
    if (!items.length) return;

    const box = document.createElement("div");
    box.className = "msg__citations";

    const titleEl = document.createElement("div");
    titleEl.className = "msg__citations-title";
    titleEl.textContent = "引用语料";

    const listEl = document.createElement("ol");
    listEl.className = "msg__citations-list";

    for (const item of items) {
      const li = document.createElement("li");
      li.className = "msg__citation";

      const sourceEl = document.createElement("div");
      sourceEl.className = "msg__citation-source";
      sourceEl.textContent = citationSource(item);
      li.appendChild(sourceEl);

      const meta = citationMeta(item);
      if (meta) {
        const metaEl = document.createElement("div");
        metaEl.className = "msg__citation-meta";
        metaEl.textContent = meta;
        li.appendChild(metaEl);
      }

      listEl.appendChild(li);
    }

    box.append(titleEl, listEl);
    div.appendChild(box);
  }

  function citationPreviewCardText(item) {
    const text = String(item.text || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > 90 ? `${text.slice(0, 89).trim()}...` : text;
  }

  function citationDetailMeta(item) {
    const parts = [];
    if (item.page !== null && item.page !== undefined) parts.push(`page ${item.page}`);
    if (item.sheet_name) parts.push(`sheet ${item.sheet_name}`);
    if (item.row_start !== null && item.row_start !== undefined) parts.push(`row ${item.row_start}`);
    if (item.chunk_type) parts.push(item.chunk_type);
    if (item.chunk_chars !== null && item.chunk_chars !== undefined) parts.push(`${item.chunk_chars} chars`);
    return parts.join(" / ");
  }

  function citationScoreRows(item) {
    const rows = [];
    if (typeof item.score === "number") rows.push(["score", item.score.toFixed(4)]);
    if (typeof item.vector_score === "number") rows.push(["vector_score", item.vector_score.toFixed(4)]);
    if (typeof item.keyword_score === "number") rows.push(["keyword_score", item.keyword_score.toFixed(4)]);
    if (item.chunk_index !== null && item.chunk_index !== undefined) rows.push(["chunk_index", String(item.chunk_index)]);
    if (item.knowledge_unit_id) rows.push(["knowledge_unit_id", String(item.knowledge_unit_id)]);
    return rows;
  }

  function appendCitations(div, citations = []) {
    const items = Array.isArray(citations) ? citations.filter(Boolean).slice(0, 5) : [];
    if (!items.length) return;

    const box = document.createElement("div");
    box.className = "msg__citations";

    const titleEl = document.createElement("div");
    titleEl.className = "msg__citations-title";
    titleEl.textContent = "引用语料";

    const listEl = document.createElement("div");
    listEl.className = "msg__citations-list";

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const li = document.createElement("div");
      li.className = "msg__citation";

      const rowBtn = document.createElement("button");
      rowBtn.type = "button";
      rowBtn.className = "msg__citation-row";

      const indexEl = document.createElement("span");
      indexEl.className = "msg__citation-index";
      indexEl.textContent = String(i + 1);
      rowBtn.appendChild(indexEl);

      const sourceEl = document.createElement("div");
      sourceEl.className = "msg__citation-source";
      sourceEl.textContent = citationSource(item);
      rowBtn.appendChild(sourceEl);

      const preview = citationPreviewCardText(item);
      if (preview) {
        const previewEl = document.createElement("div");
        previewEl.className = "msg__citation-preview";
        previewEl.textContent = preview;
        rowBtn.appendChild(previewEl);
      }

      const arrowEl = document.createElement("span");
      arrowEl.className = "msg__citation-arrow";
      arrowEl.textContent = ">";
      rowBtn.appendChild(arrowEl);

      const detailEl = document.createElement("div");
      detailEl.className = "msg__citation-detail hidden";

      const meta = citationDetailMeta(item);
      if (meta) {
        const metaEl = document.createElement("div");
        metaEl.className = "msg__citation-meta";
        metaEl.textContent = meta;
        detailEl.appendChild(metaEl);
      }

      const scoreRows = citationScoreRows(item);
      if (scoreRows.length) {
        const scoreGridEl = document.createElement("div");
        scoreGridEl.className = "msg__citation-score-grid";
        for (const [label, value] of scoreRows) {
          const labelEl = document.createElement("span");
          labelEl.textContent = label;
          const valueEl = document.createElement("strong");
          valueEl.textContent = value;
          scoreGridEl.append(labelEl, valueEl);
        }
        detailEl.appendChild(scoreGridEl);
      }

      const textEl = document.createElement("div");
      textEl.className = "msg__citation-text";
      textEl.textContent = String(item.text || "暂无语料文本");
      detailEl.appendChild(textEl);

      rowBtn.addEventListener("click", () => {
        const wasOpen = !detailEl.classList.contains("hidden");
        for (const opened of listEl.querySelectorAll(".msg__citation-detail:not(.hidden)")) {
          opened.classList.add("hidden");
        }
        for (const openedRow of listEl.querySelectorAll(".msg__citation-row.is-open")) {
          openedRow.classList.remove("is-open");
        }
        if (!wasOpen) {
          detailEl.classList.remove("hidden");
          rowBtn.classList.add("is-open");
        }
      });

      li.append(rowBtn, detailEl);
      listEl.appendChild(li);
    }

    box.append(titleEl, listEl);
    div.appendChild(box);
  }

  function addMessage(role, content, audioUrl = null, options = {}) {
    if (isHiddenAgentAck(role, content)) return;
    const div = document.createElement("div");
    div.className = `msg ${role}`;

    if (audioUrl) {
      div.classList.add("msg--audio");
      const transcriptText = options.transcriptText || content;
      const showTextInline = content && !options.transcriptText;
      if (!showTextInline) div.classList.add("msg--audio-only");
      if (showTextInline) {
        const textEl = document.createElement("p");
        textEl.textContent = content;
        div.appendChild(textEl);
      }
      const audioEl = document.createElement("audio");
      audioEl.controls = true;
      audioEl.style.width = "100%";
      audioEl.style.marginTop = content ? "8px" : "0";
      const sourceEl = document.createElement("source");
      sourceEl.src = audioUrl || DEFAULT_AUDIO_URL;
      sourceEl.type = "audio/mpeg";
      audioEl.appendChild(sourceEl);
      div.appendChild(audioEl);
      if (transcriptText && options.transcriptText) {
        const detailEl = document.createElement("details");
        detailEl.className = "msg__audio-text";
        const summaryEl = document.createElement("summary");
        summaryEl.textContent = options.transcriptLabel || "查看识别文本";
        const textEl = document.createElement("div");
        textEl.className = "msg__audio-text-body";
        textEl.textContent = transcriptText;
        detailEl.append(summaryEl, textEl);
        div.appendChild(detailEl);
      }
    } else {
      const renderedChecklist = role === "assistant" && appendAssistantChecklist(div, content);
      if (!renderedChecklist) div.textContent = content;
    }

    if (role === "assistant") {
      div.classList.add("msg--assistant-avatar");
      if (options.thinking) div.classList.add("msg--thinking");
      appendCitations(div, options.citations);
    }

    messagesEl.appendChild(div);
    const behavior = options.scrollBehavior || "auto";
    if (behavior !== "none") {
      div.scrollIntoView({ behavior, block: "end" });
    }
    return div;
  }

  function renderMessages(items, options = {}) {
    messagesEl.innerHTML = "";
    flowChecklistEl = null;
    const voiceRecords = Array.isArray(options.voiceRecords) ? [...options.voiceRecords] : [];
    if (!items.length) {
      addMessage("system", "新会话已就绪。可以直接发文本，或录音/上传音频。\n\n录音不会在浏览器里识别，而是上传到服务器后转写。");
      return;
    }
    let previousRole = "";
    for (const item of items) {
      const role = item.role || "system";
      if (role === "assistant" && previousRole === "user" && !isHiddenAgentAck(role, item.content)) {
        appendHistoricalFlowChecklist();
      }
      if (role === "user") {
        const content = item.content || "";
        const index = voiceRecords.findIndex((record) => {
          const text = String(record.userText || record.transcript || "").trim();
          return record.userAudioUrl && text && text === String(content).trim();
        });
        if (index >= 0) {
          const record = voiceRecords.splice(index, 1)[0];
          addMessage(role, "", record.userAudioUrl, {
            transcriptText: content,
            transcriptLabel: "查看识别文本",
          });
        } else {
          addMessage(role, content);
        }
      } else if (role === "assistant") {
        const content = item.content || "";
        const index = voiceRecords.findIndex((record) => {
          const text = String(record.assistantReply || "").trim();
          return text && text === String(content).trim();
        });
        if (index >= 0) {
          const record = voiceRecords.splice(index, 1)[0];
          addMessage(role, "", record.ttsAudioUrl || DEFAULT_AUDIO_URL, {
            transcriptText: content,
            transcriptLabel: "查看回复文本",
          });
        } else if (previousRole === "user" && content) {
          addMessage(role, "", DEFAULT_AUDIO_URL, {
            transcriptText: content,
            transcriptLabel: "查看回复文本",
          });
        } else {
          addMessage(role, content);
        }
      } else {
        addMessage(role, item.content || "");
      }
      previousRole = role;
    }
  }

  return { addMessage, renderMessages, updateFlowChecklist, clearFlowChecklist, beginNewFlowChecklist };
}
