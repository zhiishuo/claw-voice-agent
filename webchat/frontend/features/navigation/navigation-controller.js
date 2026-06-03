import { $ } from "../../core/dom.js";

/**
 * @param {object} opts
 * @param {function} [opts.onSwitchTo] - 切换视图时的回调，参数为视图名称（如 "knowledge-lab"）
 */
export function initNavigation({ onSwitchTo } = {}) {
  const workspaceView = $("workspace-view");
  const kbTestView = $("kb-test-view");
  const toKbBtn = $("nav-to-kb-btn");
  const backBtn = $("nav-back-btn");

  function showKnowledgeView() {
    workspaceView.classList.replace("opacity-100", "opacity-0");
    workspaceView.classList.replace("z-10", "z-0");
    workspaceView.classList.add("pointer-events-none");
    kbTestView.classList.replace("opacity-0", "opacity-100");
    kbTestView.classList.replace("z-0", "z-10");
    kbTestView.classList.remove("pointer-events-none");
  }

  function showWorkspaceView() {
    kbTestView.classList.replace("opacity-100", "opacity-0");
    kbTestView.classList.replace("z-10", "z-0");
    kbTestView.classList.add("pointer-events-none");
    workspaceView.classList.replace("opacity-0", "opacity-100");
    workspaceView.classList.replace("z-0", "z-10");
    workspaceView.classList.remove("pointer-events-none");
  }

  toKbBtn?.addEventListener("click", () => {
    showKnowledgeView();
    if (typeof onSwitchTo === "function") onSwitchTo("knowledge-lab");
  });
  backBtn?.addEventListener("click", () => {
    showWorkspaceView();
    if (typeof onSwitchTo === "function") onSwitchTo("workspace");
  });
}
