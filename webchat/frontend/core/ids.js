export function makeId(prefix) {
  const random = (
    globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  ).replace(/[^a-zA-Z0-9-]/g, "");
  return `${prefix}-${random}`;
}

export function makeSessionId() {
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
