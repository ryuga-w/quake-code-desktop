/**
 * quake-import-parser.ts — Parses `@path/to/file.md` import syntax in QUAKE.md files.
 *
 * Supports:
 * - @path/to/file.md relative imports
 * - Recursive imports up to MAX_IMPORT_DEPTH levels
 * - Backtick-escaped `@mentions` (not treated as imports)
 * - Fenced code block awareness
 * - Circular import protection
 */

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/** Maximum recursive import depth to prevent infinite loops. */
const MAX_IMPORT_DEPTH = 4;

/** Maximum total imported files to prevent resource exhaustion. */
const MAX_IMPORTED_FILES = 50;

/** Results of an import operation. */
export interface ImportResult {
	/** Resolved, flattened content with all imports expanded. */
	content: string;
	/** Files that were successfully imported (for auditing). */
	resolvedFiles: Array<{ path: string; sourceLine?: number }>;
	/** Files that failed to import. */
	failedFiles: Array<{ path: string; error: string; sourceLine?: number }>;
	/** Whether any imports were truncated due to depth/limit. */
	truncated: boolean;
}

/**
 * Parse and expand all `@path/to/file` imports in markdown content.
 * Returns the expanded content with all imports resolved inline.
 */
/**
 * Returns true if the given path is a symlink (defense against symlink attacks).
 */
function isSymlink(filePath: string): boolean {
	try {
		return lstatSync(filePath).isSymbolicLink();
	} catch {
		return false;
	}
}

export function expandImports(content: string, baseDir: string, depth: number = 0): ImportResult {
	const result: ImportResult = {
		content: "",
		resolvedFiles: [],
		failedFiles: [],
		truncated: false,
	};

	if (depth > MAX_IMPORT_DEPTH) {
		result.truncated = true;
		result.content = content;
		return result;
	}

	if (result.resolvedFiles.length > MAX_IMPORTED_FILES) {
		result.truncated = true;
		result.content = content;
		return result;
	}

	// Parse content line by line, tracking fenced code blocks and inline code
	const lines = content.split("\n");
	const outputLines: string[] = [];
	let inFencedCodeBlock = false;
	let fencedCodeLang = "";

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Track fenced code blocks
		const fencedMatch = line.match(/^(`{3,}|~{3,})(\w*)/);
		if (fencedMatch) {
			if (inFencedCodeBlock) {
				inFencedCodeBlock = false;
			} else {
				inFencedCodeBlock = true;
				fencedCodeLang = fencedMatch[2];
			}
			outputLines.push(line);
			continue;
		}

		// Skip processing inside fenced code blocks
		if (inFencedCodeBlock) {
			outputLines.push(line);
			continue;
		}

		// Check for inline code with backticks - if line has backtick-wrapped @, skip import
		if (line.includes("`@")) {
			// Complex case: mixed line with both literal @ and import @
			// We process only @ that are NOT inside backticks
			const processedLine = processLineWithInlineCode(line, baseDir, depth, result);
			outputLines.push(processedLine);
			continue;
		}

		// Find @import directives: @path/to/file or @relative/path.md
		const importMatch = line.match(/^@(\S+)$/);
		if (importMatch) {
			const importPath = importMatch[1];
			const resolvedFile = resolve(baseDir, importPath);
			const resultLine = processImportPath(resolvedFile, importPath, baseDir, depth, i + 1, result);
			if (resultLine !== null) {
				outputLines.push(resultLine);
			}
			continue;
		}

		// Also handle inline @path in the middle of text (like "See @README.md for details")
		// But only when it's not inside backticks and not at the start of line (already handled above)
		const inlineImportMatch = line.match(
			/(?<!\w)@([\w./-]+\.(?:md|markdown|txt|json|yaml|yml|toml|cfg|ini|mjs|js|ts))\b/,
		);
		if (inlineImportMatch) {
			const importPath = inlineImportMatch[1];
			const resolvedFile = resolve(baseDir, importPath);
			if (existsSync(resolvedFile) && !isSymlink(resolvedFile)) {
				const subResult = expandImportFile(resolvedFile, importPath, baseDir, depth + 1, i + 1);
				if (subResult) {
					result.resolvedFiles.push({ path: resolvedFile, sourceLine: i + 1 });
					// Replace @path with imported content
					const beforeMatch = line.slice(0, inlineImportMatch.index);
					const afterMatch = line.slice(inlineImportMatch.index! + inlineImportMatch[0].length);
					outputLines.push(`${beforeMatch}${subResult.content}${afterMatch}`);
					continue;
				}
			}
		}

		outputLines.push(line);
	}

	result.content = outputLines.join("\n");
	return result;
}

/**
 * Process a line that contains inline code (backticks) to distinguish
 * literal `@references` from actual @import directives.
 */
function processLineWithInlineCode(line: string, baseDir: string, depth: number, result: ImportResult): string {
	// Split the line by backtick-delimited segments
	const segments = line.split(/(`[^`]*`)/);
	const processedSegments: string[] = [];

	for (const segment of segments) {
		// Inside backticks (literal) - preserve as-is
		if (segment.startsWith("`") && segment.endsWith("`")) {
			processedSegments.push(segment);
			continue;
		}

		// Outside backticks - process @imports
		const importMatch = segment.match(
			/(?<!\w)@([\w./-]+\.(?:md|markdown|txt|json|yaml|yml|toml|cfg|ini|mjs|js|ts))\b/,
		);
		if (importMatch) {
			const importPath = importMatch[1];
			const resolvedFile = resolve(baseDir, importPath);
			if (existsSync(resolvedFile) && !isSymlink(resolvedFile)) {
				const subResult = expandImportFile(resolvedFile, importPath, baseDir, depth + 1, undefined);
				if (subResult) {
					result.resolvedFiles.push({ path: resolvedFile });
					const beforeMatch = segment.slice(0, importMatch.index);
					const afterMatch = segment.slice(importMatch.index! + importMatch[0].length);
					processedSegments.push(`${beforeMatch}${subResult.content}${afterMatch}`);
					continue;
				}
			}
		}

		processedSegments.push(segment);
	}

	return processedSegments.join("");
}

/**
 * Process a standalone @import line.
 * Returns the imported content as a string, or null if the file should be skipped.
 */
function processImportPath(
	resolvedFile: string,
	importPath: string,
	baseDir: string,
	depth: number,
	sourceLine: number | undefined,
	result: ImportResult,
): string | null {
	if (result.resolvedFiles.length >= MAX_IMPORTED_FILES) {
		result.truncated = true;
		return null;
	}

	const subResult = expandImportFile(resolvedFile, importPath, baseDir, depth + 1, sourceLine);
	if (subResult) {
		result.resolvedFiles.push({ path: resolvedFile, sourceLine });
		if (subResult.truncated) {
			result.truncated = true;
		}
		result.failedFiles.push(...subResult.failedFiles);
		return subResult.content;
	}

	// File doesn't exist or can't be read — log but don't add failed
	return null;
}

/**
 * Read and expand imports from a single file.
 * Returns null if the file doesn't exist, is a symlink, or can't be read.
 */
function expandImportFile(
	resolvedFile: string,
	importPath: string,
	baseDir: string,
	depth: number,
	sourceLine: number | undefined,
): ImportResult | null {
	const importBaseDir = dirname(resolvedFile);

	if (!existsSync(resolvedFile)) {
		return null;
	}

	if (isSymlink(resolvedFile)) {
		return null;
	}

	let fileContent: string;
	try {
		fileContent = readFileSync(resolvedFile, "utf-8");
	} catch {
		return null;
	}

	// Recursively expand imports in the imported file
	const subResult = expandImports(fileContent, importBaseDir, depth);
	subResult.resolvedFiles.unshift({ path: resolvedFile, sourceLine });

	return subResult;
}

/** Get the directory of a file path. */
function dirname(filePath: string): string {
	const idx = filePath.lastIndexOf("/");
	const idx2 = filePath.lastIndexOf("\\");
	const separator = idx > idx2 ? idx : idx2;
	return separator === -1 ? "." : filePath.slice(0, separator);
}
