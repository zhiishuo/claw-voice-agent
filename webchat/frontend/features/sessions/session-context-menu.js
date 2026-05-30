import { $ } from "../../core/dom.js";

export function initSessionContextMenu({ onDelete } = {}) {
  const contextMenu = $("context-menu");
  const historyList = $("history-list");
  const deleteSessionBtn = $("delete-session-btn");
  let sessionToDelete = null;

  historyList?.addEventListener("contextmenu", (event) => {
    const li = event.target.closest("li");
    if (!li) return;
    event.preventDefault();
    sessionToDelete = li;
    contextMenu.classList.remove("hidden");
    let x = event.pageX;
    let y = event.pageY;
    if (x + contextMenu.offsetWidth > window.innerWidth) x = window.innerWidth - contextMenu.offsetWidth;
    if (y + contextMenu.offsetHeight > window.innerHeight) y = window.innerHeight - contextMenu.offsetHeight;
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
  });

  deleteSessionBtn?.addEventListener("click", () => {
    if (!sessionToDelete) return;
    contextMenu.classList.add("hidden");
    const targetSession = sessionToDelete.dataset.session;
    sessionToDelete.style.transition = "all 0.3s ease-out";
    sessionToDelete.style.opacity = "0";
    sessionToDelete.style.transform = "translateX(-20px)";
    setTimeout(() => {
      sessionToDelete.remove();
      sessionToDelete = null;
    }, 300);
    onDelete?.(targetSession);
  });

  return {
    close() {
      contextMenu?.classList.add("hidden");
    },
  };
}
