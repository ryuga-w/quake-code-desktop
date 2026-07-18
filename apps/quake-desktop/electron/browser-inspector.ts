import type { WebContents } from "electron";

export type BrowserElementTarget = {
  selector: string;
  selectorPath: string[];
  xpath: string;
  frameUrl: string;
  documentUrl: string;
  tag: string;
  id: string;
  classes: string[];
  role: string;
  accessibleName: string;
  text: string;
  outerHTML: string;
  rect: { x: number; y: number; width: number; height: number };
  attributes: Record<string, string>;
  styles: {
    font: string;
    color: string;
    background: string;
    display: string;
    position: string;
    margin: string;
    padding: string;
    width: string;
    height: string;
  };
};

export type BrowserNodeReference = {
  nodeId?: number;
  backendNodeId?: number;
};

export type BrowserResolveNodeParams =
  | { nodeId: number }
  | { backendNodeId: number };

/**
 * DOM.getNodeForLocation may omit nodeId until the document has been requested,
 * while backendNodeId remains stable and can be passed directly to resolveNode.
 */
export function buildResolveNodeParams(
  reference: BrowserNodeReference | null | undefined,
): BrowserResolveNodeParams | null {
  const backendNodeId = reference?.backendNodeId;
  if (Number.isInteger(backendNodeId) && Number(backendNodeId) > 0) {
    return { backendNodeId: Number(backendNodeId) };
  }
  const nodeId = reference?.nodeId;
  if (Number.isInteger(nodeId) && Number(nodeId) > 0) {
    return { nodeId: Number(nodeId) };
  }
  return null;
}

export type BrowserPickerAnnotation = {
  target: BrowserElementTarget;
  comment: string;
  number: number;
};

export type BrowserPickerResult =
  | { status: "completed"; annotations: BrowserPickerAnnotation[]; documentTitle: string; screenshot?: string }
  | { status: "cancelled"; reason?: string }
  | { status: "error"; message: string };

const PICKER_ROOT_ID = "__quake_element_picker_root";
const HIGHLIGHT_ROOT_ID = "__quake_element_highlight_root";
const CAPTURE_ROOT_ID = "__quake_element_capture_root";
const PICKER_SESSION_KEY = "__quakeElementPickerSession";

function assertWebContents(webContents: WebContents): void {
  if (webContents.isDestroyed()) throw new Error("Tarayıcı görünümü kullanılamıyor");
}

export async function startElementPicker(webContents: WebContents): Promise<BrowserPickerResult> {
  assertWebContents(webContents);
  try {
    return await webContents.executeJavaScript(buildPickerScript(), true) as BrowserPickerResult;
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Element seçici başlatılamadı",
    };
  }
}

export async function cancelElementPicker(webContents: WebContents, reason = "cancelled"): Promise<void> {
  if (webContents.isDestroyed()) return;
  await webContents.executeJavaScript(`(() => {
    const session = window[${JSON.stringify(PICKER_SESSION_KEY)}];
    if (session && typeof session.cancel === "function") session.cancel(${JSON.stringify(reason)});
  })()`, true).catch(() => {});
}

export async function clearElementHighlight(webContents: WebContents): Promise<void> {
  if (webContents.isDestroyed()) return;
  await webContents.executeJavaScript(`(() => {
    document.getElementById(${JSON.stringify(HIGHLIGHT_ROOT_ID)})?.remove();
    document.getElementById(${JSON.stringify(CAPTURE_ROOT_ID)})?.remove();
  })()`, true).catch(() => {});
}

export async function renderElementCaptureOverlay(
  webContents: WebContents,
  annotations: BrowserPickerAnnotation[],
): Promise<void> {
  assertWebContents(webContents);
  const overlays = annotations.slice(0, 50).map((annotation, index) => ({
    number: index + 1,
    rect: {
      x: Number.isFinite(annotation.target.rect.x) ? annotation.target.rect.x : 0,
      y: Number.isFinite(annotation.target.rect.y) ? annotation.target.rect.y : 0,
      width: Number.isFinite(annotation.target.rect.width) ? annotation.target.rect.width : 0,
      height: Number.isFinite(annotation.target.rect.height) ? annotation.target.rect.height : 0,
    },
  }));
  await webContents.executeJavaScript(buildCaptureOverlayScript(overlays), true);
}

export async function highlightElementTarget(webContents: WebContents, target: BrowserElementTarget): Promise<boolean> {
  assertWebContents(webContents);
  const selectorPath = validateSelectorPath(target.selectorPath, target.selector);
  return webContents.executeJavaScript(buildHighlightScript(selectorPath), true).catch(() => false) as Promise<boolean>;
}

export async function captureElementTarget(webContents: WebContents, target: BrowserElementTarget): Promise<string> {
  assertWebContents(webContents);
  const selectorPath = validateSelectorPath(target.selectorPath, target.selector);
  const rect = await webContents.executeJavaScript(buildTargetRectScript(selectorPath), true).catch(() => null) as
    | { x: number; y: number; width: number; height: number }
    | null;
  if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error("Element artık görünür değil; yeniden seçin");
  const image = await webContents.capturePage({
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.max(1, Math.ceil(rect.width)),
    height: Math.max(1, Math.ceil(rect.height)),
  });
  return image.toPNG().toString("base64");
}

export function validateSelectorPath(path: unknown, fallback: unknown): string[] {
  const values = Array.isArray(path) ? path : typeof fallback === "string" ? [fallback] : [];
  const selectors = values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= 2_000)
    .slice(0, 12);
  if (!selectors.length) throw new Error("Geçersiz element hedefi");
  return selectors;
}

function buildTargetRectScript(selectorPath: string[]): string {
  return `(() => {
    const path = ${JSON.stringify(selectorPath)};
    let root = document;
    let element = null;
    for (let index = 0; index < path.length; index += 1) {
      try { element = root.querySelector(path[index]); } catch { return null; }
      if (!element) return null;
      if (index < path.length - 1) {
        if (!element.shadowRoot) return null;
        root = element.shadowRoot;
      }
    }
    const rect = element.getBoundingClientRect();
    const x = Math.max(0, rect.left);
    const y = Math.max(0, rect.top);
    return {
      x,
      y,
      width: Math.min(rect.width, Math.max(0, innerWidth - x)),
      height: Math.min(rect.height, Math.max(0, innerHeight - y)),
    };
  })()`;
}

function buildCaptureOverlayScript(
  overlays: Array<{ number: number; rect: { x: number; y: number; width: number; height: number } }>,
): string {
  return `(() => {
    const ROOT_ID = ${JSON.stringify(CAPTURE_ROOT_ID)};
    document.getElementById(ROOT_ID)?.remove();
    const host = document.createElement("div");
    host.id = ROOT_ID;
    host.setAttribute("data-quake-picker-ui", "true");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = ".mark{position:fixed;border:2px solid #1683ff;border-radius:3px;background:rgba(22,131,255,.20);box-shadow:0 0 0 1px rgba(0,74,168,.18)}.pin{position:absolute;left:-10px;bottom:-10px;display:grid;place-items:center;width:20px;height:20px;border:2px solid #fff;border-radius:50%;background:#1683ff;color:#fff;font:700 10px/1 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4)}";
    shadow.appendChild(style);
    const overlays = ${JSON.stringify(overlays)};
    for (const entry of overlays) {
      const rect = entry.rect;
      if (!(rect.width > 0 && rect.height > 0)) continue;
      const mark = document.createElement("div");
      mark.className = "mark";
      mark.style.left = rect.x + "px";
      mark.style.top = rect.y + "px";
      mark.style.width = rect.width + "px";
      mark.style.height = rect.height + "px";
      const pin = document.createElement("span");
      pin.className = "pin";
      pin.textContent = String(entry.number);
      mark.appendChild(pin);
      shadow.appendChild(mark);
    }
    document.documentElement.appendChild(host);
  })()`;
}

function buildHighlightScript(selectorPath: string[]): string {
  return `(() => {
    const ROOT_ID = ${JSON.stringify(HIGHLIGHT_ROOT_ID)};
    const path = ${JSON.stringify(selectorPath)};
    let root = document;
    let element = null;
    for (let index = 0; index < path.length; index += 1) {
      try { element = root.querySelector(path[index]); } catch { return false; }
      if (!element) return false;
      if (index < path.length - 1) {
        if (!element.shadowRoot) return false;
        root = element.shadowRoot;
      }
    }
    document.getElementById(ROOT_ID)?.remove();
    const overlay = document.createElement("div");
    overlay.id = ROOT_ID;
    overlay.setAttribute("data-quake-picker-ui", "true");
    const rect = element.getBoundingClientRect();
    overlay.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;box-sizing:border-box;border:2px solid #1683ff;background:rgba(22,131,255,.20);box-shadow:0 0 0 1px rgba(0,74,168,.18),0 8px 28px rgba(0,0,0,.12);left:" + rect.left + "px;top:" + rect.top + "px;width:" + rect.width + "px;height:" + rect.height + "px";
    document.documentElement.appendChild(overlay);
    return true;
  })()`;
}

export function buildPickerScript(): string {
  return `(() => new Promise((resolve) => {
    const ROOT_ID = ${JSON.stringify(PICKER_ROOT_ID)};
    const SESSION_KEY = ${JSON.stringify(PICKER_SESSION_KEY)};
    const previous = window[SESSION_KEY];
    if (previous && typeof previous.cancel === "function") previous.cancel("restarted");

    let active = true;
    let hovered = null;
    let raf = 0;
    let activeSelection = -1;
    const selections = [];
    const previousCursor = document.documentElement.style.cursor;
    const host = document.createElement("div");
    host.id = ROOT_ID;
    host.setAttribute("data-quake-picker-ui", "true");
    host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:ui-monospace,SFMono-Regular,Consolas,monospace";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement('style');
    style.textContent = '*{box-sizing:border-box}.box{position:fixed;pointer-events:none;border:2px solid #1683ff;background:rgba(22,131,255,.20);box-shadow:0 0 0 1px rgba(0,74,168,.18),0 0 0 9999px rgba(0,0,0,.035)}.tip{position:fixed;pointer-events:none;max-width:420px;padding:6px 9px;border:1px solid rgba(255,255,255,.18);border-radius:7px;background:rgba(17,17,18,.96);color:#f4f4f5;font:600 11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 8px 24px rgba(0,0,0,.38)}.marks{position:fixed;inset:0;pointer-events:none}.mark{position:fixed;border:2px solid #1683ff;border-radius:3px;background:rgba(22,131,255,.20);box-shadow:0 0 0 1px rgba(0,74,168,.18)}.pin{position:absolute;left:-10px;bottom:-10px;display:grid;place-items:center;width:20px;height:20px;border:2px solid #fff;border-radius:50%;background:#1683ff;color:#fff;font:700 10px/1 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4)}.toolbar{position:fixed;top:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:4px;max-width:calc(100vw - 24px);padding:5px 6px 5px 10px;border:1px solid rgba(255,255,255,.17);border-radius:11px;background:rgba(17,17,18,.96);color:#eee;box-shadow:0 10px 30px rgba(0,0,0,.38);pointer-events:auto;font:600 11px/1 system-ui,sans-serif}.toolbar strong{margin-right:5px;white-space:nowrap}.toolbar span{color:#a1a1aa;white-space:nowrap}.toolbar button,.comment button{height:27px;padding:0 8px;border:0;border-radius:7px;background:transparent;color:#d4d4d8;cursor:pointer;font:600 11px/1 system-ui,sans-serif}.toolbar button:hover,.comment button:hover{background:rgba(255,255,255,.1)}.toolbar button:disabled{opacity:.35;cursor:default}.toolbar .send{background:#f4f4f5;color:#18181b}.toolbar .send:hover{background:#fff}.comment{position:fixed;display:none;grid-template-columns:minmax(150px,260px) auto auto;align-items:center;gap:4px;width:min(370px,calc(100vw - 16px));padding:5px;border:1px solid rgba(255,255,255,.18);border-radius:11px;background:rgba(17,17,18,.97);box-shadow:0 14px 36px rgba(0,0,0,.44);pointer-events:auto}.comment textarea{width:100%;height:31px;resize:none;padding:7px 8px;border:0;border-radius:7px;outline:0;background:rgba(255,255,255,.07);color:#f4f4f5;font:12px/1.35 system-ui,sans-serif}.comment textarea::placeholder{color:#71717a}.comment .remove{color:#fca5a5}.limit{color:#f4d35e!important}';
    const box = document.createElement('div');
    box.className = 'box';
    const tip = document.createElement('div');
    tip.className = 'tip';
    const marks = document.createElement('div');
    marks.className = 'marks';
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    const toolbarTitle = document.createElement('strong');
    toolbarTitle.textContent = 'Canlı element seçimi';
    const counter = document.createElement('span');
    counter.textContent = '0 seçim';
    const undoButton = document.createElement('button');
    undoButton.type = 'button'; undoButton.textContent = 'Geri al'; undoButton.disabled = true;
    const clearButton = document.createElement('button');
    clearButton.type = 'button'; clearButton.textContent = 'Temizle'; clearButton.disabled = true;
    const sendButton = document.createElement('button');
    sendButton.type = 'button'; sendButton.className = 'send'; sendButton.textContent = 'Composer’a ekle'; sendButton.disabled = true;
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button'; cancelButton.textContent = 'Kapat';
    toolbar.append(toolbarTitle, counter, undoButton, clearButton, sendButton, cancelButton);
    const comment = document.createElement('div');
    comment.className = 'comment';
    const commentInput = document.createElement('textarea');
    commentInput.placeholder = 'Bu element için not…';
    commentInput.maxLength = 2000;
    const removeButton = document.createElement('button');
    removeButton.type = 'button'; removeButton.className = 'remove'; removeButton.textContent = 'Sil';
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button'; confirmButton.textContent = 'Tamam';
    comment.append(commentInput, removeButton, confirmButton);
    shadow.append(style, marks, box, tip, toolbar, comment);
    document.documentElement.appendChild(host);
    document.documentElement.style.cursor = 'crosshair';

    const cssEscape = (value) => {
      try { return CSS.escape(String(value)); } catch { return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => "\\\\" + char); }
    };
    const quoteAttr = (value) => String(value)
      .split(String.fromCharCode(92))
      .join(String.fromCharCode(92, 92))
      .split('"')
      .join(String.fromCharCode(92) + '"');
    const visibleText = (element) => (element.innerText || element.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 1000);
    const isPickerNode = (node) => node && (node === host || (node.closest && node.closest('[data-quake-picker-ui="true"]')));
    const isPickerEvent = (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      return path.some((node) => isPickerNode(node));
    };
    const isDynamicClass = (value) => value.length > 48 || /(^|[-_])[a-f0-9]{7,}($|[-_])/i.test(value) || /[a-z]+_[a-z0-9]{6,}/i.test(value);
    const unique = (selector, root = document) => {
      try { return root.querySelectorAll(selector).length === 1; } catch { return false; }
    };
    const selectorFor = (element, root) => {
      const tag = element.tagName.toLowerCase();
      if (element.id) {
        const selector = '#' + cssEscape(element.id);
        if (unique(selector, root)) return selector;
      }
      for (const attr of ['data-testid','data-test','data-cy']) {
        const value = element.getAttribute(attr);
        if (value) {
          const selector = tag + '[' + attr + '="' + quoteAttr(value) + '"]';
          if (unique(selector, root)) return selector;
        }
      }
      for (const attr of ['aria-label','name','placeholder']) {
        const value = element.getAttribute(attr);
        if (value) {
          const selector = tag + '[' + attr + '="' + quoteAttr(value) + '"]';
          if (unique(selector, root)) return selector;
        }
      }
      const stableClasses = Array.from(element.classList || []).filter((value) => !isDynamicClass(value)).slice(0, 3);
      if (stableClasses.length) {
        const selector = tag + stableClasses.map((value) => '.' + cssEscape(value)).join('');
        if (unique(selector, root)) return selector;
      }
      const parts = [];
      let current = element;
      while (current && current.nodeType === 1 && parts.length < 5) {
        let part = current.tagName.toLowerCase();
        if (current.id) {
          part += '#' + cssEscape(current.id);
          parts.unshift(part);
          break;
        }
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
        }
        parts.unshift(part);
        const candidate = parts.join(' > ');
        if (unique(candidate, root)) return candidate;
        current = parent;
      }
      return parts.join(' > ') || tag;
    };
    const targetPath = (element) => {
      const segments = [];
      let current = element;
      while (current) {
        const root = current.getRootNode();
        segments.unshift(selectorFor(current, root));
        if (!(root instanceof ShadowRoot)) break;
        current = root.host;
      }
      return segments;
    };
    const xpathFor = (element) => {
      const parts = [];
      let current = element;
      while (current && current.nodeType === 1) {
        let index = 1;
        let sibling = current.previousElementSibling;
        while (sibling) { if (sibling.tagName === current.tagName) index += 1; sibling = sibling.previousElementSibling; }
        parts.unshift(current.tagName.toLowerCase() + '[' + index + ']');
        current = current.parentElement;
      }
      return '/' + parts.join('/');
    };
    const describe = (element) => {
      const rect = element.getBoundingClientRect();
      const computed = getComputedStyle(element);
      const attributes = {};
      for (const attr of Array.from(element.attributes || [])) {
        const key = attr.name.toLowerCase();
        attributes[attr.name] = /password|secret|token|authorization/.test(key) ? '[gizlendi]' : String(attr.value).slice(0, 500);
      }
      const selectorPath = targetPath(element);
      const role = element.getAttribute('role') || '';
      const accessibleName = element.getAttribute('aria-label') || element.getAttribute('alt') || element.getAttribute('title') || visibleText(element).slice(0, 160);
      return {
        selector: selectorPath[selectorPath.length - 1] || element.tagName.toLowerCase(), selectorPath,
        xpath: xpathFor(element), frameUrl: location.href, documentUrl: location.href,
        tag: element.tagName.toLowerCase(), id: element.id || '', classes: Array.from(element.classList || []).slice(0, 20),
        role, accessibleName, text: visibleText(element), outerHTML: String(element.outerHTML || '').slice(0, 12000),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, attributes,
        styles: { font: computed.font || '', color: computed.color || '', background: computed.backgroundColor || '', display: computed.display || '', position: computed.position || '', margin: computed.margin || '', padding: computed.padding || '', width: computed.width || '', height: computed.height || '' }
      };
    };
    const draw = (element, x, y) => {
      const rect = element.getBoundingClientRect();
      box.style.left = rect.left + 'px'; box.style.top = rect.top + 'px'; box.style.width = rect.width + 'px'; box.style.height = rect.height + 'px';
      const label = element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') + ' · ' + Math.round(rect.width) + '×' + Math.round(rect.height);
      tip.textContent = label;
      const tipX = Math.min(Math.max(8, x + 14), Math.max(8, innerWidth - 430));
      const tipY = y + 44 > innerHeight ? Math.max(8, y - 36) : y + 14;
      tip.style.left = tipX + 'px'; tip.style.top = tipY + 'px';
    };
    const selectionKey = (target) => JSON.stringify(target.selectorPath || [target.selector]);
    const closeComment = () => {
      activeSelection = -1;
      comment.style.display = 'none';
      commentInput.value = '';
    };
    const positionComment = (element) => {
      if (!(element instanceof Element)) return;
      const rect = element.getBoundingClientRect();
      const width = Math.min(370, Math.max(240, innerWidth - 16));
      const left = Math.max(8, Math.min(rect.left, innerWidth - width - 8));
      const preferredTop = rect.bottom + 9;
      const top = preferredTop + 48 <= innerHeight ? preferredTop : Math.max(8, rect.top - 48);
      comment.style.left = left + 'px';
      comment.style.top = top + 'px';
    };
    const renderSelections = () => {
      marks.replaceChildren();
      selections.forEach((selection, index) => {
        const element = selection.element;
        if (!(element instanceof Element) || !element.isConnected) return;
        const rect = element.getBoundingClientRect();
        const mark = document.createElement('div');
        mark.className = 'mark';
        mark.style.left = rect.left + 'px'; mark.style.top = rect.top + 'px'; mark.style.width = rect.width + 'px'; mark.style.height = rect.height + 'px';
        const pin = document.createElement('span');
        pin.className = 'pin'; pin.textContent = String(index + 1);
        mark.appendChild(pin);
        marks.appendChild(mark);
      });
      counter.textContent = selections.length + ' seçim';
      counter.classList.toggle('limit', selections.length >= 20);
      undoButton.disabled = selections.length === 0;
      clearButton.disabled = selections.length === 0;
      sendButton.disabled = selections.length === 0;
      if (activeSelection >= 0 && selections[activeSelection]) positionComment(selections[activeSelection].element);
    };
    const openComment = (index) => {
      const selection = selections[index];
      if (!selection) return;
      activeSelection = index;
      commentInput.value = selection.comment || '';
      comment.style.display = 'grid';
      positionComment(selection.element);
      setTimeout(() => { if (active && activeSelection === index) commentInput.focus(); }, 0);
    };
    const removeSelection = (index) => {
      if (index < 0 || index >= selections.length) return;
      selections.splice(index, 1);
      closeComment();
      renderSelections();
    };
    const addSelection = (element, quick) => {
      const target = describe(element);
      const key = selectionKey(target);
      let index = selections.findIndex((selection) => selectionKey(selection.target) === key);
      if (index < 0) {
        if (selections.length >= 20) {
          counter.textContent = '20 seçim sınırı';
          counter.classList.add('limit');
          return;
        }
        selections.push({ element, target, comment: '' });
        index = selections.length - 1;
      } else {
        selections[index].element = element;
        selections[index].target = target;
      }
      renderSelections();
      if (quick) closeComment(); else openComment(index);
    };
    const cleanup = () => {
      if (!active) return;
      active = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerdown', block, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll, true);
      document.documentElement.style.cursor = previousCursor;
      host.remove();
      if (window[SESSION_KEY] === session) delete window[SESSION_KEY];
    };
    const finish = (result) => { cleanup(); resolve(result); };
    const elementAt = (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const fromPath = path.find((node) => node instanceof Element && !isPickerNode(node));
      return fromPath || document.elementFromPoint(event.clientX, event.clientY);
    };
    const onMove = (event) => {
      if (!active) return;
      if (isPickerEvent(event)) {
        box.style.visibility = 'hidden';
        tip.style.visibility = 'hidden';
        return;
      }
      const element = elementAt(event);
      if (!(element instanceof Element) || isPickerNode(element)) return;
      hovered = element;
      box.style.visibility = 'visible';
      tip.style.visibility = 'visible';
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => draw(element, event.clientX, event.clientY));
    };
    const block = (event) => {
      if (!active || isPickerEvent(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onClick = (event) => {
      if (!active || isPickerEvent(event)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const element = elementAt(event) || hovered;
      if (!(element instanceof Element)) return;
      addSelection(element, !!(event.ctrlKey || event.metaKey));
    };
    const onKey = (event) => {
      if (!active) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (activeSelection >= 0) closeComment();
        else finish({ status: 'cancelled', reason: 'escape' });
        return;
      }
      if (isPickerEvent(event)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && selections.length) {
        event.preventDefault(); event.stopImmediatePropagation();
        removeSelection(selections.length - 1);
      }
    };
    const onScroll = () => {
      renderSelections();
      if (hovered && hovered.isConnected) {
        const rect = hovered.getBoundingClientRect();
        draw(hovered, rect.left, rect.top);
      }
    };
    const complete = () => {
      const annotations = selections.map((selection, index) => ({
        target: selection.element instanceof Element && selection.element.isConnected ? describe(selection.element) : selection.target,
        comment: String(selection.comment || '').trim().slice(0, 2000),
        number: index + 1,
      }));
      if (!annotations.length) return;
      finish({ status: 'completed', annotations, documentTitle: String(document.title || '').slice(0, 500) });
    };
    undoButton.addEventListener('click', () => removeSelection(selections.length - 1));
    clearButton.addEventListener('click', () => { selections.splice(0); closeComment(); renderSelections(); });
    sendButton.addEventListener('click', complete);
    cancelButton.addEventListener('click', () => finish({ status: 'cancelled', reason: 'button' }));
    commentInput.addEventListener('input', () => {
      const selection = selections[activeSelection];
      if (selection) selection.comment = commentInput.value.slice(0, 2000);
    });
    commentInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        closeComment();
      }
    });
    removeButton.addEventListener('click', () => removeSelection(activeSelection));
    confirmButton.addEventListener('click', closeComment);
    const session = {
      cancel: (reason) => finish({ status: 'cancelled', reason: reason || 'cancelled' }),
      complete,
      getSendButtonRect: () => {
        const rect = sendButton.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      },
    };
    window[SESSION_KEY] = session;
    renderSelections();
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerdown', block, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll, true);
  }))()`;
}
