import type { Component, OverlayHandle, OverlayOptions } from "@mrquake/quakecode-tui";
import { DismissibleOverlayComponent, isDismissOverlayInput } from "./components/dismissible-overlay.js";
import { theme } from "./theme/theme.js";

const DEFAULT_OVERLAY_OPTIONS: OverlayOptions = {
	anchor: "center",
	width: 86,
	minWidth: 64,
	maxHeight: "72%",
	margin: 2,
	background: (text) => theme.bg("userMessageBg", text),
};

type OverlayUi = {
	showOverlay: (component: Component, options?: OverlayOptions) => OverlayHandle;
	setFocus: (component: Component | null) => void;
	addInputListener: (listener: (data: string) => { consume?: boolean; data?: string } | undefined) => () => void;
	requestRender: (full?: boolean) => void;
};

export function showDismissibleTextOverlay(
	ui: OverlayUi,
	body: string,
	restoreFocus: Component,
	options?: Partial<OverlayOptions>,
): void {
	let handle: OverlayHandle | undefined;
	let closed = false;
	let removeListener: (() => void) | undefined;

	const close = () => {
		if (closed) return;
		closed = true;
		removeListener?.();
		removeListener = undefined;
		handle?.hide();
		ui.setFocus(restoreFocus);
		ui.requestRender(true);
	};

	const component = new DismissibleOverlayComponent(body, close);
	removeListener = ui.addInputListener((data) => {
		if (isDismissOverlayInput(data)) {
			close();
			return { consume: true };
		}
		return undefined;
	});

	handle = ui.showOverlay(component, { ...DEFAULT_OVERLAY_OPTIONS, ...options });
	handle.focus();
	ui.setFocus(component);
	ui.requestRender(true);
}
