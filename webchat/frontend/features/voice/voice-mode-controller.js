import { qsa } from "../../core/dom.js";

export function initVoiceModeToggle() {
  const voiceModeBtns = qsa(".voice-mode-btn");
  voiceModeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      voiceModeBtns.forEach((item) => {
        item.classList.remove("active", "bg-white", "text-gray-700", "shadow-sm");
        item.classList.add("text-gray-400", "hover:text-gray-600");
      });
      btn.classList.remove("text-gray-400", "hover:text-gray-600");
      btn.classList.add("active", "bg-white", "text-gray-700", "shadow-sm");
    });
  });
}
