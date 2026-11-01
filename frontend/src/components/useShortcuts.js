import { useEffect, useRef } from "react";

// Single-key shortcuts, ignored while typing (inputs, textareas, editable
// text), with Ctrl/Cmd/Alt held, or while a dialog is open. `keys` maps
// e.key ("j", "/", "?") to a handler; it may change between renders.
export function useShortcuts(keys) {
  const ref = useRef(keys);
  useEffect(() => {
    ref.current = keys;
  });
  useEffect(() => {
    function onKey(e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const handler = ref.current[e.key];
      if (!handler) return;
      e.preventDefault();
      handler(e);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export const SHORTCUTS = [
  ["j", "Next section"],
  ["k", "Previous section"],
  ["/", "Search this book"],
  ["t", "Show or hide the contents"],
  ["?", "These shortcuts"],
];
