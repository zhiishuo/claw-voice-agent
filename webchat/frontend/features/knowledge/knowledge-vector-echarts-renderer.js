import {
  escapeHtml,
  numberValue,
  scoreColor,
  scoreRatio,
  titleOf,
} from "./knowledge-lab-utils.js";

const DEFAULT_BOUNDS = { minX: -1, maxX: 1, minY: -1, maxY: 1 };

function pointBounds(points, fallback = DEFAULT_BOUNDS) {
  const valid = (points || []).filter((point) => Number.isFinite(numberValue(point?.x)) && Number.isFinite(numberValue(point?.y)));
  if (!valid.length) return { ...fallback };
  const xs = valid.map((point) => numberValue(point.x));
  const ys = valid.map((point) => numberValue(point.y));
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function paddedBounds(bounds, ratio = 0.06, minSpan = 0.08) {
  const width = Math.max(bounds.maxX - bounds.minX, minSpan);
  const height = Math.max(bounds.maxY - bounds.minY, minSpan);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const paddedWidth = width * (1 + ratio * 2);
  const paddedHeight = height * (1 + ratio * 2);
  return {
    minX: centerX - paddedWidth / 2,
    maxX: centerX + paddedWidth / 2,
    minY: centerY - paddedHeight / 2,
    maxY: centerY + paddedHeight / 2,
  };
}

function scoreSize(result, stats) {
  return 12 + scoreRatio(result, stats) * 8;
}

function scoreLineWidth(result, stats) {
  return 1.2 + scoreRatio(result, stats) * 4.2;
}

function scoreLineOpacity(result, stats) {
  return 0.24 + scoreRatio(result, stats) * 0.46;
}

function pointSource(point) {
  return point?.source || point?.filename || point?.metadata?.source || "unknown";
}

function getChartOption({ viz, hitPoints, queryPoint, stats }) {
  const allPoints = viz?.points || [];
  const allBounds = paddedBounds(pointBounds(allPoints), 0.04, 0.08);
  const hitData = hitPoints.map(({ point, result, rank }) => ({
    value: [numberValue(point.x), numberValue(point.y), numberValue(result?.score)],
    rank,
    point,
    result,
  }));
  const lineData = hitPoints.map(({ point, result }) => ({
    coords: [
      [numberValue(queryPoint.x), numberValue(queryPoint.y)],
      [numberValue(point.x), numberValue(point.y)],
    ],
    lineStyle: {
      width: scoreLineWidth(result, stats),
      opacity: scoreLineOpacity(result, stats),
      color: scoreColor(scoreRatio(result, stats)),
    },
  }));

  return {
    animation: false,
    backgroundColor: "#ffffff",
    grid: { left: 0, right: 0, top: 0, bottom: 0, containLabel: false },
    tooltip: {
      trigger: "item",
      confine: true,
      borderWidth: 1,
      borderColor: "#bfdbfe",
      backgroundColor: "rgba(255,255,255,0.98)",
      textStyle: { color: "#334155", fontSize: 12 },
      formatter(params) {
        if (params.seriesName === "Top-K") {
          const data = params.data || {};
          const result = data.result || {};
          const score = typeof result.score === "number" ? result.score.toFixed(4) : "n/a";
          const vectorScore = typeof result.vector_score === "number" ? result.vector_score.toFixed(4) : "";
          const keywordScore = typeof result.keyword_score === "number" ? result.keyword_score.toFixed(4) : "";
          return [
            `<b>#${escapeHtml(data.rank)} ${escapeHtml(titleOf(result, data.rank - 1))}</b>`,
            `score ${escapeHtml(score)}`,
            vectorScore ? `vector ${escapeHtml(vectorScore)}` : "",
            keywordScore ? `keyword ${escapeHtml(keywordScore)}` : "",
            escapeHtml(String(result.text || "").slice(0, 160)),
          ].filter(Boolean).join("<br>");
        }
        if (params.seriesName === "Query") {
          return "<b>Query</b><br>用户问题二维投影位置";
        }
        const data = params.data || [];
        return `<b>${escapeHtml(pointSource({ source: data[3] }))}</b><br>chunk ${escapeHtml(data[2] ?? "")}`;
      },
    },
    xAxis: {
      type: "value",
      show: false,
      scale: true,
      min: allBounds.minX,
      max: allBounds.maxX,
    },
    yAxis: {
      type: "value",
      show: false,
      scale: true,
      min: allBounds.minY,
      max: allBounds.maxY,
    },
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: 0,
        filterMode: "none",
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: true,
      },
      {
        type: "inside",
        yAxisIndex: 0,
        filterMode: "none",
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: true,
      },
    ],
    series: [
      {
        name: "全库片段",
        type: "scatter",
        data: allPoints.map((point) => [
          numberValue(point.x),
          numberValue(point.y),
          point.id,
          point.source,
        ]),
        symbolSize: 3,
        large: true,
        largeThreshold: 5000,
        progressive: 8000,
        progressiveThreshold: 10000,
        itemStyle: { color: "rgba(130, 148, 170, 0.58)" },
        emphasis: { disabled: true },
        z: 1,
      },
      {
        name: "关联线",
        type: "lines",
        coordinateSystem: "cartesian2d",
        data: lineData,
        silent: true,
        lineStyle: { curveness: 0, cap: "round" },
        z: 3,
      },
      {
        name: "Top-K",
        type: "scatter",
        data: hitData,
        symbolSize: (value, params) => scoreSize(params?.data?.result, stats),
        label: {
          show: true,
          formatter: (params) => `#${params.data.rank}`,
          position: "top",
          distance: 8,
          color: "#0f45c9",
          fontSize: 14,
          fontWeight: 900,
        },
        labelLayout: { hideOverlap: true },
        itemStyle: {
          color: "#145dff",
          borderColor: "#ffffff",
          borderWidth: 2.4,
          shadowBlur: 8,
          shadowColor: "rgba(20, 93, 255, 0.22)",
        },
        z: 8,
      },
      {
        name: "Query",
        type: "scatter",
        data: [{
          value: [numberValue(queryPoint.x), numberValue(queryPoint.y)],
        }],
        symbolSize: 20,
        label: {
          show: true,
          formatter: "Query",
          position: "right",
          distance: 8,
          color: "#ef233c",
          fontSize: 13,
          fontWeight: 900,
        },
        itemStyle: {
          color: "#ef233c",
          borderColor: "#ffffff",
          borderWidth: 3,
          shadowBlur: 10,
          shadowColor: "rgba(239, 35, 60, 0.26)",
        },
        z: 10,
      },
    ],
  };
}

function dispatchRange(chart, xRange, yRange) {
  chart.dispatchAction({
    type: "dataZoom",
    batch: [
      { dataZoomIndex: 0, startValue: xRange.min, endValue: xRange.max },
      { dataZoomIndex: 1, startValue: yRange.min, endValue: yRange.max },
    ],
  });
}

function focusBounds(hitPoints, queryPoint) {
  const points = [
    queryPoint,
    ...hitPoints.map((item) => item.point),
  ];
  const bounds = paddedBounds(pointBounds(points), 0.34, 0.12);
  return {
    x: { min: bounds.minX, max: bounds.maxX },
    y: { min: bounds.minY, max: bounds.maxY },
  };
}

function zoomAroundCenter(chart, factor) {
  const option = chart.getOption();
  const xAxis = option.xAxis?.[0] || DEFAULT_BOUNDS;
  const yAxis = option.yAxis?.[0] || DEFAULT_BOUNDS;
  const zoomX = option.dataZoom?.[0] || {};
  const zoomY = option.dataZoom?.[1] || {};
  const current = {
    minX: Number.isFinite(zoomX.startValue) ? zoomX.startValue : numberValue(xAxis.min),
    maxX: Number.isFinite(zoomX.endValue) ? zoomX.endValue : numberValue(xAxis.max),
    minY: Number.isFinite(zoomY.startValue) ? zoomY.startValue : numberValue(yAxis.min),
    maxY: Number.isFinite(zoomY.endValue) ? zoomY.endValue : numberValue(yAxis.max),
  };
  const centerX = (current.minX + current.maxX) / 2;
  const centerY = (current.minY + current.maxY) / 2;
  const width = Math.max(current.maxX - current.minX, 0.0001) / factor;
  const height = Math.max(current.maxY - current.minY, 0.0001) / factor;
  dispatchRange(
    chart,
    { min: centerX - width / 2, max: centerX + width / 2 },
    { min: centerY - height / 2, max: centerY + height / 2 },
  );
}

export function createKnowledgeVectorEchartsRenderer({ chartEl, controls }) {
  if (!chartEl) return { dispose() {} };
  if (!window.echarts) {
    chartEl.innerHTML = `
      <div class="kb-empty-state">
        ECharts 未加载，无法渲染全库向量图。请确认页面已引入 echarts.min.js。
      </div>
    `;
    return { dispose() {} };
  }

  const chart = window.echarts.init(chartEl, null, { renderer: "canvas" });
  let resizeObserver = null;
  let fullRange = {
    x: { min: DEFAULT_BOUNDS.minX, max: DEFAULT_BOUNDS.maxX },
    y: { min: DEFAULT_BOUNDS.minY, max: DEFAULT_BOUNDS.maxY },
  };
  let currentFocus = null;

  const updateScale = () => {
    const label = controls?.querySelector(".kb-map-scale");
    if (!label) return;
    const option = chart.getOption();
    const zoomX = option.dataZoom?.[0] || {};
    const start = Number.isFinite(zoomX.start) ? zoomX.start : 0;
    const end = Number.isFinite(zoomX.end) ? zoomX.end : 100;
    const span = Math.max(end - start, 1);
    label.textContent = `${Math.round(10000 / span)}%`;
  };

  const render = ({ viz, hitPoints, queryPoint, stats }) => {
    const option = getChartOption({ viz, hitPoints, queryPoint, stats });
    fullRange = {
      x: { min: option.xAxis.min, max: option.xAxis.max },
      y: { min: option.yAxis.min, max: option.yAxis.max },
    };
    currentFocus = focusBounds(hitPoints, queryPoint);
    chart.setOption(option, true);
    updateScale();
    requestAnimationFrame(() => chart.resize());
  };

  const onControlClick = (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "zoom-in") zoomAroundCenter(chart, 1.25);
    if (button.dataset.action === "zoom-out") zoomAroundCenter(chart, 0.8);
    if (button.dataset.action === "focus" && currentFocus) dispatchRange(chart, currentFocus.x, currentFocus.y);
    if (button.dataset.action === "reset") dispatchRange(chart, fullRange.x, fullRange.y);
    updateScale();
  };

  controls?.addEventListener("click", onControlClick);
  chart.on("dataZoom", updateScale);
  resizeObserver = new ResizeObserver(() => chart.resize());
  resizeObserver.observe(chartEl);

  return {
    render,
    dispose() {
      controls?.removeEventListener("click", onControlClick);
      resizeObserver?.disconnect();
      chart.dispose();
    },
  };
}
