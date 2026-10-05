/** Minimal in-memory DOM for hooks rendering null; not a browser/UI certification fixture. */
export function createHookContainer(): Element {
  return {
    nodeType: 1, nodeName: 'DIV', tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml', ownerDocument: globalThis.document,
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
    textContent: '', firstChild: null,
  } as unknown as Element;
}

export function installMinimalHookDom(): () => void {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class HTMLIFrameElement {}
  const window = { HTMLIFrameElement, document: null as unknown };
  const document = {
    nodeType: 9, defaultView: window, activeElement: null, body: null,
    addEventListener() {}, removeEventListener() {},
  };
  window.document = document;
  Object.defineProperties(globalThis, {
    window: { configurable: true, writable: true, value: window },
    document: { configurable: true, writable: true, value: document },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
  });
  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };
}
