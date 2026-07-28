/**
 * Pure utility functions for plan mode.
 * Extracted for testability.
 */

// Destructive commands blocked in plan mode
const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\|\s*(sh|bash|zsh|fish|powershell|pwsh|cmd)\b/i,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)\b/i,
	/\bnpm\s+audit\s+fix\b/i,
	/\byarn\s+(add|remove|install|publish)\b/i,
	/\byarn\s+audit\s+--fix\b/i,
	/\bpnpm\s+(add|remove|install|publish)\b/i,
	/\bpnpm\s+audit\s+--fix\b/i,
	/\bpip\s+(install|uninstall)\b/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)\b/i,
	/\bbrew\s+(install|uninstall|upgrade)\b/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|restore|worktree|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)\b/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)\b/i,
	/\bservice\s+\S+\s+(start|stop|restart)\b/i,
	/\bcurl\b.*\s(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)\b/i,
	/\bcurl\b.*\s(?:-d|--data|--data-raw|--data-binary|--form|-F)\b/i,
	/\bcurl\b.*\s(?:-o|-O|--output|--remote-name|--upload-file|-T)\b/i,
	/\bwget\b.*\s(?:-O|--output-document)\s*(?!-)\S+/i,
	/\bwget\b.*\s(?:--post-data|--post-file|--method)\b/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

// Safe read-only commands allowed in plan mode
const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)(\s+.*)?$/i,
	/^\s*git\s+ls-[\w-]+(\s+.*)?$/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated)(\s+.*)?$/i,
	/^\s*npm\s+audit(\s+--.*)?$/i,
	/^\s*npm\s+run\s+(typecheck|check|lint|test)(\s+--.*)?$/i,
	/^\s*yarn\s+(list|info|why)(\s+.*)?$/i,
	/^\s*yarn\s+audit(\s+--.*)?$/i,
	/^\s*yarn\s+(typecheck|check|lint|test)(\s+--.*)?$/i,
	/^\s*pnpm\s+(typecheck|check|lint|test)(\s+--.*)?$/i,
	/^\s*(npx\s+)?tsc\s+--noEmit(\s+.*)?$/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*curl\s+(?!(?:.*\s)?(?:-X|--request|-d|--data|--data-raw|--data-binary|--form|-F|-o|-O|--output|--remote-name|--upload-file|-T)\b).+$/i,
	/^\s*wget\s+(?!(?:.*\s)?(?:--post-data|--post-file|--method)\b)(?:-q\s+)?(?:-O\s*-\s+)?\S+\s*$/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*exa\b/,
];

export function isSafeCommand(command: string): boolean {
	const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
	const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
	return !isDestructive && isSafe;
}

export interface TodoItem {
	step: number;
	text: string;
	fullText?: string;
	completed: boolean;
}

export function shouldUseAmbientTodos(text: string): boolean {
	const normalized = text.trim();
	if (normalized.length < 80) return false;

	const lines = normalized.split(/\r?\n/).filter((line) => line.trim().length > 0);
	const hasMultipleLines = lines.length >= 3;
	const hasSequencing =
		/(\b(first|then|after|also|finally|next)\b|\b(önce|sonra|ardından|ayrıca|son olarak|devamında)\b)/i.test(
			normalized,
		) || /\n\s*(?:[-*]|\d+[.)])\s+/.test(normalized);
	const hasManySentences = normalized.split(/[.!?]+/).filter((part) => part.trim().length > 0).length >= 3;

	return hasMultipleLines || hasSequencing || hasManySentences;
}

export function extractMentionedPaths(text: string): string[] {
	const matches = text.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g) ?? [];
	return Array.from(new Set(matches)).slice(0, 3);
}

export function createAmbientTodoItems(text: string, isTurkish: boolean): TodoItem[] {
	const mentionedPaths = extractMentionedPaths(text);
	const inspectTarget =
		mentionedPaths.length > 0
			? isTurkish
				? `İlgili dosyaları incele (${mentionedPaths.join(", ")})`
				: `Inspect the relevant files (${mentionedPaths.join(", ")})`
			: isTurkish
				? "İlgili dosyaları ve mevcut implementasyonu incele"
				: "Inspect the relevant files and current implementation";

	const fullTexts = isTurkish
		? [
				"Kullanıcının talebini netleştir ve görevin kapsamını belirle",
				inspectTarget,
				"İstenen değişiklikleri uygula",
				"Gerekli kontrolleri yap ve sonucu özetle",
			]
		: [
				"Clarify the user request and confirm the task scope",
				inspectTarget,
				"Apply the requested changes",
				"Run relevant checks and summarize the result",
			];

	return fullTexts.map((fullText, index) => ({
		step: index + 1,
		text: cleanStepText(fullText),
		fullText,
		completed: false,
	}));
}

export function cleanStepText(text: string): string {
	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(
			/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
			"",
		)
		.replace(/\s+/g, " ")
		.trim();

	if (cleaned.length > 0) {
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
	if (cleaned.length > 50) {
		cleaned = `${cleaned.slice(0, 47)}...`;
	}
	return cleaned;
}

function appendTodoItem(items: TodoItem[], rawText: string): void {
	const normalized = rawText
		.trim()
		.replace(/\*{1,2}$/, "")
		.trim();

	if (normalized.length <= 5 || normalized.startsWith("`") || normalized.startsWith("/")) return;

	const cleaned = cleanStepText(normalized);
	if (cleaned.length <= 3) return;

	items.push({
		step: items.length + 1,
		text: cleaned,
		fullText: normalized,
		completed: false,
	});
}

function parseNumberedTodoItems(text: string): TodoItem[] {
	const items: TodoItem[] = [];
	const numberedPattern = /^\s*(\d+)[.)]\s+(.+?)\s*$/gm;

	for (const match of text.matchAll(numberedPattern)) {
		appendTodoItem(items, match[2]);
	}

	return items;
}

function parseFlexibleTodoItems(text: string): TodoItem[] {
	const items: TodoItem[] = [];
	const flexiblePattern = /^\s*(?:[-*]\s+(?:\[[ xX]\]\s*)?|(?:Step|Adım|Aşama)\s*\d+\s*[:.)-]\s*)(.+?)\s*$/gim;

	for (const match of text.matchAll(flexiblePattern)) {
		appendTodoItem(items, match[1]);
	}

	return items;
}

export function extractTodoItems(message: string): TodoItem[] {
	const headerMatch = message.match(
		/^\s*(?:#{1,6}\s*)?\*{0,2}(?:(?:Implementation|Execution|Action)\s+Plan|Plan|Uygulama\s+Plan[ıi]|Çalışma\s+Plan[ıi]|Görev\s+Listesi|TODO\s+Listesi|Checklist)\s*(?:\([^\n)]*\))?\s*:?\*{0,2}\s*$/im,
	);

	if (headerMatch && headerMatch.index !== undefined) {
		const planSection = message.slice(headerMatch.index + headerMatch[0].length);
		const numberedItems = parseNumberedTodoItems(planSection);
		if (numberedItems.length > 0) return numberedItems;
		const flexibleItems = parseFlexibleTodoItems(planSection);
		if (flexibleItems.length > 0) return flexibleItems;
	}

	const fallbackItems = parseNumberedTodoItems(message);
	if (fallbackItems.length >= 2) return fallbackItems;
	const flexibleFallbackItems = parseFlexibleTodoItems(message);
	return flexibleFallbackItems.length >= 2 ? flexibleFallbackItems : [];
}

export function extractDoneSteps(message: string): number[] {
	const steps = new Set<number>();
	for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.add(step);
	}
	return Array.from(steps);
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
	const doneSteps = extractDoneSteps(text);
	let marked = 0;
	for (const step of doneSteps) {
		const item = items.find((t) => t.step === step);
		if (item && !item.completed) {
			item.completed = true;
			marked++;
		}
	}
	return marked;
}
