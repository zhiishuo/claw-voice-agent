export function createSessionService(http) {
  return {
    list() {
      return http.request("/api/sessions");
    },

    loadMessages(session) {
      return http.request(`/api/messages?session=${encodeURIComponent(session || "")}`);
    },

    delete(session) {
      return http.request(`/api/sessions?session=${encodeURIComponent(session || "")}`, { method: "DELETE" });
    },

    clearAll() {
      return http.request("/api/sessions?all=true", { method: "DELETE" });
    },
  };
}
