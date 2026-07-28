/**
 * Agent ↔ uygulama içi tarayıcı köprüsü (HTTP :9223).
 *
 * Playwright'ın Electron CDP'sine yapışması güvenilmez; bu yüzden ajan
 * `browser_*` tool'ları WebContentsView üzerinde bu in-process API üzerinden
 * çalışır. Sözleşme: packages/coding-agent/.../electron-bridge.ts
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { WebContents } from "electron";

export const DEFAULT_BROWSER_BRIDGE_PORT = 9223;
export const EMBEDDED_UA_MARKER = "QuakeEmbeddedBrowser/1";

export type BrowserCursorKind = "move" | "click" | "hover" | "type" | "drag" | "scroll" | "idle";

export type BrowserCursorEvent = {
  x: number;
  y: number;
  kind: BrowserCursorKind;
  label?: string;
  toX?: number;
  toY?: number;
  at: number;
};

export type BrowserBridgeHost = {
  /** Embedded WebContentsView webContents */
  getWebContents: () => WebContents | null | undefined;
  /** Ajan oturumu başlarken panel aç / görünür yap */
  onSessionStart?: () => void;
  onSessionEnd?: () => void;
  /** Playwright CDP için in-process debugger'ı serbest bırak */
  preparePlaywrightCdp?: () => Promise<void>;
  onCursor?: (cursor: BrowserCursorEvent) => void;
  onNavigate?: (url: string) => void;
};

let server: Server | undefined;
let host: BrowserBridgeHost = { getWebContents: () => null };
let sessionActive = false;
let lastCursor: BrowserCursorEvent | null = null;

const consoleBuf: Array<{ type: string; text: string; location?: string }> = [];
const networkBuf: Array<{ method: string; url: string; resourceType: string; status?: number }> = [];
let consoleWired = false;
let cursorNavWired = false;

export function setBrowserBridgeHost(next: BrowserBridgeHost): void {
  host = next;
}

async function resolveViewportSize(): Promise<{ w: number; h: number }> {
  try {
    const view = host.getWebContents();
    if (!view || view.isDestroyed()) return { w: 720, h: 480 };
    const size = (await view.executeJavaScript(
      `({ w: Math.max(1, window.innerWidth || 0), h: Math.max(1, window.innerHeight || 0) })`,
      true,
    )) as { w?: number; h?: number } | null;
    const w = Number(size?.w) || 0;
    const h = Number(size?.h) || 0;
    if (w >= 40 && h >= 40) return { w, h };
  } catch {
    /* page not ready */
  }
  return { w: 720, h: 480 };
}

/** Ajan tarayıcıyı açtığı an: imleç viewport ortasında */
async function spawnCenterCursor(label = "ajan"): Promise<void> {
  const { w, h } = await resolveViewportSize();
  publishCursor({
    x: Math.round(w / 2),
    y: Math.round(h / 2),
    kind: "idle",
    label,
    at: Date.now(),
  });
}

/** Navigasyon sonrası DOM silindi — son konumu veya ortayı yeniden çiz */
async function repaintCursorAfterNav(): Promise<void> {
  if (lastCursor) {
    await paintAgentCursorInPage({
      ...lastCursor,
      kind: lastCursor.kind === "click" ? "idle" : lastCursor.kind,
      at: Date.now(),
    });
    return;
  }
  if (sessionActive) {
    await spawnCenterCursor();
  }
}

function wc(): WebContents {
  const view = host.getWebContents();
  if (!view || view.isDestroyed()) {
    throw new Error(
      "Uygulama içi tarayıcı hazır değil. Electron açık olmalı ve Tarayıcı sekmesi kullanılabilir olmalı.",
    );
  }
  return view;
}

function sendJson(res: ServerResponse, status: number, data: Record<string, unknown>) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function wireConsoleAndNetwork(view: WebContents) {
  if (!consoleWired) {
    consoleWired = true;
    view.on("console-message", (_e, level, message, line, sourceId) => {
      const type =
        level === 3 ? "error" : level === 2 ? "warning" : level === 1 ? "info" : "log";
      consoleBuf.push({
        type,
        text: String(message || ""),
        location: sourceId ? `${sourceId}:${line || 0}` : undefined,
      });
      if (consoleBuf.length > 200) consoleBuf.splice(0, consoleBuf.length - 200);
    });
  }
  // Sayfa yenilenince imleç DOM'dan silinir — oturum/son konum varsa yeniden bas
  if (!cursorNavWired) {
    cursorNavWired = true;
    const repaint = () => {
      if (!sessionActive && !lastCursor) return;
      void repaintCursorAfterNav();
    };
    view.on("did-finish-load", repaint);
    view.on("did-navigate-in-page", repaint);
  }
}

async function ensureAboutBlankIfEmpty(view: WebContents) {
  const url = view.getURL();
  if (!url || url === "about:blank" || url === "") {
    await view.loadURL("about:blank").catch(() => {});
  }
}

async function pageState() {
  const view = wc();
  await ensureAboutBlankIfEmpty(view);
  const url = view.getURL() || "";
  let title = "";
  try {
    title = view.getTitle() || "";
    if (!title) {
      title = String(await view.executeJavaScript("document.title || ''", true).catch(() => ""));
    }
  } catch {
    title = "";
  }
  return { url, title };
}

/** CSS / ref / index hedefinden DOM elemanı seçen JS ifadesi (browser context). */
function resolveTargetExpr(target: string): string {
  const t = JSON.stringify(target);
  return `(function(){
    const target = ${t};
    const refMatch = /^ref=(e\\d+)$/.exec(target);
    if (refMatch) {
      return document.querySelector('[data-aria-ref="' + refMatch[1] + '"]');
    }
    if (/^\\d+$/.test(target)) {
      const index = Number(target);
      const selector = "a,button,input,textarea,select,[role='button'],[role='link'],[role='tab'],[role='menuitem'],[contenteditable='true']";
      const list = Array.from(document.querySelectorAll(selector)).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      return list[index - 1] || null;
    }
    try { return document.querySelector(target); } catch (e) { return null; }
  })()`;
}

async function evalInPage<T>(expression: string): Promise<T> {
  const view = wc();
  return (await view.executeJavaScript(expression, true)) as T;
}

async function withTarget<T>(
  target: string,
  fnBody: string,
): Promise<T> {
  // Hata fırlatmak yerine {ok,value,error} dön — Electron executeJavaScript
  // throw'u generic "Script failed" ile yutar.
  const expr = `(function(){
    try {
      const el = ${resolveTargetExpr(target)};
      if (!el) return { ok: false, error: 'Element not found: ' + ${JSON.stringify(target)} };
      const value = (function(el){ ${fnBody} })(el);
      return { ok: true, value };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  })()`;
  const result = await evalInPage<{ ok: boolean; value?: T; error?: string }>(expr);
  if (!result?.ok) {
    throw new Error(result?.error || `Element not found: ${target}`);
  }
  return result.value as T;
}

async function navigate(url: string) {
  const view = wc();
  wireConsoleAndNetwork(view);
  await view.loadURL(url);
  // wait briefly for title
  await new Promise((r) => setTimeout(r, 50));
  const state = await pageState();
  host.onNavigate?.(state.url);
  return state;
}

/**
 * Playwright-style ARIA snapshot: inject data-aria-ref + YAML tree.
 */
async function buildSnapshot() {
  const result = await evalInPage<{
    url: string;
    title: string;
    interactive: Array<Record<string, unknown>>;
    textBlocks: string[];
    headings: string[];
    yaml: string;
    elementCount: number;
  }>(`(function(){
    // Clear previous refs
    document.querySelectorAll('[data-aria-ref]').forEach((el) => el.removeAttribute('data-aria-ref'));

    const INTERACTIVE = "a,button,input,textarea,select,summary,[role='button'],[role='link'],[role='tab'],[role='menuitem'],[role='checkbox'],[role='radio'],[role='switch'],[role='textbox'],[contenteditable='true'],[tabindex]:not([tabindex='-1'])";
    const nodes = Array.from(document.querySelectorAll(INTERACTIVE));
    let counter = 1;
    const interactive = [];
    const lines = [];

    function visible(el) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const st = window.getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') return false;
      return true;
    }

    function labelOf(el) {
      const t = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') ||
        el.getAttribute('name') || el.getAttribute('title') || el.getAttribute('alt') ||
        el.getAttribute('value') || el.id || el.tagName || '').toString().trim().replace(/\\s+/g, ' ');
      return t.slice(0, 120);
    }

    function roleOf(el) {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === 'a') return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'input') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'submit' || type === 'button') return 'button';
        return 'textbox';
      }
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      if (tag === 'summary') return 'button';
      return tag;
    }

    for (const el of nodes) {
      if (!(el instanceof HTMLElement)) continue;
      if (!visible(el)) continue;
      const ref = 'e' + (counter++);
      el.setAttribute('data-aria-ref', ref);
      const role = roleOf(el);
      const name = labelOf(el);
      const tag = el.tagName.toLowerCase();
      interactive.push({
        index: counter - 1,
        ref,
        tag,
        role,
        text: name,
        id: el.id || undefined,
        name: el.getAttribute('name') || undefined,
        type: el.getAttribute('type') || undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        href: el.getAttribute('href') || undefined,
        visible: true,
      });
      const namePart = name ? ' "' + name.replace(/"/g, '\\\\"') + '"' : '';
      lines.push('- ' + role + namePart + ' [ref=' + ref + ']');
      if (lines.length >= 200) break;
    }

    const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
      .map((h) => (h.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 12);

    const textBlocks = Array.from(document.querySelectorAll('main,article,section,p,li'))
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 20);

    const yaml = lines.length ? lines.join('\\n') : '- document [ref=e0]';
    return {
      url: location.href,
      title: document.title || '',
      interactive,
      textBlocks,
      headings,
      yaml,
      elementCount: interactive.length,
    };
  })()`);

  return result;
}

async function screenshotPngBase64(): Promise<string> {
  const view = wc();
  // Prefer native capture — no CDP contention
  const image = await view.capturePage();
  const png = image.toPNG();
  return png.toString("base64");
}

/**
 * Native WebContentsView, React overlay'inin ÜSTÜNDE çizilir.
 * Bu yüzden ajan imlecini sayfa DOM'una enjekte ediyoruz — aksi halde görünmez.
 */
async function paintAgentCursorInPage(cursor: BrowserCursorEvent): Promise<void> {
  const view = host.getWebContents();
  if (!view || view.isDestroyed()) return;

  const x = Math.round(cursor.x);
  const y = Math.round(cursor.y);
  const kind = cursor.kind || "move";
  const label = cursor.label ? String(cursor.label).slice(0, 48) : "";

  const script = `(function(){
    var KIND = ${JSON.stringify(kind)};
    var LABEL = ${JSON.stringify(label)};
    var X = ${x};
    var Y = ${y};
    // Preset: ghost-arrow (outline only — user pick from agent-cursor-picker)
    var STYLE_VER = 'ghost-arrow-1';
    var SIZE = 26;
    var root = document.getElementById('__quake_agent_cursor_root');
    if (root && root.getAttribute('data-qc-style') !== STYLE_VER) {
      try { root.remove(); } catch (e) {}
      root = null;
    }
    if (!root) {
      root = document.createElement('div');
      root.id = '__quake_agent_cursor_root';
      root.setAttribute('data-quake-agent-cursor', '1');
      root.setAttribute('data-qc-style', STYLE_VER);
      root.style.cssText = [
        'position:fixed','left:0','top:0','width:0','height:0',
        'z-index:2147483647','pointer-events:none','overflow:visible',
        'opacity:1'
      ].join(';');
      (document.documentElement || document.body).appendChild(root);

      var style = document.createElement('style');
      style.id = '__quake_agent_cursor_style';
      style.textContent = [
        '#__quake_agent_cursor_root{opacity:1!important;transition:opacity 220ms ease;}',
        '#__quake_agent_cursor_root .qc-ptr{',
        '  position:absolute;width:' + SIZE + 'px;height:' + SIZE + 'px;margin:0;padding:0;',
        '  color:transparent;',
        '  filter:drop-shadow(0 1px 2px rgba(0,0,0,.5)) drop-shadow(0 0 1px rgba(0,0,0,.35));',
        '  transition:left 70ms cubic-bezier(.25,.1,.25,1),top 70ms cubic-bezier(.25,.1,.25,1),transform 90ms ease,filter 90ms ease;',
        '  transform:rotate(-12deg) scale(1);will-change:left,top,transform;',
        '}',
        '#__quake_agent_cursor_root .qc-ptr path{',
        '  fill:none;stroke:#fff;stroke-width:1.6;stroke-linejoin:round;',
        '}',
        '#__quake_agent_cursor_root .qc-ptr.qc-click{',
        '  filter:drop-shadow(0 0 2px #fff) drop-shadow(0 2px 4px rgba(0,0,0,.45));',
        '  transform:rotate(-6deg) scale(1.14);',
        '}',
        '#__quake_agent_cursor_root .qc-ptr.qc-click path{ stroke:#facc15; stroke-width:1.8; }',
        '#__quake_agent_cursor_root .qc-ptr.qc-type{',
        '  animation:qc-type-pulse .55s ease-in-out infinite;',
        '}',
        '#__quake_agent_cursor_root .qc-ptr.qc-type path{ stroke:#6ee7b7; }',
        '#__quake_agent_cursor_root .qc-ptr.qc-drag path{ stroke:#e2e8f0; }',
        '#__quake_agent_cursor_root .qc-ptr.qc-hover{ transform:rotate(-12deg) scale(1.06); }',
        '#__quake_agent_cursor_root .qc-ptr.qc-idle{ transform:rotate(-12deg) scale(1); }',
        '#__quake_agent_cursor_root .qc-label{',
        '  position:absolute;max-width:200px;',
        '  padding:4px 9px;border-radius:999px;',
        '  font:700 11px/1.2 system-ui,Segoe UI,sans-serif;',
        '  color:#fff;background:rgba(17,17,17,.92);',
        '  border:1px solid rgba(255,255,255,.25);',
        '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
        '  box-shadow:0 4px 12px rgba(0,0,0,.32);',
        '}',
        '#__quake_agent_cursor_root .qc-ripple{',
        '  position:absolute;width:8px;height:8px;border-radius:50%;pointer-events:none;',
        '  border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35),0 0 10px rgba(255,255,255,.25);',
        '  transform:translate(-50%,-50%);animation:qc-ripple 650ms cubic-bezier(.2,.6,.3,1) forwards;',
        '}',
        '@keyframes qc-ripple{0%{width:8px;height:8px;opacity:1}100%{width:48px;height:48px;opacity:0}}',
        '@keyframes qc-type-pulse{0%,100%{transform:rotate(-12deg) scale(1)}50%{transform:rotate(-12deg) scale(1.08)}}'
      ].join('');
      root.appendChild(style);

      var ptr = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ptr.setAttribute('class', 'qc-ptr');
      ptr.setAttribute('viewBox', '0 0 24 24');
      ptr.setAttribute('width', String(SIZE));
      ptr.setAttribute('height', String(SIZE));
      // Ghost arrow: outline only (no fill)
      ptr.innerHTML = '<path d="M5.65 5.65l3.57 14.3 2.86-5.72 5.72-2.86z"/>';
      root.appendChild(ptr);

      var lab = document.createElement('div');
      lab.className = 'qc-label';
      lab.style.display = 'none';
      root.appendChild(lab);
    }

    var ptrEl = root.querySelector('.qc-ptr');
    var labEl = root.querySelector('.qc-label');
    if (ptrEl) {
      ptrEl.style.left = X + 'px';
      ptrEl.style.top = Y + 'px';
      var cls = 'qc-ptr';
      if (KIND === 'click') cls += ' qc-click';
      else if (KIND === 'type') cls += ' qc-type';
      else if (KIND === 'drag') cls += ' qc-drag';
      else if (KIND === 'hover') cls += ' qc-hover';
      else if (KIND === 'idle') cls += ' qc-idle';
      ptrEl.className = cls;
    }
    if (labEl) {
      if (LABEL) {
        labEl.textContent = LABEL;
        labEl.style.display = 'block';
        labEl.style.left = (X + Math.round(SIZE * 0.7)) + 'px';
        labEl.style.top = (Y + Math.round(SIZE * 0.95)) + 'px';
      } else {
        labEl.style.display = 'none';
      }
    }
    if (KIND === 'click') {
      var rip = document.createElement('div');
      rip.className = 'qc-ripple';
      rip.style.left = X + 'px';
      rip.style.top = Y + 'px';
      root.appendChild(rip);
      setTimeout(function(){ try { rip.remove(); } catch(e){} }, 700);
    }
    // Ajan dursa bile imleç yerinde ve net kalsın — fade yok
    root.style.opacity = '1';
    return true;
  })()`;

  try {
    await view.executeJavaScript(script, true);
  } catch {
    /* page may be mid-navigation */
  }
}

function publishCursor(cursor: BrowserCursorEvent) {
  lastCursor = cursor;
  host.onCursor?.(cursor);
  // Fire-and-forget paint into embedded page (native view sits above React)
  void paintAgentCursorInPage(cursor);
}

async function emitCursorFromBody(body: Record<string, unknown>) {
  const cursor: BrowserCursorEvent = {
    x: Number(body.x) || 0,
    y: Number(body.y) || 0,
    kind: (String(body.kind || "move") as BrowserCursorKind) || "move",
    label: body.label != null ? String(body.label) : undefined,
    toX: body.toX != null ? Number(body.toX) : undefined,
    toY: body.toY != null ? Number(body.toY) : undefined,
    at: body.at != null ? Number(body.at) : Date.now(),
  };
  publishCursor(cursor);
}

async function clickTarget(target: string) {
  const box = await withTarget<{ x: number; y: number; width: number; height: number } | null>(
    target,
    `const r = el.getBoundingClientRect();
     el.scrollIntoView({ block: 'center', inline: 'center' });
     const r2 = el.getBoundingClientRect();
     return { x: r2.x, y: r2.y, width: r2.width, height: r2.height };`,
  );
  if (box && box.width > 0 && box.height > 0) {
    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);
    publishCursor({ x: cx, y: cy, kind: "click", label: target, at: Date.now() });
    const view = wc();
    view.sendInputEvent({ type: "mouseMove", x: cx, y: cy });
    view.sendInputEvent({ type: "mouseDown", x: cx, y: cy, button: "left", clickCount: 1 });
    view.sendInputEvent({ type: "mouseUp", x: cx, y: cy, button: "left", clickCount: 1 });
  } else {
    await withTarget(target, `el.click(); return true;`);
  }
  return pageState();
}

async function typeTarget(target: string, text: string) {
  await withTarget(
    target,
    `
    el.focus();
    if ('value' in el) {
      const proto = el instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(text)});
      else el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.isContentEditable) {
      el.textContent = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  `,
  ).then((center) => {
    if (center && typeof center === "object" && "x" in (center as object)) {
      const c = center as { x: number; y: number };
      publishCursor({
        x: Math.round(c.x),
        y: Math.round(c.y),
        kind: "type",
        label: text.slice(0, 40),
        at: Date.now(),
      });
    }
  });
  return pageState();
}

async function hoverTarget(target: string) {
  const box = await withTarget<{ x: number; y: number; width: number; height: number }>(
    target,
    `el.scrollIntoView({ block: 'center', inline: 'center' });
     const r = el.getBoundingClientRect();
     el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
     el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
     return { x: r.x, y: r.y, width: r.width, height: r.height };`,
  );
  if (box) {
    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);
    publishCursor({ x: cx, y: cy, kind: "hover", label: target, at: Date.now() });
    wc().sendInputEvent({ type: "mouseMove", x: cx, y: cy });
  }
  return pageState();
}

async function dragTargets(from: string, to: string) {
  const boxes = await evalInPage<{
    from: { x: number; y: number } | null;
    to: { x: number; y: number } | null;
  }>(`(function(){
    function resolve(target) {
      const refMatch = /^ref=(e\\d+)$/.exec(target);
      let el = null;
      if (refMatch) el = document.querySelector('[data-aria-ref="' + refMatch[1] + '"]');
      else if (/^\\d+$/.test(target)) {
        const selector = "a,button,input,textarea,select,[role='button'],[role='link']";
        const list = Array.from(document.querySelectorAll(selector));
        el = list[Number(target) - 1] || null;
      } else {
        try { el = document.querySelector(target); } catch (e) {}
      }
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }
    return { from: resolve(${JSON.stringify(from)}), to: resolve(${JSON.stringify(to)}) };
  })()`);

  if (boxes.from && boxes.to) {
    const view = wc();
    publishCursor({
      x: boxes.from.x,
      y: boxes.from.y,
      kind: "drag",
      toX: boxes.to.x,
      toY: boxes.to.y,
      at: Date.now(),
    });
    view.sendInputEvent({ type: "mouseMove", x: boxes.from.x, y: boxes.from.y });
    view.sendInputEvent({ type: "mouseDown", x: boxes.from.x, y: boxes.from.y, button: "left", clickCount: 1 });
    view.sendInputEvent({ type: "mouseMove", x: boxes.to.x, y: boxes.to.y });
    view.sendInputEvent({ type: "mouseUp", x: boxes.to.x, y: boxes.to.y, button: "left", clickCount: 1 });
  }
  return pageState();
}

async function selectOption(target: string, value: string) {
  await withTarget(
    target,
    `
    if (!(el instanceof HTMLSelectElement)) throw new Error('Not a select element');
    const wanted = ${JSON.stringify(value)};
    let matched = false;
    for (const opt of Array.from(el.options)) {
      if (opt.value === wanted || opt.text === wanted || opt.label === wanted) {
        el.value = opt.value;
        matched = true;
        break;
      }
    }
    if (!matched) el.value = wanted;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  `,
  );
  return pageState();
}

async function boundingBox(target: string) {
  try {
    const box = await withTarget<{ x: number; y: number; width: number; height: number } | null>(
      target,
      `const r = el.getBoundingClientRect();
       if (r.width <= 0 || r.height <= 0) return null;
       return { x: r.x, y: r.y, width: r.width, height: r.height };`,
    );
    return box;
  } catch {
    return null;
  }
}

async function highlightTarget(target: string) {
  await withTarget(
    target,
    `
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const prev = el.getAttribute('data-quake-hl-style');
    if (!prev) el.setAttribute('data-quake-hl-style', el.style.cssText || '');
    el.style.outline = '3px solid #9333ea';
    el.style.outlineOffset = '2px';
    el.style.boxShadow = '0 0 0 4px rgba(147,51,234,0.25)';
    setTimeout(() => {
      const old = el.getAttribute('data-quake-hl-style');
      if (old != null) { el.style.cssText = old; el.removeAttribute('data-quake-hl-style'); }
    }, 1800);
    return true;
  `,
  );
  return pageState();
}

async function pressKey(key: string) {
  const view = wc();
  // Map common Playwright-style keys
  const map: Record<string, string> = {
    Enter: "Return",
    Escape: "Escape",
    Backspace: "Backspace",
    Tab: "Tab",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Delete: "Delete",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
  };
  const parts = key.split("+").map((p) => p.trim());
  const base = parts[parts.length - 1] || key;
  const keyCode = map[base] || base;
  const modifiers = parts.slice(0, -1).map((m) => m.toLowerCase());
  const mods: Array<"shift" | "control" | "alt" | "meta"> = [];
  for (const m of modifiers) {
    if (m === "shift") mods.push("shift");
    if (m === "control" || m === "ctrl") mods.push("control");
    if (m === "alt") mods.push("alt");
    if (m === "meta" || m === "cmd" || m === "command") mods.push("meta");
  }
  view.sendInputEvent({ type: "keyDown", keyCode, modifiers: mods });
  view.sendInputEvent({ type: "char", keyCode: base.length === 1 ? base : keyCode, modifiers: mods });
  view.sendInputEvent({ type: "keyUp", keyCode, modifiers: mods });
}

async function goBack() {
  const view = wc();
  if (view.navigationHistory.canGoBack()) {
    view.navigationHistory.goBack();
    await new Promise((r) => setTimeout(r, 100));
  }
  return pageState();
}

async function waitFor(opts: { selector?: string; text?: string; timeoutMs?: number }) {
  const timeout = opts.timeoutMs ?? 10_000;
  const selector = opts.selector || "";
  const text = opts.text || "";
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = await evalInPage<boolean>(`(function(){
      ${
        selector
          ? `try { if (document.querySelector(${JSON.stringify(selector)})) return true; } catch(e) {}`
          : ""
      }
      ${
        text
          ? `if (document.body && document.body.innerText && document.body.innerText.includes(${JSON.stringify(text)})) return true;`
          : ""
      }
      ${!selector && !text ? "return true;" : "return false;"}
    })()`);
    if (found) return;
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(
    `wait-for timeout after ${timeout}ms` +
      (selector ? ` selector=${selector}` : "") +
      (text ? ` text=${text}` : ""),
  );
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = (req.url || "/").split("?")[0] || "/";
  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url === "/health") {
      let ready = false;
      try {
        ready = Boolean(host.getWebContents() && !host.getWebContents()?.isDestroyed());
      } catch {
        ready = false;
      }
      sendJson(res, 200, {
        ok: true,
        embedded: true,
        sessionActive,
        ready,
        lastCursor,
      });
      return;
    }

    if (req.method === "POST" && url === "/cdp/prepare-playwright") {
      await host.preparePlaywrightCdp?.();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/session/start") {
      sessionActive = true;
      // Sadece console wire — about:blank loadURL navigate ile yarışır, yapma.
      try {
        const view = host.getWebContents();
        if (view && !view.isDestroyed()) {
          wireConsoleAndNetwork(view);
        }
      } catch {
        /* view henüz yoksa panel açılınca hazır olur */
      }
      host.onSessionStart?.();
      // Ortada imleç — panel mount için kısa gecikme + hemen deneme
      void spawnCenterCursor("ajan");
      setTimeout(() => {
        void spawnCenterCursor("ajan");
      }, 180);
      setTimeout(() => {
        void spawnCenterCursor("ajan");
      }, 500);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/session/end") {
      sessionActive = false;
      // lastCursor SİLİNMEZ — imleç son konumda kalır
      if (lastCursor) {
        void paintAgentCursorInPage({
          ...lastCursor,
          kind: "idle",
          label: undefined,
          at: Date.now(),
        });
      }
      host.onSessionEnd?.();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url === "/agent-browser/state") {
      const state = await pageState();
      sendJson(res, 200, { ok: true, ...state });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/navigate") {
      const body = await readJsonBody(req);
      const targetUrl = String(body.url || "");
      if (!targetUrl) {
        sendJson(res, 400, { ok: false, error: "url required" });
        return;
      }
      const state = await navigate(targetUrl);
      // Yeni sayfada imleç yeniden: varsa son konum, yoksa orta
      void repaintCursorAfterNav();
      sendJson(res, 200, { ok: true, ...state });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/evaluate") {
      const body = await readJsonBody(req);
      const expression = String(body.expression || "");
      if (!expression) {
        sendJson(res, 400, { ok: false, error: "expression required" });
        return;
      }
      const result = await evalInPage(expression);
      sendJson(res, 200, { ok: true, result });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/snapshot") {
      const snap = await buildSnapshot();
      sendJson(res, 200, { ok: true, ...snap });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/screenshot") {
      const data = await screenshotPngBase64();
      const state = await pageState();
      sendJson(res, 200, {
        ok: true,
        data,
        mimeType: "image/png",
        url: state.url,
        title: state.title,
      });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/click") {
      const body = await readJsonBody(req);
      const state = await clickTarget(String(body.target || ""));
      sendJson(res, 200, { ok: true, ...state });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/type") {
      const body = await readJsonBody(req);
      const state = await typeTarget(String(body.target || ""), String(body.text ?? ""));
      sendJson(res, 200, { ok: true, ...state });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/hover") {
      const body = await readJsonBody(req);
      const state = await hoverTarget(String(body.target || ""));
      sendJson(res, 200, { ok: true, ...state });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/drag") {
      const body = await readJsonBody(req);
      const state = await dragTargets(String(body.from || ""), String(body.to || ""));
      sendJson(res, 200, { ok: true, ...state });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/select-option") {
      const body = await readJsonBody(req);
      const state = await selectOption(String(body.target || ""), String(body.value ?? ""));
      sendJson(res, 200, { ok: true, ...state });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/bounding-box") {
      const body = await readJsonBody(req);
      const box = await boundingBox(String(body.target || ""));
      sendJson(res, 200, { ok: true, box });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/console") {
      sendJson(res, 200, { ok: true, messages: consoleBuf.slice() });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/network") {
      sendJson(res, 200, { ok: true, requests: networkBuf.slice() });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/highlight") {
      const body = await readJsonBody(req);
      const state = await highlightTarget(String(body.target || ""));
      sendJson(res, 200, { ok: true, ...state });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/press-key") {
      const body = await readJsonBody(req);
      await pressKey(String(body.key || ""));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/go-back") {
      const state = await goBack();
      sendJson(res, 200, { ok: true, ...state });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/wait-for") {
      const body = await readJsonBody(req);
      await waitFor({
        selector: body.selector != null ? String(body.selector) : undefined,
        text: body.text != null ? String(body.text) : undefined,
        timeoutMs: body.timeoutMs != null ? Number(body.timeoutMs) : undefined,
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url === "/agent-browser/emit-cursor") {
      const body = await readJsonBody(req);
      await emitCursorFromBody(body);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { ok: false, error: message });
  }
}

export function startBrowserBridge(
  port = Number(process.env.QUAKE_BROWSER_BRIDGE_PORT || DEFAULT_BROWSER_BRIDGE_PORT),
): Promise<void> {
  if (server) return Promise.resolve();
  const listenHost = process.env.QUAKE_CDP_HOST?.trim() || "127.0.0.1";
  return new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      void handleRequest(req, res);
    });
    server.on("error", reject);
    server.listen(port, listenHost, () => {
      console.log(`[browser-bridge] listening on http://${listenHost}:${port}`);
      resolve();
    });
  });
}

export function stopBrowserBridge(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => {
      server = undefined;
      resolve();
    });
  });
}

export function isBrowserBridgeSessionActive(): boolean {
  return sessionActive;
}
