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
	/\b(del|erase|rd|ren)\b/i,
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
	/\s--(?:fix|write)\b/i,
	/\b(?:remove|set|add|new|copy|move|rename|clear)-item\b/i,
	/\b(?:set|add|clear)-content\b/i,
	/\bout-file\b/i,
	/\bstart-process\b/i,
	/\bstop-process\b/i,
	/\bset-executionpolicy\b/i,
	/\b(?:invoke-webrequest|iwr)\b.*\s-outfile\b/i,
	/\b(?:invoke-restmethod|irm)\b.*\s-method\s+(?:post|put|patch|delete)\b/i,
	/\bfind\b.*\s-(?:delete|exec(?:dir)?|ok(?:dir)?|fprint(?:f)?|fls)\b/i,
	/\bsed\b.*\s-i\b/i,
	/\bawk\b.*\bsystem\s*\(/i,
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
	/^\s*(?:get-content|gc)\b/i,
	/^\s*(?:get-childitem|gci|dir)\b/i,
	/^\s*(?:select-string|sls)\b/i,
	/^\s*(?:get-location|gl)\b/i,
	/^\s*(?:get-item|gi)\b/i,
	/^\s*(?:get-command|gcm)\b/i,
	/^\s*(?:get-process|gps)\b/i,
	/^\s*(?:measure-object|measure)\b/i,
	/^\s*(?:where-object|sort-object|select-object|format-list|format-table)\b/i,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)(\s+.*)?$/i,
	/^\s*git\s+ls-[\w-]+(\s+.*)?$/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated)(\s+.*)?$/i,
	/^\s*npm\s+audit(\s+--.*)?$/i,
	/^\s*npm\s+run\s+(typecheck|lint|test)(\s+--.*)?$/i,
	/^\s*yarn\s+(list|info|why)(\s+.*)?$/i,
	/^\s*yarn\s+audit(\s+--.*)?$/i,
	/^\s*yarn\s+(typecheck|lint|test)(\s+.*)?$/i,
	/^\s*pnpm\s+(typecheck|lint|test)(\s+.*)?$/i,
	/^\s*(npx\s+)?tsc\s+--noEmit(\s+.*)?$/i,
	/^\s*node\s+--version\s*$/i,
	/^\s*python\s+--version\s*$/i,
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

const SAFE_XARGS_PROGRAMS = new Set(["file", "stat", "wc"]);
const XARGS_FLAGS = new Set(["-0", "--null", "-r", "--no-run-if-empty", "-t", "--verbose", "-x", "--exit"]);
const XARGS_OPTIONS_WITH_VALUE = new Set([
	"-a",
	"--arg-file",
	"-d",
	"--delimiter",
	"-E",
	"--eof",
	"-I",
	"--replace",
	"-L",
	"--max-lines",
	"-n",
	"--max-args",
	"-P",
	"--max-procs",
	"-s",
	"--max-chars",
]);

function splitShellCommands(command: string): string[] | undefined {
	const commands: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;

	const finishCommand = (): boolean => {
		const trimmed = current.trim();
		if (!trimmed) return false;
		commands.push(trimmed);
		current = "";
		return true;
	};

	for (let index = 0; index < command.length; index += 1) {
		const character = command[index];
		const next = command[index + 1];

		if (quote === "'") {
			current += character;
			if (character === "'") quote = undefined;
			continue;
		}

		if (quote === '"') {
			if (!escaped && (character === "`" || (character === "$" && next === "("))) return undefined;
			current += character;
			if (escaped) {
				escaped = false;
			} else if (character === "\\") {
				escaped = true;
			} else if (character === '"') {
				quote = undefined;
			}
			continue;
		}

		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}
		if (character === "\\") {
			current += character;
			escaped = true;
			continue;
		}
		if (character === "'" || character === '"') {
			current += character;
			quote = character;
			continue;
		}
		if (
			character === "`" ||
			(character === "$" && next === "(") ||
			(character === "<" && (next === "(" || next === "<"))
		) {
			return undefined;
		}
		if (character === ";" || character === "\n" || character === "\r" || character === "|") {
			if (!finishCommand()) return undefined;
			if (character === "|" && next === "|") index += 1;
			if (character === "\r" && next === "\n") index += 1;
			continue;
		}
		if (character === "&") {
			if (next !== "&" || !finishCommand()) return undefined;
			index += 1;
			continue;
		}

		current += character;
	}

	if (quote || escaped || !finishCommand()) return undefined;
	return commands;
}

function tokenizeSimpleCommand(command: string): string[] | undefined {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;
	let started = false;

	const finishWord = () => {
		if (!started) return;
		words.push(current);
		current = "";
		started = false;
	};

	for (const character of command) {
		if (quote === "'") {
			if (character === "'") quote = undefined;
			else current += character;
			started = true;
			continue;
		}
		if (quote === '"') {
			if (escaped) {
				current += character;
				escaped = false;
			} else if (character === "\\") {
				escaped = true;
			} else if (character === '"') {
				quote = undefined;
			} else {
				current += character;
			}
			started = true;
			continue;
		}
		if (escaped) {
			current += character;
			escaped = false;
			started = true;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			started = true;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			started = true;
			continue;
		}
		if (/\s/.test(character)) {
			finishWord();
			continue;
		}
		current += character;
		started = true;
	}

	if (quote || escaped) return undefined;
	finishWord();
	return words;
}

function isSafeXargsCommand(command: string): boolean {
	const words = tokenizeSimpleCommand(command);
	if (!words || words[0]?.toLowerCase() !== "xargs") return false;

	let index = 1;
	while (index < words.length) {
		const option = words[index];
		if (option === "--") {
			index += 1;
			break;
		}
		if (XARGS_FLAGS.has(option)) {
			index += 1;
			continue;
		}
		const inlineOption = option.match(/^(--[^=]+)=/i)?.[1];
		if (inlineOption && XARGS_OPTIONS_WITH_VALUE.has(inlineOption)) {
			index += 1;
			continue;
		}
		if (XARGS_OPTIONS_WITH_VALUE.has(option)) {
			if (index + 1 >= words.length) return false;
			index += 2;
			continue;
		}
		if (/^-(?:[aAdEILnPs])[^-].*/.test(option)) {
			index += 1;
			continue;
		}
		if (option.startsWith("-")) return false;
		break;
	}

	if (index >= words.length) return true; // xargs defaults to echo
	const program = words[index].replace(/^.*[/\\]/, "").replace(/\.exe$/i, "").toLowerCase();
	return SAFE_XARGS_PROGRAMS.has(program);
}

function isSafeSimpleCommand(command: string): boolean {
	if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))) return false;
	if (/^\s*xargs\b/i.test(command)) return isSafeXargsCommand(command);
	return SAFE_PATTERNS.some((pattern) => pattern.test(command));
}

export function isSafeCommand(command: string): boolean {
	const commands = splitShellCommands(command);
	return commands !== undefined && commands.every(isSafeSimpleCommand);
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

function slicePlanSection(text: string): string {
	const boundaryPattern =
		/^\s*(?:#{1,6}\s+)?\*{0,2}(?:Risks?|Riskler|Tests?|Testler|Validation|Doğrulama|Affected\s+Files?|Etkilenecek\s+Dosyalar|Notes?|Notlar|Ana\s+Riskler|Çalıştırılacak\s+Testler)\s*(?:\([^\n)]*\))?\s*:?\*{0,2}\s*$/im;
	const boundaryMatch = text.match(boundaryPattern);
	return boundaryMatch?.index === undefined ? text : text.slice(0, boundaryMatch.index);
}

export function extractTodoItems(message: string): TodoItem[] {
	const headerMatch = message.match(
		/^\s*(?:#{1,6}\s*)?\*{0,2}(?:(?:Implementation|Execution|Action)\s+Plan|Plan|Uygulama\s+Plan[ıi]|Çalışma\s+Plan[ıi]|Görev\s+Listesi|TODO\s+Listesi|Checklist)\s*(?:\([^\n)]*\))?\s*:?\*{0,2}\s*$/im,
	);

	if (headerMatch && headerMatch.index !== undefined) {
		const planSection = slicePlanSection(message.slice(headerMatch.index + headerMatch[0].length));
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
	for (const match of message.matchAll(
		/\b(?:step|ad[ıi]m)\s*(\d+)\s*(?:is\s+)?(?:done|complete|completed|tamamland[ıi]|tamamlad[ıi]m|bitti|bitirdim)\b/gi,
	)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.add(step);
	}
	for (const match of message.matchAll(
		/\b(?:done|complete|completed|finished|tamamland[ıi]|tamamlad[ıi]m|bitti|bitirdim)\s*:?\s*(?:step|ad[ıi]m)\s*(\d+)\b/gi,
	)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.add(step);
	}
	for (const match of message.matchAll(
		/^\s*(?:[-*+]\s*)?(\d+)[.)]?\s*(?:step|ad[ıi]m[ıi]?)\s*(?:is\s+)?(?:done|complete|completed|tamamland[ıi]|tamamlad[ıi]m|bitti|bitirdim)\b/gim,
	)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.add(step);
	}
	for (const match of message.matchAll(
		/^\s*(?:[-*+]\s*)?(\d+)[.)]?\s*ad[ıi]m[ıi]?\s*(?:tamamland[ıi]|tamamlad[ıi]m|bitti|bitirdim)(?:\s|[.!?:;]|$)/gim,
	)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.add(step);
	}
	for (const match of message.matchAll(
		/ad[ıi]m\s*(\d+)\s*(?:tamamland[ıi]|tamamlad[ıi]m|bitti|bitirdim)(?:\s|[.!?:;]|$)/gim,
	)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.add(step);
	}
	for (const match of message.matchAll(/tamamlanan\s+ad[ıi]m\s*(\d+)(?:\s|[.!?:;]|$)/gim)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.add(step);
	}
	for (const match of message.matchAll(/^\s*(?:[-*+]\s*)?(?:\[x\]|☑|✓|✅)\s*(\d+)[.)]?\s+/gim)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.add(step);
	}
	for (const match of message.matchAll(/^\s*(\d+)[.)]\s*(?:\[x\]|☑|✓|✅)\s+/gim)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.add(step);
	}
	for (const match of message.matchAll(/^\s*(\d+)[.)]\s+.*(?:\[x\]|☑|✓|✅)\s*$/gim)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.add(step);
	}
	return Array.from(steps).sort((a, b) => a - b);
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

/** Tools that usually mean real plan progress (not pure read). */
export function isPlanProgressTool(toolName: string): boolean {
	const name = String(toolName || "").toLowerCase();
	return (
		name === "write" ||
		name === "edit" ||
		name === "apply_patch" ||
		name === "multi_edit" ||
		name === "create_file" ||
		name === "delete" ||
		name === "bash" ||
		name === "shell" ||
		name === "run_terminal_command" ||
		name.includes("write") ||
		name.includes("edit") ||
		name.includes("patch")
	);
}

/**
 * Soft completion language when the model forgets [DONE:n].
 * Does not require a step number — used with the current/active step.
 */
export function hasSoftCompletionLanguage(text: string): boolean {
	const t = String(text || "");
	if (!t.trim()) return false;
	return (
		/\b(?:oluşturdum|olusturdum|yaptım|yaptim|ekledim|yazdım|yazdim|güncelledim|guncelledim|tamamladım|tamamladim|bitirdim|hazırladım|hazirladim)\b/i.test(
			t,
		) ||
		/\b(?:created|wrote|updated|added|finished|completed|done|implemented|fixed)\b/i.test(t) ||
		/\b(?:dosya(?:yı|yi)?\s+(?:oluştur|olustur)|file\s+(?:created|written))\b/i.test(t)
	);
}

/**
 * When the agent forgets [DONE:n] / [ACTIVE:n], mark the current incomplete step
 * if there is evidence of real work this turn (tools or soft language).
 * Also backfills all lower incomplete steps so the checklist stays sequential.
 */
export function autoMarkStepWhenAgentForgot(
	items: TodoItem[],
	activeStep: number | undefined,
	signals: { mutatingTools: number; anyTools: number; text: string },
): { marked: number; nextActive?: number } {
	if (!items.length) return { marked: 0 };
	const remaining = items.filter((item) => !item.completed);
	if (remaining.length === 0) return { marked: 0 };

	const productive =
		signals.mutatingTools > 0 ||
		signals.anyTools >= 2 ||
		hasSoftCompletionLanguage(signals.text);
	if (!productive) return { marked: 0 };

	const preferred =
		(activeStep !== undefined ? remaining.find((item) => item.step === activeStep) : undefined) ??
		remaining[0];
	if (!preferred) return { marked: 0 };

	let marked = 0;
	// Complete preferred step and every incomplete step before it (sequential backfill).
	for (const item of items) {
		if (item.completed) continue;
		if (item.step <= preferred.step) {
			item.completed = true;
			marked += 1;
		}
	}
	const nextActive = items.find((item) => !item.completed)?.step;
	return { marked, nextActive };
}
