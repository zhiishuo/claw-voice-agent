export function createTranscriptionService(http, { getClientId, getSession, getLanguage } = {}) {
  return {
    transcribe({ blob, filename = "audio.webm", requestId }) {
      return http.request("/api/transcribe", {
        method: "POST",
        headers: {
          "Content-Type": blob?.type || "application/octet-stream",
          "X-Filename": filename,
          "X-ASR-Language": getLanguage?.() || "auto",
          "X-Client-Id": getClientId?.() || "",
          "X-Request-Id": requestId || "",
          "X-Session-Key": getSession?.() || "",
        },
        body: blob,
      });
    },
  };
}
