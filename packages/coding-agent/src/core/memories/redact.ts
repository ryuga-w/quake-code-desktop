/** Redact secrets before writing memory fields (Codex write-path hygiene). */

const SECRET_PATTERNS: RegExp[] = [
	/\b(sk-[A-Za-z0-9_-]{10,})\b/g,
	/\b(xai-[A-Za-z0-9_-]{10,})\b/g,
	/\b(ghp_[A-Za-z0-9]{20,})\b/g,
	/\b(github_pat_[A-Za-z0-9_]{20,})\b/g,
	/\b(AKIA[0-9A-Z]{16})\b/g,
	/\b(AIza[0-9A-Za-z_-]{20,})\b/g,
	/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
	/\b(api[_-]?key\s*[:=]\s*)(["']?)[^\s"']{8,}\2/gi,
	/\b(password\s*[:=]\s*)(["']?)[^\s"']{4,}\2/gi,
	/\b(secret\s*[:=]\s*)(["']?)[^\s"']{6,}\2/gi,
	/\b(token\s*[:=]\s*)(["']?)[^\s"']{8,}\2/gi,
];

export function redactSecrets(text: string): string {
	let out = text;
	for (const pattern of SECRET_PATTERNS) {
		out = out.replace(pattern, (match, g1?: string) => {
			if (typeof g1 === "string" && g1.toLowerCase().includes("bearer")) {
				return `${g1}[REDACTED_SECRET]`;
			}
			if (typeof g1 === "string" && /[:=]\s*$/.test(g1)) {
				return `${g1}[REDACTED_SECRET]`;
			}
			return "[REDACTED_SECRET]";
		});
	}
	return out;
}
