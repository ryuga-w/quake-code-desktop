/**
 * Memory Extension - Prompt templates
 *
 * System prompt augmentation, tool descriptions, and extraction prompts.
 */

// ============================================================================
// System Prompt Bölümü - memory aktif olduğunda system prompt'a eklenir
// ============================================================================

export function getMemorySystemPromptSection(): string {
	return `
## 🧠 PERSISTENT MEMORY

You have access to a persistent memory system that stores facts, decisions, and learnings across sessions. Use these tools intentionally:

### When to ALWAYS remember:
- **User identity**: When someone introduces themselves, use \`remember\` with key like \`user-name\` or \`user-{name}\`
- **User preferences**: Code style, tooling, formatting, naming conventions, language preferences
- **User workflow**: How they like to work, their tools, their shortcuts

### When to remember:
- **Architecture decisions**: "We chose X over Y because Z"
- **Key learnings**: Bugs you found, workarounds, important gotchas
- **Project facts**: Build commands, test patterns, deployment details
- **Error solutions**: How you fixed something tricky

### When to recall:
- **Start of a new task**: Check if there's relevant prior knowledge
- **When unsure**: Before making decisions that might contradict past choices
- **Cross-reference**: Check user name, past decisions, related patterns

### Guidelines:
- Use meaningful keys like \`arch-db-choice\` or \`user-name\`
- Keep content clear and actionable
- Tag memories for better retrieval
- Update existing memories when situations change (same key = overwrite)
- Prefer \`project\` namespace for code-related memories
- Prefer \`user\` namespace for user-related memories
`;
}

// ============================================================================
// Auto-Extraction Prompt - agent_end'de kullanılacak
// ============================================================================

export function getAutoExtractionPrompt(conversationText: string): string {
	return `You are a memory extraction assistant. Analyze this conversation turn and extract structured memories.

For each memory, determine:
1. **key**: A unique identifier (kebab-case, e.g., "arch-db-choice")
2. **title**: Short human-readable title  
3. **content**: Detailed explanation (2-3 sentences max)
4. **summary**: One-line summary (max 120 chars)
5. **type**: One of: "fact", "decision", "preference", "learning", "pattern"
6. **namespace**: One of: "project", "learnings", "user", "wip"
7. **tags**: Relevant tags for retrieval
8. **confidence**: 0.0-1.0 (how sure are you this is important?)
9. **preserve**: Must be true for the memory to be saved

Only extract memories that are:
- **Important** for future work (not trivial)
- **Stable** (not temporary or speculative)  
- **Actionable** (would help future coding sessions)

If nothing important was said, return {"memories": []}.

<conversation>
${conversationText}
</conversation>

Respond with ONLY valid JSON in this format:
{"memories": [{"key": "...", "title": "...", "content": "...", "summary": "...", "type": "...", "namespace": "...", "tags": [...], "confidence": 0.9}]}`;
}

// ============================================================================
// Memory Formatting
// ============================================================================

export function formatMemoryForRecall(
	entries: Array<{
		key: string;
		title: string;
		content: string;
		type: string;
		namespace: string;
		tags: string[];
		updatedAt: string;
	}>,
): string {
	if (entries.length === 0) return "No memories found.";

	return entries
		.map(
			(e) =>
				`[${e.namespace}/${e.type}] ${e.key}: ${e.title}\n→ ${e.content}\n  Tags: ${e.tags.join(", ") || "none"}\n  Updated: ${new Date(e.updatedAt).toLocaleDateString()}`,
		)
		.join("\n\n");
}

export function formatMemoryShort(entry: {
	key: string;
	title: string;
	summary?: string;
	type: string;
	namespace: string;
}): string {
	return `[${entry.namespace}/${entry.type}] ${entry.key}: ${entry.summary || entry.title}`;
}
