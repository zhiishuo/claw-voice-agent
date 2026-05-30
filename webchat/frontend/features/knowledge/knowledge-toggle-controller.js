import { $ } from "../../core/dom.js";

const OFF_CLASSES = {
  button: "flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 hover:border-blue-300 rounded-full transition-all group shadow-sm",
  icon: "fa-solid fa-database text-gray-400 group-hover:text-blue-500 transition-colors",
  text: "text-[11px] font-medium text-gray-600 group-hover:text-blue-600 transition-colors",
  track: "w-6 h-3.5 bg-gray-200 rounded-full relative transition-colors ml-0.5",
};

const ON_CLASSES = {
  button: "flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-full transition-all group shadow-sm",
  icon: "fa-solid fa-database text-blue-500 transition-colors",
  text: "text-[11px] font-medium text-blue-600 transition-colors",
  track: "w-6 h-3.5 bg-blue-500 rounded-full relative transition-colors ml-0.5",
};

export function isKnowledgeEnabled() {
  return $("kb-toggle-btn")?.getAttribute("data-state") === "on";
}

export function initKnowledgeToggle({ initialEnabled = false, onChange } = {}) {
  const kbToggleBtn = $("kb-toggle-btn");
  const kbIcon = $("kb-icon");
  const kbText = $("kb-text");
  const kbTrack = $("kb-track");
  const kbThumb = $("kb-thumb");

  function render(enabled) {
    if (!kbToggleBtn || !kbIcon || !kbText || !kbTrack || !kbThumb) return;
    const classes = enabled ? ON_CLASSES : OFF_CLASSES;
    kbToggleBtn.setAttribute("data-state", enabled ? "on" : "off");
    kbToggleBtn.className = classes.button;
    kbIcon.className = classes.icon;
    kbText.className = classes.text;
    kbTrack.className = classes.track;
    kbThumb.style.transform = enabled ? "translateX(10px)" : "translateX(0)";
  }

  kbToggleBtn?.addEventListener("click", () => {
    const next = kbToggleBtn.getAttribute("data-state") !== "on";
    render(next);
    onChange?.(next);
  });

  render(initialEnabled);
}
