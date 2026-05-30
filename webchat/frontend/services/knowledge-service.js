export function createKnowledgeService(http) {
  return {
    status() {
      return http.request("/api/knowledge/status");
    },

    visualization() {
      return http.request("/api/knowledge/visualization");
    },

    search({ query, topK, mode }) {
      return http.request("/api/knowledge/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          top_k: Number.isFinite(Number(topK)) ? Number(topK) : undefined,
          mode: mode || undefined,
        }),
      });
    },
  };
}
