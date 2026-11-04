// Minimal DOM morphing: patch `root` to match `html` while keeping existing elements alive.
// With prices refreshing every second, replacing innerHTML would swallow taps (the element under your
// finger is replaced between touch-down and touch-up), reset scroll and flicker. Morphing only touches
// what actually changed, so rows, sparklines and chart nodes stay stable.
const FORM = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function syncAttrs(a, b) {
  for (const at of [...a.attributes]) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
  for (const at of b.attributes) if (a.getAttribute(at.name) !== at.value) a.setAttribute(at.name, at.value);
}

function syncChildren(a, b) {
  const an = a.childNodes, bn = b.childNodes;
  for (let i = 0; i < bn.length; i++) {
    const x = an[i], y = bn[i];
    if (!x) { a.appendChild(y.cloneNode(true)); continue; }
    if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { a.replaceChild(y.cloneNode(true), x); continue; }
    if (x.nodeType === 3 || x.nodeType === 8) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
    if (FORM.has(x.nodeName) && x === document.activeElement) continue; // never disturb a control being typed in
    syncAttrs(x, y);
    syncChildren(x, y);
  }
  while (an.length > bn.length) a.removeChild(a.lastChild);
}

export function morph(root, html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  syncChildren(root, t.content);
}
