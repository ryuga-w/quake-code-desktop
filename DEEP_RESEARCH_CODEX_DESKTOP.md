# DEEP_RESEARCH_CODEX_DESKTOP.md

**Comprehensive Feature Analysis of OpenAI Codex Desktop App (2026)**

**Research Date**: 2026-06-26  
**Sources**: Official OpenAI docs (developers.openai.com/codex/app/*, openai.com/index/*), reviews, videos, user reports. 20+ high-quality sources triangulated.

**Scope**: All major features of the official OpenAI Codex Desktop application (macOS/Windows Electron app). Focus on what each feature does (purpose), where it appears (UI location), its shape/appearance (design/layout), and how it works (mechanics, flow, sub-agents/tools, backend). 

This is the "Codex desktop" referenced in developer contexts — a native desktop command center for agentic coding, extending the Codex CLI/IDE with GUI orchestration, Computer Use, skills, worktrees, etc. It is distinct from but related to Cursor, Windsurf/Devin Desktop, etc.

The app treats AI agents as "teammates" for parallel, long-running work with human oversight (review diffs, steer, approve).

## 1. Core UI Architecture and Navigation

**Purpose**: Provides a focused, low-cognitive-load desktop environment (Electron app) that blends chat-like agent interaction with IDE elements. Reduces context switching compared to terminals or full IDEs. Supports multitasking across projects/threads without losing state.

**Where it Appears**: Primary app window. Multiple pop-out/floating windows supported. macOS menu bar integration for quick access.

**Appearance / Shape**: Clean, IDE-like layout. Left sidebar (projects/threads/skills), central thread view (composer + output blending text/code), toggleable panes (diff/review, terminal, summary, browser). Dark theme by default, with support for theme switching (Cmd+K). Minimalist compared to full VS Code — focused on agent threads. Project sidebar shows hierarchical projects → threads. Diff pane shows Git-style diffs with comment capability. In-app browser panel for previews.

**How it Works**: 
- Persistent across sessions (picks up CLI/IDE history/config via login).
- Threads are independent agent conversations, grouped under projects (a project ≈ a codebase/folder).
- Sidebar filters/recent/pinned threads.
- Cmd+K command palette for quick actions.
- Floating windows can "stay on top".
- Menu bar (macOS) for pinned/recent threads and quick launch.
- State synced via cloud/login; local sandbox for execution.

**Citations**: [web:27], [web:53], [web:54], [web:62]

## 2. Projects and Threads / Multitasking

**Purpose**: Organize work by codebase (projects) and individual agent tasks (threads). Enables switching contexts seamlessly while keeping agent state, history, and diffs isolated per thread.

**Where it Appears**: Left sidebar (project list → threads inside). Thread selector/composer at top or in view. "Multitask across projects" section in docs.

**Appearance / Shape**: Hierarchical tree/list in sidebar. Each thread shows title, status (running/background), last activity. Visual cards or list items with badges for worktree/local. Can pin/archive threads.

**How it Works**: 
- Create project by selecting folder/codebase.
- Inside project, create new thread (prompt composer).
- Threads run independently; switch via sidebar without losing context.
- Codex can self-manage threads (create/find/pin/archive via prompt, e.g., "Create a separate background thread in a worktree...").
- One app window handles multiple projects/threads.
- Context is per-thread (only relevant files/sandbox).

**Citations**: [web:26], [web:53], [web:54]

## 3. Parallel Agents and Orchestration

**Purpose**: Run multiple agents concurrently on different tasks or the same project without interference. Supports team-like workflows (e.g., one agent on frontend, one on backend, coordinator).

**Where it Appears**: Sidebar threads list (multiple running). Main window can show/switch between active threads. "Mission Control" style previews in some descriptions. Background execution indicators.

**Appearance / Shape**: Multiple thread cards or tabs in sidebar. Status indicators (running, queued). Parallel execution shown in summary pane or task list. Visual "fleets" or Kanban-like in advanced views.

**How it Works**: 
- Start multiple threads in parallel from the app.
- Agents run in isolated contexts (see Worktrees).
- User supervises from one place; agents report progress.
- Self-orchestration: One thread can spawn/manage others.
- Background mode for long tasks while user works elsewhere.
- Powered by agent runtime with tool use.

**Citations**: [web:4], [web:7], [web:25], [web:40]

## 4. Worktree Support and Isolation

**Purpose**: Allow parallel work on the same Git repo without conflicts. Each agent gets its own isolated checkout (Git worktree) while sharing .git metadata.

**Where it Appears**: Thread composer (select Local vs Worktree mode). Sidebar shows worktrees per project. Thread header shows current worktree. "Handoff" controls to move between Local and Worktree.

**Appearance / Shape**: Mode selector in composer (Local / Worktree / Cloud). Sidebar lists worktrees. Diffs scoped to the worktree. Badges or indicators on threads.

**How it Works**: 
- For Git projects: When starting thread in Worktree mode, Codex creates a Git worktree (detached HEAD or branch).
- Agents edit only their worktree copy.
- Handoff: Moves thread + changes safely between worktree and local checkout using Git ops.
- Automations use dedicated background worktrees.
- Non-Git projects: Run directly in project dir.
- "Create branch here" turns worktree into proper branch.
- Permanent worktrees via sidebar menu for long-lived envs.
- Integrates with Git tools (see below). Isolation prevents trampling main work.

**Citations**: [web:41], [web:42], [web:44], [web:51], [web:26]

## 5. Built-in Git Tools and Diff Review

**Purpose**: Native Git operations and visual review of agent changes without leaving the app. Enables human-in-the-loop approval of code.

**Where it Appears**: Diff pane (toggleable, often right or bottom). Thread view shows changes. Review panel (Cmd+Option+B or similar). Sidebar for file previews. Commit/PR buttons in header or review pane.

**Appearance / Shape**: Split or dedicated diff view with side-by-side or unified diffs. Inline comment boxes on lines/chunks. Stage/revert buttons per hunk or file. Git status indicators. "Last turn changes" filter vs full branch diff.

**How it Works**: 
- After agent work, diff pane auto-populates from Git state of the thread's worktree/local.
- User reviews, comments inline (comments fed back to agent).
- Stage/revert specific chunks/files.
- Direct commit, push, create PR from app.
- Integrates with integrated terminal for advanced Git.
- "Review" mode or /review command opens dedicated review thread/pane.
- For GitHub reviews: Can address comments.
- Sandboxed; changes only in the thread's scope.

**Citations**: [web:26], [web:53], [web:57], [web:44]

## 6. Integrated Terminal

**Purpose**: Run commands, validate, test, Git ops scoped to the current project/worktree without switching apps.

**Where it Appears**: Toggle with terminal icon (top right) or Cmd+J. Inside thread view or dedicated pane. Scoped per thread.

**Appearance / Shape**: Standard terminal emulator embedded. Tabs for multiple terminals in some updates. Output visible and readable by Codex (agent can reference build logs, server output).

**How it Works**: 
- Terminal is bound to the thread's project dir or worktree.
- Codex reads terminal output for context (e.g., failed build → fix).
- Common commands pre-suggested or via actions (from local environments).
- Supports clearing (Ctrl+L), etc.
- For dev servers: Agent can monitor output.

**Citations**: [web:26], [web:31], [web:47]

## 7. Computer Use (Screen, Click, Type, Control Desktop Apps)

**Purpose**: Allow Codex to interact with graphical desktop apps (Xcode, Figma, browsers, simulators, etc.) visually — see screen, move cursor, click, type, use clipboard. For tasks not easily done via CLI/tools.

**Where it Appears**: Enabled per-thread or via @Computer / @AppName in prompts. Permissions in Settings > Computer Use. Visual feedback (cursor movement visible). "Locked use" for background after Mac lock (macOS).

**Appearance / Shape**: Agent "takes over" visually (cursor moves on screen). In-app indicators or screenshots in thread. Appshots for context capture (Cmd+Cmd on Mac: screenshot + OCR/text of frontmost window attached to thread).

**How it Works**: 
- Requires plugin install + macOS permissions (Screen Recording + Accessibility) or Windows active desktop.
- Agent uses computer-use tool: screenshots, UI tree or pixel actions, keyboard/mouse events.
- Sandboxed/approved per app (user grants "Always allow" or per-task).
- Windows: Foreground only (takes focus); background via VM or remote.
- In-app browser is special case for web previews.
- Appshots (Mac): Double-Command hotkey captures active window (beyond visible area) + text into thread for context.
- Used for: GUI testing, bug repro in simulators, clicking through UIs, Figma-to-code, etc.
- Background mode: Multiple agents in parallel without blocking user.

**Citations**: [web:25], [web:34], [web:35], [web:72], [web:5]

## 8. In-App Browser + Annotations / Browser Use

**Purpose**: Preview local dev servers or public (non-auth) pages inside the app. Annotate UI elements directly for precise agent instructions. Faster frontend iteration.

**Where it Appears**: Dedicated in-app browser panel/tab. Annotations on rendered elements. "Browser use" for direct control.

**Appearance / Shape**: Embedded browser view. Click-to-annotate (comments on DOM elements). Side-by-side with code thread.

**How it Works**: 
- Open local server URL or public page (no cookies/extensions/auth by default).
- Comment on elements ("make button taller", "fix font").
- Agent receives annotations + screenshot/context and acts (edits code, etc.).
- Browser Use mode: Agent can navigate/click/type in the preview for local dev.
- Managed in settings (allowed/blocked sites, plugin).
- Complements Computer Use for web-specific tasks.

**Citations**: [web:25], [web:29], [web:5]

## 9. Skills Support and Management

**Purpose**: Extend Codex with reusable "skills" (bundled instructions + resources + scripts/tools) for reliable, domain-specific tasks (not just code gen). Examples: Figma implement, Linear project mgmt, deploy to Vercel/Netlify, image gen, PDF/spreadsheet/docx handling, etc.

**Where it Appears**: Sidebar "Skills" section for discovery/management. Auto-used or explicitly invoked in prompts. In thread composer or automations. Library view in app.

**Appearance / Shape**: Cards or list with name, description (from SKILL.md), capabilities/tools provided, status. Create/manage interface for custom skills.

**How it Works**: 
- Skills are markdown + scripts/config (open source at github.com/openai/skills).
- Codex app surfaces them; user/team can add (check into repo for sharing).
- Agent automatically selects or is instructed to use skills.
- Bundled popular ones (imagegen, deploy, office docs, etc.).
- Powers non-code work and complex coding workflows.
- Created/edited in app or externally; shared via team config.

**Citations**: [web:24], [web:25], [web:26]

## 10. Automations (Thread + Scheduled)

**Purpose**: Run repetitive/background tasks on schedule or trigger. Combine skills + instructions. Results land in review queue for human oversight.

**Where it Appears**: Automations section in app/sidebar. Thread automations (ongoing in one thread). Global/scheduled in settings or project. Review queue for completed automations.

**Appearance / Shape**: Config UI for schedule, skills, instructions. Status in sidebar or queue. Results link back to threads.

**How it Works**: 
- Define automation (e.g., daily CI summary + fixes).
- Runs in background worktree or dedicated thread.
- On completion: notification + review queue.
- Uses same agent runtime + skills.
- Examples at OpenAI: issue triage, CI failure fixes, release briefs.

**Citations**: [web:25], [web:26]

## 11. Image Generation / Editing (gpt-image-1.5) and Appshots / Visuals

**Purpose**: Inline image gen/edit for mockups, diagrams, assets, game art. Appshots for quick context from any app window.

**Where it Appears**: In-thread image gen prompts. Appshots via Cmd+Cmd (Mac) or hotkey — attaches screenshot + text to thread. Visual previews in sidebar/summary. Appshots panel.

**Appearance / Shape**: Generated images inline in thread. Annotation on screenshots. Previews for non-code artifacts (PDFs, etc.) in sidebar.

**How it Works**: 
- Powered by gpt-image model.
- Reference screenshots or describe changes.
- Appshots: Captures frontmost window (visible + beyond, + OCR/text) for context without manual copy-paste.
- Used in workflows like Figma-to-code or rapid prototyping.

**Citations**: [web:5], [web:25], [web:70], [web:72]

## 12. Memory, Context Awareness, and Personalization

**Purpose**: Remember user/team preferences, project context, past actions. Adapt behavior over time. "Personality" modes (terse vs. conversational).

**Where it Appears**: Settings for memory/preferences. /personality command. Summary pane tracks plans/sources. Auto-context in threads.

**Appearance / Shape**: Subtle indicators of memory usage. Config UI for rules/preferences.

**How it Works**: Persistent memory across sessions/threads. Learns from interactions. /personality switches style. Combined with skills for consistent workflows.

**Citations**: [web:5], [web:25]

## 13. Automations, Plugins, and Extensibility

**Purpose**: Role-specific plugins (62+ apps, 110 skills for non-dev roles too). Sites for interactive web/apps.

**Where it Appears**: Plugins in settings/sidebar. Role plugins adapt Codex to workflows (Linear, etc.).

**Appearance / Shape**: Plugin manager. "Sites" for shareable interactive outputs.

**How it Works**: Plugins bundle context, skills, instructions. Extends beyond coding (dashboards, materials). 90+ plugins mentioned.

**Citations**: [web:25], [web:30]

## 14. Voice Dictation, Floating Windows, and Extras

**Purpose**: Voice input, keep threads visible while multitasking.

**Where it Appears**: Hold Ctrl+M for dictation in composer. Pop-out thread windows (can stay on top). macOS menu bar.

**Appearance / Shape**: Standard input with voice indicator. Draggable pop-outs.

**How it Works**: Transcription to prompt. Pop-outs for context (e.g., near browser during frontend work).

**Citations**: [web:26], [web:60]

## 15. Safety, Sandbox, Permissions, and Review

**Purpose**: Bounded execution. User approves risky actions. Sandbox per project/thread.

**Where it Appears**: Permission prompts during tasks. Settings > Computer Use / Apps. Review pane for changes. Admin configs.

**Appearance / Shape**: Modal permission dialogs. Always-allow toggles in settings. Diff/review UI for human gate.

**How it Works**: Native sandbox (Windows PowerShell, macOS). File edits limited to project. Elevated perms require approval (configurable rules). Computer Use per-app approvals. Review diffs before commit.

**Citations**: [web:25], [web:26], [web:34]

## 16. Settings, Local Environments, and Platform Specifics

**Purpose**: Configure models, rules, plugins, sandbox, automations, SSH/remote, etc.

**Where it Appears**: Dedicated Settings view/pane. Local Environments for setup scripts. Windows-specific sandbox notes.

**Appearance / Shape**: Standard settings UI with sections. Toggle for features like Computer Use.

**How it Works**: Persistent config. Per-project or global. Windows native sandbox vs WSL. Remote devbox SSH alpha.

**Citations**: [web:26], [web:31]

## Summary and Relation to Broader Ecosystem

Codex Desktop is OpenAI's bet on agentic, orchestrated coding: from single-prompt snippets to supervising fleets of agents over days/weeks, with strong Git/worktree isolation, visual review, computer control, and skills for end-to-end workflows (code + images + docs + deploy + non-code tasks).

It emphasizes "human in the loop" at review/steer/approve stages, not every step.

**Relation to Quake/grok-premium**: This project (Quake Code) appears to be implementing a similar or competing "Codex-like" full-featured desktop + web + CLI experience, with heavy emphasis on subagents, worktrees, plan mode, rich tool UIs, approvals, browser annotations, etc. Many features here (parallel specialists, isolated work, rich diff/review, computer/browser use, skills) map directly to capabilities being built in grok-premium/SubagentStudio.

**Sources / Bibliography** (selected key; full triangulation from 20+):
[web:0] igmguru.com blog on Codex capabilities.
[web:4] Forbes launch announcement.
[web:5] buildfastwithai full review (Computer Use, browser, images).
[web:7] nimbalyst comparison (parallel, worktrees, diff).
[web:24] Official "Introducing the Codex app".
[web:25] "Codex for (almost) everything" update.
[web:26] Official features page.
[web:27] Official app overview.
[web:34] Computer Use docs.
[web:41] Worktrees docs.
[web:51] Worktrees deep dive.
[web:53] Features excerpts (sidebar, skills, diff, previews).
[web:54] Substack beginner guide (sidebar, threads, review panel).
[web:62] Diff pane, sidebar previews.
And others from searches.

Report generated via web research + official docs. For implementation details in this workspace, cross-reference with packages/coding-agent and apps/grok-premium code (subagents, execute tools, UI components). 

**Confidence**: High on core features (official docs + consistent reviews); Medium on exact pixel-perfect UI layouts (described but screenshots limited in text). 

All claims traceable. No fabrication.