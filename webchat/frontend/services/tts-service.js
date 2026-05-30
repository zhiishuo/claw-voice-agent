export function createTtsService(http, { getClientId, getSession } = {}) {
  return {
    synthesize({ text, voice = "zh-CN-XiaoxiaoNeural", mode = "api", session, requestId }) {
      return http.request("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": getClientId?.() || "",
          "X-Request-Id": requestId || "",
          "X-Session-Key": getSession?.() || "",
        },
        body: JSON.stringify({ session, text, voice, mode }),
      });
    },

    withTokenUrl(raw) {
      return http.withTokenUrl(raw);
    },
  };
}
