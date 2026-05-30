export function normalizeWakeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[.,!?;:'"()\-_/\\，。！？；：、""''\s]+/g, "");
}

export function wakeLanguageCode(phrase) {
  return /^[\x00-\x7F]+$/.test(String(phrase || "")) ? "en" : "zh";
}

export function wakeChunkMs(phrase, { enMs = 1500, zhMs = 2400 } = {}) {
  return wakeLanguageCode(phrase) === "en" ? enMs : zhMs;
}

export function base64Utf8(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
