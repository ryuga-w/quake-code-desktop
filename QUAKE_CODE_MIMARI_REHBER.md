# Quake Code Monorepo — Mimari Rehber

> **Oluşturma:** 2026-06-26
> **Amaç:** Proje yapısı, akışlar ve önemli noktalar için tek başvuru kaynağı

---

## İçindekiler

1. [Proje Künyesi](#1-proje-künyesi)
2. [Dizin Yapısı](#2-dizin-yapısı)
3. [Mimari Genel Bakış](#3-mimari-genel-bakış)
4. [Paket Haritası](#4-paket-haritası)
5. [Uygulamalar](#5-uygulamalar)
   - 5.1 [grok-premium](#51-grok-premium)
   - 5.2 [quake-desktop](#52-quake-desktop)
   - 5.3 [quake-mobile](#53-quake-mobile)
6. [AI Provider Katmanı](#6-ai-provider-katmanı)
7. [Tools (Yerleşik Araçlar)](#7-tools-yerleşik-araclar)
8. [Extensions & Skills](#8-extensions--skills)
9. [Agent Worker Mimarisi](#9-agent-worker-mimarisi)
10. [Akış Diyagramları](#10-akış-diyagramları)
11. [Konfigürasyon & State](#11-konfigürasyon--state)
12. [Build & Geliştirme](#12-build--geliştirme)
13. [Önemli Dosyalar](#13-önemli-dosyalar)

---

## 1. Proje Künyesi

| Alan | Değer |
|------|-------|
| **Ad** | Quake Code |
| **Monorepo adı** | `quake-code-monorepo` |
| **Sürüm** | 1.11.2 |
| **Lisans** | MIT |
| **Yazar** | MrQuake |
| **npm scope** | `@mrquake/*` |
| **ESM** | `"type": "module"` |
| **Workspace tanımı** | `package.json` → `workspaces: ["apps/*", "packages/*"]` |
| **Node gereksinimi** | ≥ 20.6.0 |

**CLI binary'leri (4 adı):**
| Komut | Çalıştırılan |
|-------|-------------|
| `quake` | `packages/coding-agent/dist/cli.js` |
| `quake-code` | aynı |
| `qd` | aynı |
| `qc` | aynı |

---

## 2. Dizin Yapısı

```
C:\quake code\                           ← Workspace root
├── apps/
│   ├── grok-premium/                    ← Next.js 16 Grok Workspace (en aktif)
│   │   ├── app/                         ←  App Router pages
│   │   ├── agent-worker/                ←  Agent RPC server
│   │   ├── components/                  ←  React bileşenleri
│   │   │   ├── brand/                   ←  QuakeLogo
│   │   │   ├── browser/                 ←  Browser panel + anotasyonlar
│   │   │   ├── chat/                    ←  Sohbet UI (16 bileşen)
│   │   │   ├── layout/                  ←  WorkspaceShell
│   │   │   ├── sidebar/                 ←  Sidebar
│   │   │   ├── subagents/               ←  SubagentStudio, types
│   │   │   ├── tools/                   ←  Tool renderer'lar, DiffViewer
│   │   │   ├── ui/                      ←  QuakeSkeleton
│   │   │   ├── video/                   ←  LazyVideo, VideoStudioLoading
│   │   │   └── workspace/               ←  FileExplorer, RightInspectorPanel
│   │   ├── lib/                         ←  Client & server lib
│   │   │   ├── hooks/                   ←  8 custom hook
│   │   │   └── tools/                   ←  Tool definition'lar
│   │   └── agent-worker/                ←  RPC köprüsü (quakecode-cli ile)
│   ├── quake-desktop/                   ←  Electron + Vite + React 19 IDE shell
│   │   ├── src/
│   │   │   ├── client/                  ←  React UI
│   │   │   ├── server/                  ←  Node.js backend
│   │   │   └── shared/                  ←  Protocol
│   │   └── docs/                        ←  Mimari, güvenlik, roadmap dökümanları
│   └── quake-mobile/                    ←  React Native / Expo (erken aşama)
│
├── packages/
│   ├── coding-agent/                    ← ★ Ana CLI ürünü
│   │   ├── src/
│   │   │   ├── cli/                     ←  CLI argümanları
│   │   │   ├── core/                    ←  ★ Çekirdek (tools, session, memory...)
│   │   │   │   ├── tools/               ←  25+ built-in tool
│   │   │   │   ├── compaction/          ←  Session compaction
│   │   │   │   ├── extensions/          ←  Extension loader/runner
│   │   │   │   ├── export-html/         ←  HTML export
│   │   │   │   ├── memory/              ←  Memory store
│   │   │   │   ├── self-improvement/    ←  Self-improvement loop
│   │   │   │   └── ... (30+ modül)
│   │   │   ├── modes/
│   │   │   │   └── interactive/         ←  TUI bileşenleri (40+)
│   │   │   └── bundled/                 ←  Extensions & skills
│   │   ├── test/                        ←  80+ test dosyası
│   │   ├── docs/                        ←  Dokümantasyon
│   │   └── examples/                    ←  SDK örnekleri
│   │
│   ├── ai/                              ←  AI provider abstraction
│   │   ├── src/
│   │   │   ├── providers/               ←  15+ provider
│   │   │   ├── utils/oauth/             ←  OAuth yardımcıları
│   │   │   └── ... (models, stream, types)
│   │   └── test/
│   │
│   ├── agent/                           ←  Agent core (loop, proxy, types)
│   ├── tui/                             ←  Terminal UI primitives
│   ├── mom/                             ←  Slack bot
│   ├── pods/                            ←  vLLM pod yönetimi
│   ├── jiti/                            ←  JIT import wrapper
│   ├── clipboard/                       ←  Native clipboard
│   ├── openclaw-core/                   ←  Native Windows OS katmanı
│   ├── openclaw-driver-win32/
│   ├── openclaw-prism/
│   └── os-bridge/
│
├── scripts/                             ←  Build, release, smoke, profil
├── plugins/                             ←  Web research MCP
├── assets/                              ←  Logo, mockup, görseller
├── agent-tools/                         ←  Agent çalışma dosyaları
├── .quake-code/                         ←  Runtime state (sessions, memory, rules)
│
├── QUAKE.md                             ←  Agnet instructions (committed)
├── QUAKE.local.md                       ←  Personal preferences (gitignored)
├── WORKSPACE_OVERVIEW.md                ←  Önceki workspace özeti
├── QUAKE_CODE_MIMARI_REHBER.md          ←  ★ Bu dosya
│
├── package.json                         ←  Monorepo root
├── tsconfig.json + tsconfig.base.json   ←  TS yapılandırması
├── biome.json                           ←  Linter/formatter
├── bun.lock + package-lock.json         ←  Lock files
└── node_modules/                        ←  ~73K dosya
```

---

## 3. Mimari Genel Bakış

```
┌─────────────────────────────────────────────────────────────┐
│                    grok-premium (Next.js 16)                  │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────────────┐ │
│  │  Chat UI  │  │  Browser   │  │   Right Inspector Panel  │ │
│  │ (sayfa.tsx)│  │  Panel     │  │  (review/outputs/browser)│ │
│  └────┬─────┘  └─────┬──────┘  └───────────┬──────────────┘ │
│       │              │                      │                │
│  ┌────▼──────────────▼──────────────────────▼──────────────┐ │
│  │              /api/chat, /api/execute, /api/imagine       │ │
│  │              Next.js Route Handlers                      │ │
│  └────────────────────────┬─────────────────────────────────┘ │
│                           │ HTTP/SSE                          │
│  ┌────────────────────────▼─────────────────────────────────┐ │
│  │              agent-worker (port 5191)                     │ │
│  │  Node HTTP Server (event-mapper + rpc-bridge)            │ │
│  │  ┌────────────────────────────────────────────────────┐  │ │
│  │  │  QuakeRpcBridge (child_process: quakecode-cli)     │  │ │
│  │  │  ↔ stdin/stdout JSON-RPC                           │  │ │
│  │  └────────────────────────────────────────────────────┘  │ │
│  └────────────────────────┬─────────────────────────────────┘ │
└───────────────────────────┼─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│              @mrquake/quakecode-cli (Runtime)                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ AgentSession  │  │    Tools     │  │  Extensions / Skills │  │
│  │ (loop + state)│  │ (read, bash, │  │  (plan-mode, review, │  │
│  │              │  │  edit, grep..)│  │   subagents..)      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────┘  │
│         │                  │                                     │
│  ┌──────▼──────────────────▼──────────────────────────────────┐ │
│  │              @mrquake/quakecode-ai (Provider Layer)         │ │
│  │  OpenAI  Anthropic  Gemini  Bedrock  Mistral  xAI  Codex   │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Veri Akışı (Streaming Chat)

```
1. Kullanıcı mesajı yazar → sendMessage()
2. useAgentStream() → POST /api/chat/stream → agent-worker /prompt
3. agent-worker → QuakeRpcBridge.prompt() → quakecode-cli stdin
4. quakecode-cli → AI provider → streaming response
5. agent-worker ← RPC events → SSE → client
6. consumeAgentSseStream() → segment güncelleme → UI render
```

---

## 4. Paket Haritası

### 4.1 `@mrquake/quakecode-cli` (packages/coding-agent)

**Bağımlılık zinciri:** `tui → ai → agent → coding-agent` (build sırası)

| Klasör | İçerik |
|--------|--------|
| `src/cli/` | CLI arg parsing, main entry |
| `src/core/` | **Çekirdek** — AgentSession, tools, extensions, memory, settings |
| `src/core/tools/` | 25+ built-in tool (read, write, edit, bash, grep, find, ls, generate_image, generate_video, os-control, memory, web-search) |
| `src/core/compaction/` | Session compaction (branch summarization) |
| `src/core/extensions/` | Extension lifecycle (loader, runner, types, virtual modules) |
| `src/core/self-improvement/` | Self-improvement loop (governor, ledger, orchestrator, scoreboard) |
| `src/core/memory/` | Persistent memory store |
| `src/bundled/extensions/` | **plan-mode**, quake-browser-tools |
| `src/bundled/skills/` | docx, pptx, pdf, xlsx + quake agent skills |
| `src/modes/interactive/` | **TUI** — 40+ component, theme sistemi, footer, input |
| `test/` | 80+ test, suite/ entegrasyon testleri |

### 4.2 `@mrquake/quakecode-ai` (packages/ai)

| Klasör | İçerik |
|--------|--------|
| `src/providers/` | 15+ AI provider |
| `src/utils/oauth/` | OAuth clients (anthropic, github-copilot, openai-codex, google) |
| `src/` | Stream, types, models, api-registry, env-api-keys |
| → Yeni: | `grok-auth.ts`, `grok-billing.ts`, `mimo-free.ts` |

### 4.3 `@mrquake/quakecode-agent-core` (packages/agent)

Hafif paket: agent loop, proxy, temel TypeScript tipleri.

### 4.4 `@mrquake/quakecode-tui` (packages/tui)

Terminal UI primitives: editor, select-list, settings-list, terminal, tui, **mouse**, **spatial-index**, **mouse-layout-collector**.

### 4.5 `@mrquake/quakecode-mom` (packages/mom)

Slack bot integration (16 source file).

### 4.6 `@mrquake/quakecode-pods` (packages/pods)

vLLM pod yönetimi — `scripts/model_run.sh`, `pod_setup.sh`.

### 4.7 `@mrquake/quakecode-jiti` (packages/jiti)

JIT import wrapper — 2 source file.

### 4.8 Native Windows Paketleri

| Paket | Rol |
|-------|-----|
| `@openclaw/core` | Native Windows OS kontrol core |
| `@openclaw/prism` | UI element inspection |
| `@openclaw/driver-win32` | Windows driver |
| `os-bridge` | Python inspector script |

---

## 5. Uygulamalar

### 5.1 grok-premium (`apps/grok-premium/`)

**Stack:** Next.js 16.2.9 + React 19.2.4 + Tailwind CSS 4 + Monaco + Zustand + Framer Motion + Playwright

**Portlar:** Web: 5180, Agent Worker: 5191

```
grok-premium/
├── app/
│   ├── page.tsx                 ←  ★ Ana sayfa (GrokPremium bileşeni)
│   ├── layout.tsx               ←  Root layout (Geist font, dark tema)
│   ├── loading.tsx              ←  Loading skeleton
│   ├── globals.css              ←  Tailwind + global stiller
│   ├── api/                     ←  14 route handler
│   │   ├── chat/route.ts        ←  Chat persistence API
│   │   ├── chats/               ←  CRUD
│   │   ├── agent/stream/        ←  SSE streaming endpoint
│   │   ├── agent/health/        ←  Agent worker health
│   │   ├── agent/abort/         ←  Streaming abort
│   │   ├── execute/             ←  Tool execution proxy
│   │   ├── imagine/             ←  Image gen API
│   │   ├── image/save-edit/     ←  Image edit save
│   │   ├── video/               ←  Video gen API
│   │   ├── browser/frame/       ←  Browser frame proxy
│   │   ├── auth/status/         ←  OIDC auth status
│   │   └── models/              ←  Model listesi
│   ├── code/page.tsx            ←  Code editor sayfası
│   ├── image/page.tsx           ←  Görsel üretim sayfası
│   ├── video/page.tsx           ←  Video üretim sayfası
│   ├── files/page.tsx           ←  File explorer
│   ├── subagents/page.tsx       ←  Subagent studio
│   ├── extensions/page.tsx      ←  Extensions manager
│   ├── sign-in/                 ←  Auth
│   └── sign-up/
│
├── components/
│   ├── chat/
│   │   ├── ChatMessageList.tsx       ←  Virtuoso tabanlı mesaj listesi
│   │   ├── ChatMessageRenderer.tsx   ←  Segment → JSX dönüşümü
│   │   ├── ChatComposer.tsx          ←  Komposer (text, image, video, context)
│   │   ├── ChatSidebar.tsx           ←  Sohbet geçmişi
│   │   ├── ChatEmptyState.tsx        ←  Boş durum
│   │   ├── WorkspaceHeader.tsx       ←  Üst başlık
│   │   ├── SettingsPanel.tsx         ←  Ayarlar
│   │   ├── SessionDashboard.tsx      ←  Session istatistikleri
│   │   ├── GeneratedImageGrid.tsx    ←  Üretilen görsel grid
│   │   ├── ImageGenWait.tsx          ←  Görsel üretim bekleme
│   │   └── ImageLightbox.tsx         ←  Görsel büyüteç
│   ├── tools/
│   │   ├── DiffViewer.tsx            ←  Diff karşılaştırma
│   │   ├── ToolCard.tsx              ←  Tool kartı
│   │   ├── ToolDisplay.tsx           ←  Tool görüntüleme
│   │   ├── ToolGroup.tsx             ←  Tool gruplama
│   │   ├── ToolTimeline.tsx          ←  Zaman çizelgesi
│   │   ├── ApprovalCenter.tsx        ←  Onay merkezi
│   │   ├── ToolApprovalGate.tsx      ←  Onay kapısı
│   │   ├── GrokOutput.tsx            ←  Grok çıktı render
│   │   ├── GrokShimmer.tsx           ←  Loading animasyonu
│   │   ├── SourceFavicons.tsx        ←  Kaynak favicon
│   │   └── renderers/               ←  6 tool renderer
│   ├── browser/
│   │   ├── BrowserPanel.tsx          ←  Ana browser paneli
│   │   ├── BrowserPanelToolbar.tsx   ←  Browser toolbar
│   │   ├── AnnotationChip.tsx        ←  Anotasyon çipi
│   │   ├── AnnotationCommentModal.tsx←  Yorum modal
│   │   ├── InlineAnnotationPrompt.tsx←  Anotasyon promptu
│   │   └── StyleFeedbackPanel.tsx    ←  Stil geribildirimi
│   ├── subagents/
│   │   ├── SubagentStudio.tsx        ←  ★ Subagent arayüzü
│   │   ├── ExtensionsManager.tsx     ←  Extension yönetimi
│   │   └── types.ts                  ←  Specialist türleri
│   ├── workspace/
│   │   ├── RightInspectorPanel.tsx    ←  ★ Sağ panel (review/browser/plan)
│   │   └── FileExplorer.tsx          ←  Dosya gezgini
│   └── layout/WorkspaceShell.tsx     ←  Ana layout
│
├── lib/
│   ├── hooks/
│   │   ├── useAgentStream.ts         ←  ★ Streaming hook (core)
│   │   ├── useChatPersistence.ts     ←  Session persistence
│   │   ├── useGrokPremiumInit.ts     ←  Initialization
│   │   ├── useSubagentSession.ts     ←  Subagent state yönetimi
│   │   ├── useBrowserPanel.ts        ←  Browser panel state
│   │   ├── useBrowserAnnotations.ts  ←  Browser anotasyonları
│   │   └── useWorkspaceChrome.ts     ←  Chrome sekme yönetimi
│   ├── agent-stream-client.ts        ←  SSE streaming client
│   ├── agent-config.ts               ←  Agent worker konfig
│   ├── agent-client.ts               ←  Agent REST client
│   ├── session-store.ts              ←  Server-side session store
│   ├── session-store-shared.ts       ←  Paylaşılan tipler
│   ├── message-segments.ts           ←  Segment modeli (text/tools)
│   ├── tool-types.ts                 ←  Tool tip tanımları
│   ├── tool-utils.ts                 ←  Risk analizi, preview
│   ├── context-injection.ts          ←  ★ Context injection sistemi
│   ├── browser-annotation.ts         ←  Browser anotasyon modeli
│   ├── grok-auth.ts                  ←  Grok/xAI OIDC auth
│   ├── quake-auth-bridge.ts          ←  Quake ↔ Grok auth köprüsü
│   ├── models.ts                     ←  Model kaydı
│   ├── chat-title.ts                 ←  Otomatik başlık
│   ├── extract-tool-media.ts         ←  Tool ortam çıkarma
│   ├── extract-web-sources.ts        ←  Web kaynak çıkarma
│   ├── format-tool-summary.ts        ←  Tool özeti
│   ├── apply-tool-event.ts           ←  Tool event uygulama
│   ├── render-message.tsx            ←  Mesaj render
│   ├── video-api-errors.ts           ←  Video hata sınıflandırma
│   ├── video-constants.ts            ←  Video sabitleri
│   ├── video-nsfw.ts                 ←  NSFW filtresi
│   └── grok-imagine.ts               ←  Imagine API
│
└── agent-worker/
    ├── server.ts                     ←  ★ Node HTTP server (port 5191)
    ├── rpc-bridge.ts                 ←  ★ Quakecode-cli RPC köprüsü
    ├── event-mapper.ts               ←  RPC event → SSE dönüşümü
    └── model-resolver.ts             ←  Model çözümleme
```

#### 5.1.1 Sayfa Rotası Haritası

| Route | Component | Açıklama |
|-------|-----------|----------|
| `/` | `GrokPremium` | Ana chat workspace |
| `/code` | CodeEditor | Monaco editor |
| `/image` | ImageWorkspace | Görsel üretim |
| `/video` | VideoWorkspace | Video üretim |
| `/files` | FileExplorer | Dosya gezgini |
| `/subagents` | SubagentStudio | Multi-agent yönetimi |
| `/extensions` | ExtensionsManager | Extension yönetimi |
| `/sign-in` | (kaldırıldı) | Geçmiş |
| `/sign-up` | (kaldırıldı) | Geçmiş |

#### 5.1.2 Subagent Specialist Türleri

| Specialist | ID prefix | Rol |
|-----------|-----------|-----|
| `edit-review` | `review-*` | Profesyonel kod review + approval |
| `approver` | `approver-*` | Tool risk analizi + onay |
| `optimizer` | `optimizer-*` | Session compaction |
| `exporter` | `exporter-*` | Session export |
| `session` | `session-*` | Session yönetimi |
| `composer` | `composer-*` | Context curation |
| `plan` | `plan-*` | Plan oluşturma |
| `coder` | (SubagentStudio) | Kod yazma |
| `memory` | (SubagentStudio) | Bellek yönetimi |

### 5.2 quake-desktop (`apps/quake-desktop/`)

**Paket:** `@mrquake/quake-desktop` (eski: `@mrquake/quakecode-web`)

**Stack:** Electron + Vite + React 19 + Monaco Editor + Zustand + node-pty

grok-premium'dan farkı:
- Düşük seviye runtime host'a direkt bağlanır (agent-worker katmanı yok)
- Electron masaüstü kabuğu, gömülü tarayıcı ve agent cursor overlay
- Extension web bridge (`defineWebExtensionComponent`)

### 5.3 quake-mobile

- React Native / Expo
- Çok erken aşama (sadece temel komutlar var)

---

## 6. AI Provider Katmanı

`packages/ai/src/providers/` — 15+ provider:

| Provider | Dosya | Auth |
|----------|-------|------|
| **OpenAI Responses** | `openai-responses.ts` | API key |
| **OpenAI Completions** | `openai-completions.ts` | API key |
| **OpenAI Codex** | `openai-codex-responses.ts` | OAuth |
| **Anthropic** | `anthropic.ts` | API key |
| **Google Gemini** | `google.ts` | API key |
| **Google Gemini CLI** | `google-gemini-cli.ts` | OAuth (Antigravity) |
| **Google Vertex** | `google-vertex.ts` | GCP auth |
| **AWS Bedrock** | `amazon-bedrock.ts` | AWS creds |
| **Azure OpenAI** | `azure-openai-responses.ts` | API key |
| **Mistral** | `mistral.ts` | API key |
| **xAI Grok** | `grok-auth.ts` | OIDC (OAuth) |
| **Mimo (Free)** | `mimo-free.ts` | Yok |
| **Faux (Mock)** | `faux.ts` | Yok |

**Model kaydı:**
- `packages/ai/src/models.ts` — Statik model tanımları
- `packages/ai/src/models.generated.ts` — Otomatik oluşturulan model listesi
- `packages/ai/scripts/generate-models.ts` — Model üretici script

**OAuth altyapısı:** `packages/ai/src/utils/oauth/`
- anthropic, github-copilot, google-antigravity, google-gemini-cli, openai-codex
- pkce, types, oauth-page

---

## 7. Tools (Yerleşik Araçlar)

`packages/coding-agent/src/core/tools/`

| Tool | Dosya | Açıklama |
|------|-------|----------|
| `read` | `read.ts` | Dosya okuma (limit, offset) |
| `write` | `write.ts` | Dosya yazma |
| `edit` | `edit.ts` | Snippet bazlı düzenleme |
| `edit-diff` | `edit-diff.ts` | Diff tabanlı düzenleme |
| `bash` | `bash.ts` | Terminal komut çalıştırma |
| `grep` | `grep.ts` | Metin arama |
| `find` | `find.ts` | Dosya bulma |
| `ls` | `ls.ts` | Dizin listeleme |
| `generate_image` | `generate-image.ts` | AI görsel üretimi |
| `generate_video` | `generate-video.ts` | AI video üretimi |
| `inspect_windows_ui` | `os-control.ts` | Windows UI inceleme |
| `os_control_action` | `os-control.ts` | OS kontrol eylemi |
| `os_wait_for_window` | `os-control.ts` | Pencere bekleme |
| `os_wait_for_text` | `os-control.ts` | Metin bekleme |
| `os_perform_step` | `os-control.ts` | Adım gerçekleştirme |
| `web_search` | `web-search.ts` | Web arama |
| `web_runtime` | `web-runtime.ts` | Browser runtime |
| `memory_read/write/search` | `memory-tools.ts` | Bellek araçları |

**Tool kategorileri:**
- `codingTools = [read, bash, edit, write]`
- `readOnlyTools = [read, grep, find, ls]`
- `allTools = { read, bash, edit, write, grep, find, ls, generate_*, os_*, memory_*, web_* }`

---

## 8. Extensions & Skills

### 8.1 Extensions (`packages/coding-agent/src/bundled/extensions/`)

- **plan-mode/** — Plan Mode TUI extension
- **quake-browser-tools/** — Browser otomasyon tools

Extension mekanizması (`src/core/extensions/`):
- `loader.ts` → Extension yükleme
- `runner.ts` → Extension çalıştırma
- `types.ts` → Extension tip tanımları
- `virtual-modules.ts` → Sanal modüller
- `wrapper.ts` → Extension sarmalayıcı

### 8.2 Skills (`packages/coding-agent/src/bundled/skills/`)

| Skill | Açıklama |
|-------|----------|
| docx | Word dokümanları |
| pptx | PowerPoint sunumları |
| pdf | PDF işlemleri |
| xlsx | Excel işlemleri |
| review | Kod review |
| security | Güvenlik denetimi |
| plan | Plan oluşturma |
| refactor | Refactoring |
| test | Test yazma |
| Agent odaları | Multi-agent koordinasyon |

---

## 9. Agent Worker Mimarisi

```
┌──────────────────────────────────────────────────┐
│              grok-premium (Next.js)                │
│                                                    │
│  Client (Browser) ←→ Route Handler ←→ HTTP/SSE    │
│                                                    │
│  POST /api/agent/stream  ──────────────┐          │
│  GET  /api/agent/health  ──────────┐   │          │
│  POST /api/agent/abort   ──────┐   │   │          │
│  POST /api/execute        ──┐   │   │   │          │
│                              ▼   ▼   ▼   ▼         │
│                    agent-worker (port 5191)         │
│  ┌──────────────────────────────────────────────┐  │
│  │           Node HTTP Server                    │  │
│  │                                               │  │
│  │  /health  → handleHealth()                    │  │
│  │  /prompt  → handlePrompt() → SSE stream       │  │
│  │  /abort   → handleAbort()                     │  │
│  │  /sessions/new → handleNewSession()           │  │
│  │                                               │  │
│  │  QuakeRpcBridge (rpc-bridge.ts)               │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │  child_process: node dist/cli.js --rpc  │  │  │
│  │  │  ↔ stdin/stdout JSON-RPC (NDJSON)       │  │  │
│  │  │  - prompt()                             │  │  │
│  │  │  - configureForPrompt()                  │  │  │
│  │  │  - abort()                              │  │  │
│  │  │  - newSession()                         │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  │                                               │  │
│  │  Event Mapper (event-mapper.ts)               │  │
│  │  RPC event → WorkerSseEvent dönüşümü          │  │
│  │  (text_delta, thinking_delta, tool_start/     │  │
│  │   update/end, agent_start/end, error)         │  │
│  └──────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### RPC Event Akışı

```
quakecode-cli stdout → NDJSON line
  ↓
rpc-bridge.ts → emitLine() → listeners
  ↓
event-mapper.ts → mapRpcEventToSse() → WorkerSseEvent
  ↓
formatSse() → "data: {json}\n\n"
  ↓
HTTP Response → SSE stream
  ↓
agent-stream-client.ts → consumeAgentSseStream()
  ↓
useAgentStream.ts → segment update → UI
```

### SSE Event Türleri

| Event | İçerik |
|-------|--------|
| `text_delta` | Metin parçası |
| `thinking_delta` | Düşünce zinciri |
| `tool_start` | Tool başladı (id, name, args) |
| `tool_update` | Tool ara sonuç |
| `tool_end` | Tool bitti (result, isError) |
| `agent_start` | Agent başladı |
| `agent_end` | Agent bitti |
| `error` | Hata mesajı |
| `done` | Stream sonu |
| `queue_update` | Kuyruk durumu |

---

## 10. Akış Diyagramları

### 10.1 Mesaj Gönderme Akışı

```
Kullanıcı → ChatComposer → sendMessage()
  │
  ├── Context Injection: attachedContext + curatedContextBlock
  ├── Image Processing: base64 images
  ├── Annotation Injection: browser annotations
  └── Video Injection: attachedVideo
       │
       ▼
useAgentStream().sendMessage()
  │
  ├── User message → messages state'e eklenir
  ├── Assistant placeholder eklenir (streaming)
  │
  └── POST /api/chat (Next.js)
       │
       ▼  (server-side)
  agent-client.ts → POST agent-worker:5191/prompt
       │
       ▼  (agent-worker)
  rpc-bridge.ts → quakecode-cli child_process
       │
       ▼  (streaming)
  consumeAgentSseStream() ← SSE events
       │
       ├── text_delta → Δ segment → UI
       ├── tool_start → ToolCard → UI
       ├── tool_update → progress → ToolCard
       ├── tool_end → result → ToolDisplay
       └── done → stream bitti
```

### 10.2 Tool Approval Akışı

```
Agent tool çağırır
  │
  ▼
ensureApproval(tool)
  │
  ├── computeRiskScore(tool) → {score, risk, reason}
  ├── buildToolPreview(tool) → preview
  │
  ├── risk = LOW → otomatik approve
  ├── risk = MEDIUM → kullanıcıya sor
  └── risk = HIGH → + approver subagent analysis
       │
       ▼
  ToolApprovalGate → UI'da onay kartı
       │
       ├── Approve → handleApproveTool()
       │   ├── pending'den kaldır
       │   ├── edit tool ise handleApproveEdit()
       │   └── approverSession log
       │
       ├── Reject → handleRejectTool()
       │   ├── pending'den kaldır
       │   └── approverSession log
       │
       └── Steer → handleSteerTool(steerText)
           ├── approver re-analysis
           └── yeni recommendation
```

### 10.3 Context Injection Akışı

```
Kullanıcı ekler:
  ├── @mentions (file, symbol)
  ├── File picker → triggerFilePicker()
  │   ├── read file → auto-summarize → addContextItem()
  │   └── token estimate
  ├── Symbol search → triggerSymbolSearch()
  │   └── grep → addContextItem()
  ├── Repo map → injectRepoMap()
  │   └── ls → buildRepoMapSnippet()
  ├── Browser annotation → handleBrowserAnnotation()
  └── Drag & drop
       │
       ▼
optimizeContextWithSubagent()  (isteğe bağlı)
  │
  ├── composerSession.steer() → subagent curation
  ├── Parse: CURATED_CONTEXT + SUMMARY + FINAL_PROMPT
  └── setCuratedContextBlock() → final prompt
       │
       ▼
prepareFinalPromptWithContext()
  ├── attachedContext → formatted block
  ├── curatedContextBlock → (varsa)
  └── buildFinalSegments() → segments
```

### 10.4 Plan Mode Akışı

```
Kullanıcı → "Plan mode" veya /plan
  │
  ▼
activatePlanMode(initialQuery?)
  │
  ├── setIsPlanModeActive(true)
  ├── buildSpecialistPrompt("plan", starter)
  └── planSession.steer(fullPrompt)
       │
       ▼
  Plan subagent → tools (ls, read, grep) → plan output
       │
       ├── Export → exportPlanAsMarkdown()
       ├── Fork → forkCurrentPlan()
       ├── Create AGENTS.md → createAgentsMdFromPlan()
       ├── Delegate to Coder → delegatePlanStepToCoder()
       └── Exit → exitPlanMode()
```

### 10.5 Session Yaşam Döngüsü

```
newChat()
  │
  ├── createNewChat() → {id, messages: [], created, updated}
  ├── setCurrentChatId(id)
  └── addTagToCurrent(tag) → meta güncelleme
       │
       ▼  (kullanım sırasında)
  loadChat(id) → getChat(id) → parse → setMessages()
       │
       ├── Kompakt: compactCurrentChat()
       │   ├── optimizerSession.steer("Compaction")
       │   └── updateChatMeta(id, {compactSummary, stats})
       │
       ├── Fork: forkCurrentChat()
       │   └── forkChat(id) → yeni session
       │
       ├── Export: exportWithSpecialist()
       │   └── exporterSession.steer("Export HTML")
       │
       └── Sil: deleteChat(id)
```

---

## 11. Konfigürasyon & State

### 11.1 Root Config

| Dosya | Amaç |
|-------|------|
| `package.json` | Monorepo root, scripts, workspaces |
| `tsconfig.json` | TS paths (quakecode aliases, compat) |
| `tsconfig.base.json` | Base TS config (ES2022, Node16, strict) |
| `biome.json` | Linter/formatter (tab, 3 indent, 120 width) |
| `bun.lock` | Bun lockfile |
| `package-lock.json` | npm lockfile |
| `QUAKE.md` | Agent instructions (committed) |
| `QUAKE.local.md` | Personal pref (gitignored) |

### 11.2 Runtime State (`.quake-code/`)

```
.quake-code/
├── agent-memory/        ← Agent otomatik belleği
├── agent-rooms/         ← Multi-agent odaları
│   ├── messages/
│   ├── tasks/
│   └── artifacts/
├── rules/               ← Path-bazlı kurallar
├── web-settings.json    ← Web ayarları
└── web-token           ← Auth token
```

### 11.3 grok-premium State (`~/.grok-premium/`)

```
~/.grok-premium/
└── chats/
    ├── {id}.json        ← Her sohbet bir JSON dosyası
    └── ...
```

### 11.4 xAI Auth (`~/.grok/auth.json`)

```json
{
  "key": "...",           // OIDC token
  "refresh_token": "...",
  "expires_at": "...",
  "email": "...",
  "oidc_client_id": "..."
}
```

---

## 12. Build & Geliştirme

### 12.1 Komutlar

```bash
# Kurulum
npm install

# Build (sıralı: tui → ai → agent → coding-agent → mom → pods)
npm run build

# Development (tüm paketler concurrently)
npm run dev

# grok-premium development
npm run dev:grok-premium           # Sadece web (port 5180)
npm run dev:grok-premium:stable    # Webpack (Turbopack yok)
npm run dev:grok-premium:full      # Web + agent worker (concurrently)

# Kalite kontrol
npm run check                      # biome + tsgo + browser smoke
npm run check:fix                  # Otomatik düzeltme

# Test
npm test

# Release
npm run release:patch
npm run release:minor
npm run release:major
```

### 12.2 grok-premium Özel Komutlar

```bash
npm run dev:agent          # Sadece agent worker (port 5191)
npm run dev:agent:rpc      # RPC modu
npm run e2e                # Playwright E2E testleri
npm run e2e:ui             # Playwright UI modu
npm run test:browser-url   # Browser URL testi
npm run check:browser      # Browser stack check
```

### 12.3 Build Sırası

```
1. packages/tui       → Terminal UI primitives
2. packages/ai        → AI provider layer
3. packages/agent     → Agent core
4. packages/coding-agent → CLI + runtime (hepsine bağımlı)
5. packages/mom       → Slack bot
6. packages/pods      → vLLM pods
```

### 12.4 Önemli Script'ler

| Script | Açıklama |
|--------|----------|
| `scripts/release.mjs` | Release automation |
| `scripts/sync-versions.js` | Versiyon senkronizasyonu |
| `scripts/check-browser-smoke.mjs` | Browser smoke test |
| `scripts/check-mouse-smoke.mjs` | Mouse smoke test |
| `scripts/check-architecture-debt.mjs` | Mimari borç kontrolü |
| `scripts/profile-coding-agent-node.mjs` | Performans profili |
| `scripts/cost.ts` | Maliyet hesaplama |
| `scripts/install-qd-shim.cjs` | qd shim kurulumu |

### 12.5 Docker (Mom)

```bash
packages/mom/docker.sh     # Docker build
packages/mom/dev.sh        # Development
```

---

## 13. Önemli Dosyalar

### En Kritik Dosyalar

| Dosya | Açıklama |
|-------|----------|
| `apps/grok-premium/app/page.tsx` | ★ Ana sayfa (GrokPremium) — 1000+ satır, tüm state yönetimi |
| `apps/grok-premium/lib/hooks/useAgentStream.ts` | ★ Streaming chat hook |
| `apps/grok-premium/agent-worker/server.ts` | Agent worker HTTP server |
| `apps/grok-premium/agent-worker/rpc-bridge.ts` | ★ RPC köprüsü (quakecode-cli ↔ web) |
| `apps/grok-premium/lib/session-store.ts` | Session persistence |
| `apps/grok-premium/lib/message-segments.ts` | Segment modeli |
| `apps/grok-premium/lib/context-injection.ts` | Context injection sistemi |
| `apps/grok-premium/lib/grok-auth.ts` | xAI auth (WSL bridge) |
| `apps/grok-premium/components/subagents/SubagentStudio.tsx` | Subagent UI |
| `apps/grok-premium/components/workspace/RightInspectorPanel.tsx` | Sağ panel |
| `packages/coding-agent/src/main.ts` | CLI entry point |
| `packages/coding-agent/src/core/agent-session.ts` | Agent session |
| `packages/coding-agent/src/core/tools/index.ts` | Tool registry |
| `packages/ai/src/index.ts` | AI package exports |

---

## Ek: Güvenlik Modeli

- Varsayılan: `127.0.0.1` + per-process token
- Workspace allowlist
- Terminal policy: `safe` | `allow-all` | `disabled`
- Dosya önizleme limitleri
- Uzak erişim: `QUAKE_WEB_ALLOW_REMOTE` env
- Permissions-Policy header (grok-premium)
- Tool approval gates (risk scoring)
- OIDC auth (xAI Grok)

---

## Ek: De-upstream Notları

Eski `@mariozechner/pi-*` paket adları compat alias olarak `tsconfig.json`'da tanımlı:
- `@mariozechner/pi-ai` → `@mrquake/quakecode-ai`
- `@mariozechner/pi-agent-core` → `@mrquake/quakecode-agent-core`
- `@mariozechner/pi-coding-agent` → `@mrquake/quakecode-cli`
- `@mariozechner/pi-tui` → `@mrquake/quakecode-tui`
- `@mariozechner/pi-mom` → `@mrquake/quakecode-mom`
- `@mariozechner/pi` → `@mrquake/quakecode-pods`

---

*Bu rehber 2026-06-26 tarihinde yapılan kapsamlı incelemeye dayanmaktadır.*
