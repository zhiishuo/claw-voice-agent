export function createDebugService(http) {
  return {
    last({ clientId = "", session = "", requestId = "" } = {}) {
      const params = new URLSearchParams();
      if (clientId) params.set("clientId", clientId);
      if (session) params.set("session", session);
      if (requestId) params.set("requestId", requestId);
      const query = params.toString();
      return http.request(query ? `/api/debug/last?${query}` : "/api/debug/last");
    },
  };
}
