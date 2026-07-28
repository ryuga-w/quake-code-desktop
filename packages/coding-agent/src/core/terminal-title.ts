/**
 * Dynamic terminal title management for Quake Code.
 * Updates tab/window title based on session state, directory, and activity.
 *
 * Cross-platform:
 *   - Unix/Linux/macOS: ANSI OSC sequences (\x1b]0;title\x07)
 *   - Windows: process.title (some terminals support OSC, falls back)
 */

import { homedir } from "node:os";
import { relative } from "node:path";

interface TitleState {
	cwdLabel?: string;
	sessionName?: string;
	messageCount?: number;
	currentTool?: string;
	isRunning?: boolean;
}

let currentState: TitleState = {};
let baseTitle = "Quake Code";
let originalProcessTitle = process.title;

/**
 * Check if terminal supports OSC escape sequences.
 * Most modern terminals do. VS Code's terminal can be inconsistent, so avoid forcing there.
 */
function supportsOsc(): boolean {
	if (!process.stdout.isTTY) return false;
	if (process.env.VS_CODE_PID) return false;
	return true;
}

/**
 * Set the terminal title using appropriate method for platform.
 */
export function setTerminalTitle(title: string): void {
	process.title = title;

	if (supportsOsc()) {
		try {
			process.stdout.write(`\x1b]0;${title}\x07`);
		} catch {
			// Ignore unsupported terminals.
		}
	}
}

/**
 * Format a concise directory path for display.
 * Shows relative from home or just the last directory segment.
 */
function formatCwd(cwd: string): string {
	const home = homedir();
	if (cwd.startsWith(home)) {
		const relativePath = relative(home, cwd);
		if (relativePath === "") return "~";
		// Show parent/lastSeg for clarity
		const segments = relativePath.split(/[\\/]/);
		if (segments.length === 1) return `~/${segments[0]}`;
		return `~/../${segments[segments.length - 1]}`;
	}
	// For non-home paths, show last segment or parent/child
	const segments = cwd.split(/[\\/]/).filter(Boolean);
	if (segments.length === 1) return segments[0];
	if (segments.length > 1) return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
	return cwd;
}

/**
 * Build the title from current state.
 */
function buildTitle(): string {
	const scopeLabel = currentState.sessionName || currentState.cwdLabel;
	const parts: string[] = [baseTitle];

	if (scopeLabel) {
		parts.push(": ");
		parts.push(scopeLabel);
	}

	if (currentState.isRunning && currentState.currentTool) {
		parts.push(` · ${currentState.currentTool}`);
	} else if (currentState.messageCount !== undefined && currentState.messageCount > 0) {
		parts.push(` · ${currentState.messageCount} msg`);
	}

	return parts.join("");
}

/**
 * Update title with new state.
 */
function updateTitle(): void {
	setTerminalTitle(buildTitle());
}

/**
 * Initialize terminal title system.
 * Call once at startup.
 */
export function initTerminalTitle(options: { cwd: string; sessionName?: string }): void {
	originalProcessTitle = process.title || originalProcessTitle;
	baseTitle = "Quake Code";
	currentState = {
		cwdLabel: formatCwd(options.cwd),
		sessionName: options.sessionName,
		messageCount: 0,
		isRunning: false,
	};
	updateTitle();
}

/**
 * Update the session name (e.g., after /rename).
 */
export function setSessionName(name: string | undefined): void {
	currentState.sessionName = name?.trim() || undefined;
	updateTitle();
}

/**
 * Update working directory display.
 */
export function setWorkingDirectory(cwd: string): void {
	currentState.cwdLabel = formatCwd(cwd);
	updateTitle();
}

/**
 * Update message count for current session.
 */
export function setMessageCount(count: number): void {
	currentState.messageCount = count;
	updateTitle();
}

/**
 * Mark that a tool is running.
 */
export function setToolRunning(toolName: string | undefined): void {
	currentState.isRunning = Boolean(toolName);
	currentState.currentTool = toolName;
	updateTitle();
}

/**
 * Reset title to default on exit.
 */
export function resetTerminalTitle(): void {
	currentState = {};
	setTerminalTitle(originalProcessTitle || "Quake Code");
}

/**
 * Update title with model info (reserved for future use).
 */
export function setModelInfo(_provider: string, _model: string): void {
	// Reserved for future use.
}
