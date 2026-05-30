import { $ } from "../../core/dom.js";

export function initSidebar() {
  const sidebar = $("sidebar");
  const toggleBtn = $("sidebar-toggle");

  toggleBtn?.addEventListener("click", () => {
    if (window.innerWidth >= 768) {
      sidebar.classList.toggle("-ml-[260px]");
    } else {
      sidebar.classList.toggle("hidden");
      if (!sidebar.classList.contains("hidden")) sidebar.classList.add("absolute", "z-50", "shadow-2xl");
    }
  });
}
