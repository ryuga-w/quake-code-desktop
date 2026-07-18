export type OsTestMode = "quick" | "visual" | "autonomous";

export interface ParsedOsTestCommand {
	mode: OsTestMode;
	target?: string;
	raw: string;
}

export function parseOsTestCommand(raw: string): ParsedOsTestCommand {
	const trimmed = raw.trim();
	const rest = trimmed.startsWith("/test") ? trimmed.slice(5).trim() : trimmed;
	if (!rest) {
		return { mode: "visual", raw: trimmed };
	}

	const [first, ...tail] = rest.split(/\s+/);
	const lower = first.toLowerCase();
	if (lower === "quick" || lower === "visual" || lower === "autonomous") {
		return {
			mode: lower,
			target: tail.join(" ").trim() || undefined,
			raw: trimmed,
		};
	}

	return {
		mode: "visual",
		target: rest,
		raw: trimmed,
	};
}

export function buildOsTestPrompt(parsed: ParsedOsTestCommand): string {
	const targetClause = parsed.target
		? `Focus specifically on this target or scenario: ${parsed.target}.`
		: "Choose the most relevant visible app or UI flow from the current desktop state.";

	if (parsed.mode === "quick") {
		return [
			"Run a quick OS validation using the desktop tools.",
			"Use inspect_windows_ui first.",
			targetClause,
			"Then perform the smallest safe verification sequence possible.",
			"Prefer os_perform_step for any action that needs verification.",
			"Return a concise pass/fail report with the specific evidence observed.",
		].join(" ");
	}

	if (parsed.mode === "autonomous") {
		return [
			"Run an autonomous OS test workflow using the desktop tools.",
			"Use inspect_windows_ui to ground yourself, then plan a short multi-step test.",
			targetClause,
			"Prefer background-safe actions when possible.",
			"Use os_perform_step for each critical step so every action is verified.",
			"If a step fails, explain whether the failure happened during action or verification, and suggest the next fallback.",
			"Return a structured report with steps, evidence, and final verdict.",
		].join(" ");
	}

	return [
		"Run a visual OS audit using the desktop tools.",
		"Use inspect_windows_ui first and analyze the current UI state.",
		targetClause,
		"If useful, run one minimal verified step with os_perform_step.",
		"Return a focused visual audit report, notable risks, and what appears broken or ready.",
	].join(" ");
}
