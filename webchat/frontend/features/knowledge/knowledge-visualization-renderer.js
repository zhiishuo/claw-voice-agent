import {
  escapeHtml,
  numberValue,
  scoreColor,
  scoreRatio,
  scoreStats,
  titleOf,
} from "./knowledge-lab-utils.js";
import { createKnowledgeVectorEchartsRenderer } from "./knowledge-vector-echarts-renderer.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const VIEWBOX = { width: 1180, height: 640, pad: 44 };
const LOCAL_VIEWBOX = { width: 420, height: 520, pad: 42 };

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== null && value !== undefined) el.setAttribute(key, String(value));
  });
  return el;
}

function projectPoint(point, box = VIEWBOX) {
  const x = box.pad + ((numberValue(point?.x) + 1) / 2) * (box.width - box.pad * 2);
  const y = box.pad + ((1 - (numberValue(point?.y) + 1) / 2)) * (box.height - box.pad * 2);
  return { x, y };
}

function clampView(view) {
  view.scale = Math.max(1, Math.min(8, view.scale));
  if (view.scale <= 1) {
    view.tx = 0;
    view.ty = 0;
    return view;
  }
  view.tx = Math.max(VIEWBOX.width * (1 - view.scale), Math.min(0, view.tx));
  view.ty = Math.max(VIEWBOX.height * (1 - view.scale), Math.min(0, view.ty));
  return view;
}

function transformPoint(point, view) {
  return {
    x: point.x * view.scale + view.tx,
    y: point.y * view.scale + view.ty,
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function displayHitsForMap(hitPoints, queryProjected, stats) {
  const rows = hitPoints.map((item) => ({
    ...item,
    projected: projectPoint(item.point),
  }));
  if (rows.length < 2) return rows.map((item) => ({ ...item, display: item.projected, expanded: false }));

  const xs = rows.map((item) => item.projected.x);
  const ys = rows.map((item) => item.projected.y);
  const nearQueryCount = rows.filter((item) => distance(item.projected, queryProjected) < 76).length;
  const clusterWidth = Math.max(...xs) - Math.min(...xs);
  const clusterHeight = Math.max(...ys) - Math.min(...ys);
  const shouldExpand = nearQueryCount >= 2 || Math.max(clusterWidth, clusterHeight) < 86;
  if (!shouldExpand) return rows.map((item) => ({ ...item, display: item.projected, expanded: false }));

  return rows.map((item, index) => {
    const ratio = scoreRatio(item.result, stats);
    const angle = (Math.PI * 2 * index) / rows.length - Math.PI / 2;
    const radius = 58 + (index % 2) * 28 + ratio * 18;
    return {
      ...item,
      display: {
        x: queryProjected.x + Math.cos(angle) * radius,
        y: queryProjected.y + Math.sin(angle) * radius,
      },
      expanded: true,
    };
  });
}

function createPointIndex(viz) {
  const index = new Map();
  for (const point of viz?.points || []) {
    if (point.id !== undefined) index.set(`id:${point.id}`, point);
    if (point.knowledge_unit_id) index.set(`unit:${point.knowledge_unit_id}`, point);
  }
  return index;
}

function findPoint(index, result) {
  const meta = result?.metadata || {};
  const candidates = [
    result?.id !== undefined ? `id:${result.id}` : "",
    meta.chunk_index !== undefined ? `id:${meta.chunk_index}` : "",
    meta.knowledge_unit_id ? `unit:${meta.knowledge_unit_id}` : "",
    result?.knowledge_unit_id ? `unit:${result.knowledge_unit_id}` : "",
  ];
  for (const key of candidates) {
    if (key && index.has(key)) return index.get(key);
  }
  return null;
}

function approximateQueryPoint(hitPoints, results) {
  if (!hitPoints.length) return { x: -0.86, y: 0 };
  const stats = scoreStats(results);
  let weightSum = 0;
  let x = 0;
  let y = 0;
  hitPoints.forEach(({ point, result }) => {
    const weight = 0.35 + scoreRatio(result, stats);
    x += numberValue(point.x) * weight;
    y += numberValue(point.y) * weight;
    weightSum += weight;
  });
  if (!weightSum) return { x: -0.86, y: 0 };
  return { x: x / weightSum, y: y / weightSum };
}

function isDegenerate(points) {
  if (points.length < 3) return points.length > 1;
  const xs = points.map((item) => item.x);
  const ys = points.map((item) => item.y);
  const xSpan = Math.max(...xs) - Math.min(...xs);
  const ySpan = Math.max(...ys) - Math.min(...ys);
  return xSpan < 0.035 || ySpan < 0.035 || Math.min(xSpan, ySpan) / Math.max(xSpan, ySpan, 0.000001) < 0.12;
}

function localPositions(hitPoints, queryPoint) {
  return hitPoints.map(({ point, result, rank }) => ({
    x: numberValue(point.x),
    y: numberValue(point.y),
    result,
    rank,
  }));
}

function fitLocalProjector(points, queryPoint) {
  const all = [...points, queryPoint];
  const xs = all.map((item) => item.x);
  const ys = all.map((item) => item.y);
  let minX = Math.min(...xs);
  let maxX = Math.max(...xs);
  let minY = Math.min(...ys);
  let maxY = Math.max(...ys);
  const width = Math.max(maxX - minX, 0.08);
  const height = Math.max(maxY - minY, 0.08);
  minX -= width * 0.22;
  maxX += width * 0.22;
  minY -= height * 0.22;
  maxY += height * 0.22;

  return (point) => ({
    x: LOCAL_VIEWBOX.pad + ((point.x - minX) / Math.max(maxX - minX, 0.000001)) * (LOCAL_VIEWBOX.width - LOCAL_VIEWBOX.pad * 2),
    y: LOCAL_VIEWBOX.pad + (1 - ((point.y - minY) / Math.max(maxY - minY, 0.000001))) * (LOCAL_VIEWBOX.height - LOCAL_VIEWBOX.pad * 2),
  });
}

export function createKnowledgeVisualizationRenderer(kbVizContent) {
  let kbVisualization = null;
  let visualizationError = "";
  let pointIndex = null;
  let pointIndexKey = "";
  let vectorMapRenderer = null;

  function setVisualization(viz) {
    if (viz?.available && Array.isArray(viz.points) && viz.points.length) {
      kbVisualization = viz;
      visualizationError = "";
      pointIndex = null;
      pointIndexKey = "";
    } else {
      kbVisualization = null;
      visualizationError = viz?.error || "visualization file not available";
    }
  }

  function setError(error) {
    kbVisualization = null;
    visualizationError = error?.message || String(error || "");
  }

  function ensurePointIndex(viz) {
    const key = `${viz.path || ""}:${viz.count || viz.points?.length || 0}:${viz.method || ""}`;
    if (!pointIndex || pointIndexKey !== key) {
      pointIndex = createPointIndex(viz);
      pointIndexKey = key;
    }
    return pointIndex;
  }

  function canvasPoint(point, cssWidth, cssHeight, view) {
    const projected = projectPoint(point);
    const transformed = transformPoint(projected, view);
    return {
      x: (transformed.x / VIEWBOX.width) * cssWidth,
      y: (transformed.y / VIEWBOX.height) * cssHeight,
    };
  }

  function paintBaseCanvas(canvas, viz, mapEl, view = { scale: 1, tx: 0, ty: 0 }, hitPoints = [], queryPoint = null, stats = null) {
    const rect = mapEl.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width || VIEWBOX.width));
    const cssHeight = Math.max(1, Math.round(rect.height || VIEWBOX.height));
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = "#9aa8ba";
    for (const point of viz?.points || []) {
      const { x, y } = canvasPoint(point, cssWidth, cssHeight, view);
      if (x < -8 || y < -8 || x > cssWidth + 8 || y > cssHeight + 8) continue;
      ctx.globalAlpha = 0.62;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.35, Math.min(4.4, 1.55 * Math.sqrt(view.scale))), 0, Math.PI * 2);
      ctx.fill();
    }

    for (const { point, result } of hitPoints) {
      const { x, y } = canvasPoint(point, cssWidth, cssHeight, view);
      if (x < -18 || y < -18 || x > cssWidth + 18 || y > cssHeight + 18) continue;
      const ratio = stats ? scoreRatio(result, stats) : 0.5;
      ctx.globalAlpha = 0.98;
      ctx.fillStyle = "#145dff";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(5.5, Math.min(13, (5.5 + ratio * 3) * Math.sqrt(view.scale))), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (queryPoint) {
      const { x, y } = canvasPoint(queryPoint, cssWidth, cssHeight, view);
      ctx.globalAlpha = 0.98;
      ctx.fillStyle = "#ef233c";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(7, Math.min(16, 7 * Math.sqrt(view.scale))), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  function render(results, query, queryPointFromBackend = null) {
    if (!kbVizContent) return;
    vectorMapRenderer?.dispose?.();
    vectorMapRenderer = null;
    if (kbVisualization?.points?.length) {
      renderWholeKbViz(kbVisualization, results, query, queryPointFromBackend);
    } else if (results?.length) {
      renderFallbackViz(results, query);
    } else {
      kbVizContent.innerHTML = `<div class="kb-empty-state">暂无可视化数据。${visualizationError ? `后端提示：${escapeHtml(visualizationError)}` : "请先执行一次检索。"}</div>`;
    }
  }

  function renderWholeKbViz(viz, results, query, queryPointFromBackend = null) {
    const index = ensurePointIndex(viz);
    const hitPoints = (results || []).map((result, resultIndex) => {
      const point = findPoint(index, result);
      return point ? { point, result, rank: resultIndex + 1 } : null;
    }).filter(Boolean);
    const queryPoint = queryPointFromBackend?.projected
      ? { x: numberValue(queryPointFromBackend.x), y: numberValue(queryPointFromBackend.y), projected: true }
      : approximateQueryPoint(hitPoints, results);
    const stats = scoreStats(results);

    const shell = document.createElement("div");
    shell.className = "kb-viz-shell";

    const main = document.createElement("div");
    main.className = "kb-viz-map";
    const chartEl = document.createElement("div");
    chartEl.className = "kb-viz-echarts";
    const controls = document.createElement("div");
    controls.className = "kb-map-controls";
    controls.innerHTML = `
      <button type="button" data-action="zoom-in" title="放大"><i class="fa-solid fa-plus"></i></button>
      <button type="button" data-action="zoom-out" title="缩小"><i class="fa-solid fa-minus"></i></button>
      <button type="button" data-action="focus" title="聚焦 Query 和 Top-K"><i class="fa-solid fa-location-crosshairs"></i></button>
      <button type="button" data-action="reset" title="重置"><i class="fa-solid fa-expand"></i></button>
      <span class="kb-map-scale">100%</span>
    `;

    main.appendChild(chartEl);
    main.appendChild(controls);

    const mainWrap = document.createElement("div");
    mainWrap.className = "kb-viz-main-col";
    mainWrap.appendChild(main);
    mainWrap.appendChild(renderMeta(viz, hitPoints, queryPoint));
    shell.appendChild(mainWrap);
    shell.appendChild(renderSidePanel(hitPoints, queryPoint, stats));

    kbVizContent.innerHTML = "";
    kbVizContent.appendChild(shell);
    vectorMapRenderer = createKnowledgeVectorEchartsRenderer({ chartEl, controls });
    vectorMapRenderer.render?.({ viz, hitPoints, queryPoint, stats, query });
  }

  function installMapInteractions({ main, canvas, overlayViewport, controls, infoBox, viz, hitPoints, queryPoint, stats, view }) {
    const scaleLabel = controls.querySelector(".kb-map-scale");
    let dragging = false;
    let last = null;
    let moved = false;

    const applyView = () => {
      clampView(view);
      overlayViewport.setAttribute("transform", `translate(${view.tx} ${view.ty}) scale(${view.scale})`);
      if (scaleLabel) scaleLabel.textContent = `${Math.round(view.scale * 100)}%`;
      paintBaseCanvas(canvas, viz, main, view, hitPoints, queryPoint, stats);
      infoBox.classList.add("hidden");
    };

    const zoomAt = (clientX, clientY, factor) => {
      const rect = main.getBoundingClientRect();
      const vx = ((clientX - rect.left) / Math.max(rect.width, 1)) * VIEWBOX.width;
      const vy = ((clientY - rect.top) / Math.max(rect.height, 1)) * VIEWBOX.height;
      const worldX = (vx - view.tx) / view.scale;
      const worldY = (vy - view.ty) / view.scale;
      const nextScale = Math.max(1, Math.min(8, view.scale * factor));
      view.tx = vx - worldX * nextScale;
      view.ty = vy - worldY * nextScale;
      view.scale = nextScale;
      applyView();
    };

    controls.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const rect = main.getBoundingClientRect();
      if (button.dataset.action === "zoom-in") zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.25);
      if (button.dataset.action === "zoom-out") zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.8);
      if (button.dataset.action === "reset") {
        view.scale = 1;
        view.tx = 0;
        view.ty = 0;
        applyView();
      }
    });

    main.addEventListener("wheel", (event) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 0.9);
    }, { passive: false });

    main.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".kb-map-controls")) return;
      dragging = true;
      moved = false;
      last = { x: event.clientX, y: event.clientY };
      main.setPointerCapture?.(event.pointerId);
      main.classList.add("is-panning");
    });

    main.addEventListener("pointermove", (event) => {
      if (!dragging || !last) return;
      const rect = main.getBoundingClientRect();
      const dx = ((event.clientX - last.x) / Math.max(rect.width, 1)) * VIEWBOX.width;
      const dy = ((event.clientY - last.y) / Math.max(rect.height, 1)) * VIEWBOX.height;
      if (Math.abs(dx) + Math.abs(dy) > 0.8) moved = true;
      view.tx += dx;
      view.ty += dy;
      last = { x: event.clientX, y: event.clientY };
      applyView();
    });

    main.addEventListener("pointerup", (event) => {
      dragging = false;
      last = null;
      main.releasePointerCapture?.(event.pointerId);
      main.classList.remove("is-panning");
      if (!moved && !event.target.closest(".kb-viz-hit-point, .kb-viz-query-point")) {
        infoBox.classList.add("hidden");
      }
    });

    requestAnimationFrame(applyView);
  }

  function showPointInfo(infoBox, point, view, detail) {
    const transformed = transformPoint(point, view);
    const left = Math.max(12, Math.min(88, (transformed.x / VIEWBOX.width) * 100));
    const top = Math.max(10, Math.min(86, (transformed.y / VIEWBOX.height) * 100));
    infoBox.style.left = `${left}%`;
    infoBox.style.top = `${top}%`;
    infoBox.innerHTML = `
      <div class="kb-viz-point-title">${escapeHtml(detail.title)}</div>
      <div class="kb-viz-point-meta">${escapeHtml(detail.meta)}</div>
      <div class="kb-viz-point-text">${escapeHtml(String(detail.text || "").slice(0, 180))}</div>
    `;
    infoBox.classList.remove("hidden");
  }

  function renderMeta(viz, hitPoints, queryPoint) {
    const meta = document.createElement("div");
    meta.className = "kb-viz-meta";
    const queryLabel = queryPoint?.projected ? "用户问题真实位置" : "用户问题近似位置";
    meta.innerHTML = `
      <span><i class="kb-dot kb-dot--gray"></i> 全库片段 ${escapeHtml(viz.count || viz.points.length)}</span>
      <span><i class="kb-dot kb-dot--blue"></i> Top-K ${hitPoints.length}</span>
      <span><i class="kb-dot kb-dot--red"></i> ${queryLabel}</span>
      <span>方法：${escapeHtml(viz.method || "unknown")}</span>
    `;
    return meta;
  }

  function renderSidePanel(hitPoints, queryPoint, stats) {
    const side = document.createElement("aside");
    side.className = "kb-viz-side";
    side.appendChild(renderLocalViz(hitPoints, queryPoint, stats));
    side.appendChild(renderHitList(hitPoints, stats));
    return side;
  }

  function renderLocalViz(hitPoints, queryPoint, stats) {
    const panel = document.createElement("section");
    panel.className = "kb-viz-local";
    const local = localPositions(hitPoints, queryPoint);
    const project = fitLocalProjector(local, queryPoint);
    const queryProjected = project(queryPoint);
    const svg = svgEl("svg", { viewBox: `0 0 ${LOCAL_VIEWBOX.width} ${LOCAL_VIEWBOX.height}`, class: "kb-viz-local-svg" });

    local.forEach((item) => {
      const projected = project(item);
      const ratio = scoreRatio(item.result, stats);
      svg.appendChild(svgEl("line", {
        x1: queryProjected.x,
        y1: queryProjected.y,
        x2: projected.x,
        y2: projected.y,
        stroke: scoreColor(ratio),
        "stroke-width": (2 + ratio * 6).toFixed(2),
        "stroke-linecap": "round",
      }));
      svg.appendChild(svgEl("circle", { cx: projected.x, cy: projected.y, r: 15 + ratio * 8, fill: "#145dff", stroke: "#ffffff", "stroke-width": "2.8", opacity: 0.96 }));
      const rank = svgEl("text", { x: projected.x, y: projected.y + 6, fill: "#fff", "font-size": "14", "font-weight": "900", "text-anchor": "middle" });
      rank.textContent = String(item.rank);
      svg.appendChild(rank);
    });

    svg.appendChild(svgEl("circle", { cx: queryProjected.x, cy: queryProjected.y, r: 20, fill: "#ef233c", stroke: "#ffffff", "stroke-width": "3" }));
    const q = svgEl("text", { x: queryProjected.x, y: queryProjected.y + 6, fill: "#fff", "font-size": "14", "font-weight": "900", "text-anchor": "middle" });
    q.textContent = "Q";
    svg.appendChild(q);

    panel.innerHTML = `
      <div class="kb-viz-local-title">局部放大</div>
      <div class="kb-viz-local-note">基于左侧全库向量图的真实二维位置裁剪放大，蓝点为当前 Top-K。</div>
    `;
    panel.appendChild(svg);
    return panel;
  }

  function renderHitList(hitPoints, stats) {
    const panel = document.createElement("section");
    panel.className = "kb-viz-docs";
    const rows = hitPoints.map(({ result, rank }) => {
      const ratio = scoreRatio(result, stats);
      const score = typeof result.score === "number" ? result.score.toFixed(4) : "n/a";
      return `
        <div class="kb-viz-doc" data-rank="${rank}">
          <span class="kb-viz-doc-rank">#${rank}</span>
          <span class="kb-viz-doc-main">
            <span class="kb-viz-doc-title">${escapeHtml(titleOf(result, rank - 1))}</span>
            <span class="kb-viz-doc-score" style="--score-opacity:${(0.45 + ratio * 0.55).toFixed(2)}">score ${score}</span>
          </span>
          <button class="kb-viz-doc-detail-btn" type="button" data-rank="${rank}">详情</button>
        </div>
      `;
    }).join("");

    panel.innerHTML = `
      <div class="kb-viz-docs-title">命中文档</div>
      <div class="kb-viz-docs-list">${rows || '<div class="kb-viz-doc-empty">暂无 Top-K 命中</div>'}</div>
    `;

    const rowsEls = Array.from(panel.querySelectorAll(".kb-viz-doc"));
    const showDetail = (rank) => {
      const hit = hitPoints.find((item) => item.rank === rank);
      if (!hit) return;
      const result = hit.result || {};
      const meta = result.metadata || {};
      const source = titleOf(result, rank - 1);
      const score = typeof result.score === "number" ? result.score.toFixed(4) : "n/a";
      const vectorScore = typeof result.vector_score === "number" ? result.vector_score.toFixed(4) : "";
      const keywordScore = typeof result.keyword_score === "number" ? result.keyword_score.toFixed(4) : "";
      rowsEls.forEach((row) => row.classList.toggle("active", Number(row.dataset.rank) === rank));
      openDetailModal({
        rank,
        source,
        score,
        vectorScore,
        keywordScore,
        page: meta.page,
        rowStart: meta.row_start,
        text: result.text || "暂无文本内容",
      });
    };

    panel.querySelectorAll(".kb-viz-doc-detail-btn").forEach((button) => {
      button.addEventListener("click", () => showDetail(Number(button.dataset.rank)));
    });
    return panel;
  }

  function openDetailModal(detail) {
    let modal = document.querySelector(".kb-doc-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.className = "kb-doc-modal hidden";
      modal.innerHTML = `
        <div class="kb-doc-modal-backdrop"></div>
        <div class="kb-doc-modal-panel" role="dialog" aria-modal="true" aria-label="命中文档详情">
          <div class="kb-doc-modal-head">
            <div>
              <div class="kb-doc-modal-eyebrow">Top-K 文档</div>
              <h3 class="kb-doc-modal-title"></h3>
            </div>
            <button class="kb-doc-modal-close" type="button" aria-label="关闭"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="kb-doc-modal-meta"></div>
          <div class="kb-doc-modal-text"></div>
        </div>
      `;
      document.body.appendChild(modal);
      modal.querySelector(".kb-doc-modal-backdrop")?.addEventListener("click", () => closeDetailModal(modal));
      modal.querySelector(".kb-doc-modal-close")?.addEventListener("click", () => closeDetailModal(modal));
    }

    modal.querySelector(".kb-doc-modal-title").textContent = `#${detail.rank} ${detail.source}`;
    modal.querySelector(".kb-doc-modal-meta").textContent = [
      `score ${detail.score}`,
      detail.vectorScore ? `vector ${detail.vectorScore}` : "",
      detail.keywordScore ? `keyword ${detail.keywordScore}` : "",
      detail.page ? `p.${detail.page}` : "",
      detail.rowStart ? `row ${detail.rowStart}` : "",
    ].filter(Boolean).join(" · ");
    modal.querySelector(".kb-doc-modal-text").textContent = detail.text;
    modal.classList.remove("hidden");
  }

  function closeDetailModal(modal) {
    modal?.classList.add("hidden");
  }

  function renderFallbackViz(results, query) {
    const stats = scoreStats(results);
    const queryPoint = { x: 90, y: 190 };
    const svg = svgEl("svg", { viewBox: "0 0 760 380", class: "kb-fallback-svg" });
    svg.appendChild(svgEl("circle", { cx: queryPoint.x, cy: queryPoint.y, r: 15, fill: "#ef4444" }));
    const label = svgEl("text", { x: queryPoint.x, y: queryPoint.y + 4, fill: "#fff", "font-size": "10", "font-weight": "700", "text-anchor": "middle" });
    label.textContent = "Q";
    svg.appendChild(label);

    results.forEach((item, index) => {
      const ratio = scoreRatio(item, stats);
      const angle = (Math.PI * 2 * index) / Math.max(results.length, 1) - Math.PI / 2;
      const x = 440 + Math.cos(angle) * (130 + (index % 2) * 42);
      const y = 190 + Math.sin(angle) * 112;
      svg.appendChild(svgEl("line", {
        x1: queryPoint.x + 15,
        y1: queryPoint.y,
        x2: x,
        y2: y,
        stroke: scoreColor(ratio),
        "stroke-width": (1.4 + ratio * 4).toFixed(2),
        "stroke-linecap": "round",
      }));
      svg.appendChild(svgEl("circle", { cx: x, cy: y, r: 10 + ratio * 5, fill: "#2563eb", opacity: 0.9 }));
      const rank = svgEl("text", { x, y: y + 4, fill: "#fff", "font-size": "10", "font-weight": "700", "text-anchor": "middle" });
      rank.textContent = String(index + 1);
      svg.appendChild(rank);
    });

    kbVizContent.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "kb-fallback-viz";
    wrapper.appendChild(svg);
    wrapper.insertAdjacentHTML("beforeend", `<div class="kb-viz-meta">未加载全库 visualization.json，当前展示 Top-K 聚类备用视图。${query ? `query="${escapeHtml(query)}"` : ""}</div>`);
    kbVizContent.appendChild(wrapper);
  }

  return { render, setError, setVisualization };
}
