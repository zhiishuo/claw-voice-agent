import { DEFAULT_CONFIG } from "../core/config.js";
import { makeId, makeSessionId } from "../core/ids.js";
import { readLocal, readSession, STORAGE_KEYS, writeLocal, writeSession } from "../core/storage.js";

function readNumber(key, fallback) {
  const value = Number(readLocal(key, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

function readInteger(key, fallback) {
  const value = Number.parseInt(readLocal(key, String(fallback)), 10);
  return Number.isFinite(value) ? value : fallback;
}

export function createAppContext() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token") || readSession(STORAGE_KEYS.authToken, "");
  const session = url.searchParams.get("session") || readSession(STORAGE_KEYS.session, "") || makeSessionId();
  const clientId = readLocal(STORAGE_KEYS.clientId, "") || makeId("client");
  if (token) writeSession(STORAGE_KEYS.authToken, token);
  writeSession(STORAGE_KEYS.session, session);
  writeLocal(STORAGE_KEYS.clientId, clientId);

  return {
    token,
    session,
    clientId,
    // 每个 session 是否已通过唤醒词+声纹验证
    sessionVerified: new Map(),
    settings: {
      transcriptLanguage: readLocal(STORAGE_KEYS.language, DEFAULT_CONFIG.transcriptLanguage),
      knowledgeEnabled: readLocal(STORAGE_KEYS.knowledgeEnabled, DEFAULT_CONFIG.knowledgeEnabled ? "1" : "0") !== "0",
      autoTts: readLocal(STORAGE_KEYS.autoTts, DEFAULT_CONFIG.autoTts ? "1" : "0") !== "0",
      autoPlay: readLocal("openclaw-webchat-auto-play", "0") !== "0",
      ttsMode: readLocal(STORAGE_KEYS.ttsMode, DEFAULT_CONFIG.ttsMode),
      ttsVoice: readLocal(STORAGE_KEYS.ttsVoice, DEFAULT_CONFIG.ttsVoice),
      autoPrependWake: readLocal(STORAGE_KEYS.autoPrependWake, "1") !== "0",
      wakePhrase: readLocal(STORAGE_KEYS.wakePhrase, DEFAULT_CONFIG.wakePhrase),
      streamingMode: readLocal(STORAGE_KEYS.streamingMode, DEFAULT_CONFIG.streamingMode ? "1" : "0") !== "0",
      wakeDetection: readLocal(STORAGE_KEYS.wakeDetection, DEFAULT_CONFIG.wakeDetection ? "1" : "0") !== "0",
      llmModel: readLocal(STORAGE_KEYS.llmModel, DEFAULT_CONFIG.llmModel) === "7b" ? "7b" : "30b",
      llmGeneration: {
        "7b": {
          temperature: readNumber(STORAGE_KEYS.llmTemperature7b, DEFAULT_CONFIG.llmGeneration["7b"].temperature),
          maxTokens: readInteger(STORAGE_KEYS.llmMaxTokens7b, DEFAULT_CONFIG.llmGeneration["7b"].maxTokens),
        },
        "30b": {
          temperature: readNumber(STORAGE_KEYS.llmTemperature30b, DEFAULT_CONFIG.llmGeneration["30b"].temperature),
          maxTokens: readInteger(STORAGE_KEYS.llmMaxTokens30b, DEFAULT_CONFIG.llmGeneration["30b"].maxTokens),
        },
      },
    },
  };
}

export function renderAppContextStatus(context) {
  const sessionBadge = document.getElementById("session-badge");
  const authStatus = document.getElementById("auth-status");
  const connectionStatus = document.getElementById("connection-status");

  if (sessionBadge) sessionBadge.textContent = context.session;
  if (authStatus) {
    authStatus.textContent = context.token ? "已认证" : "未认证";
    authStatus.classList.toggle("bg-blue-100", !!context.token);
    authStatus.classList.toggle("text-blue-700", !!context.token);
    authStatus.classList.toggle("bg-amber-100", !context.token);
    authStatus.classList.toggle("text-amber-700", !context.token);
  }
  if (connectionStatus) connectionStatus.textContent = "API";
}

export function setAppSession(context, session) {
  context.session = session;
  writeSession(STORAGE_KEYS.session, session);

  const url = new URL(window.location.href);
  url.searchParams.set("session", session);
  window.history.replaceState({}, "", url.toString());

  renderAppContextStatus(context);
}

export function setAppToken(context, token) {
  context.token = String(token || "").trim();
  writeSession(STORAGE_KEYS.authToken, context.token);
  renderAppContextStatus(context);
}

export function renderAuthCheckStatus(kind, text) {
  const authStatus = document.getElementById("auth-status");
  if (!authStatus) return;

  authStatus.textContent = text;
  authStatus.classList.remove("bg-blue-100", "text-blue-700", "bg-amber-100", "text-amber-700", "bg-red-100", "text-red-700");
  if (kind === "ok") {
    authStatus.classList.add("bg-blue-100", "text-blue-700");
  } else if (kind === "error") {
    authStatus.classList.add("bg-red-100", "text-red-700");
  } else {
    authStatus.classList.add("bg-amber-100", "text-amber-700");
  }
}
