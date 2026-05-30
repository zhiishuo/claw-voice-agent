import { $ } from "../../core/dom.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * @param {object} opts
 * @param {object} opts.knowledgeService - from services.knowledge
 */
export function initKnowledgeLab({ knowledgeService } = {}) {
  const kbSearchInput = $("kb-search-input");
  const doSearchBtn = $("do-search-btn");
  const kbResultsArea = $("kb-results-area");
  const kbResultsList = $("kb-results-list");
  const kbResultSummary = $("kb-result-summary");
  const kbVizArea = $("kb-viz-area");
  const kbVizContent = $("kb-viz-content");
  const kbRefreshBtn = $("kb-refresh-btn");
  const kbStatusText = $("kb-status-text");
  const kbStatusDot = $("kb-status-dot");
  const kbStatusTags = $("kb-status-tags");
  const kbTopK = $("kb-top-k");
  const kbMode = $("kb-mode");
  const kbTabResults = $("kb-tab-results");
  const kbTabViz = $("kb-tab-viz");

  let currentTab = "results";

  // --- 状态加载 ---
  async function loadStatus() {
    if (!knowledgeService) return;
    try {
      const data = await knowledgeService.status();
      const kb = data?.knowledge || {};
      renderStatus(kb);
      return kb;
    } catch (err) {
      console.error("知识库状态加载失败:", err);
      renderStatus({ enabled: false, loaded: false, error: err.message });
      return null;
    }
  }

  function renderStatus(kb) {
    if (kbStatusText) {
      if (kb.error) {
        kbStatusText.textContent = `错误：${kb.error}`;
        kbStatusText.className = "text-red-600 font-medium mb-3 text-[15px]";
      } else if (kb.loaded) {
        kbStatusText.textContent = "知识库已连接，索引已经加载，可以开始检索。";
        kbStatusText.className = "text-green-600 font-medium mb-3 text-[15px]";
      } else if (kb.enabled) {
        kbStatusText.textContent = "知识库已启用但索引未加载。";
        kbStatusText.className = "text-amber-600 font-medium mb-3 text-[15px]";
      } else {
        kbStatusText.textContent = "知识库未启用。";
        kbStatusText.className = "text-gray-500 font-medium mb-3 text-[15px]";
      }
    }

    if (kbStatusDot) {
      kbStatusDot.className = kb.loaded
        ? "w-4 h-4 bg-green-400 rounded-full animate-pulse"
        : kb.enabled
          ? "w-4 h-4 bg-amber-400 rounded-full"
          : "w-4 h-4 bg-gray-300 rounded-full";
    }

    if (kbStatusTags) {
      const tags = [];
      if (kb.output_dir) tags.push(`索引目录: ${escapeHtml(kb.output_dir)}`);
      if (kb.model) tags.push(`模型: ${escapeHtml(kb.model)}`);
      if (kb.mode) tags.push(`模式: ${escapeHtml(kb.mode)}`);
      if (kb.top_k) tags.push(`top_k: ${kb.top_k}`);
      kbStatusTags.innerHTML = tags
        .map((t) => `<span class="bg-gray-50 border border-gray-200 px-2 py-1 rounded">${t}</span>`)
        .join("");
    }
  }

  // --- 检索 ---
  async function doSearch() {
    const query = kbSearchInput?.value?.trim();
    if (!query) {
      kbSearchInput.value = "你好，飞行的关键是什么？";
      return;
    }
    if (!knowledgeService) return;

    doSearchBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 检索中...';
    doSearchBtn.classList.add("opacity-70");
    doSearchBtn.disabled = true;

    const topK = parseInt(kbTopK?.value, 10) || undefined;
    const mode = kbMode?.value?.trim() || undefined;

    try {
      const data = await knowledgeService.search({ query, topK, mode });
      const results = Array.isArray(data?.results) ? data.results : [];
      const kb = data?.knowledge || {};

      renderStatus(kb);
      lastResults = results;
      lastQuery = query;
      renderResults(results, query, topK, mode);
      showTab("results");
    } catch (err) {
      console.error("知识库检索失败:", err);
      if (kbResultsList) {
        kbResultsList.innerHTML = `<div class="text-sm text-red-600 p-4">检索失败：${escapeHtml(err.message)}</div>`;
      }
      kbResultsArea?.classList.remove("hidden");
      kbResultsArea?.classList.add("flex");
    } finally {
      doSearchBtn.innerHTML = "开始检索";
      doSearchBtn.classList.remove("opacity-70");
      doSearchBtn.disabled = false;
    }
  }

  function renderResults(results, query, topK, mode) {
    if (!kbResultsList) return;

    // Summary
    if (kbResultSummary) {
      kbResultSummary.textContent = `${results.length} 条结果 · query="${query}"${topK ? ` · top_k=${topK}` : ""}${mode ? ` · mode=${mode}` : ""}`;
    }

    if (!results.length) {
      kbResultsList.innerHTML = '<div class="text-sm text-gray-500 p-4">未找到相关结果</div>';
      kbResultsArea?.classList.remove("hidden");
      kbResultsArea?.classList.add("flex");
      return;
    }

    kbResultsList.innerHTML = results.map((item, index) => {
      const meta = item.metadata || {};
      const source = escapeHtml(meta.filename || meta.source || meta.relative_path || "未知来源");
      const text = escapeHtml(item.text || "");
      const score = typeof item.score === "number" ? item.score.toFixed(4) : "";
      const vectorScore = typeof item.vector_score === "number" ? `vector: ${item.vector_score.toFixed(4)}` : "";
      const keywordScore = typeof item.keyword_score === "number" ? `keyword: ${item.keyword_score.toFixed(4)}` : "";
      const rawData = JSON.stringify(item, null, 2);

      return `
        <div class="w-full border border-gray-100 rounded-xl p-5 hover:border-gray-200 hover:shadow-sm transition-all">
          <div class="flex justify-between items-start mb-3">
            <div class="text-sm font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded">${source}</div>
            <div class="text-xs text-gray-400">#${index + 1} · score=${score}${vectorScore ? ` · ${vectorScore}` : ""}${keywordScore ? ` · ${keywordScore}` : ""}</div>
          </div>
          <div class="text-[15px] leading-relaxed text-gray-800 mb-4 font-medium">${text}</div>
          <div class="border border-gray-100 rounded-lg overflow-hidden bg-gray-50">
            <button class="w-full px-4 py-2.5 flex items-center gap-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors font-medium text-left" onclick="document.getElementById('raw-data-${index}').classList.toggle('hidden')">
              <i class="fa-solid fa-chevron-down text-[10px]"></i> 原始数据
            </button>
            <div id="raw-data-${index}" class="p-4 border-t border-gray-100 bg-white hidden">
<pre class="whitespace-pre-wrap text-gray-600 text-xs"><code>${escapeHtml(rawData)}</code></pre>
            </div>
          </div>
        </div>
      `;
    }).join("");

    kbResultsArea?.classList.remove("hidden");
    kbResultsArea?.classList.add("flex");
  }

  // --- 可视化 ---
  const COLORS = ["#4f7cff", "#2fbb9b", "#e05aa7", "#f5a524", "#7b61ff", "#15a0c8", "#e5485c"];
  let kbVisualization = null;
  let lastResults = [];
  let lastQuery = "";

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v != null) el.setAttribute(k, String(v));
    }
    return el;
  }

  async function loadVisualization() {
    if (!knowledgeService) return;
    try {
      const data = await knowledgeService.visualization();
      const viz = data?.visualization || {};
      if (viz.available && Array.isArray(viz.points) && viz.points.length) {
        kbVisualization = viz;
      } else {
        kbVisualization = null;
      }
    } catch (err) {
      console.error("知识库可视化加载失败:", err);
      kbVisualization = null;
    }
  }

  function renderVisualization(results, query) {
    if (!kbVizContent) return;
    if (kbVisualization?.points?.length) {
      renderWholeKbViz(kbVisualization, results, query);
    } else if (results?.length) {
      renderClusterViz(results, query);
    } else {
      kbVizContent.innerHTML = '<div class="text-sm text-gray-400 p-4">暂无可视化数据。请先执行一次检索。</div>';
    }
  }

  function renderWholeKbViz(viz, results, query) {
    const points = viz.points;
    const W = 800, H = 400;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "w-full h-auto" });

    // Draw all points as small dots
    points.forEach((p) => {
      const x = 60 + (p.x ?? 0) * 340 + 170;
      const y = H / 2 - (p.y ?? 0) * 170;
      svg.appendChild(svgEl("circle", { cx: x, cy: y, r: 2.5, fill: "#c0c8d4", opacity: 0.5 }));
    });

    // Highlight matched results
    const hitColors = {};
    (results || []).forEach((r, i) => {
      const point = points.find((p) => p.id === r.id || p.knowledge_unit_id === r.metadata?.knowledge_unit_id);
      if (!point) return;
      const x = 60 + (point.x ?? 0) * 340 + 170;
      const y = H / 2 - (point.y ?? 0) * 170;
      const source = r.metadata?.filename || r.metadata?.source || "unknown";
      if (!hitColors[source]) hitColors[source] = COLORS[Object.keys(hitColors).length % COLORS.length];
      const color = hitColors[source];

      // Draw line from query to hit
      svg.appendChild(svgEl("line", {
        x1: 80, y1: H / 2, x2: x, y2: y,
        stroke: color, "stroke-width": 1.5, opacity: 0.4,
      }));
      // Draw hit node
      svg.appendChild(svgEl("circle", { cx: x, cy: y, r: 7, fill: color, opacity: 0.9 }));
      // Draw rank label
      const text = svgEl("text", { x: x + 10, y: y - 8, fill: color, "font-size": "10", "font-weight": "600" });
      text.textContent = `#${i + 1}`;
      svg.appendChild(text);
    });

    // Draw query node
    svg.appendChild(svgEl("circle", { cx: 80, cy: H / 2, r: 12, fill: "#e5485c", opacity: 0.9 }));
    const qLabel = svgEl("text", { x: 80, y: H / 2 + 4, fill: "white", "font-size": "9", "text-anchor": "middle", "font-weight": "600" });
    qLabel.textContent = "Q";
    svg.appendChild(qLabel);

    // Legend
    const legend = document.createElement("div");
    legend.className = "flex flex-wrap gap-3 mt-2 text-[11px] text-gray-500";
    legend.innerHTML = `
      <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"></span> 用户问题</span>
      <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span> Top-K 命中</span>
      <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-gray-300 inline-block"></span> 其他片段</span>
      <span class="text-gray-400">· ${points.length} 个知识片段 · 命中 ${(results || []).length} 条</span>
    `;

    kbVizContent.innerHTML = "";
    kbVizContent.appendChild(svg);
    kbVizContent.appendChild(legend);
  }

  function renderClusterViz(results, query) {
    if (!results?.length) {
      kbVizContent.innerHTML = '<div class="text-sm text-gray-400 p-4">暂无可视化数据</div>';
      return;
    }

    // Group by source
    const groups = new Map();
    results.forEach((r, i) => {
      const source = r.metadata?.filename || r.metadata?.source || "unknown";
      if (!groups.has(source)) groups.set(source, []);
      groups.get(source).push({ item: r, index: i });
    });
    const groupList = [...groups.entries()];

    const W = 800, H = 400;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "w-full h-auto" });

    // Query node
    svg.appendChild(svgEl("circle", { cx: 100, cy: H / 2, r: 16, fill: "#e5485c", opacity: 0.9 }));
    const qText = svgEl("text", { x: 100, y: H / 2 + 4, fill: "white", "font-size": "10", "text-anchor": "middle", "font-weight": "600" });
    qText.textContent = "Q";
    svg.appendChild(qText);

    const maxScore = Math.max(...results.map((r) => Math.abs(r.score || 0)), 0.001);

    groupList.forEach(([source, items], gi) => {
      const color = COLORS[gi % COLORS.length];
      const angle = groupList.length === 1 ? 0 : (Math.PI * 2 * gi) / groupList.length - Math.PI / 2;
      const cx = 480 + Math.cos(angle) * 220;
      const cy = H / 2 + Math.sin(angle) * 140;
      const clusterR = Math.max(40, 24 + items.length * 10);

      // Cluster circle
      svg.appendChild(svgEl("circle", {
        cx, cy, r: clusterR,
        fill: "none", stroke: color, "stroke-width": 1.5, opacity: 0.3, "stroke-dasharray": "4,3",
      }));

      // Cluster label
      const cLabel = svgEl("text", {
        x: cx, y: cy - clusterR - 6,
        fill: color, "font-size": "10", "text-anchor": "middle", "font-weight": "500", opacity: 0.8,
      });
      const shortSource = source.length > 20 ? source.slice(0, 18) + "..." : source;
      cLabel.textContent = shortSource;
      svg.appendChild(cLabel);

      items.forEach(({ item, index }, ii) => {
        const score = Math.abs(item.score || 0);
        const ratio = Math.max(0.2, Math.min(1, score / maxScore));
        const localAngle = (Math.PI * 2 * ii) / Math.max(items.length, 1) + gi * 0.5;
        const localR = items.length === 1 ? 0 : Math.min(clusterR - 12, 12 + ii * 8);
        const x = cx + Math.cos(localAngle) * localR;
        const y = cy + Math.sin(localAngle) * localR;
        const r = 6 + ratio * 8;

        // Line from query
        svg.appendChild(svgEl("line", {
          x1: 116, y1: H / 2, x2: x, y2: y,
          stroke: color, "stroke-width": 1 + ratio * 3, opacity: 0.3,
        }));

        // Node
        svg.appendChild(svgEl("circle", { cx: x, cy: y, r, fill: color, opacity: 0.85 }));

        // Rank
        const rank = svgEl("text", { x, y: y + 3, fill: "white", "font-size": "8", "text-anchor": "middle", "font-weight": "700" });
        rank.textContent = String(index + 1);
        svg.appendChild(rank);
      });
    });

    // Legend
    const legend = document.createElement("div");
    legend.className = "flex flex-wrap gap-3 mt-2 text-[11px] text-gray-500";
    const legendItems = groupList.slice(0, 6).map(([source], i) => {
      const short = source.length > 14 ? source.slice(0, 12) + "..." : source;
      return `<span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full inline-block" style="background:${COLORS[i % COLORS.length]}"></span> ${escapeHtml(short)}</span>`;
    }).join("");
    legend.innerHTML = `
      <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"></span> Query</span>
      ${legendItems}
      <span class="text-gray-400">· ${groupList.length} 个来源 · ${results.length} 条结果</span>
    `;

    kbVizContent.innerHTML = "";
    kbVizContent.appendChild(svg);
    kbVizContent.appendChild(legend);
  }

  // --- Tab 切换 ---
  function showTab(tab) {
    currentTab = tab;
    if (kbTabResults && kbTabViz) {
      if (tab === "results") {
        kbTabResults.className = "kb-test-tab px-4 py-1.5 bg-white shadow-sm text-sm font-medium text-gray-800 rounded-md";
        kbTabViz.className = "kb-test-tab px-4 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 rounded-md";
        kbResultsList?.classList.remove("hidden");
        kbVizArea?.classList.add("hidden");
      } else {
        kbTabViz.className = "kb-test-tab px-4 py-1.5 bg-white shadow-sm text-sm font-medium text-gray-800 rounded-md";
        kbTabResults.className = "kb-test-tab px-4 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 rounded-md";
        kbResultsList?.classList.add("hidden");
        kbVizArea?.classList.remove("hidden");
        renderVisualization(lastResults, lastQuery);
      }
    }
  }

  // --- 事件绑定 ---
  doSearchBtn?.addEventListener("click", doSearch);

  kbSearchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      doSearch();
    }
  });

  kbRefreshBtn?.addEventListener("click", loadStatus);
  kbTabResults?.addEventListener("click", () => showTab("results"));
  kbTabViz?.addEventListener("click", () => showTab("viz"));

  // 初始化：加载状态和可视化数据
  loadStatus();
  loadVisualization();
}
