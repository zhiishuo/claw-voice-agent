import { $ } from "../../core/dom.js";

export function initNavigation() {
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

  toKbBtn?.addEventListener("click", showKnowledgeView);
  backBtn?.addEventListener("click", showWorkspaceView);
}
