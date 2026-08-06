# Quake Code — Repo İnceleme Raporu

**Tarih:** 2026-07-25  
**Sürüm:** 1.11.2  
**Tip:** Terminal-first AI coding assistant  

---

## 1. Genel Bakış

Quake Code, çoklu AI provider desteği olan, terminal-first bir kodlama asistanıdır. CLI, TUI, Web (Electron) ve Mobil (React Native) platformlarında çalışır.

| Özellik | Değer |
|---------|-------|
| Monorepo | npm workspaces |
| Dil | TypeScript (strict) |
| Node.js | >= 20.x |
| Paket sayısı | 13 (8'i @mrquake/*, 3'ü @openclaw/*) |
| Desktop | Electron + Vite + React |
| CLI binary | Bun-compiled single binary |
| Linter | Biome |
| TS derleyici | tsgo (custom) |

---

## 2. Monorepo Yapısı

```
quake-code/
├── apps/
│   └── quake-desktop/     # @mrquake/quake-desktop (v0.1.1)
│
├── packages/ (13 adet)
│   ├── ai/                # @mrquake/quakecode-ai
│   ├── agent/             # @mrquake/quakecode-agent-core
│   ├── coding-agent/      # @mrquake/quakecode-cli (ana CLI)
│   ├── tui/               # @mrquake/quakecode-tui
│   ├── jiti/              # @mrquake/quakecode-jiti
│   ├── clipboard/         # @mrquake/quakecode-clipboard
│   ├── mom/               # @mrquake/quakecode-mom (Slack bot)
│   ├── pods/              # @mrquake/quakecode-pods (GPU/vLLM)
│   ├── os-bridge/         # OS köprüsü (scripts/)
│   ├── openclaw-core/     # @openclaw/core
│   ├── openclaw-driver-win32/  # @openclaw/driver-win32
│   └── openclaw-prism/    # @openclaw/prism
```

---

## 3. Paket Detayları

### 3.1. `@mrquake/quakecode-cli` (coding-agent) ★ Ana CLI

- **Görevi:** CLI/TUI coding assistant runtime
- **Binary:** `quake-code`, `quake`, `qd`, `qc`
- **Katmanlar:**
  - `src/core/` — ana runtime
  - `src/core/tools/` — tüm araçlar (read, write, edit, bash, grep, find, web vb.)
  - `src/core/extensions/` — extension/skill sistemi
  - `src/core/prompts/` — Codex prompt templateleri
  - `src/core/guardian/` — güvenlik katmanı
  - `src/core/memory/` — bellek sistemi
  - `src/core/rollout/` — rollout yönetimi
  - `src/modes/` — interactive, rpc, print
  - `src/bundled/` — built-in skill'ler
- **Bağımlılıkları:** ai, agent, tui, jiti, openclaw-\*

### 3.2. `@mrquake/quakecode-ai` (ai) ★ AI Katmanı

- **Görevi:** Multi-provider AI abstraction
- **Provider'lar:**
  - Anthropic (SDK)
  - OpenAI Responses API
  - OpenAI Completions API
  - OpenAI Codex Responses
  - Azure OpenAI Responses
  - Google Gemini
  - Google Vertex AI
  - Mistral AI
  - Amazon Bedrock
  - GitHub Copilot headers

### 3.3. `@mrquake/quakecode-agent-core` (agent) ★ Agent Runtime

- **Görevi:** Agent loop, transport abstraction, state management
- **Dosyalar:** `agent.ts`, `agent-loop.ts`, `proxy.ts`, `types.ts`

### 3.4. `@mrquake/quakecode-tui` (tui) ★ Terminal UI

- **Görevi:** Differential rendering terminal UI kütüphanesi
- **Özellikler:** Editor, autocomplete, kill-ring, undo-stack, mouse, spatial-index, terminal image, keybindings

### 3.5. `@mrquake/quakecode-mom` (mom)

- **Görevi:** Slack bot — mesajları Quake Code agent'ına yönlendirir
- **Teknoloji:** Slack Socket Mode + Anthropic Sandbox

### 3.6. `@mrquake/quakecode-pods` (pods)

- **Görevi:** GPU pod'larında vLLM deployment yönetimi
- **Teknoloji:** SSH + vLLM

### 3.7. `@openclaw/*` (openclaw-core, driver-win32, prism)

- **Görevi:** Windows OS otomasyonu (computer-use altyapısı)
- **core:** Çekirdek
- **driver-win32:** Win32 driver
- **prism:** UI tarama/prism katmanı

---

## 4. Desktop Uygulaması (`quake-desktop`)

### 4.1. Teknoloji Stack'i

| Bileşen | Teknoloji |
|---------|-----------|
| Frontend | React 19 + TypeScript |
| CSS | Tailwind CSS v4 + CSS Modules |
| Bundler | Vite 7 |
| Editor | Monaco Editor |
| Terminal | xterm.js + node-pty |
| Markdown | streamdown + marked + rehype/remark |
| Matematik | KaTeX |
| Diagram | Mermaid |
| Runtime | Electron 42 |
| Paketleme | electron-builder |
| State | Zustand |
| UI Kütüphanesi | cmdk, lucide-react, motion, shiki, sonner |

### 4.2. Mimarisi

```
src/client/             → React SPA (Vite)
  ├── app/              → App shell, routing, SSE
  ├── components/       → UI bileşenleri (22 kategori)
  │   ├── chrome/       → NavRail, Titlebar, StatusBar
  │   ├── composer/     → ChatComposer
  │   ├── timeline/     → Mesaj timeline
  │   ├── dock/         → Sağ panel (Browser, ComputerUse, Mobile)
  │   ├── settings/     → Ayarlar (Appearance, General, Providers)
  │   ├── files/        → Dosya paneli
  │   ├── goal/         → Goal panel
  │   ├── agents/       → Subagent panel
  │   └── pages/        → ConversationHistory, Extensions, Schedule
  ├── state/            → Zustand store + context
  └── landing/          → Karşılama sayfası

src/server/             → Node.js HTTP sunucu
  ├── index.ts          → HTTP server entry
  ├── runtime.ts        → Agent runtime bridge
  ├── sse.ts            → SSE stream
  ├── files.ts          → Dosya işlemleri
  ├── computer-use.ts   → Computer-use bridge
  ├── mcp/              → MCP server
  ├── mobile/           → Mobile bridge
  ├── goal/             → Goal yönetimi
  ├── auth.ts           → Kimlik doğrulama
  └── terminal.ts       → Terminal PTY

src/shared/
  └── protocol.ts       → Client-server protocol types
```

### 4.3. UI Component Kategorileri (22 adet)

agents, chrome, command, common, composer, dock, editor, extensions, files, goal, markdown, modals, pages, plan, preview, search, security, sessions, settings, shell, sidechat, terminal, timeline, tools, workspace

---

## 5. Build ve Script Sistemi

```bash
npm run build               # Tüm paketleri sıralı build et
npm run dev                 # Watch mode (ai, agent, coding-agent, mom, tui)
npm run check               # Biome lint + tsgo typecheck + smoke tests
npm run dev:desktop         # Desktop development mode
npm run package:desktop:win # Windows Electron paketleme
npm run version:patch|minor|major  # Versiyon güncelleme
npm run publish             # npm publish (tüm workspace'ler)
```

---

## 6. AI Provider Haritası

```
                    ┌─────────────┐
                    │  quakecode-ai │
                    └──────┬──────┘
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌──────────┐    ┌────────────┐    ┌──────────┐
   │ OpenAI   │    │ Anthropic  │    │ Google   │
   │ Responses│    │ SDK        │    │ Gemini   │
   │ Complet. │    └────────────┘    │ Vertex   │
   │ Codex    │                      └──────────┘
   └──────────┘
   ┌──────────┐    ┌────────────┐    ┌──────────┐
   │ Mistral  │    │ AWS        │    │ Azure    │
   │          │    │ Bedrock    │    │ OpenAI   │
   └──────────┘    └────────────┘    └──────────┘
   ┌──────────┐
   │ GitHub   │
   │ Copilot  │
   └──────────┘
```

---

## 7. Önemli Notlar

- **OpenClaw** paketleri (`core`, `driver-win32`, `prism`) yalnızca `package.json` içeriyor — kaynak kodları ayrı bir yerde build edilip `dist/`'e kopyalanıyor olabilir.
- **os-bridge** klasöründe yalnızca `scripts/` var, `package.json` bulunamadı — muhtemelen kullanılmıyor veya taşınmış.
- **clipboard** paketi `@mariozechner/clipboard` wrapper'ı — upstream bağımlılığı.
- **Git** tek commit (`58daecb Initial commit`) — proje yakın zamanda yeniden başlatılmış.
- **WORKSPACE_OVERVIEW.md** dosyası kapsamlı bir mimari rehber içeriyor (~189K TS kaynak, 749 dosya).
- **QUAKE_CODE_MIMARI_REHBER.md** Türkçe mimari dokümanı mevcut.
