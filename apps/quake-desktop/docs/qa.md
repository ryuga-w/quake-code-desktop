# Quake Code Web Manual QA

Run:

```bash
npm --workspace @mrquake/quakecode-web run build
npm --workspace @mrquake/quakecode-web run smoke
npm --workspace @mrquake/quakecode-web run e2e
npm --workspace @mrquake/quakecode-web run dev
```

Open `http://127.0.0.1:3737`.

Checklist:

- [ ] Home loads the Quake Code IDE shell without visible overflow on desktop or mobile.
- [ ] Settings panel shows host, workspace, kimlik, terminal, and preview limits in Turkish copy.
- [ ] Runtime state is visible through the header/sidebar/composer controls without the old context bar.
- [ ] Session list loads and a session can be selected.
- [ ] Birden fazla klasör tek seçimle eklenir; kök değiştirildiğinde önceki sohbet ve çalışan ajan kapanmaz.
- [ ] Farklı kökteki bir sohbete dönünce dosya ağacı, terminal, MCP ve workspace ayarları o köke bağlanır.
- [ ] Model selector loads and current model is marked.
- [ ] Command palette opens with Ctrl/Ôîİ+K, supports Ôåæ/Ôåô, Enter, group headers, `>` command mode, and `@` file mode.
- [ ] `/status` refreshes runtime state.
- [ ] `/model`, `/resume`, `/settings`, `/checklist` focus the expected panel.
- [ ] File explorer shows nested tree, expands/collapses folders, supports hidden/generated toggles, global search, and keyboard navigation.
- [ ] File preview opens a small text file.
- [ ] File actions support ask, summarize, copy relative path, open Monaco, reveal, and guarded edit warning.
- [ ] Monaco tabs support inline editor preview, diff tabs, close all, reveal, and find.
- [ ] Tool diff cards expose `Diff aç` and show Monaco diff or fallback.
- [ ] Tool panel groups calls by assistant turn and changed-files panel shows created/modified/deleted summaries.
- [ ] Terminal tabs run `node --version`, support stop/restart/history, and can add terminal output as context.
- [ ] Git paneli / branch / commit yok; `/api/git/*` 410 döner.
- [ ] Prompt submission sends a normal user message.
- [ ] Slash autocomplete appears after `/` and context chips can be added/removed before sending.
- [ ] Abort button remains responsive during streaming.
- [ ] Tool cards appear for agent tool calls.
- [ ] Plan/checklist widget lines appear in the checklist panel.
- [ ] Widget/sidebar panels close when extension sends `undefined` or an empty line array.
- [ ] Extension `select`, `confirm`, `input`, and `editor` requests open usable modal UX.
- [ ] Security banner shows auth/token/bind/workspace/terminal status and dangerous terminal commands show a warning.
- [ ] Toasts show success/warning/error variants, actions when present, and persistent error cards.
- [ ] Browser console has no unexpected errors.
