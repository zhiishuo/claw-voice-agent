import { $, qsa } from "../../core/dom.js";

export function switchCitationTab(clickedBtn, msgId, citationId) {
  const isActive = clickedBtn.classList.contains("bg-blue-50");

  const container = $(`kb-tabs-container-${msgId}`);
  const allBtns = container.querySelectorAll(".kb-tab-btn");
  allBtns.forEach((btn) => {
    btn.className = "kb-tab-btn px-2.5 py-1.5 bg-white text-gray-500 border border-gray-200 hover:bg-gray-50 hover:text-gray-700 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer group";
    const badge = btn.querySelector(".num-badge");
    badge.className = "num-badge w-4 h-4 rounded bg-gray-100 text-gray-500 flex items-center justify-center text-[9px] font-bold transition-colors group-hover:bg-gray-200";
  });

  const panels = qsa(`.kb-panel-${msgId}`);
  panels.forEach((panel) => {
    panel.classList.remove("block", "message-anim");
    panel.classList.add("hidden");
  });

  if (isActive) return;

  clickedBtn.className = "kb-tab-btn px-2.5 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg text-xs font-medium transition-all shadow-sm flex items-center gap-1.5 cursor-pointer group";
  const activeBadge = clickedBtn.querySelector(".num-badge");
  activeBadge.className = "num-badge w-4 h-4 rounded bg-blue-600 text-white flex items-center justify-center text-[9px] font-bold transition-colors";

  const activePanel = $(`kb-panel-${msgId}-${citationId}`);
  if (activePanel) {
    activePanel.classList.remove("hidden");
    void activePanel.offsetWidth;
    activePanel.classList.add("block", "message-anim");
  }
}

export function initCitationTabGlobals() {
  // Temporary bridge for existing inline onclick handlers. Remove once citation
  // rendering is delegated from a controller.
  window.switchCitationTab = switchCitationTab;
}
