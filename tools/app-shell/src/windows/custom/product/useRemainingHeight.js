import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Product detail: a tab's own scroll box is bounded by the space that is left below it, but never below
// `minHeight` (200 px by default, the caller passes its own floor): with less room the content column scrolls as a whole.
// DetailView's content column is `overflow-auto` and unbounded for the content, so a fixed
// `100vh - N` guess overflows it as soon as the header above (cost banner, form rows) grows.

/** Height left in the scroll column below an element, or null when it cannot be measured. */
export function computeRemainingHeight({ boxTop, containerTop, containerClientHeight, containerScrollTop, bottomGap, minHeight }) {
  if (![boxTop, containerTop, containerClientHeight].every(Number.isFinite) || containerClientHeight <= 0) return null;
  // Position of the box inside the column's content, independent of how far the column is scrolled.
  const offset = boxTop - containerTop + (containerScrollTop || 0);
  return Math.max(minHeight, Math.floor(containerClientHeight - offset - bottomGap));
}

function findScrollParent(el) {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const oy = globalThis.getComputedStyle?.(p)?.overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
  }
  return null;
}

/**
 * Returns `{ ref, style }` for the scroll box (`fill: true` adds `height` equal to `maxHeight`). `style.maxHeight` is the room left below the box in its
 * nearest scrolling ancestor (viewport when there is none), re-measured on resize and whenever a
 * sibling above it changes size (banner shown/hidden, form rows wrapping, panel collapsed).
 */
export function useRemainingHeight({ active = true, bottomGap = 20, minHeight = 200, fill = false, fitContent = false, scrollTolerance = 0 } = {}) {
  const ref = useRef(null);
  const [measured, setMeasured] = useState(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const container = findScrollParent(el);
    const box = el.getBoundingClientRect();
    // `fitContent`: the floor is the smaller of `minHeight` and the natural height of the box content (the sum of its
    // children, which never depends on the box height, unlike its scrollHeight), so a short table does not leave
    // empty space that pushes the Total below the fold.
    // The box's own horizontal scrollbar (offsetHeight - clientHeight) is part of what the floor must hold.
    const content = fitContent
      ? Array.from(el.children).reduce((sum, child) => sum + child.getBoundingClientRect().height, 0) + (el.offsetHeight - el.clientHeight)
      : null;
    // With the scroll tolerance active (nothing more to load) the box may sit up to `scrollTolerance` px under its
    // content, which the hidden overflow below absorbs, so a short list never makes the column overflow by a few px.
    const fitted = content != null && content > 0 ? Math.max(0, Math.ceil(content) - scrollTolerance) : null;
    const floor = fitted != null ? Math.min(minHeight, fitted) : minHeight;
    const next = container
      ? computeRemainingHeight({
        boxTop: box.top,
        containerTop: container.getBoundingClientRect().top,
        containerClientHeight: container.clientHeight,
        containerScrollTop: container.scrollTop,
        bottomGap,
        minHeight: floor,
      })
      : computeRemainingHeight({
        boxTop: box.top, containerTop: 0, containerClientHeight: globalThis.innerHeight, containerScrollTop: 0, bottomGap, minHeight: floor,
      });
    if (next != null) setMeasured((prev) => (prev?.height === next && prev?.floor === floor && prev?.content === content ? prev : { height: next, floor, content }));
  }, [bottomGap, minHeight, fitContent, scrollTolerance]);

  useLayoutEffect(() => {
    if (!active) return undefined;
    measure();
    const container = findScrollParent(ref.current);
    globalThis.addEventListener?.('resize', measure);
    let observer = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      if (container) {
        observer.observe(container);
        Array.from(container.children).forEach((child) => observer.observe(child));
      }
    }
    return () => {
      globalThis.removeEventListener?.('resize', measure);
      observer?.disconnect();
    };
  }, [active, measure]);

  // Content above the box can change without a resize of the column (fonts, async banner): re-measure
  // on the next frame after each commit of an active tab, cheap and idempotent (setState bails out).
  useEffect(() => {
    if (!active) return undefined;
    const id = globalThis.requestAnimationFrame?.(measure);
    return () => { if (id != null) globalThis.cancelAnimationFrame?.(id); };
  });

  // `fill` also emits `height`: the box takes all the room that is left (never below `minHeight`, which the caller
  // sets as CSS min-height) instead of only being capped by it, so whatever follows the box sits at the bottom.
  if (measured == null) return { ref, style: undefined };
  const style = { maxHeight: measured.height };
  if (fill) style.height = measured.height;
  if (fitContent) style.minHeight = measured.floor;
  // A shortfall of a few px (the content is `scrollTolerance` px or less taller than the box) would only show a tiny,
  // useless scrollbar: hide vertical overflow then. Callers pass 0 when more content can still load by scrolling.
  const shortfall = measured.content == null ? 0 : measured.content - measured.height;
  if (scrollTolerance > 0 && shortfall > 0 && shortfall <= scrollTolerance) style.overflowY = 'hidden';
  return { ref, style };
}
