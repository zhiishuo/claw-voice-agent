export function createWakeService(http, { getClientId, getSession } = {}) {
  return {
    checkWake({ blob, filename = "wake.webm", wakePhrase = "", language = "zh", speakerId = "owner", matchMode = "all", requestId }) {
      return http.request("/api/wake-check", {
        method: "POST",
        headers: {
          "Content-Type": blob?.type || "audio/pcm-f32",
          "X-Filename": filename,
          "X-Wake-Language": language,
          "X-Wake-Phrase-B64": btoa(unescape(encodeURIComponent(wakePhrase))),
          "X-Speaker-Id": speakerId,
          "X-Speaker-Match-Mode": matchMode,
          "X-Client-Id": getClientId?.() || "",
          "X-Request-Id": requestId || "",
          "X-Session-Key": getSession?.() || "",
        },
        body: blob,
      });
    },
  };
}
