export interface KimiModelRef {
	provider?: string;
	id?: string;
}

export interface PendingKimiEditRecovery {
	path?: string;
	reason: string;
	modelLabel: string;
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}

export function firstPathArg(args: any): string | undefined {
	return firstString(args?.path, args?.filePath, args?.cwd, args?.dir, args?.directory);
}

export function isKimiK25Model(model: KimiModelRef | undefined): boolean {
	if (!model) return false;
	const provider = model.provider?.toLowerCase() ?? "";
	const id = model.id?.toLowerCase() ?? "";
	return provider === "kimi-coding" || id.includes("kimi-k2.5");
}

export function isGlm5Model(model: KimiModelRef | undefined): boolean {
	if (!model) return false;
	const provider = model.provider?.toLowerCase() ?? "";
	const id = model.id?.toLowerCase() ?? "";
	return provider === "zai" || id === "z-ai/glm5" || id === "glm-5" || id.includes("glm-5") || id.includes("glm5");
}

export function getQuakeOptimizationBadge(model: KimiModelRef | undefined): string | undefined {
	if (isKimiK25Model(model) || isGlm5Model(model)) {
		return "Optimized for QuakeCode";
	}
	return undefined;
}

export function detectKimiEditRecoveryNeed(
	model: KimiModelRef | undefined,
	toolName: string,
	result: { content?: Array<{ type?: string; text?: string }> } | undefined,
	isError: boolean,
	args?: any,
): PendingKimiEditRecovery | undefined {
	if (!isError || toolName !== "edit" || (!isKimiK25Model(model) && !isGlm5Model(model))) {
		return undefined;
	}

	const text = (result?.content ?? [])
		.filter((item) => item.type === "text")
		.map((item) => item.text ?? "")
		.join("\n");
	if (!text.includes("Could not find the exact text")) {
		return undefined;
	}

	return {
		path: firstPathArg(args),
		reason: text,
		modelLabel: isGlm5Model(model) ? "GLM-5" : "Kimi",
	};
}

export function buildKimiEditRecoveryToolMessage(recovery: PendingKimiEditRecovery): string {
	const target = recovery.path ? ` for ${recovery.path}` : "";
	return [
		recovery.reason,
		`${recovery.modelLabel} recovery policy active${target}. Do not reconstruct or rewrite the file from memory.`,
		"Required next step: use read on the target file, then retry with a smaller exact match.",
		"If the next exact edit also fails, stop and report the mismatch briefly instead of rewriting the file.",
	].join("\n\n");
}

function isMutatingBashCommand(command: string | undefined): boolean {
	const lower = command?.toLowerCase() ?? "";
	if (!lower) return false;
	if (/\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|build|lint|check)\b/.test(lower)) return false;
	if (/\b(vitest|jest|tsc|eslint|biome|pytest|ruff|mypy|cargo test|go test)\b/.test(lower)) return false;
	if (/\bgit\s+(status|diff|log|show|branch)\b/.test(lower)) return false;
	if (/\b(ls|dir|find|fd|rg|grep|cat|head|tail|pwd|which|where)\b/.test(lower)) return false;
	return true;
}

export function evaluateKimiRecoveryGate(
	recovery: PendingKimiEditRecovery | undefined,
	toolName: string,
	args?: any,
): { clearRecovery: boolean; blockReason?: string } {
	if (!recovery) {
		return { clearRecovery: false };
	}

	if (toolName === "read") {
		const readPath = firstPathArg(args);
		if (!recovery.path || !readPath || readPath === recovery.path) {
			return { clearRecovery: true };
		}
		return { clearRecovery: false };
	}

	const blocksMutation =
		toolName === "edit" || toolName === "write" || (toolName === "bash" && isMutatingBashCommand(args?.command));
	if (!blocksMutation) {
		return { clearRecovery: false };
	}

	const target = recovery.path ? ` ${recovery.path}` : " the target file";
	return {
		clearRecovery: false,
		blockReason: `${recovery.modelLabel} edit recovery is active. Read${target} before attempting another mutating operation. Do not rewrite the file from memory.`,
	};
}
