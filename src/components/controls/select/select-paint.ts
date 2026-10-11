/** Paint-only copies: never an overlay, form field, accessible option or event target. */
const scrollCopies = new WeakMap<HTMLElement, Array<{ element: HTMLElement; top: number; left: number }>>();
export function selectPaintCopy(source: HTMLElement): HTMLElement {
  let copy = source.cloneNode(true) as HTMLElement;
  const elements = [copy, ...copy.querySelectorAll<HTMLElement>('*')];
  const originals = [source, ...source.querySelectorAll<HTMLElement>('*')], scroll: Array<{ element: HTMLElement; top: number; left: number }> = [];
  for (const [index, element] of elements.entries()) {
    const original = originals[index]!;
    if (original.scrollTop || original.scrollLeft) scroll.push({ element, top: original.scrollTop, left: original.scrollLeft });
    for (const attribute of [...element.attributes]) {
      if (/^(?:id|name|form|for|autofocus|tabindex|role|aria-.+|data-testid|data-zero-overlay-owner|data-radix-.+|on.+)$/iu.test(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (/^(?:INPUT|SELECT|TEXTAREA|BUTTON|OPTION|OPTGROUP|FIELDSET|FORM)$/u.test(element.tagName)) {
      const span = source.ownerDocument.createElement('span');
      for (const attribute of [...element.attributes]) span.setAttribute(attribute.name, attribute.value);
      if (element instanceof source.ownerDocument.defaultView!.HTMLInputElement) span.textContent = element.value;
      else span.replaceChildren(...element.childNodes);
      element.replaceWith(span);
      if (element === copy) copy = span;
    }
  }
  scrollCopies.set(copy, scroll);
  return finalize(copy);
}

/** Detached copies have no scroll range. Restore visible rows only after the paint has its final box in the portal. */
export function restoreSelectPaintScroll(copy: HTMLElement) {
  for (const item of scrollCopies.get(copy) ?? []) { item.element.scrollTop = item.top; item.element.scrollLeft = item.left; }
  scrollCopies.delete(copy);
}

function finalize(element: HTMLElement): HTMLElement {
  element.setAttribute('aria-hidden', 'true'); element.inert = true;
  element.style.pointerEvents = 'none';
  return element;
}
