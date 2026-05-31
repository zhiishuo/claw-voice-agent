import { escapeHtml, titleOf } from "./knowledge-lab-utils.js";

function displayModelName(model) {
  const value = String(model || "").trim();
  if (!value) return "bge-m3";
  if (value.toLowerCase().includes("bge-m3")) return "bge-m3";
  if (value.toLowerCase().includes("text2vec")) return "bge-m3";
  return value;
}

export function updateQueryCount({ kbSearchInput, kbQueryCount }) {
  if (!kbSearchInput || !kbQueryCount) return;
  kbQueryCount.textContent = `${kbSearchInput.value.length} / ${kbSearchInput.maxLength || 1000}`;
}

export function renderStatus(kb, elements = {}) {
  const { kbStatusText, kbStatusDot, kbStatusTags } = elements;
  const loaded = !!kb.loaded;
  const enabled = !!kb.enabled;
  const error = kb.error ? String(kb.error) : "";

  if (kbStatusText) {
    if (error) {
      kbStatusText.textContent = `知识库连接异常：${error}`;
      kbStatusText.className = "kb-status-text kb-status-text--error";
    } else if (loaded) {
      kbStatusText.textContent = "知识库已连接，索引已加载，可以开始检索。";
      kbStatusText.className = "kb-status-text kb-status-text--ok";
    } else if (enabled) {
      kbStatusText.textContent = "知识库已启用，首次检索时会加载索引。";
      kbStatusText.className = "kb-status-text kb-status-text--warn";
    } else {
      kbStatusText.textContent = "知识库未启用。";
      kbStatusText.className = "kb-status-text kb-status-text--muted";
    }
  }

  if (kbStatusDot) {
    kbStatusDot.className = loaded
      ? "kb-status-dot kb-status-dot--ok"
      : enabled
        ? "kb-status-dot kb-status-dot--warn"
        : "kb-status-dot kb-status-dot--muted";
  }

  if (kbStatusTags) {
    const tags = [
      ["fa-regular fa-clipboard", "索引目录", kb.output_dir || "航空知识库"],
      ["fa-solid fa-network-wired", "向量模型", displayModelName(kb.model)],
      ["fa-regular fa-clipboard", "检索模式", kb.mode || "混合检索"],
    ];
    kbStatusTags.innerHTML = tags.map(([icon, label, value]) => `
      <div class="kb-status-metric">
        <i class="${icon}"></i>
        <div>
          <div class="kb-status-metric-label">${escapeHtml(label)}</div>
          <div class="kb-status-metric-value">${escapeHtml(value)}</div>
        </div>
      </div>
    `).join("");
  }
}

export function renderResults(results, { query, topK, mode } = {}, elements = {}) {
  const { kbResultsList, kbResultSummary } = elements;
  if (!kbResultsList) return;
  if (kbResultSummary) {
    kbResultSummary.textContent = `${results.length} 条结果 · query="${query}"${topK ? ` · top_k=${topK}` : ""}${mode ? ` · mode=${mode}` : ""}`;
  }

  if (!results.length) {
    kbResultsList.innerHTML = '<div class="kb-empty-state">未找到相关结果。</div>';
    return;
  }

  kbResultsList.innerHTML = results.map((item, index) => {
    const meta = item.metadata || {};
    const text = escapeHtml(item.text || "");
    const source = escapeHtml(titleOf(item, index));
    const score = typeof item.score === "number" ? item.score.toFixed(4) : "n/a";
    const vectorScore = typeof item.vector_score === "number" ? item.vector_score.toFixed(4) : "";
    const keywordScore = typeof item.keyword_score === "number" ? item.keyword_score.toFixed(4) : "";
    const rawData = escapeHtml(JSON.stringify(item, null, 2));
    const page = meta.page ? ` · p.${escapeHtml(meta.page)}` : "";
    const row = meta.row_start ? ` · row ${escapeHtml(meta.row_start)}` : "";

    return `
      <article class="kb-result-item">
        <div class="kb-result-rank">#${index + 1}</div>
        <div class="kb-result-body">
          <div class="kb-result-title">
            <i class="fa-regular fa-file-lines"></i>
            <span>${source}${page}${row}</span>
          </div>
          <p class="kb-result-text">${text}</p>
          <details class="kb-raw-details">
            <summary>原始数据</summary>
            <pre><code>${rawData}</code></pre>
          </details>
        </div>
        <div class="kb-score-column">
          <div class="kb-score-badge">score ${score}</div>
          <div class="kb-score-sub">${vectorScore ? `vector ${vectorScore}` : ""}${vectorScore && keywordScore ? " · " : ""}${keywordScore ? `keyword ${keywordScore}` : ""}</div>
        </div>
      </article>
    `;
  }).join("");
}
