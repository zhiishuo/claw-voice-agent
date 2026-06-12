export const STORAGE_KEYS = {
  authToken: "openclaw-webchat-auth-token",
  clientId: "openclaw-webchat-client-id",
  session: "openclaw-webchat-session",
  micDevice: "openclaw-webchat-mic-device",
  language: "openclaw-webchat-language",
  autoSend: "openclaw-webchat-auto-send",
  autoTts: "openclaw-webchat-auto-tts",
  ttsMode: "openclaw-webchat-tts-mode",
  ttsVoice: "openclaw-webchat-tts-voice",
  knowledgeEnabled: "openclaw-webchat-knowledge-enabled",
  wakePhrase: "openclaw-webchat-wake-phrase",
  voiceInputMode: "openclaw-webchat-voice-input-mode",
  autoPrependWake: "openclaw-webchat-auto-prepend-wake",
  streamingMode: "openclaw-webchat-streaming-mode",
  wakeDetection: "openclaw-webchat-wake-detection",
  llmModel: "openclaw-webchat-llm-model",
  llmTemperature7b: "openclaw-webchat-llm-temperature-7b",
  llmMaxTokens7b: "openclaw-webchat-llm-max-tokens-7b",
  llmTemperature30b: "openclaw-webchat-llm-temperature-30b",
  llmMaxTokens30b: "openclaw-webchat-llm-max-tokens-30b",
};

export function readLocal(key, fallback = "") {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage failures in private/locked-down browser modes.
  }
}

export function readSession(key, fallback = "") {
  try {
    return window.sessionStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeSession(key, value) {
  try {
    window.sessionStorage.setItem(key, String(value));
  } catch {
    // Ignore storage failures in private/locked-down browser modes.
  }
}
