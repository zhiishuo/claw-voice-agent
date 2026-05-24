export function createApiClient(getAuthToken) {
  return async function api(path, init = {}) {
    const headers = new Headers(init.headers || {});
    const token = typeof getAuthToken === "function" ? (getAuthToken() || "") : "";
    if (token) headers.set("X-Webchat-Token", token);
    const req = { ...init, headers };
    const res = await fetch(path, req);
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!res.ok) {
      const message = data && data.error ? data.error : text || `HTTP ${res.status}`;
      throw new Error(message);
    }
    return data;
  };
}
