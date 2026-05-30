function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createHttpClient({ getToken } = {}) {
  async function request(path, init = {}) {
    const headers = new Headers(init.headers || {});
    const token = typeof getToken === "function" ? getToken() : "";
    if (token) headers.set("X-Webchat-Token", token);

    const res = await fetch(path, { ...init, headers });
    const text = await res.text();
    const data = text ? parseJson(text) : null;
    if (!res.ok) {
      throw new Error(data?.error || text || `HTTP ${res.status}`);
    }
    return data;
  }

  function withTokenUrl(raw) {
    if (!raw) return "";
    const url = new URL(raw, window.location.origin);
    const token = typeof getToken === "function" ? getToken() : "";
    if (token) url.searchParams.set("token", token);
    return url.toString();
  }

  return { request, withTokenUrl };
}
