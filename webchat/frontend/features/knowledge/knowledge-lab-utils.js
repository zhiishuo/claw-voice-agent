export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

export function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sourceOf(item) {
  const meta = item?.metadata || {};
  return meta.relative_path || meta.filename || meta.source || item?.source || "未知来源";
}

export function titleOf(item, index) {
  const source = sourceOf(item);
  return source || item?.title || item?.id || `结果 ${index + 1}`;
}

export function scoreStats(results) {
  const values = (results || []).map((item) => numberValue(item.score)).filter(Number.isFinite);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  return { min, max, span: Math.max(max - min, 0.000001) };
}

export function scoreRatio(item, stats) {
  return clamp((numberValue(item?.score) - stats.min) / stats.span, 0, 1);
}

export function scoreColor(ratio) {
  const alpha = 0.36 + ratio * 0.58;
  return `rgba(20, 93, 255, ${alpha.toFixed(3)})`;
}
