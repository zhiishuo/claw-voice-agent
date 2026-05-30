export const $ = (id, root = document) => root.getElementById ? root.getElementById(id) : document.getElementById(id);

export const qs = (selector, root = document) => root.querySelector(selector);

export const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function on(target, eventName, handler, options) {
  if (!target) return () => {};
  target.addEventListener(eventName, handler, options);
  return () => target.removeEventListener(eventName, handler, options);
}

export function replaceClasses(el, removeList = [], addList = []) {
  if (!el) return;
  el.classList.remove(...removeList);
  el.classList.add(...addList);
}
