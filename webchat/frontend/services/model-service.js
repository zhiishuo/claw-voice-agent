export function createModelService(http) {
  return {
    status() {
      return http.request("/api/model/status");
    },

    switchModel(llmModel) {
      return http.request("/api/model/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llmModel }),
      });
    },
  };
}
