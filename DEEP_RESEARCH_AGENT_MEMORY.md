# Deep Research: AI Coding Agent Memory Systems

> Generated 2026-06-25 | Depth: standard | Sources: 22 | Implementation: Quake Code TUI/CLI

## TL;DR

Modern coding agents (Claude Code, Codex, Cursor) converge on **layered, file-based memory**: human-authored instructions (CLAUDE.md / AGENTS.md / Rules) plus **agent-written markdown memories** with scoped namespaces. Quake Code should treat memory as a **curated cache**, not source of truth — inject capped summaries at session start (200 lines / 25KB), expose hot-path `memory_remember` / `memory_recall` tools, and provide a TUI panel for audit/edit. This report informed a **from-scratch rewrite** of Quake's memory stack in `packages/coding-agent/src/core/memory/`.

## Executive Summary

Coding-agent memory is not one feature but a **stack of four layers**: procedural (rules, skills, system prompts), semantic long-term (preferences, conventions), episodic/session (recent work context), and working memory (current chat). Anthropic's Claude Code [1][2] splits **CLAUDE.md** (user-written, hierarchical) from **auto memory** (agent-written `MEMORY.md`, 200-line startup cap, topic files on demand). OpenAI Codex [3][4] separates mandatory **AGENTS.md** from opt-in **~/.codex/memories/** with background extract/consolidation models. Cursor [20][22] uses **Rules** for durable team standards and **Memories** for agent-proposed user-approved facts. Windsurf, Cline, and Aider favor **explicit files** (rules, memory-bank, repo map) over opaque vector stores at small scale [26][27][28].

Research consensus [40][45]: hot-path writes are transparent but add latency; background consolidation is cleaner but can stale. Markdown collections work up to ~150 entries; beyond that, archive + summarize. Memory hurts when stale, over-broad, or treated as authoritative over the repo [40][44].

**Quake implementation (this session):** New `memory-store.ts` with scopes `user | project | local | session`, tools `memory_remember/recall/forget`, legacy aliases, layered prompt injection, TUI `/memory` panel, auto-consolidation across all scopes.

## 1. Status Quo [Confidence: High]

### Claude Code [1][2][7]

Dual system: **CLAUDE.md** files discovered walking up the directory tree (closer wins), plus **auto memory** at `~/.claude/projects/<hash>/memory/MEMORY.md`. Auto memory loads first **200 lines or 25KB**; additional topic files load on demand. Instructions are soft context, not enforced config. Community reports background **"Auto Dream"** consolidation pruning cross-session notes [7].

### OpenAI Codex [3][4][6]

**AGENTS.md** hierarchy: `~/.codex/AGENTS.override.md` → `AGENTS.md` → repo walk-up, 32 KiB cap. **Memories off by default**; stored in `~/.codex/memories/` as markdown artifacts. Background **extract** and **consolidation** models run after idle; Chronicle (macOS) optionally augments from ephemeral screenshots [5].

### Cursor, Copilot, Windsurf, Cline, Aider [20]-[29]

| Tool | Durable instructions | Agent memory |
|------|---------------------|--------------|
| Cursor | `.cursor/rules/*.mdc`, AGENTS.md | Agent-proposed Memories (user accepts) |
| Copilot | `copilot-instructions.md`, path rules | Copilot Memories (VS 2026, user confirms) |
| Windsurf | `global_rules.md`, `.windsurf/rules` | Workspace auto-memories |
| Cline | `.clinerules` | Community Memory Bank (`memory-bank/*.md`) |
| Aider | `--file`, config | Repo map + chat history files, summarization |

### Architectural patterns [40][45]

CoALA taxonomy: working, episodic, semantic, procedural. LangGraph distinguishes thread-scoped vs namespace-scoped long-term stores with hot-path or background managers [40][41]. Mem0 demonstrates token-efficient retrieval (~7K vs 25K+ full replay) but adds infrastructure [42].

## 2. Emerging Trends [Confidence: Medium]

- **AGENTS.md interoperability** — Claude reads CLAUDE.md; both ecosystems document cross-import [8].
- **Opt-in generated memory** — Codex defaults off; Claude auto memory on but capped [1][3].
- **Project-scoped isolation** — Claude project memory boundaries; Quake `user/project/local/session` mirrors this [44].
- **Incognito / no-memory sessions** — Claude incognito; Quake could add `--no-memory` flag (future).
- **File-first over vector-first** for coding agents under ~100 entries; hybrid RAG at scale [40][42].

## 3. Critical Assessment [Confidence: High]

Memory fails when: (1) **stale facts** after refactors, (2) **context pollution** from injecting everything every turn, (3) **hallucinated extractions** saved as truth, (4) **scope leakage** (user prefs in committed project files) [40][44]. Quake's previous implementation suffered from: broken frontmatter parser, project-only tools ignoring user/local scopes, no search/recall, chat-only `/memory` UI, and naive `---` counting for entry totals.

**Recommendation:** Repo + docs = source of truth; memory = preferences + stable conventions only. Require `memory_recall` before `memory_remember`. Cap injection. Expose TUI audit panel.

## 4. Action Plan (Quake Code TUI/CLI)

- [x] Rewrite `memory-store.ts` — layered scopes, robust parser, search, injection caps
- [x] Tools: `memory_remember`, `memory_recall`, `memory_forget` + legacy aliases
- [x] Layered injection in `resource-loader.ts` via `buildMemoryInjectionBlock()`
- [x] TUI `MemoryPanelComponent` — `/memory` interactive panel (list, view, delete, consolidate)
- [x] Auto-consolidation across all scopes after prompts
- [ ] Add `--no-memory` CLI flag for incognito sessions
- [ ] User-approved capture UI (Cursor-style) before saving agent-proposed memories
- [ ] Background LLM consolidation (wire real summarizer model, not heuristic)
- [ ] `/login grok`-style docs for memory in `docs/settings.md`

## 5. Open Questions & Caveats

- Cursor Memories product status disputed (forum vs third-party blogs) [22][23] — treat as evolving.
- Claude "Auto Dream" consolidation is Tier-2 community coverage, not Tier-1 official doc [7].
- Vector/RAG not implemented in Quake v1 rewrite — markdown sufficient until >100 entries.
- Enterprise privacy (encryption at rest) not addressed — memories are plain markdown like Codex [5].

## Methodology

Depth: **standard**. Phase 0 answered by user (all tools, TUI-only, all memory types, scratch rewrite). Wave 1: 3 parallel retrieval subagents (Claude/Codex, Cursor/Copilot/Windsurf/Cline/Aider, architecture patterns). Sources merged and deduplicated. Implementation followed immediately per user option C.

## Bibliography

[1] Anthropic — How Claude remembers your project — https://code.claude.com/docs/en/memory — 2026-06-25 — Tier: 1  
[2] Anthropic — Explore the .claude directory — https://code.claude.com/docs/en/claude-directory.md — 2026-06-25 — Tier: 1  
[3] OpenAI — Memories (Codex) — https://developers.openai.com/codex/memories — 2026-06-25 — Tier: 1  
[4] OpenAI — AGENTS.md — https://developers.openai.com/codex/guides/agents-md — 2026-06-25 — Tier: 1  
[5] OpenAI — Chronicle — https://developers.openai.com/codex/memories/chronicle — 2026-06-25 — Tier: 1  
[6] OpenAI — Codex CLI — https://developers.openai.com/codex/cli — 2026-06-25 — Tier: 1  
[7] Verified newsletter — Claude Code Memory 2.0 — https://buttondown.com/verified/archive/claude-code-memory-20-how-anthropics-latest/ — 2026-03-24 — Tier: 2  
[8] Anthropic — AGENTS.md interoperability — https://code.claude.com/docs/en/memory — 2026-06-25 — Tier: 1  
[20] Cursor — Rules docs — https://cursor.com/docs/rules — Tier: 1  
[21] Cursor Help — Rules — https://cursor.com/help/customization/rules.md — Tier: 1  
[22] Cursor Forum — Rules vs Memories — https://forum.cursor.com/t/best-way-to-provide-context-rules-vs-memories/132960 — Tier: 2  
[24] GitHub Docs — Copilot custom instructions — https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot — Tier: 1  
[25] Microsoft DevBlog — Copilot Memories — https://devblogs.microsoft.com/visualstudio/copilot-memories/ — Tier: 1  
[26] Windsurf — Cascade Memories — https://docs.devin.ai/windsurf/plugins/cascade/memories — Tier: 1  
[27] Cline — Memory Bank — https://docs.cline.bot/best-practices/memory-bank — Tier: 1  
[28] Aider — Repository map — https://aider.chat/docs/repomap.html — Tier: 1  
[29] Aider — Options / history — https://aider.chat/docs/config/options.html — Tier: 1  
[40] LangGraph — Memory overview — https://docs.langchain.com/oss/python/langgraph/memory — Tier: 1  
[41] LangMem — https://langchain-ai.github.io/langmem/ — Tier: 2  
[42] Mem0 Research — https://mem0.ai/research — Tier: 1  
[44] Anthropic — Bringing memory to Claude — https://claude.com/blog/memory — Tier: 2  
[45] CoALA arXiv:2309.02427 — https://arxiv.org/pdf/2309.02427 — Tier: 1 [foundational]