export type OperationRiskLevel = "safe" | "caution" | "review" | "high-impact";

export interface OperationReviewSignal {
	level: OperationRiskLevel;
	label: string;
	detail?: string;
	isReadOnly: boolean;
}

export interface OperationReviewContext {
	currentModel?: {
		provider?: string;
		id?: string;
	};
}

export interface OperationEvidenceSummary {
	surfaces: string[];
	verificationRecommended: boolean;
	filesTouched: number;
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value !== "string") continue;
		const trimmed = value.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}

function firstPathArg(args: any): string | undefined {
	return firstString(args?.path, args?.filePath, args?.cwd, args?.dir, args?.directory);
}

function isSensitivePath(path: string | undefined): boolean {
	if (!path) return false;
	const lower = path.toLowerCase();
	return [
		"package.json",
		"package-lock.json",
		"bun.lock",
		"bun.lockb",
		"pnpm-lock.yaml",
		"yarn.lock",
		"tsconfig.json",
		"biome.json",
		"eslint.config",
		".env",
		".github/workflows/",
		"dockerfile",
		"compose.yml",
		"compose.yaml",
	].some((token) => lower.includes(token));
}

function getReliabilityProfile(context?: OperationReviewContext): "none" | "kimi" | "glm" {
	const provider = context?.currentModel?.provider?.toLowerCase() ?? "";
	const id = context?.currentModel?.id?.toLowerCase() ?? "";
	if (provider === "kimi-coding" || id.includes("kimi-k2.5")) return "kimi";
	if (provider === "zai" || id === "z-ai/glm5" || id === "glm-5" || id.includes("glm-5") || id.includes("glm5")) {
		return "glm";
	}
	return "none";
}

function isScriptOrConfigPath(path: string | undefined): boolean {
	if (!path) return false;
	const lower = path.toLowerCase();
	return (
		lower.endsWith(".ts") ||
		lower.endsWith(".tsx") ||
		lower.endsWith(".js") ||
		lower.endsWith(".jsx") ||
		lower.endsWith(".mjs") ||
		lower.endsWith(".cjs") ||
		lower.endsWith(".json") ||
		lower.endsWith(".yml") ||
		lower.endsWith(".yaml") ||
		lower.endsWith(".sh") ||
		lower.includes("scripts/") ||
		lower.includes("config")
	);
}

function collectSurfaces(paths: Array<string | undefined>, command?: string): string[] {
	const surfaces = new Set<string>();
	for (const path of paths) {
		const lower = path?.toLowerCase() ?? "";
		if (!lower) continue;
		if (
			lower.includes("package.json") ||
			lower.includes("lock") ||
			lower.includes("pnpm") ||
			lower.includes("yarn")
		) {
			surfaces.add("dependency");
		}
		if (
			lower.includes("tsconfig") ||
			lower.includes("biome") ||
			lower.includes("eslint") ||
			lower.includes("config") ||
			lower.endsWith(".json") ||
			lower.endsWith(".yml") ||
			lower.endsWith(".yaml")
		) {
			surfaces.add("config");
		}
		if (lower.includes(".env") || lower.includes("auth") || lower.includes("token") || lower.includes("credential")) {
			surfaces.add("auth");
		}
		if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".jsx")) {
			surfaces.add("code");
		}
		if (lower.includes("scripts/") || lower.endsWith(".sh") || lower.includes("workflow")) {
			surfaces.add("script");
		}
	}
	const lowerCommand = command?.toLowerCase() ?? "";
	if (/\b(npm|pnpm|yarn|bun)\s+(install|add|remove|uninstall|update|upgrade)\b/.test(lowerCommand)) {
		surfaces.add("dependency");
	}
	if (/\b(tsc|eslint|biome|vitest|jest|pytest|ruff|mypy)\b/.test(lowerCommand)) {
		surfaces.add("verification");
	}
	return Array.from(surfaces);
}

export function summarizeOperationEvidence(toolName: string, args?: any): OperationEvidenceSummary {
	const primaryPath = firstPathArg(args);
	const editPaths = toolName === "edit" || toolName === "write" ? [primaryPath] : [];
	const command = toolName === "bash" ? firstString(args?.command) : undefined;
	const surfaces = collectSurfaces(editPaths, command);
	const verificationRecommended =
		toolName === "edit" ||
		toolName === "write" ||
		surfaces.includes("dependency") ||
		surfaces.includes("config") ||
		surfaces.includes("script");
	return {
		surfaces,
		verificationRecommended,
		filesTouched: editPaths.filter(Boolean).length,
	};
}

function classifyEditRisk(args: any, context?: OperationReviewContext): OperationReviewSignal {
	const path = firstPathArg(args);
	const editCount = Array.isArray(args?.edits) ? args.edits.length : 0;
	const reliabilityProfile = getReliabilityProfile(context);
	if (isSensitivePath(path)) {
		return {
			level: "high-impact",
			label: "High-impact file change",
			detail: path,
			isReadOnly: false,
		};
	}
	if (reliabilityProfile !== "none" && isScriptOrConfigPath(path)) {
		return {
			level: editCount > 3 ? "high-impact" : "review",
			label:
				reliabilityProfile === "glm"
					? "GLM-5 reliability review for script/config change"
					: "Kimi reliability review for script/config change",
			detail: `${path ?? "target file"}${editCount > 0 ? ` · ${editCount} targeted replacements` : ""}`,
			isReadOnly: false,
		};
	}
	if (editCount > 3) {
		return {
			level: "review",
			label: "Review suggested before applying",
			detail: `${editCount} targeted replacements${path ? ` · ${path}` : ""}`,
			isReadOnly: false,
		};
	}
	return {
		level: "caution",
		label: "Targeted workspace change",
		detail: path,
		isReadOnly: false,
	};
}

function classifyWriteRisk(args: any, context?: OperationReviewContext): OperationReviewSignal {
	const path = firstPathArg(args);
	const content = firstString(args?.content) ?? "";
	const lineCount = content ? content.split("\n").length : 0;
	const reliabilityProfile = getReliabilityProfile(context);
	if (isSensitivePath(path)) {
		return {
			level: "high-impact",
			label: "High-impact file write",
			detail: path,
			isReadOnly: false,
		};
	}
	if (reliabilityProfile !== "none" && isScriptOrConfigPath(path)) {
		return {
			level: lineCount > 40 ? "high-impact" : "review",
			label:
				reliabilityProfile === "glm"
					? "GLM-5 reliability review for script/config write"
					: "Kimi reliability review for script/config write",
			detail: `${path ?? "target file"}${lineCount > 0 ? ` · ${lineCount} lines` : ""}`,
			isReadOnly: false,
		};
	}
	return {
		level: lineCount > 40 ? "review" : "caution",
		label: lineCount > 40 ? "Large file write" : "Workspace file write",
		detail: path,
		isReadOnly: false,
	};
}

function classifyBashRisk(args: any): OperationReviewSignal {
	const command = firstString(args?.command) ?? "";
	const lower = command.toLowerCase();
	if (!command) {
		return { level: "review", label: "Command execution", isReadOnly: false };
	}

	if (
		/\b(rm|del|rmdir|mv|move|chmod|chown)\b/.test(lower) ||
		/\bgit\s+(reset|checkout|switch|clean|restore|rebase|push)\b/.test(lower)
	) {
		return {
			level: "high-impact",
			label: "Command may mutate or discard workspace state",
			detail: command,
			isReadOnly: false,
		};
	}

	if (/\b(npm|pnpm|yarn|bun)\s+(install|add|remove|uninstall|update|upgrade)\b/.test(lower)) {
		return {
			level: "high-impact",
			label: "Dependency operation",
			detail: command,
			isReadOnly: false,
		};
	}

	if (
		/\b(npm|pnpm|yarn|bun|cargo|go)\s+(run\s+)?(test|build|lint|check)\b/.test(lower) ||
		/\b(vitest|jest|tsc|eslint|biome|pytest|ruff|mypy|cargo test|go test)\b/.test(lower)
	) {
		return {
			level: "caution",
			label: "Verification command",
			detail: command,
			isReadOnly: true,
		};
	}

	if (
		/\bgit\s+(status|diff|log|show|branch)\b/.test(lower) ||
		/\b(ls|dir|find|fd|rg|grep|cat|head|tail|pwd|which|where)\b/.test(lower)
	) {
		return {
			level: "safe",
			label: "Read-only inspection",
			detail: command,
			isReadOnly: true,
		};
	}

	return {
		level: "review",
		label: "Command review recommended",
		detail: command,
		isReadOnly: false,
	};
}

export function classifyOperationRisk(
	toolName: string,
	args?: any,
	context?: OperationReviewContext,
): OperationReviewSignal {
	if (
		toolName === "read" ||
		toolName === "grep" ||
		toolName === "find" ||
		toolName === "ls" ||
		toolName === "web_search"
	) {
		return {
			level: "safe",
			label: "Read-only tool",
			detail: firstPathArg(args),
			isReadOnly: true,
		};
	}
	if (toolName === "edit") return classifyEditRisk(args, context);
	if (toolName === "write") return classifyWriteRisk(args, context);
	if (toolName === "bash") return classifyBashRisk(args);
	if (toolName.startsWith("browser_")) {
		return {
			level: "caution",
			label: "Interactive browser action",
			detail: firstString(args?.url, args?.selector, args?.target),
			isReadOnly: false,
		};
	}
	return {
		level: "review",
		label: "Review recommended",
		detail: toolName,
		isReadOnly: false,
	};
}
