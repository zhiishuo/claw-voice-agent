import { createApiClient } from "/static/modules/api-client.js";

const $ = (id) => document.getElementById(id);

const statusTextEl = $("statusText");
const statusCardEl = statusTextEl?.closest(".kb-card--status") || null;
const refreshStatusBtn = $("refreshStatusBtn");
const queryInputEl = $("queryInput");
const topKInputEl = $("topKInput");
const modeInputEl = $("modeInput");
const searchBtn = $("searchBtn");
const resultMetaEl = $("resultMeta");
const resultListEl = $("resultList");
const visualizationPanelEl = $("visualizationPanel");
const resultViewButtons = Array.from(document.querySelectorAll("[data-result-view]"));

const SVG_NS = "http://www.w3.org/2000/svg";
const VISUAL_COLORS = ["#4f7cff", "#2fbb9b", "#e05aa7", "#f5a524", "#7b61ff", "#15a0c8", "#e5485c"];
let currentResultView = "list";
let lastResults = [];
let lastQuery = "";
let kbVisualization = null;
let visualizationLoadPromise = null;
let visualizationError = "";

const sessionStore = window.sessionStorage;
const url = new URL(window.location.href);
const urlToken = url.searchParams.get("token") || "";
const storedToken = sessionStore.getItem("openclaw-webchat-auth-token") || "";
const authToken = urlToken || storedToken;
const api = createApiClient(() => authToken);

function ensureStatusUi() {
  if (!statusCardEl || !statusTextEl) return {};
  let lamp = $("statusLamp");
  if (!lamp) {
    lamp = document.createElement("div");
    lamp.id = "statusLamp";
    lamp.className = "kb-status-lamp kb-status-lamp--checking";
    lamp.setAttribute("aria-hidden", "true");
    lamp.innerHTML = "<span></span>";
    statusCardEl.insertBefore(lamp, statusCardEl.firstElementChild);
  }

  let details = $("statusDetails");
  if (!details) {
    details = document.createElement("div");
    details.id = "statusDetails";
    details.className = "kb-status-details";
    statusTextEl.insertAdjacentElement("afterend", details);
  }
  return { lamp, details };
}

function setStatus(text, kind = "", detailItems = []) {
  const { lamp, details } = ensureStatusUi();
  statusTextEl.textContent = text;
  statusTextEl.className = "";
  if (kind) statusTextEl.classList.add(`kb-status-${kind}`);
  if (lamp) lamp.className = `kb-status-lamp kb-status-lamp--${kind || "checking"}`;
  if (details) {
    details.innerHTML = "";
    detailItems.forEach((item) => {
      const row = document.createElement("div");
      row.className = "kb-status-detail";
      row.textContent = item;
      details.appendChild(row);
    });
  }
}

function readableValue(value, fallback = "未设置") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function describeKnowledgeStatus(knowledge = {}) {
  const enabled = !!knowledge.enabled;
  const loaded = !!knowledge.loaded;
  const error = knowledge.error ? String(knowledge.error) : "";
  const mode = readableValue(knowledge.mode, "默认");
  const topK = readableValue(knowledge.top_k, "默认");
  const outputDir = readableValue(knowledge.output_dir);
  const model = readableValue(knowledge.model, "默认 embedding 模型");

  if (error) {
    return {
      kind: "error",
      text: `知识库连接异常：${error}`,
      details: [
        "后端已经响应，但知识库加载或检索时出现错误。",
        `索引目录：${outputDir}`,
        `后端默认：${mode} 模式，未填写返回条数时返回 ${topK} 条。`,
      ],
    };
  }

  if (!enabled) {
    return {
      kind: "error",
      text: "知识库服务已响应，但检索开关没有打开。",
      details: [
        "当前会返回空结果；启动前设置 OPENCLAW_KB_ENABLED=1 后再重启服务。",
        `索引目录：${outputDir}`,
        `后端默认：${mode} 模式，未填写返回条数时返回 ${topK} 条。`,
      ],
    };
  }

  if (!loaded) {
    return {
      kind: "warning",
      text: "知识库已开启，正在等待第一次检索加载索引。",
      details: [
        "这是正常状态；第一次点击“开始检索”时会加载 embedding 模型和索引。",
        `索引目录：${outputDir}`,
        `模型：${model}；后端默认：${mode} 模式，未填写返回条数时返回 ${topK} 条。`,
      ],
    };
  }

  return {
    kind: "ok",
    text: "知识库已连接，索引已经加载，可以开始检索。",
    details: [
      `索引目录：${outputDir}`,
      `模型：${model}`,
      `后端默认：${mode} 模式，未填写返回条数时返回 ${topK} 条。`,
    ],
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function normalizeResultTitle(item, index) {
  return item.title || item.source || item.path || item.id || `结果 ${index + 1}`;
}

function normalizeResultText(item) {
  return item.text || item.content || item.chunk || item.document || item.summary || safeJson(item);
}

function resultMetadata(item) {
  return item && typeof item.metadata === "object" && item.metadata ? item.metadata : {};
}

function resultSource(item) {
  const metadata = resultMetadata(item);
  return item.source || metadata.relative_path || metadata.filename || metadata.source || item.path || "unknown";
}

function resultChunkType(item) {
  const metadata = resultMetadata(item);
  return metadata.chunk_type || item.chunk_type || "text";
}

function resultTitle(item, index) {
  return resultSource(item) || normalizeResultTitle(item, index);
}

function resultKnowledgeUnitId(item) {
  const metadata = resultMetadata(item);
  return item.knowledge_unit_id || metadata.knowledge_unit_id || "";
}

function shortLabel(value, maxLength = 22) {
  const text = String(value || "").replace(/\\/g, "/");
  const last = text.split("/").filter(Boolean).pop() || text || "unknown";
  return last.length > maxLength ? `${last.slice(0, maxLength - 1)}...` : last;
}

function sourceExtensionLabel(source) {
  const filename = shortLabel(source, 80);
  const match = /\.([A-Za-z0-9]+)(?:$|[?#])/i.exec(filename);
  return match ? match[1].toLowerCase() : "file";
}

function numericValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== null && value !== undefined) el.setAttribute(key, String(value));
  });
  return el;
}

function clearVisualization(message = "暂无可视化结果。请先执行一次检索。") {
  if (!visualizationPanelEl) return;
  visualizationPanelEl.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "kb-visual__empty";
  empty.textContent = message;
  visualizationPanelEl.appendChild(empty);
}

function setResultView(view) {
  currentResultView = view === "visual" ? "visual" : "list";
  resultViewButtons.forEach((button) => {
    const active = button.dataset.resultView === currentResultView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  resultListEl.classList.toggle("hidden", currentResultView !== "list");
  if (visualizationPanelEl) visualizationPanelEl.classList.toggle("hidden", currentResultView !== "visual");
  if (currentResultView === "visual") {
    void loadVisualization();
    renderVisualization(lastResults, lastQuery);
  }
}

function groupResultsForVisualization(results) {
  const groupMap = new Map();
  results.forEach((item, index) => {
    const source = resultSource(item);
    if (!groupMap.has(source)) {
      groupMap.set(source, {
        source,
        color: VISUAL_COLORS[groupMap.size % VISUAL_COLORS.length],
        items: [],
      });
    }
    groupMap.get(source).items.push({ item, index });
  });
  return [...groupMap.values()];
}

function resultMatchKeys(results) {
  const keys = new Map();
  (Array.isArray(results) ? results : []).forEach((item, index) => {
    if (item.id !== null && item.id !== undefined) keys.set(`id:${item.id}`, index);
    const knowledgeUnitId = resultKnowledgeUnitId(item);
    if (knowledgeUnitId) keys.set(`ku:${knowledgeUnitId}`, index);
  });
  return keys;
}

function pointMatchIndex(point, matchKeys) {
  if (point.id !== null && point.id !== undefined && matchKeys.has(`id:${point.id}`)) return matchKeys.get(`id:${point.id}`);
  if (point.knowledge_unit_id && matchKeys.has(`ku:${point.knowledge_unit_id}`)) return matchKeys.get(`ku:${point.knowledge_unit_id}`);
  return -1;
}

function colorForSource(source, colorMap) {
  if (!colorMap.has(source)) colorMap.set(source, VISUAL_COLORS[colorMap.size % VISUAL_COLORS.length]);
  return colorMap.get(source);
}

function scaledPoint(point) {
  return {
    x: 520 + numericValue(point.x) * 440,
    y: 260 - numericValue(point.y) * 205,
  };
}

function localHitCoordinates(hitItems, item, index) {
  const xs = hitItems.map((hit) => hit.actual.x);
  const ys = hitItems.map((hit) => hit.actual.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spreadX = maxX - minX;
  const spreadY = maxY - minY;
  if (spreadX < 8 && spreadY < 8) {
    const angle = (Math.PI * 2 * index) / Math.max(hitItems.length, 1) - Math.PI / 2;
    const radius = hitItems.length <= 1 ? 0 : 92;
    return {
      x: 180 + Math.cos(angle) * radius,
      y: 170 + Math.sin(angle) * radius,
    };
  }
  return {
    x: 44 + ((item.actual.x - minX) / Math.max(spreadX, 1)) * 272,
    y: 44 + ((item.actual.y - minY) / Math.max(spreadY, 1)) * 252,
  };
}

function renderLocalHitPanel(container, hitItems, selectedIndex = 0) {
  container.innerHTML = "";
  const title = document.createElement("div");
  title.className = "kb-visual__detail-title";
  title.textContent = hitItems.length ? `命中局部放大 · top ${hitItems.length}` : "命中局部放大";
  container.appendChild(title);

  if (!hitItems.length) {
    const empty = document.createElement("div");
    empty.className = "kb-visual__empty";
    empty.textContent = "本次还没有命中结果。";
    container.appendChild(empty);
    return;
  }

  const svg = createSvgElement("svg", { viewBox: "0 0 360 330", role: "img", "aria-label": "命中结果局部放大图" });
  const guide = createSvgElement("circle", {
    cx: 180,
    cy: 170,
    r: 116,
    class: "kb-visual__detail-guide",
  });
  svg.appendChild(guide);

  hitItems.forEach((hit, index) => {
    const { x, y } = localHitCoordinates(hitItems, hit, index);
    const isSelected = hit.matchIndex === selectedIndex;
    const node = createSvgElement("circle", {
      cx: x,
      cy: y,
      r: isSelected ? 18 : 14,
      class: isSelected ? "kb-visual__detail-node is-selected" : "kb-visual__detail-node",
    });
    const nodeTitle = createSvgElement("title");
    nodeTitle.textContent = [
      `#${hit.matchIndex + 1} ${sourceExtensionLabel(hit.source)}`,
      hit.source,
      hit.point.knowledge_unit_id || "",
      hit.point.text_preview || "",
    ].filter(Boolean).join("\n");
    node.appendChild(nodeTitle);
    svg.appendChild(node);

    const rank = createSvgElement("text", { x, y, class: "kb-visual__rank" });
    rank.textContent = String(hit.matchIndex + 1);
    svg.appendChild(rank);

    const label = createSvgElement("text", { x: x + 18, y: y - 18, class: "kb-visual__label" });
    label.textContent = `#${hit.matchIndex + 1} ${sourceExtensionLabel(hit.source)}`;
    svg.appendChild(label);
  });
  container.appendChild(svg);

  const list = document.createElement("div");
  list.className = "kb-visual__hit-list";
  hitItems.forEach((hit) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = hit.matchIndex === selectedIndex ? "kb-visual__hit-item is-selected" : "kb-visual__hit-item";
    item.textContent = `#${hit.matchIndex + 1} ${sourceExtensionLabel(hit.source)} · ${shortLabel(hit.source, 28)}`;
    item.addEventListener("click", () => renderLocalHitPanel(container, hitItems, hit.matchIndex));
    list.appendChild(item);
  });
  container.appendChild(list);
}

async function loadVisualization() {
  if (kbVisualization || visualizationLoadPromise) return visualizationLoadPromise;
  visualizationLoadPromise = api("/api/knowledge/visualization")
    .then((data) => {
      const visualization = data?.visualization || {};
      if (visualization.available && Array.isArray(visualization.points)) {
        kbVisualization = visualization;
        visualizationError = "";
      } else {
        kbVisualization = null;
        visualizationError = visualization.error || "visualization data is unavailable";
      }
      if (currentResultView === "visual") renderVisualization(lastResults, lastQuery);
      return kbVisualization;
    })
    .catch((err) => {
      kbVisualization = null;
      visualizationError = err.message || String(err);
      if (currentResultView === "visual") renderVisualization(lastResults, lastQuery);
      return null;
    });
  return visualizationLoadPromise;
}

function renderVisualization(results, query = "") {
  if (kbVisualization && Array.isArray(kbVisualization.points) && kbVisualization.points.length) {
    renderWholeKbVisualization(results, query);
    return;
  }
  renderResultClusterVisualization(results, query);
}

function renderWholeKbVisualization(results, query = "") {
  if (!visualizationPanelEl) return;
  visualizationPanelEl.innerHTML = "";
  const points = Array.isArray(kbVisualization?.points) ? kbVisualization.points : [];
  if (!points.length) {
    renderResultClusterVisualization(results, query);
    return;
  }

  const matchKeys = resultMatchKeys(results);
  const colorMap = new Map();
  const matchedCount = points.filter((point) => pointMatchIndex(point, matchKeys) >= 0).length;
  const sourceCount = new Set(points.map((point) => point.source || "unknown")).size;
  const matchedBuckets = new Map();
  points.forEach((point) => {
    const matchIndex = pointMatchIndex(point, matchKeys);
    if (matchIndex < 0) return;
    const { x, y } = scaledPoint(point);
    const bucketKey = `${Math.round(x / 18)}:${Math.round(y / 18)}`;
    if (!matchedBuckets.has(bucketKey)) matchedBuckets.set(bucketKey, []);
    matchedBuckets.get(bucketKey).push(matchIndex);
  });

  const toolbar = document.createElement("div");
  toolbar.className = "kb-visual__toolbar";
  const summary = document.createElement("div");
  summary.textContent = `全库向量降维图 · ${kbVisualization.method || "pca"} · ${points.length} 个知识片段 · ${sourceCount} 个来源 · 命中 ${matchedCount} 条`;
  const legend = document.createElement("div");
  legend.className = "kb-visual__legend";
  [
    ["#17243a", "Query"],
    ["#e5485c", "本次命中"],
    ["#4f7cff", "全库片段：颜色区分来源文件"],
  ].forEach(([color, text]) => {
    const item = document.createElement("span");
    item.className = "kb-visual__legend-item";
    const swatch = document.createElement("span");
    swatch.className = "kb-visual__swatch";
    swatch.style.background = color;
    const label = document.createElement("span");
    label.textContent = text;
    item.append(swatch, label);
    legend.appendChild(item);
  });
  toolbar.append(summary, legend);

  const stage = document.createElement("div");
  stage.className = "kb-visual__stage kb-visual__stage--split";
  const globalPane = document.createElement("div");
  globalPane.className = "kb-visual__global-pane";
  const detailPane = document.createElement("div");
  detailPane.className = "kb-visual__detail-pane";
  const svg = createSvgElement("svg", { viewBox: "0 0 1040 520", role: "img", "aria-label": "全库向量降维图" });
  const backgroundLayer = createSvgElement("g");
  const tetherLayer = createSvgElement("g");
  const focusLayer = createSvgElement("g");
  const matchLayer = createSvgElement("g");
  const labelLayer = createSvgElement("g");
  const hitItems = [];

  points.forEach((point) => {
    const matchIndex = pointMatchIndex(point, matchKeys);
    const actual = scaledPoint(point);
    let x = actual.x;
    let y = actual.y;
    const source = point.source || "unknown";
    const color = colorForSource(source, colorMap);
    const isMatched = matchIndex >= 0;
    if (isMatched) {
      const bucketKey = `${Math.round(actual.x / 18)}:${Math.round(actual.y / 18)}`;
      const bucket = matchedBuckets.get(bucketKey) || [];
      const order = Math.max(0, bucket.indexOf(matchIndex));
      if (bucket.length > 1) {
        const angle = (Math.PI * 2 * order) / bucket.length - Math.PI / 2;
        const spread = 24 + Math.floor(order / 8) * 12;
        x = actual.x + Math.cos(angle) * spread;
        y = actual.y + Math.sin(angle) * spread;
        tetherLayer.appendChild(createSvgElement("line", {
          x1: actual.x,
          y1: actual.y,
          x2: x,
          y2: y,
          class: "kb-visual__match-tether",
        }));
      }
      hitItems.push({ point, matchIndex, source, actual });
    }
    const node = createSvgElement("circle", {
      cx: x,
      cy: y,
      r: isMatched ? 11 : 3.2,
      fill: isMatched ? "#e5485c" : color,
      class: isMatched ? "kb-visual__node kb-visual__node--matched" : "kb-visual__point",
      opacity: isMatched ? 0.96 : 0.36,
    });
    const title = createSvgElement("title");
    title.textContent = [
      isMatched ? `命中 #${matchIndex + 1}` : "全库片段",
      source,
      point.knowledge_unit_id || "",
      point.section_title || point.article_number || "",
      point.text_preview || "",
    ].filter(Boolean).join("\n");
    node.appendChild(title);
    if (isMatched) {
      node.style.cursor = "pointer";
      node.addEventListener("click", () => renderLocalHitPanel(detailPane, hitItems, matchIndex));
    }
    (isMatched ? matchLayer : backgroundLayer).appendChild(node);

    if (isMatched) {
      const rank = createSvgElement("text", { x, y, class: "kb-visual__rank" });
      rank.textContent = String(matchIndex + 1);
      labelLayer.appendChild(rank);
      const labelOffsetY = matchIndex % 2 === 0 ? -17 : 24;
      const label = createSvgElement("text", { x: x + 15, y: y + labelOffsetY, class: "kb-visual__label" });
      label.textContent = `#${matchIndex + 1} ${sourceExtensionLabel(source)}`;
      labelLayer.appendChild(label);
    }
  });

  if (hitItems.length) {
    const xs = hitItems.map((hit) => hit.actual.x);
    const ys = hitItems.map((hit) => hit.actual.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const radius = Math.max(28, Math.min(92, Math.max(maxX - minX, maxY - minY) / 2 + 30));
    focusLayer.appendChild(createSvgElement("circle", {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      r: radius,
      class: "kb-visual__focus-ring",
    }));
  }

  const queryNode = createSvgElement("circle", { cx: 78, cy: 58, r: 18, class: "kb-visual__query" });
  const queryTitle = createSvgElement("title");
  queryTitle.textContent = `Query: ${query || "当前检索问题"}`;
  queryNode.appendChild(queryTitle);
  const queryLabel = createSvgElement("text", { x: 104, y: 63, class: "kb-visual__label" });
  queryLabel.textContent = shortLabel(query || "Query", 32);
  labelLayer.append(queryNode, queryLabel);

  svg.append(backgroundLayer, focusLayer, tetherLayer, matchLayer, labelLayer);
  globalPane.appendChild(svg);
  renderLocalHitPanel(detailPane, hitItems, hitItems[0]?.matchIndex || 0);
  stage.append(globalPane, detailPane);
  visualizationPanelEl.append(toolbar, stage);
}

function renderResultClusterVisualization(results, query = "") {
  if (!visualizationPanelEl) return;
  visualizationPanelEl.innerHTML = "";
  if (!Array.isArray(results) || !results.length) {
    clearVisualization("暂无可视化结果。请先执行一次检索。");
    return;
  }

  const groups = groupResultsForVisualization(results);
  const maxScore = Math.max(...results.map((item) => Math.abs(numericValue(item.score))), 1);

  const toolbar = document.createElement("div");
  toolbar.className = "kb-visual__toolbar";
  const summary = document.createElement("div");
  summary.textContent = `按来源文件聚类 · ${groups.length} 个来源 · ${results.length} 条结果`;
  const legend = document.createElement("div");
  legend.className = "kb-visual__legend";
  groups.slice(0, 6).forEach((group) => {
    const legendItem = document.createElement("span");
    legendItem.className = "kb-visual__legend-item";
    const swatch = document.createElement("span");
    swatch.className = "kb-visual__swatch";
    swatch.style.background = group.color;
    const label = document.createElement("span");
    label.textContent = shortLabel(group.source, 14);
    legendItem.append(swatch, label);
    legend.appendChild(legendItem);
  });
  toolbar.append(summary, legend);

  const stage = document.createElement("div");
  stage.className = "kb-visual__stage";
  const svg = createSvgElement("svg", { viewBox: "0 0 1040 520", role: "img", "aria-label": "检索结果聚类可视化" });
  const queryX = 120;
  const queryY = 260;

  const lineLayer = createSvgElement("g");
  const clusterLayer = createSvgElement("g");
  const nodeLayer = createSvgElement("g");
  const labelLayer = createSvgElement("g");

  const queryNode = createSvgElement("circle", { cx: queryX, cy: queryY, r: 22, class: "kb-visual__query" });
  const queryTitle = createSvgElement("title");
  queryTitle.textContent = `Query: ${query || "当前检索问题"}`;
  queryNode.appendChild(queryTitle);
  nodeLayer.appendChild(queryNode);
  const queryLabel = createSvgElement("text", { x: queryX, y: queryY + 44, class: "kb-visual__label", "text-anchor": "middle" });
  queryLabel.textContent = "Query";
  labelLayer.appendChild(queryLabel);

  groups.forEach((group, groupIndex) => {
    const angle = groups.length === 1 ? 0 : (Math.PI * 2 * groupIndex) / groups.length - Math.PI / 2;
    const centerX = 620 + Math.cos(angle) * 250;
    const centerY = 260 + Math.sin(angle) * 170;
    const clusterRadius = Math.max(54, 36 + group.items.length * 13);

    clusterLayer.appendChild(createSvgElement("circle", {
      cx: centerX,
      cy: centerY,
      r: clusterRadius,
      class: "kb-visual__cluster",
    }));
    const clusterLabel = createSvgElement("text", {
      x: centerX,
      y: centerY - clusterRadius - 10,
      class: "kb-visual__small-label",
      "text-anchor": "middle",
    });
    clusterLabel.textContent = shortLabel(group.source, 18);
    labelLayer.appendChild(clusterLabel);

    group.items.forEach(({ item, index }, itemIndex) => {
      const score = Math.abs(numericValue(item.score));
      const scoreRatio = Math.max(0.12, Math.min(1, score / maxScore));
      const localAngle = (Math.PI * 2 * itemIndex) / Math.max(group.items.length, 1) + groupIndex * 0.7;
      const localRadius = group.items.length === 1 ? 0 : Math.min(clusterRadius - 18, 20 + itemIndex * 9);
      const x = centerX + Math.cos(localAngle) * localRadius - scoreRatio * 36;
      const y = centerY + Math.sin(localAngle) * localRadius;
      const radius = 10 + scoreRatio * 16;
      const title = resultTitle(item, index);
      const textPreview = normalizeResultText(item).slice(0, 180);

      lineLayer.appendChild(createSvgElement("line", {
        x1: queryX + 24,
        y1: queryY,
        x2: x,
        y2: y,
        class: "kb-visual__line",
        "stroke-width": 1.2 + scoreRatio * 4,
      }));

      const node = createSvgElement("circle", {
        cx: x,
        cy: y,
        r: radius,
        fill: group.color,
        class: "kb-visual__node",
      });
      const nodeTitle = createSvgElement("title");
      nodeTitle.textContent = [
        `#${index + 1} ${title}`,
        `score=${numericValue(item.score).toFixed(4)}`,
        `vector=${numericValue(item.vector_score).toFixed(4)}`,
        `keyword=${numericValue(item.keyword_score).toFixed(4)}`,
        `type=${resultChunkType(item)}`,
        textPreview,
      ].join("\n");
      node.appendChild(nodeTitle);
      nodeLayer.appendChild(node);

      const rank = createSvgElement("text", { x, y, class: "kb-visual__rank" });
      rank.textContent = String(index + 1);
      labelLayer.appendChild(rank);

      const label = createSvgElement("text", { x: x + radius + 8, y: y + 4, class: "kb-visual__label" });
      label.textContent = shortLabel(title, 16);
      labelLayer.appendChild(label);
    });
  });

  svg.append(lineLayer, clusterLayer, nodeLayer, labelLayer);
  stage.appendChild(svg);
  visualizationPanelEl.append(toolbar, stage);
}

function createRawDataCard(item) {
  const meta = document.createElement("details");
  meta.className = "kb-result__meta";

  const summary = document.createElement("summary");
  summary.className = "kb-raw-summary";
  const label = document.createElement("span");
  label.textContent = "原始数据";
  summary.append(label);

  const detailCard = document.createElement("div");
  detailCard.className = "kb-raw-card";
  const pre = document.createElement("pre");
  pre.textContent = safeJson(item);
  detailCard.appendChild(pre);

  meta.append(summary, detailCard);
  return meta;
}

function renderResults(results) {
  resultListEl.innerHTML = "";
  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "kb-empty";
    empty.textContent = "没有检索到结果。可以换一个问题，或检查知识库是否已经加载。";
    resultListEl.appendChild(empty);
    return;
  }

  results.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "kb-result";

    const head = document.createElement("div");
    head.className = "kb-result__head";
    const title = document.createElement("span");
    title.textContent = resultTitle(item, index);
    const score = document.createElement("span");
    const rawScore = item.score ?? item.similarity ?? item.distance ?? "";
    score.textContent = rawScore === "" ? `#${index + 1}` : `#${index + 1} · score=${rawScore}`;
    head.append(title, score);

    const text = document.createElement("div");
    text.className = "kb-result__text";
    text.textContent = normalizeResultText(item);

    const meta = createRawDataCard(item);

    card.append(head, text, meta);
    resultListEl.appendChild(card);
  });
}

function updateRequestHint() {
  const topK = Number.parseInt(topKInputEl.value, 10);
  const mode = modeInputEl.value.trim();
  const requestedTopK = Number.isFinite(topK) ? `${topK} 条` : "后端默认条数";
  const requestedMode = mode || "后端默认模式";
  if (resultMetaEl) {
    resultMetaEl.textContent = `待检索 · 本次将使用 ${requestedMode}，请求返回 ${requestedTopK}`;
  }
}

async function refreshStatus() {
  setStatus("正在检查知识库连接...", "checking", ["请稍等，正在请求后端状态接口。"]);
  try {
    const data = await api("/api/knowledge/status");
    const status = describeKnowledgeStatus(data.knowledge || {});
    setStatus(status.text, status.kind, status.details);
  } catch (err) {
    setStatus(`连接失败：${err.message || err}`, "error", [
      "前端没有成功请求到 /api/knowledge/status。",
      "请确认 webchat 服务正在运行，并且 token 没有填错。",
    ]);
  }
}

async function searchKnowledge() {
  const query = queryInputEl.value.trim();
  if (!query) {
    queryInputEl.focus();
    setStatus("请先输入测试问题。", "error");
    return;
  }

  searchBtn.disabled = true;
  resultMetaEl.textContent = "检索中...";
  resultListEl.innerHTML = "";
  lastResults = [];
  lastQuery = query;
  clearVisualization("正在等待本次检索结果...");

  try {
    const topK = Number.parseInt(topKInputEl.value, 10);
    const mode = modeInputEl.value.trim();
    const requestedTopK = Number.isFinite(topK) ? topK : "后端默认";
    const requestedMode = mode || "后端默认";
    resultMetaEl.textContent = `检索中...本次请求：${requestedMode} 模式，返回 ${requestedTopK} 条`;
    const data = await api("/api/knowledge/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        top_k: Number.isFinite(topK) ? topK : undefined,
        mode: mode || undefined,
      }),
    });
    const results = Array.isArray(data.results) ? data.results : [];
    lastResults = results;
    lastQuery = data.query || query;
    resultMetaEl.textContent = `${results.length} 条结果 · 本次请求 ${requestedTopK} 条 · ${requestedMode} 模式 · query="${data.query || query}"`;
    renderResults(results);
    renderVisualization(results, lastQuery);

    if (data.knowledge) {
      const status = describeKnowledgeStatus(data.knowledge);
      setStatus(status.text, status.kind, status.details);
    }
  } catch (err) {
    resultMetaEl.textContent = "检索失败";
    const empty = document.createElement("div");
    empty.className = "kb-empty";
    empty.textContent = `请求失败：${err.message || err}`;
    resultListEl.appendChild(empty);
    clearVisualization(`检索失败：${err.message || err}`);
  } finally {
    searchBtn.disabled = false;
  }
}

refreshStatusBtn.addEventListener("click", () => void refreshStatus());
searchBtn.addEventListener("click", () => void searchKnowledge());
resultViewButtons.forEach((button) => {
  button.addEventListener("click", () => setResultView(button.dataset.resultView || "list"));
});
topKInputEl.addEventListener("input", updateRequestHint);
modeInputEl.addEventListener("input", updateRequestHint);
queryInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void searchKnowledge();
  }
});

updateRequestHint();
clearVisualization();
setResultView("list");
void loadVisualization();
void refreshStatus();
