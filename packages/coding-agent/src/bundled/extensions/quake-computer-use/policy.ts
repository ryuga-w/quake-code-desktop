import * as fs from "node:fs";
import * as path from "node:path";

export type ComputerUseToolMode = "custom" | "claude_native";

export type ComputerUsePolicy = {
	actuateEnabled: boolean;
	stepLimit: number;
	/** custom = desktop_* tools; claude_native = unified `computer` tool + Anthropic API passthrough */
	toolMode?: ComputerUseToolMode;
};

export const DEFAULT_COMPUTER_USE_POLICY: ComputerUsePolicy = {
	actuateEnabled: false,
	stepLimit: 40,
	toolMode: "custom",
};

const READ_ONLY_TOOLS = new Set([
	"desktop_screenshot",
	"desktop_cursor_position",
	"desktop_list_windows",
	"desktop_list_apps",
	"desktop_list_displays",
	"desktop_ui_snapshot",
	"desktop_ui_find",
	"desktop_detect_uac",
]);
const ACTUATE_TOOLS = new Set([
	"desktop_mouse_move",
	"desktop_click",
	"desktop_type",
	"desktop_key",
	"desktop_scroll",
	"desktop_wait",
	"desktop_open_app",
	"desktop_focus_window",
	"desktop_close_window",
	"desktop_ui_click",
	"desktop_ui_type",
	"desktop_dialog_set_path",
	"desktop_task_done",
]);

const stepCounters = new Map<string, number>();

function policyFile(cwd: string): string {
	return path.join(cwd, ".quake-code", "computer-use", "policy.json");
}

export function loadComputerUsePolicy(cwd: string): ComputerUsePolicy {
	const file = policyFile(cwd);
	if (!fs.existsSync(file)) return { ...DEFAULT_COMPUTER_USE_POLICY };
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ComputerUsePolicy>;
		const toolMode = parsed.toolMode === "claude_native" ? "claude_native" : "custom";
		return {
			actuateEnabled: parsed.actuateEnabled === true,
			stepLimit:
				typeof parsed.stepLimit === "number" && parsed.stepLimit > 0
					? Math.min(Math.floor(parsed.stepLimit), 200)
					: DEFAULT_COMPUTER_USE_POLICY.stepLimit,
			toolMode,
		};
	} catch {
		return { ...DEFAULT_COMPUTER_USE_POLICY };
	}
}

export function saveComputerUsePolicy(cwd: string, patch: Partial<ComputerUsePolicy>): ComputerUsePolicy {
	const current = loadComputerUsePolicy(cwd);
	const next: ComputerUsePolicy = {
		actuateEnabled: patch.actuateEnabled ?? current.actuateEnabled,
		stepLimit: patch.stepLimit ?? current.stepLimit,
		toolMode: patch.toolMode ?? current.toolMode ?? "custom",
	};
	const dir = path.dirname(policyFile(cwd));
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(policyFile(cwd), `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return next;
}

export function resetStepCount(cwd: string): void {
	stepCounters.delete(cwd);
}

export function getStepCount(cwd: string): number {
	return stepCounters.get(cwd) ?? 0;
}

export function incrementStepCount(cwd: string): number {
	const next = getStepCount(cwd) + 1;
	stepCounters.set(cwd, next);
	return next;
}

export function isActuateTool(toolName: string): boolean {
	return ACTUATE_TOOLS.has(toolName);
}

export function isReadOnlyTool(toolName: string): boolean {
	return READ_ONLY_TOOLS.has(toolName);
}

export function assertComputerUseToolAllowed(
	cwd: string,
	toolName: string,
	options?: { requiresActuate?: boolean },
): void {
	const policy = loadComputerUsePolicy(cwd);
	const steps = incrementStepCount(cwd);
	if (steps > policy.stepLimit) {
		throw new Error(
			`Computer-use adım limiti aşıldı (${policy.stepLimit}). Oturumu sonlandırın veya Ayarlar → Masaüstü Computer-Use bölümünden limiti artırın.`,
		);
	}
	const needsActuate = options?.requiresActuate === true || isActuateTool(toolName);
	if (needsActuate && !policy.actuateEnabled) {
		throw new Error(
			"Masaüstü etkileşim araçları kapalı. Ayarlar → Customizations → Masaüstü Computer-Use bölümünden 'Etkileşim araçlarını etkinleştir' seçeneğini açın.",
		);
	}
	if (toolName === "computer") return;
	if (!isReadOnlyTool(toolName) && !isActuateTool(toolName)) {
		throw new Error(`Bilinmeyen computer-use aracı: ${toolName}`);
	}
}