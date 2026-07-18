/**
 * Heuristic host extraction from shell commands (curl/wget/iwr/git clone…).
 * Not a full proxy — cooperative CLIs only.
 */

import { normalizeHost } from "./normalize.js";
import type { NetworkApprovalProtocol } from "../guardian/types.js";

export interface ExtractedNetworkTarget {
	host: string;
	protocol: NetworkApprovalProtocol;
	raw?: string;
}

const URL_RE =
	/(?:https?|socks5):\/\/[^\s"'`<>]+|git@[^\s"'`:]+:[^\s"'`]+|(?:^|[\s"'`])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s"'`]*)?/gi;

function protocolFromUrl(url: string): NetworkApprovalProtocol {
	const lower = url.toLowerCase();
	if (lower.startsWith("https://")) return "https";
	if (lower.startsWith("http://")) return "http";
	if (lower.startsWith("socks5://")) return "socks5_tcp";
	return "https";
}

function hostFromUrlLike(raw: string): ExtractedNetworkTarget | null {
	const s = raw.trim().replace(/[),.;]+$/, "");
	if (!s) return null;

	// git@host:path
	const gitSsh = s.match(/^git@([^:]+):/);
	if (gitSsh) {
		const host = normalizeHost(gitSsh[1]);
		return host ? { host, protocol: "https", raw: s } : null;
	}

	try {
		if (/^https?:\/\//i.test(s) || /^socks5:\/\//i.test(s)) {
			const u = new URL(s);
			const host = normalizeHost(u.hostname);
			if (!host) return null;
			return { host, protocol: protocolFromUrl(s), raw: s };
		}
	} catch {
		/* fall through */
	}

	// bare host/path
	const bare = s.replace(/^\/\//, "");
	const hostPart = bare.split("/")[0] || "";
	if (!hostPart.includes(".") && !/^\d+\.\d+\.\d+\.\d+$/.test(hostPart)) return null;
	const host = normalizeHost(hostPart);
	if (!host || host.length < 3) return null;
	return { host, protocol: "https", raw: s };
}

/**
 * Extract network targets from a shell command string.
 * Returns unique hosts in order of appearance.
 */
export function extractNetworkTargets(command: string): ExtractedNetworkTarget[] {
	const cmd = String(command || "");
	if (!cmd.trim()) return [];

	const lower = cmd.toLowerCase();
	// Fast skip: no common network tools / URL schemes
	const networky =
		/\b(curl|wget|iwr|invoke-webrequest|invoke-restmethod|git\s+clone|npm\s+install|pnpm\s+add|yarn\s+add|pip\s+install|go\s+get|go\s+install|docker\s+pull|docker\s+push|http:\/\/|https:\/\/)\b/i.test(
			cmd,
		) || /https?:\/\//i.test(cmd);
	if (!networky) return [];

	const found: ExtractedNetworkTarget[] = [];
	const seen = new Set<string>();

	const push = (t: ExtractedNetworkTarget | null) => {
		if (!t?.host || seen.has(t.host)) return;
		// skip obvious non-hosts
		if (t.host === "localhost" || t.host === "127.0.0.1") {
			// still track — policy may care
		}
		seen.add(t.host);
		found.push(t);
	};

	// Explicit URLs
	const matches = cmd.match(URL_RE) || [];
	for (const m of matches) {
		push(hostFromUrlLike(m.trim()));
	}

	// curl/wget -H / next token heuristics for bare host after program
	if (/\b(curl|wget)\b/i.test(lower)) {
		const tokens = cmd.match(/(?:"[^"]*"|'[^']*'|`[^`]*`|\S+)/g) || [];
		for (let i = 0; i < tokens.length; i += 1) {
			const t = tokens[i].replace(/^["'`]|["'`]$/g, "");
			if (/^https?:\/\//i.test(t) || /^[a-z0-9.-]+\.[a-z]{2,}/i.test(t)) {
				push(hostFromUrlLike(t));
			}
		}
	}

	// git clone <url>
	const gitClone = cmd.match(/\bgit\s+clone\s+(?:--[^\s]+\s+)*([^\s]+)/i);
	if (gitClone) push(hostFromUrlLike(gitClone[1]));

	// go get / go install <module path> (often host/org/repo without scheme)
	const goMod = cmd.match(/\bgo\s+(?:get|install)\s+(?:-[^\s]+\s+)*([^\s]+)/i);
	if (goMod) {
		const mod = goMod[1].replace(/@.*$/, ""); // strip @version
		if (/^https?:\/\//i.test(mod) || mod.includes(".")) {
			push(hostFromUrlLike(mod.startsWith("http") ? mod : `https://${mod}`));
		}
	}

	// docker pull/push [registry/]name[:tag]
	const dockerImg = cmd.match(/\bdocker\s+(?:pull|push)\s+(?:--[^\s]+\s+)*([^\s]+)/i);
	if (dockerImg) {
		const ref = dockerImg[1];
		// registry.example.com/ns/img:tag — only when first segment looks like a host
		const first = ref.split("/")[0] || "";
		if (first.includes(".") || first === "localhost" || /^\d+\.\d+\.\d+\.\d+/.test(first)) {
			const host = normalizeHost(first);
			if (host) push({ host, protocol: "https", raw: ref });
		}
	}

	return found;
}
