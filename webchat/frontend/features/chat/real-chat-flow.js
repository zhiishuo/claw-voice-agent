import { makeId } from "../../core/ids.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderCitationItems(citations = [], msgId) {
  const items = Array.isArray(citations) ? citations.filter(Boolean).slice(0, 5) : [];
  if (!items.length) return "";

  let tabsHtml = "";
  let panelsHtml = "";

  items.forEach((item, index) => {
    const id = index + 1;
    const source = escapeHtml(item.source || item.filename || item.relative_path || item.path || "未知来源");
    const text = escapeHtml(item.text || item.content || "");
    const score = typeof item.score === "number" ? item.score.toFixed(4) : "";
    const meta = escapeHtml(item.page ? `Page ${item.page}` : item.line ? `Line ${item.line}` : "");

    tabsHtml += `
      <div class="kb-tab-btn px-2.5 py-1.5 bg-white text-gray-500 border border-gray-200 hover:bg-gray-50 hover:text-gray-700 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer group" onclick="window.switchCitationTab(this, '${msgId}', ${id})">
        <span class="num-badge w-4 h-4 rounded bg-gray-100 text-gray-500 flex items-center justify-center text-[9px] font-bold transition-colors group-hover:bg-gray-200">${id}</span>
        <span class="truncate max-w-[140px]" title="${source}">${source}</span>
      </div>
    `;

    panelsHtml += `
      <div id="kb-panel-${msgId}-${id}" class="kb-panel-${msgId} hidden bg-[#f8f9fa] border border-gray-100 rounded-xl p-3.5 relative overflow-hidden transition-all duration-300">
        <div class="absolute left-0 top-0 bottom-0 w-[3px] bg-blue-400"></div>
        <div class="pl-1">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2 text-[10px] font-mono">
              <span class="bg-white px-2 py-0.5 rounded text-gray-500 shadow-sm border border-gray-100 flex items-center gap-1 truncate max-w-[300px]" title="${source}"><i class="fa-regular fa-file-lines text-gray-400"></i> ${source}</span>
              ${meta ? `<span class="bg-white px-2 py-0.5 rounded text-gray-500 shadow-sm border border-gray-100 flex items-center gap-1">${meta}</span>` : ""}
              ${score ? `<span class="text-gray-400">Score: <span class="text-blue-500 font-medium">${score}</span></span>` : ""}
            </div>
          </div>
          <div class="text-[13px] text-gray-600 leading-relaxed cursor-text select-text mt-1 text-justify">
            ${text || "暂无文本"}
          </div>
        </div>
      </div>
    `;
  });

  return `
    <div class="mt-2 w-full max-w-[95%]">
      <div class="flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 mb-2.5 pl-1 tracking-widest uppercase">
        <i class="fa-solid fa-quote-left text-blue-400 opacity-70"></i> 知识库溯源
      </div>
      <div class="flex flex-wrap gap-2 items-center mb-2.5" id="kb-tabs-container-${msgId}">
        ${tabsHtml}
      </div>
      <div id="kb-panels-container-${msgId}" class="relative">
        ${panelsHtml}
      </div>
    </div>
  `;
}

function appendAssistantShell(chatContainer, requestId) {
  const html = `
    <div class="flex items-start gap-4 message-anim mt-2" id="ai-msg-${requestId}">
      <div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex-shrink-0 flex items-center justify-center font-bold text-xs">ATC</div>
      <div class="flex-1 flex flex-col gap-2 min-w-0">

        <!-- 动态进度条面板 -->
        <div class="flex flex-col bg-[#f4f5f7] rounded-xl border border-gray-100 text-[13px] text-gray-500 shadow-sm w-fit transition-all duration-300 overflow-hidden" id="progress-box-${requestId}">
          <div class="hidden items-center justify-between gap-4 px-3 py-2 cursor-pointer hover:bg-gray-100 transition-colors" id="progress-toggle-${requestId}">
            <div class="flex items-center gap-1.5 text-xs text-gray-600 font-medium" id="progress-title-box-${requestId}">
              <i class="fa-solid fa-bolt text-green-500" id="progress-icon-${requestId}"></i> <span id="progress-title-${requestId}">处理完成</span>
            </div>
            <i class="fa-solid fa-chevron-down text-[10px] text-gray-400 transition-transform duration-200" id="progress-chevron-${requestId}"></i>
          </div>
          <div class="flex flex-col gap-2 p-3 transition-all duration-300" id="progress-steps-${requestId}">
            <div class="flex items-center gap-2 text-blue-600 font-medium transition-colors" id="step1-${requestId}">
              <i class="fa-solid fa-circle-notch fa-spin w-4 text-center"></i> <span>声纹与唤醒词检测</span>
            </div>
            <div class="flex items-center gap-2 text-gray-400 transition-colors" id="step2-${requestId}">
              <i class="fa-regular fa-circle w-4 text-center"></i> <span>Agent执行</span>
            </div>
            <div class="flex items-center gap-2 text-gray-400 transition-colors" id="step3-${requestId}">
              <i class="fa-regular fa-circle w-4 text-center"></i> <span>TTS语音生成</span>
            </div>
          </div>
        </div>

        <!-- 最终回复内容 -->
        <div class="hidden flex-col gap-2" id="final-reply-${requestId}">
          <div class="text-[15px] leading-relaxed p-1 text-gray-800" id="final-text-${requestId}"></div>
          <div id="kb-citations-${requestId}"></div>
          <div id="tts-audio-${requestId}"></div>
        </div>

        <!-- 推荐对话区 (初始隐藏，显示加载状态) -->
        <div class="hidden flex-col gap-2 mt-1" id="suggestion-area-${requestId}">
          <div class="flex items-center gap-2 text-[13px] text-blue-500 font-medium" id="sug-loading-${requestId}">
            <i class="fa-solid fa-circle-notch fa-spin w-4 text-center"></i> <span>推荐对话生成中...</span>
          </div>
          <div class="hidden flex-col gap-1.5" id="sug-list-${requestId}"></div>
        </div>

      </div>
    </div>
  `;
  chatContainer.insertAdjacentHTML("beforeend", html);
  const welcome = document.getElementById("empty-welcome");
  if (welcome) welcome.classList.add("hidden");
  chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" });
}

/** Update a step's visual state: 'active' | 'done' | 'error' */
function updateStep(requestId, stepNum, status) {
  const stepEl = document.getElementById(`step${stepNum}-${requestId}`);
  if (!stepEl) return;
  const icon = stepEl.querySelector("i");
  if (status === "active") {
    stepEl.className = "flex items-center gap-2 text-blue-600 font-medium transition-colors";
    icon.className = "fa-solid fa-circle-notch fa-spin w-4 text-center";
  } else if (status === "done") {
    stepEl.className = "flex items-center gap-2 text-green-600 transition-colors";
    icon.className = "fa-solid fa-check w-4 text-center";
  } else if (status === "error") {
    stepEl.className = "flex items-center gap-2 text-red-500 font-medium transition-colors";
    icon.className = "fa-solid fa-circle-xmark w-4 text-center";
  }
}

/** Collapse progress steps into a single "处理完成" summary line */
function collapseProgress(requestId, isError = false) {
  const progToggle = document.getElementById(`progress-toggle-${requestId}`);
  const progSteps = document.getElementById(`progress-steps-${requestId}`);
  if (!progToggle || !progSteps) return;

  if (isError) {
    document.getElementById(`progress-icon-${requestId}`).className = "fa-solid fa-circle-xmark text-red-500";
    document.getElementById(`progress-title-${requestId}`).innerText = "Agent执行失败";
    document.getElementById(`progress-title-box-${requestId}`).className = "flex items-center gap-1.5 text-xs text-red-600 font-medium";
    const progBox = document.getElementById(`progress-box-${requestId}`);
    progBox.classList.replace("bg-[#f4f5f7]", "bg-red-50/50");
    progBox.classList.replace("border-gray-100", "border-red-100");
  }

  progToggle.classList.remove("hidden");
  progToggle.classList.add("flex");
  progSteps.classList.add("hidden");

  progToggle.addEventListener("click", () => {
    progSteps.classList.toggle("hidden");
    document.getElementById(`progress-chevron-${requestId}`).classList.toggle("rotate-180");
  });
}

function showDone(requestId, reply, citations) {
  collapseProgress(requestId, false);

  const finalReply = document.getElementById(`final-reply-${requestId}`);
  const finalText = document.getElementById(`final-text-${requestId}`);
  const citationBox = document.getElementById(`kb-citations-${requestId}`);

  if (finalText) finalText.textContent = reply || "[empty reply]";
  if (citationBox) citationBox.innerHTML = renderCitationItems(citations, requestId);
  if (finalReply) {
    finalReply.classList.remove("hidden");
    finalReply.classList.add("flex", "message-anim");
  }
}

function showError(requestId, err) {
  collapseProgress(requestId, true);

  const finalReply = document.getElementById(`final-reply-${requestId}`);
  const finalText = document.getElementById(`final-text-${requestId}`);

  if (finalText) finalText.textContent = `请求失败：${err?.message || err}`;
  if (finalReply) {
    finalReply.classList.remove("hidden");
    finalReply.classList.add("flex", "message-anim");
  }
}

function appendTtsAudio(requestId, audioUrl) {
  const container = document.getElementById(`tts-audio-${requestId}`);
  if (!container) return;
  container.innerHTML = `
    <div class="mt-2">
      <div class="audio-message-btn bg-blue-50 border border-blue-100 px-3 py-2 rounded-2xl flex items-center gap-3 cursor-pointer hover:bg-blue-100 transition-colors shadow-sm w-fit" onclick="window.playTtsAudio(this)">
        <div class="play-icon-container w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white shadow-sm shrink-0 transition-colors">
          <i class="fa-solid fa-play ml-0.5 text-xs"></i>
        </div>
        <span class="text-xs font-medium text-blue-600">语音回复</span>
      </div>
      <audio class="hidden" preload="auto" src="${escapeHtml(audioUrl)}"></audio>
    </div>
  `;
}

function setupTtsAutoplay(requestId) {
  const container = document.getElementById(`tts-audio-${requestId}`);
  if (!container) return;
  const audioEl = container.querySelector("audio");
  if (!audioEl) return;
  audioEl.addEventListener("canplay", () => {
    audioEl.play().catch(() => {});
  }, { once: true });
  setTimeout(() => {
    if (audioEl.paused) audioEl.play().catch(() => {});
  }, 3000);
}

function initTtsPlayerGlobals() {
  window.playTtsAudio = function (btn) {
    const container = btn.closest(".flex-col") || btn.parentElement;
    const audioEl = container?.querySelector("audio");
    if (!audioEl) return;

    document.querySelectorAll("[data-tts-playing]").forEach((a) => {
      a.pause();
      a.currentTime = 0;
      a.removeAttribute("data-tts-playing");
    });
    document.querySelectorAll(".play-icon-container").forEach((icon) => {
      if (icon.closest("[onclick*='playTtsAudio']")) {
        icon.classList.remove("bg-red-500");
        icon.classList.add("bg-blue-500");
        icon.innerHTML = '<i class="fa-solid fa-play ml-0.5 text-xs"></i>';
      }
    });

    if (audioEl.paused) {
      audioEl.setAttribute("data-tts-playing", "1");
      const icon = btn.querySelector(".play-icon-container");
      if (icon) {
        icon.classList.remove("bg-blue-500");
        icon.classList.add("bg-red-500");
        icon.innerHTML = '<i class="fa-solid fa-stop text-xs"></i>';
      }
      audioEl.play().catch(() => {});
      audioEl.addEventListener("ended", () => {
        icon?.classList.remove("bg-red-500");
        icon?.classList.add("bg-blue-500");
        icon && (icon.innerHTML = '<i class="fa-solid fa-play ml-0.5 text-xs"></i>');
        audioEl.removeAttribute("data-tts-playing");
      }, { once: true });
    } else {
      audioEl.pause();
      audioEl.currentTime = 0;
      audioEl.removeAttribute("data-tts-playing");
    }
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showSuggestions(requestId, suggestions = []) {
  const sugArea = document.getElementById(`suggestion-area-${requestId}`);
  const sugLoading = document.getElementById(`sug-loading-${requestId}`);
  const sugList = document.getElementById(`sug-list-${requestId}`);

  if (!sugArea) return;

  if (!suggestions.length) {
    // 无建议时隐藏整个区域
    sugArea.classList.add("hidden");
    return;
  }

  // 隐藏加载状态
  if (sugLoading) sugLoading.classList.add("hidden");

  // 清理建议文本中的残留字符
  function cleanSuggestion(text) {
    return String(text || "")
      .replace(/^[\s"'\\\[\{]+/, "")
      .replace(/[\s"'\\\]\}]+$/, "")
      .trim();
  }

  // 渲染 chips
  const chips = suggestions.map((text) => {
    const clean = cleanSuggestion(text);
    if (!clean) return "";
    return `
      <button class="dyn-sug-btn group px-3 py-2 bg-white border border-gray-200 hover:border-blue-400 hover:shadow-sm hover:text-blue-600 rounded-lg text-xs text-gray-600 transition-all flex items-center gap-2">
        <span>${escapeHtml(clean)}</span>
        <i class="fa-solid fa-arrow-up text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"></i>
      </button>
    `;
  }).filter(Boolean).join("");

  if (sugList) {
    sugList.innerHTML = `
      <div class="text-xs text-gray-400 mb-0.5 ml-1"><i class="fa-solid fa-wand-magic-sparkles text-blue-400"></i> 推荐对话：</div>
      <div class="flex flex-wrap gap-2">${chips}</div>
    `;
    sugList.classList.remove("hidden");
    sugList.classList.add("flex", "message-anim");
  }

  // 显示整个区域
  sugArea.classList.remove("hidden");
  sugArea.classList.add("flex", "message-anim");
}

export function createRealChatFlow({ chatContainer, chatService, ttsService, context, isKnowledgeEnabled, onAfterSend, onTrace }) {
  initTtsPlayerGlobals();

  async function sendMessage(text) {
    const requestId = makeId("chat");
    appendAssistantShell(chatContainer, requestId);

    try {
      // Step 1: 声纹与唤醒词检测 (快速完成，模拟短暂延迟)
      updateStep(requestId, 1, "active");
      await delay(300);
      updateStep(requestId, 1, "done");

      // Step 2: Agent 执行
      updateStep(requestId, 2, "active");
      const data = await chatService.send({
        session: context.session,
        message: text,
        knowledgeEnabled: isKnowledgeEnabled(),
        requestId,
      });
      const fallbackReply = Array.isArray(data.messages)
        ? [...data.messages].reverse().find((item) => item.role === "assistant")?.content
        : "";
      const reply = (data.reply || fallbackReply || "").trim();
      const citations = Array.isArray(data?.meta?.knowledge?.citations) ? data.meta.knowledge.citations : [];
      updateStep(requestId, 2, "done");

      // Step 3: TTS 语音生成
      if (context.settings.autoTts && reply && ttsService) {
        updateStep(requestId, 3, "active");
        try {
          const ttsData = await ttsService.synthesize({
            text: reply,
            voice: context.settings.ttsVoice,
            mode: context.settings.ttsMode,
            session: context.session,
            requestId,
          });
          updateStep(requestId, 3, "done");

          // 显示最终回复
          showDone(requestId, reply, citations);

          // 播放 TTS
          if (ttsData?.audio?.url) {
            const audioUrl = ttsService.withTokenUrl(ttsData.audio.url);
            appendTtsAudio(requestId, audioUrl);
            // autoPlay 控制是否自动播放，但播放器始终显示
            if (context.settings.autoPlay) {
              setupTtsAutoplay(requestId);
            }
          }
        } catch (ttsErr) {
          console.error("TTS 合成失败:", ttsErr);
          updateStep(requestId, 3, "error");
          // TTS 失败但仍显示文本回复
          showDone(requestId, reply, citations);
        }
      } else {
        // 无 TTS，直接显示回复
        showDone(requestId, reply, citations);
      }

      // 推荐追问：有 citations 时调用 suggestions API
      if (isKnowledgeEnabled() && citations.length && reply) {
        // 先显示推荐对话区（加载状态）
        const sugArea = document.getElementById(`suggestion-area-${requestId}`);
        if (sugArea) {
          sugArea.classList.remove("hidden");
          sugArea.classList.add("flex", "message-anim");
          chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" });
        }

        try {
          const sugData = await chatService.suggestions({
            session: context.session,
            question: text,
            answer: reply,
            citations,
            requestId,
          });
          const suggestions = Array.isArray(sugData?.suggestions) ? sugData.suggestions : [];
          showSuggestions(requestId, suggestions);
        } catch (sugErr) {
          console.error("推荐追问生成失败:", sugErr);
          // 失败时隐藏推荐区域
          if (sugArea) sugArea.classList.add("hidden");
        }
      }

      // 本地留痕
      onTrace?.({
        ts: Date.now(),
        requestId,
        text,
        reply,
        status: "ok",
      });

      onAfterSend?.(data);
    } catch (err) {
      showError(requestId, err);
    } finally {
      chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: "smooth" });
    }
  }

  return { sendMessage };
}
