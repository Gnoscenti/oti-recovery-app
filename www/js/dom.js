// @ts-check
/**
 * Tiny DOM helpers. Text always goes through createTextNode, so nothing from
 * content.json or user input is ever parsed as HTML.
 */

/** @typedef {string|number|Node|null|undefined|false|ChildArray} Child */
/** @typedef {Array<Child>} ChildArray */

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, any>} [attrs]
 * @param {...Child} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  append(node, children);
  return node;
}

/**
 * @param {Node} parent
 * @param {Child[]} children
 */
export function append(parent, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) { append(parent, c); continue; }
    parent.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/**
 * Inline SVG icon referencing a <symbol> defined in index.html. The name is
 * always a code constant, never user data.
 * @param {string} name
 */
export function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ic" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
  return /** @type {SVGElement} */ (t.content.firstElementChild);
}

/** @param {Element} node */
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/**
 * External link (opens in a new tab / the system browser).
 * @param {string} href
 * @param {Record<string, any>} attrs
 * @param  {...Child} children
 */
export function ext(href, attrs, ...children) {
  return el('a', { href, target: '_blank', rel: 'noopener noreferrer', ...attrs }, ...children);
}

let toastTimer = 0;
/** @param {string} msg */
export function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 2400);
}

/**
 * Copy text; falls back to a selection-based copy where the async clipboard is refused.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

