import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Move focus into a dialog, trap Tab inside it, and restore focus on close/unmount.
 */
export default function useDialogA11y(active = true) {
  const ref = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    const node = ref.current;
    if (!node) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusables = () =>
      [...node.querySelectorAll(FOCUSABLE)].filter((el) => !el.hasAttribute("disabled"));

    const initial = focusables()[0] || node;
    if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
    initial.focus();

    const onKey = (event) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return ref;
}
