import {
	clearGrokAuthCache,
	ensureFreshGrokAuthToken,
	type GrokAuthInfo,
	type GrokBillingInfo,
	getGrokAuthInfo,
	getGrokBilling,
} from "@mrquake/quakecode-ai";
import { theme } from "./theme/theme.js";

function formatExpiry(expiresAt: Date): { label: string; tone: "ok" | "warning" | "expired" } {
	const ms = expiresAt.getTime() - Date.now();
	if (ms <= 0) return { label: "expired", tone: "expired" };
	const hours = ms / (1000 * 60 * 60);
	if (hours < 24) return { label: `${Math.max(1, Math.round(hours))}h left`, tone: "warning" };
	const days = Math.round(hours / 24);
	return { label: `${days}d left`, tone: "ok" };
}

function tokenSourceLabel(source: GrokAuthInfo["tokenSource"]): string {
	switch (source) {
		case "env":
			return "GROK_AUTH_TOKEN";
		case "file":
			return "~/.grok/auth.json";
		case "xai-env":
			return "XAI_API_KEY";
		default:
			return "none";
	}
}

function formatCredits(value: number): string {
	return value.toFixed(2);
}

function appendBillingLines(
	lines: string[],
	line: (label: string, value: string) => string,
	billing: GrokBillingInfo,
): void {
	lines.push("");
	lines.push(theme.fg("accent", "Credits (SuperGrok / CLI proxy)"));

	if (billing.error) {
		lines.push(line("credits", theme.fg("warning", billing.error)));
		return;
	}

	if (!billing.available) {
		lines.push(line("credits", theme.fg("dim", "unavailable")));
		return;
	}

	const usageTone = billing.percentUsed >= 90 ? "error" : billing.percentUsed >= 70 ? "warning" : "text";
	lines.push(
		line(
			"used",
			`${theme.fg(usageTone, `${billing.percentUsed}%`)} ${theme.fg("dim", `(${formatCredits(billing.creditsUsed)} / ${formatCredits(billing.creditsLimit)} kredi)`)}`,
		),
	);
	lines.push(line("remaining", theme.fg("success", `${formatCredits(billing.creditsRemaining)} kredi`)));
	if (billing.resetAt) {
		lines.push(line("resets", theme.fg("dim", billing.resetAt.toLocaleDateString())));
	}
	if (billing.onDemandCapCredits !== undefined) {
		lines.push(line("on-demand", theme.fg("dim", `${formatCredits(billing.onDemandCapCredits)} kredi cap`)));
	}
}

export async function buildGrokStatusLines(options: { forceBilling?: boolean } = {}): Promise<string[]> {
	const info = getGrokAuthInfo();
	const line = (label: string, value: string) => `${theme.fg("dim", `${label.padEnd(12)} `)}${value}`;

	const lines: string[] = [theme.fg("accent", "╭─ Grok Auth Status ─────────────────────────────────────────╮"), ""];

	if (!info.configured) {
		lines.push(line("status", theme.fg("warning", "not configured")));
		lines.push("");
		lines.push(theme.fg("muted", "Login with the Grok CLI, then retry:"));
		lines.push(theme.fg("text", "  grok login"));
		lines.push("");
		lines.push(theme.fg("muted", "Or set an API key:"));
		lines.push(theme.fg("text", "  export GROK_AUTH_TOKEN=<jwt>"));
		lines.push(theme.fg("text", "  export XAI_API_KEY=<key>"));
	} else {
		lines.push(line("status", theme.fg("success", "configured")));
		lines.push(line("source", tokenSourceLabel(info.tokenSource)));
		if (info.tokenPreview) {
			lines.push(line("token", theme.fg("muted", info.tokenPreview)));
		}

		const expiresAt = info.expiresAt;
		if (expiresAt) {
			const expiry = formatExpiry(expiresAt);
			const expiryColor = expiry.tone === "expired" ? "error" : expiry.tone === "warning" ? "warning" : "text";
			lines.push(
				line("expires", `${theme.fg(expiryColor, expiry.label)} ${theme.fg("dim", expiresAt.toLocaleString())}`),
			);
		} else {
			lines.push(line("expires", theme.fg("dim", "unknown")));
		}

		lines.push(line("cli ver", info.cliVersion));
		if (info.grokHome) {
			lines.push(line("grok home", theme.fg("muted", info.grokHome)));
		}
		if (info.autoRefreshEnabled) {
			lines.push(line("refresh", theme.fg("success", "auto (OIDC)")));
		} else if (info.hasRefreshToken) {
			lines.push(line("refresh", theme.fg("dim", "stored")));
		}

		if (info.tokenSource === "file" || info.autoRefreshEnabled) {
			const billing = await getGrokBilling({ force: options.forceBilling });
			appendBillingLines(lines, line, billing);
		}

		if (expiresAt && expiresAt.getTime() <= Date.now() && !info.autoRefreshEnabled) {
			lines.push("");
			lines.push(theme.fg("warning", "Token expired — run: grok login"));
		}
	}

	lines.push("");
	lines.push(theme.fg("muted", "Commands: /grok refresh"));
	lines.push(theme.fg("dim", "Esc/q close"));
	lines.push(theme.fg("borderMuted", "╰───────────────────────────────────────────────────────────╯"));

	return lines;
}

export async function handleGrokRefresh(): Promise<string> {
	clearGrokAuthCache();
	try {
		const token = await ensureFreshGrokAuthToken({ force: true });
		if (token) {
			const info = getGrokAuthInfo();
			const billing = await getGrokBilling({ force: true });
			const expiry = info.expiresAt ? info.expiresAt.toLocaleString() : "unknown";
			const credits =
				billing.available && !billing.error ? ` · ${formatCredits(billing.creditsRemaining)} kredi kaldı` : "";
			return theme.fg("accent", `✓ Grok token refreshed. Expires ${expiry}${credits}.`);
		}
		return theme.fg("warning", "No Grok token available. Run `grok login` first.");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return theme.fg("warning", `Refresh failed: ${message}`);
	}
}
