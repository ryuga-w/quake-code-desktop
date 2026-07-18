/**
 * Codex control.rs — clear memory root contents (preserve root dir; refuse symlink).
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { MEMORIES_HOME_DIRNAME } from "./constants.js";

export function clearMemoryRootContents(memoryRoot: string): void {
	if (!existsSync(memoryRoot)) {
		mkdirSync(memoryRoot, { recursive: true });
		return;
	}
	const st = lstatSync(memoryRoot);
	if (st.isSymbolicLink()) {
		throw new Error(`refusing to clear symlinked memory root ${memoryRoot}`);
	}
	mkdirSync(memoryRoot, { recursive: true });
	for (const name of readdirSync(memoryRoot)) {
		const path = join(memoryRoot, name);
		try {
			const meta = lstatSync(path);
			if (meta.isDirectory() && !meta.isSymbolicLink()) {
				rmSync(path, { recursive: true, force: true });
			} else if (!meta.isSymbolicLink()) {
				rmSync(path, { force: true });
			}
		} catch {
			/* skip */
		}
	}
}

/** Clear ~/.quake-code/memories and optional memories_extensions (Codex clear_memory_roots_contents). */
export function clearMemoryRootsContents(quakeHome = join(homedir(), ".quake-code")): void {
	clearMemoryRootContents(join(quakeHome, MEMORIES_HOME_DIRNAME));
	const ext = join(quakeHome, "memories_extensions");
	if (existsSync(ext) || true) {
		// Always ensure path can be cleared/created like Codex dual roots
		try {
			if (existsSync(ext) && !lstatSync(ext).isSymbolicLink()) {
				clearMemoryRootContents(ext);
			} else if (!existsSync(ext)) {
				mkdirSync(ext, { recursive: true });
			}
		} catch {
			/* optional second root */
		}
	}
}

export function memoryRootIsEmpty(memoryRoot: string): boolean {
	if (!existsSync(memoryRoot)) return true;
	try {
		return readdirSync(memoryRoot).length === 0;
	} catch {
		return true;
	}
}

/** Sanity: root still exists as directory after clear. */
export function assertMemoryRootPreserved(memoryRoot: string): boolean {
	return existsSync(memoryRoot) && statSync(memoryRoot).isDirectory();
}
