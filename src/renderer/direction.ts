/**
 * Which way an element reads (milestone 70): right to left in a window shown in a
 * right-to-left language, unless the element or one above it is pinned left to
 * right, as the transport row and the picture are. Read from the computed style,
 * so a pin by `dir="ltr"` in the markup is honored wherever the element is drawn —
 * the stage's own window included.
 */
export function isRtl(el: Element): boolean {
  const view = el.ownerDocument.defaultView ?? window;
  return view.getComputedStyle(el).direction === 'rtl';
}
