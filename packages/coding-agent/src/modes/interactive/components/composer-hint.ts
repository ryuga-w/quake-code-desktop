import { truncateToWidth } from "@mrquake/quakecode-tui";
import type { AgentSession } from "../../../core/agent-session.js";
import type { ReadonlyFooterDataProvider } from "../../../core/footer-data-provider.js";
import { theme } from "../theme/theme.js";

type SessionModel = NonNullable<AgentSession["state"]["model"]>;

function stripControlChars(text: string): string {
	return text
		.replace(/\x1b\[[0-9;]*m/g, "")
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function formatDisplayModel(model: SessionModel, multiProvider: boolean): string {
	const label = multiProvider ? `${model.provider}/${model.id}` : model.id;
	const id = label.includes("/") ? label.split("/").pop() || label : label;
	const provider = model.provider.toLowerCase();

	if (provider === "grok" || provider === "grok-cli") {
		const versionMatch = id.match(/grok-?([\d.]+(?:-\d+)?)/i);
		const version = versionMatch?.[1]?.replace(/-/g, ".") ?? id;
		if (id.includes("reasoning")) return `Grok ${version} Reasoning`;
		if (id.includes("fast")) return `Grok ${version} Fast`;
		return `Grok ${version}`;
	}

	return id.replace(/^gpt-/, "gpt-").replace(/-/g, " ");
}

function resolveModeLabel(session: AgentSession, footerData?: ReadonlyFooterDataProvider): string {
	const planStatus = footerData?.getExtensionStatuses().get("plan-mode");
	if (planStatus) {
		const plain = stripControlChars(planStatus);
		if (plain) return plain;
	}

	const model = session.state.model;
	if (model?.reasoning) {
		const level = session.state.thinkingLevel || "off";
		if (level !== "off") return `think ${level}`;
	}

	return "always-approve";
}

export function buildComposerFooterHint(session: AgentSession, footerData?: ReadonlyFooterDataProvider): string {
	const model = session.state.model;
	const multiProvider = session.modelRegistry.getAvailable().length > 1;
	const modelPart = model ? formatDisplayModel(model, multiProvider) : "no model";
	const modePart = resolveModeLabel(session, footerData);
	return `${modelPart} - ${modePart}`;
}

/** @deprecated Use buildComposerFooterHint — kept for invalidate wiring. */
export class ComposerHintComponent {
	constructor(
		private readonly getSession: () => AgentSession,
		private readonly getFooterData?: () => ReadonlyFooterDataProvider,
	) {}

	invalidate(): void {}

	getText(): string {
		return buildComposerFooterHint(this.getSession(), this.getFooterData?.());
	}

	render(width: number): string[] {
		const text = theme.fg("dim", this.getText());
		return [truncateToWidth(text, width, theme.fg("dim", "…"))];
	}
}
