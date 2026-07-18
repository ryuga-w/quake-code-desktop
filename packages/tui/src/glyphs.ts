/**
 * Detect whether the current terminal is expected to render decorative Unicode
 * glyphs reliably. Environment overrides are useful for terminals that cannot
 * be identified automatically.
 */
export function supportsRichGlyphs(env: NodeJS.ProcessEnv = process.env, platform = process.platform): boolean {
	if (env.QUAKE_ASCII === "1") return false;
	if (env.QUAKE_UNICODE === "1") return true;

	if (platform !== "win32") return true;

	if (env.WT_SESSION || env.ANSICON || env.ConEmuANSI === "ON") return true;

	const terminalProgram = env.TERM_PROGRAM?.toLowerCase() ?? "";
	if (
		terminalProgram.includes("vscode") ||
		terminalProgram.includes("wezterm") ||
		terminalProgram.includes("mintty") ||
		terminalProgram.includes("hyper")
	) {
		return true;
	}

	const term = env.TERM?.toLowerCase() ?? "";
	return term.includes("xterm") || term.includes("screen") || term.includes("tmux") || term.includes("cygwin");
}
