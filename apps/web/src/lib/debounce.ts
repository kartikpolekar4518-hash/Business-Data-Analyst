import { useEffect, useState } from "react";

/**
 * The value, held still until it stops changing for `delay` ms.
 *
 * Written for the scenario sliders: dragging one fires a change per pixel, and each of
 * those would otherwise become a URL write (and a history entry). Debouncing the value
 * that leaves the component keeps the slider itself instant — it stays controlled by
 * its own state — while everything downstream sees one settled value per gesture.
 */
export function useDebounced<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
