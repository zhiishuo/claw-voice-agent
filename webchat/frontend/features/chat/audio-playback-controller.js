import { qsa } from "../../core/dom.js";

export function toggleAudioPlay(btn) {
  const iconContainer = btn.querySelector(".play-icon-container");
  const icon = iconContainer.querySelector("i");
  const waveform = btn.querySelector(".waveform-container");
  const duration = parseInt(btn.getAttribute("data-duration"), 10) || 2;
  const isAI = btn.classList.contains("ai-audio");

  if (btn.classList.contains("playing")) {
    btn.classList.remove("playing");
    icon.classList.remove("fa-stop");
    icon.classList.add("fa-play", "ml-0.5");
    if (isAI) iconContainer.classList.replace("bg-emerald-600", "bg-emerald-500");
    else iconContainer.classList.replace("bg-blue-600", "bg-blue-500");
    if (waveform) {
      waveform.classList.remove("animate-pulse");
      waveform.classList.replace("opacity-100", "opacity-70");
    }
    clearTimeout(btn.playTimeout);
    return;
  }

  qsa(".audio-message-btn.playing").forEach((otherBtn) => {
    if (otherBtn !== btn) toggleAudioPlay(otherBtn);
  });
  btn.classList.add("playing");
  icon.classList.remove("fa-play", "ml-0.5");
  icon.classList.add("fa-stop");
  if (isAI) iconContainer.classList.replace("bg-emerald-500", "bg-emerald-600");
  else iconContainer.classList.replace("bg-blue-500", "bg-blue-600");
  if (waveform) {
    waveform.classList.add("animate-pulse");
    waveform.classList.replace("opacity-70", "opacity-100");
  }
  btn.playTimeout = setTimeout(() => {
    if (btn.classList.contains("playing")) toggleAudioPlay(btn);
  }, duration * 1000);
}

export function initAudioPlaybackGlobals() {
  // Temporary bridge for existing inline onclick handlers. Remove once message
  // rendering moves out of template strings.
  window.toggleAudioPlay = toggleAudioPlay;
}
