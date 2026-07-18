import { BrowserWindow, screen } from "electron";

/**
 * Computer-use visual overlay:
 * - Edge pulse ON while session is active (user feedback: "ajan masaüstünü kullanıyor")
 * - Fake agent cursor OFF (real OS mouse moves via SendInput; second cursor was confusing)
 */
const EDGE_PULSE_ENABLED = true;
const AGENT_CURSOR_ENABLED = false;

let overlayWindow: BrowserWindow | undefined;
/** True once the overlay page has applied at least one agent cursor update. */
let agentCursorShown = false;

const DEFAULT_MODEL_SIZE = { width: 1280, height: 800 };

export type ComputerUseAgentCursor = {
	x: number;
	y: number;
	kind?: string;
	label?: string;
	at?: number;
};

const OVERLAY_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: transparent;
    pointer-events: none;
  }
  .frame {
    position: fixed;
    inset: 0;
    pointer-events: none;
  }
  .edge {
    position: absolute;
    pointer-events: none;
    opacity: 0.55;
    animation: edge-pulse 2.4s ease-in-out infinite;
  }
  .edge-top {
    top: 0; left: 0; right: 0; height: 28px;
    background: linear-gradient(180deg, rgba(124, 58, 237, 0.85) 0%, rgba(124, 58, 237, 0) 100%);
    animation-delay: 0s;
  }
  .edge-bottom {
    bottom: 0; left: 0; right: 0; height: 28px;
    background: linear-gradient(0deg, rgba(167, 139, 250, 0.85) 0%, rgba(167, 139, 250, 0) 100%);
    animation-delay: 0.6s;
  }
  .edge-left {
    top: 0; bottom: 0; left: 0; width: 28px;
    background: linear-gradient(90deg, rgba(52, 211, 153, 0.75) 0%, rgba(52, 211, 153, 0) 100%);
    animation-delay: 1.2s;
  }
  .edge-right {
    top: 0; bottom: 0; right: 0; width: 28px;
    background: linear-gradient(270deg, rgba(250, 204, 21, 0.75) 0%, rgba(250, 204, 21, 0) 100%);
    animation-delay: 1.8s;
  }
  .frame.flash .edge {
    animation-duration: 0.9s;
    opacity: 0.9;
  }
  @keyframes edge-pulse {
    0%, 100% { opacity: 0.25; filter: blur(0px); }
    50% { opacity: 0.95; filter: blur(1px); }
  }

  /* Agent cursor — optional; usually hidden (real OS mouse is used) */
  #agent-cursor {
    position: fixed;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    z-index: 9999;
    pointer-events: none;
    opacity: 0;
    display: none; /* AGENT_CURSOR_ENABLED=false */
    transform: translate3d(-100px, -100px, 0);
    transition: opacity 0.15s ease;
    will-change: transform, opacity;
  }
  #agent-cursor.visible {
    opacity: 1;
  }
  #agent-cursor.dim {
    opacity: 0.9;
  }
  #agent-cursor .cursor-inner {
    position: absolute;
    left: 0;
    top: 0;
    width: 27px;
    height: 27px;
    pointer-events: none;
    transform-origin: 4px 2px;
    transition: transform 0.12s ease;
  }
  #agent-cursor.kind-click .cursor-inner {
    transform: scale(0.88);
  }
  #agent-cursor.kind-type .cursor-inner {
    animation: cursor-type-pulse 1.1s ease-in-out infinite;
  }
  #agent-cursor.kind-scroll .cursor-inner {
    transform: scale(1.05);
  }
  #agent-cursor.kind-drag .cursor-inner {
    transform: scale(0.95) rotate(-8deg);
  }
  @keyframes cursor-type-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.08); opacity: 0.92; }
  }
  #agent-cursor .cursor-arrow {
    position: absolute;
    left: 0;
    top: 0;
    width: 27px;
    height: 27px;
    pointer-events: none;
    filter: drop-shadow(0 1px 1px rgba(0,0,0,0.35));
  }
  #agent-cursor .cursor-arrow svg {
    display: block;
    width: 27px;
    height: 27px;
    overflow: visible;
  }
  #agent-cursor .ripple {
    position: absolute;
    left: 4px;
    top: 4px;
    width: 10px;
    height: 10px;
    margin-left: -5px;
    margin-top: -5px;
    border: 2px solid #111;
    border-radius: 50%;
    pointer-events: none;
    opacity: 0;
    transform: scale(0.4);
  }
  #agent-cursor.kind-click .ripple {
    animation: cursor-ripple 0.45s ease-out forwards;
  }
  @keyframes cursor-ripple {
    0% { opacity: 0.85; transform: scale(0.4); }
    100% { opacity: 0; transform: scale(3.2); }
  }
  #agent-cursor .label-chip {
    position: absolute;
    left: 22px;
    top: 18px;
    max-width: 160px;
    padding: 2px 7px;
    border-radius: 4px;
    background: #111;
    color: #fff;
    font: 600 11px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
    box-shadow: 0 1px 3px rgba(0,0,0,0.35);
    display: none;
  }
  #agent-cursor .label-chip.show {
    display: block;
  }
</style>
</head>
<body>
  <div class="frame" id="frame">
    <div class="edge edge-top"></div>
    <div class="edge edge-bottom"></div>
    <div class="edge edge-left"></div>
    <div class="edge edge-right"></div>
  </div>
  <div id="agent-cursor" aria-hidden="true">
    <div class="cursor-inner">
      <div class="cursor-arrow">
        <svg viewBox="0 0 27 27" xmlns="http://www.w3.org/2000/svg">
          <!-- Black arrow with white stroke (~1.2), OS pointer vibe -->
          <path
            d="M4 2 L4 22 L9.5 16.5 L13 24.5 L16.2 23.2 L12.8 15.4 L20 15.4 Z"
            fill="#111"
            stroke="#fff"
            stroke-width="1.2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
      </div>
      <div class="ripple" id="cursor-ripple"></div>
    </div>
    <div class="label-chip" id="cursor-label"></div>
  </div>
  <script>
    (function () {
      var root = document.getElementById("agent-cursor");
      var labelEl = document.getElementById("cursor-label");
      var rippleEl = document.getElementById("cursor-ripple");
      var idleTimer = null;
      var lastKind = "idle";

      function normalizeKind(kind) {
        var k = (kind || "default").toLowerCase();
        if (k === "default" || k === "idle" || k === "move" || k === "click" ||
            k === "type" || k === "scroll" || k === "drag") {
          return k === "default" ? "idle" : k;
        }
        return "idle";
      }

      function clearKindClasses() {
        root.classList.remove(
          "kind-move", "kind-click", "kind-type",
          "kind-scroll", "kind-drag", "kind-idle"
        );
      }

      function retriggerRipple() {
        if (!rippleEl) return;
        rippleEl.style.animation = "none";
        // force reflow
        void rippleEl.offsetWidth;
        rippleEl.style.animation = "";
      }

      function scheduleDim() {
        if (idleTimer) clearTimeout(idleTimer);
        root.classList.remove("dim");
        idleTimer = setTimeout(function () {
          // Soft dim after long idle — stay visible, never hide
          root.classList.add("dim");
        }, 8000);
      }

      /**
       * payload: { x, y, kind?, label?, at? }
       * x/y are already in overlay client (CSS pixel) space.
       */
      window.__quakeCuCursorUpdate = function (payload) {
        if (!root) return;
        var data = payload;
        if (typeof payload === "string") {
          try { data = JSON.parse(payload); } catch (e) { return; }
        }
        if (!data || typeof data.x !== "number" || typeof data.y !== "number") return;

        var kind = normalizeKind(data.kind);
        lastKind = kind;

        root.style.transform =
          "translate3d(" + data.x + "px, " + data.y + "px, 0)";
        root.classList.add("visible");
        root.classList.remove("dim");

        clearKindClasses();
        root.classList.add("kind-" + kind);

        if (kind === "click") {
          retriggerRipple();
        }

        if (labelEl) {
          var label = data.label != null ? String(data.label) : "";
          if (label) {
            labelEl.textContent = label;
            labelEl.classList.add("show");
          } else {
            labelEl.textContent = "";
            labelEl.classList.remove("show");
          }
        }

        scheduleDim();
      };

      window.__quakeCuCursorClear = function () {
        if (!root) return;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        root.classList.remove("visible", "dim");
        clearKindClasses();
        root.style.transform = "translate3d(-100px, -100px, 0)";
        if (labelEl) {
          labelEl.textContent = "";
          labelEl.classList.remove("show");
        }
      };

      window.flashEdgePulse = function () {
        var frame = document.getElementById("frame");
        if (!frame) return;
        frame.classList.add("flash");
        setTimeout(function () { frame.classList.remove("flash"); }, 900);
      };
    })();
  </script>
</body>
</html>`;

function primaryBounds() {
	const display = screen.getPrimaryDisplay();
	return display?.bounds ?? { x: 0, y: 0, width: 1280, height: 800 };
}

function isOverlayAlive(): boolean {
	return Boolean(overlayWindow && !overlayWindow.isDestroyed());
}

function runOnOverlay(script: string): void {
	if (!isOverlayAlive()) return;
	overlayWindow!.webContents.executeJavaScript(script, true).catch(() => {});
}

function injectCursorUpdate(cursor: {
	x: number;
	y: number;
	kind?: string;
	label?: string;
	at?: number;
}): void {
	const json = JSON.stringify(cursor);
	runOnOverlay(`window.__quakeCuCursorUpdate?.(${json})`);
	agentCursorShown = true;
}

function scaleModelToClient(
	cursor: ComputerUseAgentCursor,
	modelSize?: { width: number; height: number },
): { x: number; y: number; kind?: string; label?: string; at?: number } {
	const modelW = modelSize?.width && modelSize.width > 0 ? modelSize.width : DEFAULT_MODEL_SIZE.width;
	const modelH = modelSize?.height && modelSize.height > 0 ? modelSize.height : DEFAULT_MODEL_SIZE.height;

	// Prefer the overlay window's webContents size (client area) when available.
	let clientW = DEFAULT_MODEL_SIZE.width;
	let clientH = DEFAULT_MODEL_SIZE.height;
	if (isOverlayAlive()) {
		const [cw, ch] = overlayWindow!.getContentSize();
		if (cw > 0 && ch > 0) {
			clientW = cw;
			clientH = ch;
		} else {
			const b = primaryBounds();
			clientW = b.width;
			clientH = b.height;
		}
	} else {
		const b = primaryBounds();
		clientW = b.width;
		clientH = b.height;
	}

	return {
		x: (cursor.x / modelW) * clientW,
		y: (cursor.y / modelH) * clientH,
		kind: cursor.kind,
		label: cursor.label,
		at: cursor.at,
	};
}

function ensureOverlayThen(fn: () => void): void {
	if (!EDGE_PULSE_ENABLED && !AGENT_CURSOR_ENABLED) {
		return;
	}
	if (isOverlayAlive()) {
		if (overlayWindow!.webContents.isLoading()) {
			overlayWindow!.webContents.once("did-finish-load", () => fn());
		} else {
			fn();
		}
		return;
	}
	showComputerUseEdgePulse();
	// showComputerUseEdgePulse sets ready-to-show; also wait for load
	if (isOverlayAlive()) {
		overlayWindow!.webContents.once("did-finish-load", () => fn());
	}
}

export function showComputerUseEdgePulse(): void {
	if (!EDGE_PULSE_ENABLED) {
		return;
	}
	if (overlayWindow && !overlayWindow.isDestroyed()) {
		overlayWindow.showInactive();
		return;
	}
	const bounds = primaryBounds();
	overlayWindow = new BrowserWindow({
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		frame: false,
		transparent: true,
		alwaysOnTop: true,
		skipTaskbar: true,
		focusable: false,
		hasShadow: false,
		resizable: false,
		movable: false,
		show: false,
		backgroundColor: "#00000000",
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true,
		},
	});
	overlayWindow.setIgnoreMouseEvents(true, { forward: true });
	overlayWindow.setAlwaysOnTop(true, "screen-saver");
	void overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`);
	overlayWindow.once("ready-to-show", () => {
		overlayWindow?.showInactive();
		// Optional fake agent cursor (off by default — real mouse already moves)
		if (AGENT_CURSOR_ENABLED && !agentCursorShown && overlayWindow && !overlayWindow.isDestroyed()) {
			const [cw, ch] = overlayWindow.getContentSize();
			const w = cw > 0 ? cw : primaryBounds().width;
			const h = ch > 0 ? ch : primaryBounds().height;
			injectCursorUpdate({
				x: w / 2,
				y: h / 2,
				kind: "idle",
				label: "ajan",
			});
		}
	});
	overlayWindow.on("closed", () => {
		overlayWindow = undefined;
		agentCursorShown = false;
	});
}

export function hideComputerUseEdgePulse(): void {
	if (!overlayWindow || overlayWindow.isDestroyed()) return;
	overlayWindow.close();
	overlayWindow = undefined;
	agentCursorShown = false;
}

export function flashComputerUseEdgePulse(): void {
	if (!EDGE_PULSE_ENABLED) return;
	if (!overlayWindow || overlayWindow.isDestroyed()) {
		showComputerUseEdgePulse();
	}
	if (!overlayWindow || overlayWindow.isDestroyed()) return;
	overlayWindow.webContents
		.executeJavaScript("window.flashEdgePulse?.()", true)
		.catch(() => {});
}

export function destroyComputerUseEdgePulse(): void {
	hideComputerUseEdgePulse();
}

/**
 * Update the agent cursor position/kind/label.
 * Coordinates are in MODEL space (default 1280×800 agent target space)
 * and scaled to the overlay window client size:
 *   left = (x / modelW) * innerWidth
 *   top  = (y / modelH) * innerHeight
 */
export function updateComputerUseAgentCursor(
	_cursor: ComputerUseAgentCursor,
	_modelSize?: { width: number; height: number },
): void {
	if (!AGENT_CURSOR_ENABLED) return;
	const apply = () => {
		const scaled = scaleModelToClient(_cursor, _modelSize);
		injectCursorUpdate(scaled);
	};

	if (!isOverlayAlive()) {
		// Ensure overlay exists, then apply after load
		ensureOverlayThen(apply);
		return;
	}
	overlayWindow!.showInactive();
	if (overlayWindow!.webContents.isLoading()) {
		overlayWindow!.webContents.once("did-finish-load", apply);
	} else {
		apply();
	}
}

/**
 * Show agent cursor at center of overlay, kind idle.
 * Default label is "ajan".
 */
export function showComputerUseAgentCursorCenter(_label?: string): void {
	if (!AGENT_CURSOR_ENABLED) {
		// Still ensure edge pulse if session wants visual feedback via other calls
		return;
	}
	const apply = () => {
		if (!isOverlayAlive()) return;
		const [cw, ch] = overlayWindow!.getContentSize();
		const w = cw > 0 ? cw : primaryBounds().width;
		const h = ch > 0 ? ch : primaryBounds().height;
		injectCursorUpdate({
			x: w / 2,
			y: h / 2,
			kind: "idle",
			label: _label ?? "ajan",
		});
	};

	if (!isOverlayAlive()) {
		ensureOverlayThen(apply);
		return;
	}
	overlayWindow!.showInactive();
	if (overlayWindow!.webContents.isLoading()) {
		overlayWindow!.webContents.once("did-finish-load", apply);
	} else {
		apply();
	}
}

/**
 * Hide the agent cursor. Edge pulse stays unless hideWindow is true
 * (in which case the whole overlay is destroyed).
 */
export function clearComputerUseAgentCursor(hideWindow?: boolean): void {
	if (hideWindow) {
		hideComputerUseEdgePulse();
		return;
	}
	if (!isOverlayAlive()) return;
	runOnOverlay("window.__quakeCuCursorClear?.()");
	agentCursorShown = false;
}
