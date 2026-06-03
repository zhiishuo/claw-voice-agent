import { $ } from "../../core/dom.js";
import { escapeHtml } from "./knowledge-lab-utils.js";
import { renderResults, renderStatus, updateQueryCount } from "./knowledge-lab-renderer.js";
import { createKnowledgeVisualizationRenderer } from "./knowledge-visualization-renderer.js";

/**
 * @param {object} opts
 * @param {object} opts.knowledgeService - from services.knowledge
 * @param {function} [opts.onSwitchTo] - 注册导航切换回调，由 navigation controller 调用
 * @returns {{ activate: function }} 控制器，调用 activate() 触发数据加载
 */
export function initKnowledgeLab({ knowledgeService, onSwitchTo } = {}) {
  const elements = {
    kbSearchInput: $("kb-search-input"),
    doSearchBtn: $("do-search-btn"),
    kbResultsArea: $("kb-results-area"),
    kbResultsList: $("kb-results-list"),
    kbResultSummary: $("kb-result-summary"),
    kbVizArea: $("kb-viz-area"),
    kbVizContent: $("kb-viz-content"),
    kbRefreshBtn: $("kb-refresh-btn"),
    kbStatusText: $("kb-status-text"),
    kbStatusDot: $("kb-status-dot"),
    kbStatusTags: $("kb-status-tags"),
    kbTopK: $("kb-top-k"),
    kbMode: $("kb-mode"),
    kbTabResults: $("kb-tab-results"),
    kbTabViz: $("kb-tab-viz"),
    kbQueryCount: $("kb-query-count"),
  };

  const vizRenderer = createKnowledgeVisualizationRenderer(elements.kbVizContent);
  let currentTab = "results";
  let lastResults = [];
  let lastQuery = "";

  async function loadStatus() {
    if (!knowledgeService) return null;
    try {
      const data = await knowledgeService.status();
      const kb = data?.knowledge || {};
      renderStatus(kb, elements);
      return kb;
    } catch (err) {
      renderStatus({ enabled: false, loaded: false, error: err.message }, elements);
      return null;
    }
  }

  async function loadVisualization() {
    if (!knowledgeService) return;
    try {
      const data = await knowledgeService.visualization();
      vizRenderer.setVisualization(data?.visualization || {});
    } catch (err) {
      vizRenderer.setError(err);
    }
  }

  async function doSearch() {
    const query = elements.kbSearchInput?.value?.trim();
    if (!query) {
      if (elements.kbSearchInput) {
        elements.kbSearchInput.value = "南方8900请求起飞，需要检索哪些知识？";
        updateQueryCount(elements);
        elements.kbSearchInput.focus();
      }
      return;
    }
    if (!knowledgeService || !elements.doSearchBtn) return;

    elements.doSearchBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>检索中</span>';
    elements.doSearchBtn.classList.add("is-loading");
    elements.doSearchBtn.disabled = true;

    const topK = parseInt(elements.kbTopK?.value, 10) || undefined;
    const mode = elements.kbMode?.value?.trim() || undefined;

    try {
      const data = await knowledgeService.search({ query, topK, mode });
      const results = Array.isArray(data?.results) ? data.results : [];
      const kb = data?.knowledge || {};

      renderStatus(kb, elements);
      lastResults = results;
      lastQuery = query;
      renderResults(results, { query, topK, mode: mode || kb.mode }, elements);
      elements.kbResultsArea?.classList.remove("hidden");
      elements.kbResultsArea?.classList.add("flex");
      showTab("results");
    } catch (err) {
      if (elements.kbResultsList) {
        elements.kbResultsList.innerHTML = `<div class="kb-empty-state">检索失败：${escapeHtml(err.message)}</div>`;
      }
      elements.kbResultsArea?.classList.remove("hidden");
      elements.kbResultsArea?.classList.add("flex");
    } finally {
      elements.doSearchBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i><span>执行检索</span>';
      elements.doSearchBtn.classList.remove("is-loading");
      elements.doSearchBtn.disabled = false;
    }
  }

  function showTab(tab) {
    currentTab = tab === "viz" ? "viz" : "results";
    if (currentTab === "results") {
      elements.kbTabResults?.classList.add("active");
      elements.kbTabViz?.classList.remove("active");
      elements.kbResultsList?.classList.remove("hidden");
      elements.kbVizArea?.classList.add("hidden");
      return;
    }

    elements.kbTabViz?.classList.add("active");
    elements.kbTabResults?.classList.remove("active");
    elements.kbResultsList?.classList.add("hidden");
    elements.kbVizArea?.classList.remove("hidden");
    vizRenderer.render(lastResults, lastQuery);
  }

  elements.doSearchBtn?.addEventListener("click", doSearch);
  elements.kbSearchInput?.addEventListener("input", () => updateQueryCount(elements));
  elements.kbSearchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      doSearch();
    }
  });
  elements.kbRefreshBtn?.addEventListener("click", async () => {
    await loadStatus();
    await loadVisualization();
    if (currentTab === "viz") vizRenderer.render(lastResults, lastQuery);
  });
  elements.kbTabResults?.addEventListener("click", () => showTab("results"));
  elements.kbTabViz?.addEventListener("click", () => showTab("viz"));

  updateQueryCount(elements);

  // 延迟激活：不在初始化时请求 API，等导航切换或认证完成后再加载
  let _activated = false;

  function activate() {
    if (!_activated) {
      _activated = true;
      loadStatus();
      loadVisualization();
    } else {
      loadStatus();
    }
  }

  // 注册导航切换回调：用户点击"知识库测试"时由 navigation controller 触发
  if (typeof onSwitchTo === "function") {
    onSwitchTo(activate);
  }

  return { activate };
}
