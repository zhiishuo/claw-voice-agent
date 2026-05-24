export function autoplayProofAudio(audioEl, { onPlaying, onFallback } = {}) {
  if (!audioEl) return;

  audioEl.pause();
  audioEl.currentTime = 0;

  const fallback = () => {
    if (typeof onFallback === "function") onFallback();
  };

  if (audioEl.readyState >= 2) {
    void audioEl.play().then(() => {
      if (typeof onPlaying === "function") onPlaying();
    }).catch(fallback);
    return;
  }

  const playWhenReady = () => {
    audioEl.removeEventListener("canplay", playWhenReady);
    void audioEl.play().then(() => {
      if (typeof onPlaying === "function") onPlaying();
    }).catch(fallback);
  };

  audioEl.addEventListener("canplay", playWhenReady, { once: true });
}
