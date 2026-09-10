export function scrollToRefWithReducedMotion(
  target: React.RefObject<HTMLElement | null>,
) {
  const element = target.current;
  if (!element) return;

  // En scroll imperativo el guard de prefers-reduced-motion no cubre el CSS.
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({
    behavior: reduce ? "auto" : "smooth",
    block: "start",
  });
}
