import { $ } from "../../core/dom.js";

const STORAGE_KEY = "openclaw-webchat-sidebar-width";
const DEFAULT_WIDTH = 260;
const MIN_WIDTH = 220;
const MAX_WIDTH = 420;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function readStoredWidth() {
  const value = Number(window.localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(value) ? clamp(value, MIN_WIDTH, MAX_WIDTH) : DEFAULT_WIDTH;
}

function applyWidth(width) {
  document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
}

export function initSidebar() {
  const sidebar = $("sidebar");
  const toggleBtn = $("sidebar-toggle");
  const resizer = $("sidebar-resizer");

  let width = readStoredWidth();
  applyWidth(width);

  function setCollapsed(collapsed) {
    sidebar?.classList.toggle("sidebar-collapsed", collapsed);
    resizer?.classList.toggle("is-hidden", collapsed);
  }

  toggleBtn?.addEventListener("click", () => {
    if (window.innerWidth >= 768) {
      setCollapsed(!sidebar.classList.contains("sidebar-collapsed"));
    } else {
      sidebar.classList.toggle("hidden");
      if (!sidebar.classList.contains("hidden")) sidebar.classList.add("absolute", "z-50", "shadow-2xl");
    }
  });

  resizer?.addEventListener("pointerdown", (event) => {
    if (window.innerWidth < 768 || sidebar?.classList.contains("sidebar-collapsed")) return;
    event.preventDefault();
    resizer.setPointerCapture?.(event.pointerId);
    resizer.classList.add("is-dragging");
    document.body.classList.add("sidebar-resizing");

    function handleMove(moveEvent) {
      width = clamp(moveEvent.clientX, MIN_WIDTH, MAX_WIDTH);
      applyWidth(width);
    }

    function handleUp() {
      window.localStorage.setItem(STORAGE_KEY, String(width));
      resizer.classList.remove("is-dragging");
      document.body.classList.remove("sidebar-resizing");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  });

  resizer?.addEventListener("dblclick", () => {
    width = DEFAULT_WIDTH;
    applyWidth(width);
    window.localStorage.setItem(STORAGE_KEY, String(width));
  });
}
