export function createSpeakerService(http, { getClientId } = {}) {
  function commonHeaders(requestId, speakerId = "owner") {
    return {
      "X-Speaker-Id": speakerId,
      "X-Client-Id": getClientId?.() || "",
      "X-Request-Id": requestId || "",
    };
  }

  return {
    status({ speakerId = "owner" } = {}) {
      return http.request(`/api/speaker/status?speaker_id=${encodeURIComponent(speakerId)}`);
    },

    enroll({ blob, filename = "speaker.webm", speakerId = "owner", requestId, signal }) {
      return http.request("/api/speaker/enroll", {
        method: "POST",
        headers: {
          "Content-Type": blob?.type || "audio/wav",
          "X-Filename": filename,
          ...commonHeaders(requestId, speakerId),
        },
        body: blob,
        signal,
      });
    },

    verify({ blob, filename = "speaker.webm", speakerId = "owner", requestId, signal }) {
      return http.request("/api/speaker/verify", {
        method: "POST",
        headers: {
          "Content-Type": blob?.type || "audio/wav",
          "X-Filename": filename,
          ...commonHeaders(requestId, speakerId),
        },
        body: blob,
        signal,
      });
    },
  };
}
