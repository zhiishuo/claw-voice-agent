export function createChatService(http, { getClientId, getSession } = {}) {
  function commonHeaders(requestId) {
    return {
      "Content-Type": "application/json",
      "X-Client-Id": getClientId?.() || "",
      "X-Request-Id": requestId || "",
      "X-Session-Key": getSession?.() || "",
    };
  }

  return {
    send({ session, message, knowledgeEnabled = true, llmModel = "30b", requestId }) {
      return http.request("/api/chat", {
        method: "POST",
        headers: commonHeaders(requestId),
        body: JSON.stringify({ session, message, knowledgeEnabled, llmModel }),
      });
    },

    suggestions({ session, question, answer, citations = [], llmModel = "30b", requestId }) {
      return http.request("/api/chat/suggestions", {
        method: "POST",
        headers: commonHeaders(requestId),
        body: JSON.stringify({ session, question, answer, citations, llmModel }),
      });
    },
  };
}
