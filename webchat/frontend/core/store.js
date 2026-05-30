export function createStore(initialState = {}) {
  let state = structuredClone(initialState);
  const listeners = new Set();

  function getState() {
    return state;
  }

  function setState(patch) {
    const nextPatch = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...nextPatch };
    listeners.forEach((listener) => listener(state));
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState, setState, subscribe };
}
