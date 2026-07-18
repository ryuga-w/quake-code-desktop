type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Marker for web-native extension UI handles returned from `ctx.ui.custom()` factories. */
export const WEB_EXTENSION_MARKER = "__quakeWebExtension" as const;

export interface WebExtensionComponentSpec {
	componentType: string;
	props?: Record<string, JsonValue>;
	title?: string;
}

export interface WebExtensionComponentHandle<T = unknown> {
	[WEB_EXTENSION_MARKER]: true;
	spec: WebExtensionComponentSpec;
	resolve: (value: T) => void;
}

export interface WebExtensionWidgetSpec {
	componentType: string;
	props?: Record<string, JsonValue>;
}

export const WEB_WIDGET_MARKER = "__quakeWebWidget" as const;

export interface WebExtensionWidgetDescriptor {
	[WEB_WIDGET_MARKER]: true;
	spec: WebExtensionWidgetSpec;
}

/**
 * Build a `ctx.ui.custom()` factory that renders a registered web component.
 * Extensions can use this for cross-platform UI: TUI falls back to dialogs, web renders React.
 */
export function defineWebExtensionComponent<T = unknown>(
	componentType: string,
	props?: Record<string, JsonValue>,
	title?: string,
): (
	_tui: unknown,
	_theme: unknown,
	_kb: unknown,
	done: (result: T) => void,
) => WebExtensionComponentHandle<T> {
	return (_tui, _theme, _kb, done) => ({
		[WEB_EXTENSION_MARKER]: true,
		spec: { componentType, props, title },
		resolve: done,
	});
}

export function defineWebExtensionWidget(
	componentType: string,
	props?: Record<string, JsonValue>,
): WebExtensionWidgetDescriptor {
	return {
		[WEB_WIDGET_MARKER]: true,
		spec: { componentType, props },
	};
}

export function isWebExtensionComponentHandle(value: unknown): value is WebExtensionComponentHandle {
	return Boolean(value && typeof value === "object" && WEB_EXTENSION_MARKER in value);
}

export function isWebExtensionWidgetDescriptor(value: unknown): value is WebExtensionWidgetDescriptor {
	return Boolean(value && typeof value === "object" && WEB_WIDGET_MARKER in value);
}