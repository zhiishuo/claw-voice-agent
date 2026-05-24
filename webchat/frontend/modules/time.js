export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDuration(ms) {
  if (!ms || ms < 0) return "0.0 秒";
  if (ms < 10000) return `${(ms / 1000).toFixed(1)} 秒`;
  return `${Math.round(ms / 1000)} 秒`;
}
