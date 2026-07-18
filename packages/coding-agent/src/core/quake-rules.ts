/**
 * quake-rules.ts - Path-scoped rules for Quake Code.
 *
 * Rules are markdown files in .quake-code/rules/ that apply to specific
 * file types or directories. Rules are loaded on-demand when the agent
 * reads files matching the rule's path pattern.
 *
 * File naming convention:
 *   .quake-code/rules/*.md                  - applies to all files
 *   .quake-code/rules/*.{ts,tsx}.md         - applies to .ts/.tsx files
 *   .quake-code/rules/all/tests/*.md         - applies to files in test dirs
 *   .quake-code/rules/*.{glob}.md           - glob pattern in filename
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";

/** A loaded rule with its path pattern and content. */
export interface Rule {
	path: string;
	name: string;
	pattern: string;
	content: string;
	description?: string;
}

/** Result of loading rules for a specific file path. */
export interface RulesForFile {
	rules: Rule[];
	totalRules: number;
}

let rulesCache: Rule[] | null = null;
let rulesCacheTime = 0;
const CACHE_TTL_MS = 5000;

function isSymlink(filePath: string): boolean {
	try {
		return lstatSync(filePath).isSymbolicLink();
	} catch {
		return false;
	}
}

function parseRulePattern(filename: string): string {
	const name = basename(filename, ".md");
	const ext = extname(name);
	if (ext) {
		const glob = name.slice(0, -ext.length);
		return "**/*.{" + ext.slice(1) + "}";
	}
	if (name.includes(".")) {
		const path = name.replace(/\./g, "/");
		return path + "/**";
	}
	return "**/*";
}

export function pathMatchesRule(filePath: string, rulePattern: string): boolean {
	const normalizedPath = filePath.replace(/\\/g, "/");
	const normalizedPattern = rulePattern.replace(/\\/g, "/");
	if (normalizedPattern === "**/*") {
		return true;
	}
	const extMatch = normalizedPattern.match(/^\*\*\/\*\.\{(\w+)\}$/);
	if (extMatch) {
		const targetExt = extMatch[1];
		return normalizedPath.endsWith("." + targetExt);
	}
	const pathMatch = normalizedPattern.match(/^\*\*\/(.+)\/\*\*$/);
	if (pathMatch) {
		return normalizedPath.includes(pathMatch[1]);
	}
	return false;
}

export function loadRules(cwd: string): Rule[] {
	const now = Date.now();
	if (rulesCache && now - rulesCacheTime < CACHE_TTL_MS) {
		return rulesCache;
	}
	const rulesDir = join(cwd, ".quake-code", "rules");
	const rules: Rule[] = [];
	if (!existsSync(rulesDir)) {
		rulesCache = rules;
		rulesCacheTime = now;
		return rules;
	}
	try {
		const entries = readdirSync(rulesDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isFile() && entry.name.endsWith(".md")) {
				const rulePath = join(rulesDir, entry.name);
				if (isSymlink(rulePath)) continue;
				try {
					if (statSync(rulePath).size > 1024 * 100) continue;
					const content = readFileSync(rulePath, "utf-8");
					const pattern = parseRulePattern(entry.name);
					let description: string | undefined;
					const descMatch = content.match(/^description:\s*(.+)$/m);
					if (descMatch) {
						description = descMatch[1].trim();
					}
					rules.push({
						path: rulePath,
						name: basename(entry.name, ".md"),
						pattern,
						content,
						description,
					});
				} catch {
					// skip
				}
			}
		}
	} catch {
		// skip
	}
	rulesCache = rules;
	rulesCacheTime = now;
	return rules;
}

export function clearRulesCache(): void {
	rulesCache = null;
	rulesCacheTime = 0;
}

export function getRulesForFile(cwd: string, filePath: string): RulesForFile {
	const allRules = loadRules(cwd);
	const matchingRules: Rule[] = [];
	for (const rule of allRules) {
		if (pathMatchesRule(filePath, rule.pattern)) {
			matchingRules.push(rule);
		}
	}
	matchingRules.sort((a, b) => {
		const aScore = patternSpecificity(a.pattern);
		const bScore = patternSpecificity(b.pattern);
		return bScore - aScore;
	});
	return {
		rules: matchingRules,
		totalRules: allRules.length,
	};
}

function patternSpecificity(pattern: string): number {
	if (pattern === "**/*") return 0;
	if (pattern.startsWith("**/*.")) return 1;
	if (pattern.includes("/**")) return 2;
	return 0;
}

export function formatRulesForPrompt(rules: Rule[]): string {
	if (rules.length === 0) return "";
	const parts: string[] = ["## Project Rules"];
	for (const rule of rules) {
		const desc = rule.description ? " (" + rule.description + ")" : "";
		parts.push("\n### " + rule.name + desc);
		parts.push(rule.content);
	}
	return parts.join("\n");
}

export function initRulesDirectory(cwd: string): void {
	const rulesDir = join(cwd, ".quake-code", "rules");
	if (!existsSync(rulesDir)) {
		mkdirSync(rulesDir, { recursive: true });
	}
	const sampleRule = join(rulesDir, "all.md");
	if (!existsSync(sampleRule)) {
		const content = [
			"# Project Rules",
			"",
			"Add path-scoped rules for your project here.",
			"",
			"## Naming Convention",
			"",
			"- typescript.ts.md - applies to all .ts files",
			"- react.tsx.md - applies to all .tsx files",
			"- test.jest.md - applies to test files",
			"- src.api.handlers.md - applies to src/api/handlers/ directory",
			"- all.md - applies to all files",
			"",
			"## Rule Format",
			"",
			"Rules use standard markdown. Add instructions that Claude should follow",
			"when working with files matching the rule's path pattern.",
			"",
			"`markdown",
			"# Rule Title",
			"",
			"Instructions for this specific file type or directory path.",
			"`",
		].join("\n");
		writeFileSync(sampleRule, content, "utf-8");
	}
}
