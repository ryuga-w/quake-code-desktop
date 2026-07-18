/**
 * memory-mcp-server.ts — MCP server for Quake Code persistent memory.
 *
 * Exposes memory operations as MCP tools so other MCP clients
 * (Claude Code, Cursor, etc.) can read/write Quake Code's memory.
 *
 * Usage: node dist/cli.js mcp-memory-server
 */

import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const MEMORY_DIR = ".quake-code/agent-memory/default-agent";

// ── Helpers ──────────────────────────────────────────────────────────────────

function isSymlink(fp: string): boolean {
	try {
		return lstatSync(fp).isSymbolicLink();
	} catch {
		return false;
	}
}

function safeRead(fp: string): string | undefined {
	if (!existsSync(fp) || isSymlink(fp)) return undefined;
	try {
		return readFileSync(fp, "utf-8");
	} catch {
		return undefined;
	}
}

function getMemoryDir(cwd: string): string {
	return resolve(cwd, MEMORY_DIR);
}

function getMemoryFile(cwd: string): string {
	return join(getMemoryDir(cwd), "MEMORY.md");
}

/** Parse memory entries from MEMORY.md content. */
function parseEntries(content: string): Array<Record<string, string>> {
	const entries: Array<Record<string, string>> = [];
	const lines = content.split("\n");
	let current: Record<string, string> | null = null;
	for (const line of lines) {
		if (line.match(/^---\s*$/)) {
			if (current === null) current = {};
			else {
				if (current.name) entries.push({ ...current });
				current = {};
			}
			continue;
		}
		if (current) {
			const kv = line.match(/^(\w+):\s*(.+)$/);
			if (kv) current[kv[1].trim()] = kv[2].trim();
			else current._content = (current._content || "") + line + "\n";
		}
	}
	return entries;
}

// ── MCP Protocol ─────────────────────────────────────────────────────────────

interface JsonRpcRequest {
	jsonrpc: string;
	id: number | string;
	method: string;
	params?: any;
}

interface JsonRpcResponse {
	jsonrpc: string;
	id: number | string;
	result?: any;
	error?: { code: number; message: string };
}

function sendResponse(id: number | string, result: any): void {
	const resp: JsonRpcResponse = { jsonrpc: "2.0", id, result };
	console.log(JSON.stringify(resp));
}

function sendError(id: number | string, code: number, message: string): void {
	const resp: JsonRpcResponse = { jsonrpc: "2.0", id, error: { code, message } };
	console.log(JSON.stringify(resp));
}

// ── Tool Implementations ─────────────────────────────────────────────────────

function handleListTools(id: number | string): void {
	sendResponse(id, {
		tools: [
			{
				name: "list_entries",
				description: "List all memory entries with names and descriptions",
				inputSchema: {
					type: "object",
					properties: {
						cwd: { type: "string", description: "Working directory (default: current dir)" },
					},
				},
			},
			{
				name: "read_entry",
				description: "Read a specific memory entry by name",
				inputSchema: {
					type: "object",
					properties: {
						name: { type: "string", description: "Entry name to read" },
						cwd: { type: "string", description: "Working directory" },
					},
					required: ["name"],
				},
			},
			{
				name: "write_entry",
				description: "Write a new memory entry",
				inputSchema: {
					type: "object",
					properties: {
						name: { type: "string", description: "Entry name" },
						description: { type: "string", description: "One-line description" },
						type: { type: "string", description: "Entry type (feedback/user/project/reference)" },
						content: { type: "string", description: "Entry content" },
						cwd: { type: "string", description: "Working directory" },
					},
					required: ["name", "description", "content"],
				},
			},
			{
				name: "delete_entry",
				description: "Delete a specific memory entry by name",
				inputSchema: {
					type: "object",
					properties: {
						name: { type: "string", description: "Entry name to delete" },
						cwd: { type: "string", description: "Working directory" },
					},
					required: ["name"],
				},
			},
			{
				name: "search_entries",
				description: "Search memory entries by keyword in name, description, or content",
				inputSchema: {
					type: "object",
					properties: {
						query: { type: "string", description: "Search keyword" },
						cwd: { type: "string", description: "Working directory" },
					},
					required: ["query"],
				},
			},
		],
	});
}

function handleToolCall(id: number | string, name: string, args: any): void {
	const cwd = args?.cwd || process.cwd();

	switch (name) {
		case "list_entries": {
			const memoryFile = getMemoryFile(cwd);
			if (!existsSync(memoryFile)) {
				sendResponse(id, { entries: [] });
				return;
			}
			const content = safeRead(memoryFile);
			if (!content) {
				sendResponse(id, { entries: [] });
				return;
			}
			const entries = parseEntries(content);
			sendResponse(id, {
				entries: entries.map((e) => ({
					name: e.name,
					description: e.description || "",
					type: e.type || "unknown",
				})),
			});
			break;
		}
		case "read_entry": {
			const memoryFile = getMemoryFile(cwd);
			if (!existsSync(memoryFile)) {
				sendResponse(id, { entry: null });
				return;
			}
			const content = safeRead(memoryFile);
			if (!content) {
				sendResponse(id, { entry: null });
				return;
			}
			const entries = parseEntries(content);
			const entry = entries.find((e) => e.name === args.name);
			sendResponse(id, { entry: entry || null });
			break;
		}
		case "write_entry": {
			const memoryDir = getMemoryDir(cwd);
			if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
			const memoryFile = getMemoryFile(cwd);
			const entryType = args.type || "feedback";
			const entryMd = `\n---\nname: ${args.name}\ndescription: ${args.description}\ntype: ${entryType}\n---\n${args.content}\n`;
			appendFileSync(memoryFile, entryMd, "utf-8");
			sendResponse(id, { success: true, name: args.name });
			break;
		}
		case "delete_entry": {
			const memoryFile = getMemoryFile(cwd);
			if (!existsSync(memoryFile)) {
				sendResponse(id, { success: false, error: "No memory file" });
				return;
			}
			const content = safeRead(memoryFile);
			if (!content) {
				sendResponse(id, { success: false, error: "Cannot read memory" });
				return;
			}
			const lines = content.split("\n");
			const newLines: string[] = [];
			let inEntry = false,
				skipEntry = false,
				found = false;
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (line.match(/^---\s*$/)) {
					if (!inEntry) {
						inEntry = true;
						let eName = "";
						for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
							if (lines[j].match(/^---\s*$/)) break;
							const kv = lines[j].match(/^name:\s*(.+)$/);
							if (kv) {
								eName = kv[1].trim();
								break;
							}
						}
						if (eName === args.name) {
							skipEntry = true;
							found = true;
							continue;
						}
						skipEntry = false;
					} else {
						inEntry = false;
						if (skipEntry) {
							skipEntry = false;
							continue;
						}
					}
				}
				if (!skipEntry) newLines.push(line);
			}
			writeFileSync(memoryFile, newLines.join("\n"), "utf-8");
			sendResponse(id, { success: found, name: args.name });
			break;
		}
		case "search_entries": {
			const memoryFile = getMemoryFile(cwd);
			if (!existsSync(memoryFile)) {
				sendResponse(id, { entries: [] });
				return;
			}
			const content = safeRead(memoryFile);
			if (!content) {
				sendResponse(id, { entries: [] });
				return;
			}
			const entries = parseEntries(content);
			const q = args.query.toLowerCase();
			const results = entries.filter(
				(e) =>
					(e.name || "").toLowerCase().includes(q) ||
					(e.description || "").toLowerCase().includes(q) ||
					(e._content || "").toLowerCase().includes(q),
			);
			sendResponse(id, {
				entries: results.map((e) => ({
					name: e.name,
					description: e.description || "",
					type: e.type || "unknown",
				})),
			});
			break;
		}
		default:
			sendError(id, -32601, `Tool not found: ${name}`);
	}
}

// ── Main Loop ────────────────────────────────────────────────────────────────

export function startMemoryMcpServer(): void {
	process.stdin.setEncoding("utf-8");
	let buffer = "";

	process.stdin.on("data", (chunk: string) => {
		buffer += chunk;
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				const req: JsonRpcRequest = JSON.parse(trimmed);
				switch (req.method) {
					case "tools/list":
						handleListTools(req.id);
						break;
					case "tools/call":
						handleToolCall(req.id, req.params?.name, req.params?.arguments);
						break;
					default:
						sendError(req.id, -32601, `Method not found: ${req.method}`);
				}
			} catch (e: any) {
				console.error(`Invalid JSON-RPC: ${e.message}`);
			}
		}
	});

	process.stdin.on("end", () => {
		process.exit(0);
	});
}

// Allow running as standalone
if (process.argv[1]?.endsWith("memory-mcp-server.js") || process.argv[2] === "mcp-memory-server") {
	startMemoryMcpServer();
}
