const MODE_KEY = "openclaw-webchat-ui-mode";
const DENSITY_KEY = "openclaw-webchat-ui-density";

function nowMs() {
  return Date.now();
}

export function createUiModeController({
  bodyEl,
  modeToggleEl,
  modeBadgeEl,
  densitySelectEl,
  clickWindowMs = 1200,
  requiredClicks = 3,
} = {}) {
  let clickCount = 0;
  let firstClickAt = 0;

  const applyMode = (mode) => {
    const nextMode = mode === "debug" ? "debug" : "simple";
    bodyEl.classList.toggle("ui-debug", nextMode === "debug");
    bodyEl.classList.toggle("ui-simple", nextMode !== "debug");
    if (modeBadgeEl) modeBadgeEl.textContent = nextMode === "debug" ? "DEBUG" : "SIMPLE";
    localStorage.setItem(MODE_KEY, nextMode);
  };

  const applyDensity = (density) => {
    const next = density === "compact" ? "compact" : "comfortable";
    bodyEl.classList.remove("ui-density-compact", "ui-density-comfortable");
    bodyEl.classList.add(next === "compact" ? "ui-density-compact" : "ui-density-comfortable");
    localStorage.setItem(DENSITY_KEY, next);
    if (densitySelectEl) densitySelectEl.value = next;
  };

  const toggleMode = () => {
    const isDebug = bodyEl.classList.contains("ui-debug");
    applyMode(isDebug ? "simple" : "debug");
  };

  const onToggleClick = () => {
    const t = nowMs();
    if (!firstClickAt || t - firstClickAt > clickWindowMs) {
      firstClickAt = t;
      clickCount = 1;
      return;
    }
    clickCount += 1;
    if (clickCount >= requiredClicks) {
      toggleMode();
      clickCount = 0;
      firstClickAt = 0;
    }
  };

  const init = () => {
    const params = new URLSearchParams(window.location.search);
    const requestedMode = params.get("ui") || params.get("mode");
    const savedMode = requestedMode || "simple";
    const savedDensity = localStorage.getItem(DENSITY_KEY) || "comfortable";
    applyMode(savedMode);
    applyDensity(savedDensity);

    const modeClickTarget = modeToggleEl?.closest(".brand__eyebrow") || modeToggleEl;
    if (modeClickTarget) {
      modeClickTarget.addEventListener("click", onToggleClick);
    }

    if (densitySelectEl) {
      densitySelectEl.addEventListener("change", () => applyDensity(densitySelectEl.value || "comfortable"));
    }
  };

  return { init, applyMode, applyDensity };
}
