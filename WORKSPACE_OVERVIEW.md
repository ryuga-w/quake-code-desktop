# Quake Code - Workspace Overview

**Son Kapsamlı İnceleme:** 2026-06-26
**Amaç:** Workspace yapısını, mimariyi ve önemli noktaları tek yerde toplamak. Her seferinde tekrar incelememek için.

---

## 🎯 Proje Nedir?

**Quake Code**, terminal-first AI coding assistant'tır.

- Ana arayüz: **Terminal (TUI)** — çok güçlü ve olgun
- Aynı `@mrquake/quakecode-cli` runtime'ını kullanan **iki web yüzeyi:**
  - **quake-desktop** — Quake Code IDE (Electron + web shell, TUI parity)
  - **grok-premium** — Grok chat workspace (Next.js, farklı ürün/UX)
- Çoklu AI provider desteği
- Zengin yerleşik araçlar, skills, extensions ve session yönetimi
- CLI komutları: `quake`, `quake-code`, `qd`, `qc`

Kısaca: Geliştiricilerin kod okuma, yazma, düzenleme, shell çalıştırma ve AI'dan tek bir araç üzerinden yararlanmasını sağlayan kapsamlı bir sistem.

---

## 📊 İstatistikler (2026-06-26)

| Metrik                  | Değer          |
|-------------------------|----------------|
| TS / TSX Kaynak Dosyası | **749**        |
| TS/TSX Satır Sayısı     | **~189.300**   |
| Markdown Dosyası        | 164            |
| Git Tracked Dosyalar    | ~1.400         |
| Ana Paketler            | 12+            |
| Core Packages           | 8 (@mrquake/*) |
| Uygulamalar             | 3 (web + mobile + grok-premium) |

---

## 📁 Dizin Yapısı (Özet)

```
.
├── packages/
│   ├── coding-agent/     ← Ana CLI + runtime + tools + skills + TUI modları
│   ├── ai/               ← Provider katmanı (OpenAI, Anthropic, Gemini, Bedrock...)
│   ├── agent/            ← Agent core runtime
│   ├── tui/              ← Terminal UI primitive'leri
│   ├── mom/              ← Slack entegrasyonu
│   ├── pods/             ← vLLM / GPU pod yönetimi
│   ├── jiti/             ← Jiti wrapper
│   ├── clipboard/
│   └── openclaw-* / os-bridge   ← Native Windows katmanları
│
├── apps/
│   ├── quake-desktop/    ← IDE shell (Electron + React 19 + Vite + Monaco + aynı runtime)
│   ├── quake-mobile/     ← React Native / Expo (erken aşama)
│   └── grok-premium/     ← Grok chat workspace (Next.js; quakecode-cli + agent-worker)
│
├── .quake-code/          ← Runtime state (sessions, memory, rules, web-settings)
├── .github/workflows/    ← CI, binary build, pr-gate
├── scripts/              ← Release, profile, smoke, sync vs.
├── docs/ + çok sayıda *.md plan dosyası
└── node_modules/         ← Çok büyük (kaçınılmaz)
```

---

## 📦 Core Paketler

| Paket                            | Sürüm    | Amaç / İçerik |
|----------------------------------|----------|---------------|
| `@mrquake/quakecode-cli`         | 1.11.2   | **Ana ürün**. CLI entry point'leri, AgentSession, tools, extensions, skills, interactive TUI |
| `@mrquake/quakecode-ai`          | 1.11.2   | AI provider abstraction, streaming, model registry, OAuth, tüm provider'lar |
| `@mrquake/quakecode-agent-core`  | 1.11.2   | Agent runtime ve temel tipler |
| `@mrquake/quakecode-tui`         | 1.11.2   | Terminal bileşenleri (editor, markdown, select, image, input vs.) |
| `@mrquake/quakecode-mom`         | -        | Slack bot entegrasyonu |
| `@mrquake/quakecode-pods`        | -        | vLLM pod yönetimi CLI'si |
| `@mrquake/quakecode-jiti`        | -        | Jiti wrapper |
| `@mrquake/quakecode-clipboard`   | -        | Clipboard erişimi |

**En kritik klasör:** `packages/coding-agent/src/`
- `core/` → tools, agent-session, extensions, skills, compaction, memory, settings
- `modes/interactive/` → Zengin TUI component'leri
- `bundled/skills/` + `extensions/` → Docx, pptx, pdf, xlsx + quake-özel ajanlar + subagents + agent-room

---

## 🌐 Uygulamalar

### quake-desktop (`apps/quake-desktop`)

- **Paket:** `@mrquake/quake-desktop` (eski ad: `@mrquake/quakecode-web`)
- **Amaç:** Terminal TUI'nin web + Electron IDE karşılığı (aynı runtime'ı kullanır)
- **Teknoloji:** Electron + React 19 + Vite + Monaco Editor + Zustand
- **Backend:** Node HTTP + SSE + WebSocket PTY (AgentSessionRuntimeHost direkt import)
- Özellikler:
  - Streaming chat, gömülü tarayıcı, agent cursor
  - Tool renderers + diff + Monaco edit
  - File explorer, terminal PTY, git panel
  - Command palette, plan panel, sessions, settings
  - Extension web bridge (`defineWebExtensionComponent`)
- **Güvenlik:** Local token, 127.0.0.1 default, workspace allowlist, terminal policy (safe)
- Detaylı dokümanlar: `apps/quake-desktop/docs/`

### quake-mobile (`apps/quake-mobile`)

- React Native + Expo
- Henüz erken aşamada

### grok-premium (`apps/grok-premium`)

- **Amaç:** Üst düzey Grok çalışma alanı — sohbet, görsel, video, kod, tarayıcı paneli
- **Teknoloji:** Next.js 16 (App Router) + Tailwind + Monaco + agent-worker (port 5191)
- **Runtime paylaşımı:** `@mrquake/quakecode-cli`, `@mrquake/quakecode-ai` (quake-desktop ile aynı çekirdek)
- **Farkları (quake-desktop'a göre):**
  - Farklı ürün/UX (Grok dark tema, chat-first; IDE shell değil)
  - Farklı stack (Next.js vs Vite + custom Node server)
  - Farklı persistence (`~/.grok-premium/chats` vs `.quake-code/`)
  - xAI/Grok odaklı modeller ve auth (`~/.grok/auth.json`)
- **Dev komutları:** `npm run dev:grok-premium`, `dev:grok-premium:full` (web + agent worker)
- Detay: `apps/grok-premium/README.md`

| | quake-desktop | grok-premium |
|---|---|---|
| Ürün | Quake Code IDE | Grok workspace |
| Stack | Vite + Node SSE | Next.js + agent-worker RPC |
| Runtime | `@mrquake/quakecode-cli` | `@mrquake/quakecode-cli` + worker |
| State | `.quake-code/` | `~/.grok-premium/` |

---

## 🛠️ Teknoloji Stack & Konvansiyonlar

- **Dil:** TypeScript (strict mode)
- **Runtime:** Node.js ≥ 20.6
- **Module:** ES Modules
- **Lint/Format:** Biome 2.3.5 (tab indent, width=3, lineWidth=120)
- **Build:** `tsgo` (native TS preview) + tsc
- **Test:** Vitest + Playwright (web için)
- **Web:** React 19, Vite, Monaco, Zustand
- **Diğer:** undici, playwright, diff, marked, glob, yaml, photon (image), OpenClaw native

**Önemli Konvansiyonlar:**
- `node:fs`, `node:path` gibi Node built-in'leri prefix'li kullan
- `import type` tercih et
- Build sırası önemlidir (`tui → ai → agent → coding-agent`)

---

## 🚀 Build & Geliştirme Komutları

```bash
# Kurulum
npm install

# Tüm paketleri build et (sıralı)
npm run build

# Development (concurrently)
npm run dev

# Web (Quake Code IDE)
npm run dev:web
npm --workspace @mrquake/quake-desktop run build

# Grok workspace (web + agent worker)
npm run dev:grok-premium
npm run dev:grok-premium:full

# Kalite kontrol
npm run check          # biome + tsgo + browser smoke

# Test
npm test
npm --workspace @mrquake/quake-desktop run e2e

# CLI çalıştırma (build sonrası)
quake
# veya
node packages/coding-agent/dist/cli.js
```

**Release ile ilgili script'ler** `package.json` ve `scripts/release.mjs`'de.

---

## ✨ Öne Çıkan Özellikler

- **Tools:** read, write, edit (diff), grep, find, ls, bash, memory-tools, web-search, os-control
- **Skills:** Python destekli ofis araçları (docx, pptx, pdf, xlsx) + quake-özel ajanlar (plan, review, refactor, security, test vs.)
- **Extensions:** Subagents, Agent Rooms, Browser Tools, Plan Mode, Web Search
- **Session Yönetimi:** Save / Resume / Fork / Export (HTML dahil) + Compaction
- **Memory & Rules:** Persistent memory + path-scoped rules (`.quake-code/rules/`)
- **Multi-Provider:** OpenAI (Responses/Completions/Codex), Anthropic, Google Gemini/Vertex, Mistral, AWS Bedrock, Azure, custom
- **Web Parity:** quake-desktop ve grok-premium, AgentSession / quakecode-cli runtime'ını paylaşır (farklı UI katmanları)
- **Self-Improvement** ve agent room yapıları

---

## 📁 Önemli Dosyalar ve Konumlar

| Konum                                      | Açıklama |
|--------------------------------------------|----------|
| `packages/coding-agent/src/main.ts`        | CLI ana giriş |
| `packages/coding-agent/src/core/tools/`    | Yerleşik araçlar |
| `packages/ai/src/providers/`               | AI provider implementasyonları |
| `apps/quake-desktop/src/server/runtime.ts`     | quake-desktop ↔ Runtime köprüsü |
| `apps/quake-desktop/src/shared/protocol.ts`    | quake-desktop protokolü |
| `apps/grok-premium/agent-worker/server.ts` | grok-premium agent worker (tools/RPC) |
| `apps/grok-premium/lib/quake-auth-bridge.ts` | Quake auth ↔ Grok auth köprüsü |
| `.quake-code/`                             | Kullanıcı state'i (sessions, memory, rules) |
| `QUAKE.md`                                 | Proje talimatları (memory) |
| `biome.json` / `tsconfig.json`             | Konfigürasyon |
| `packages/coding-agent/docs/`              | CLI dokümantasyonu |

---

## 🧠 Runtime State (.quake-code)

```
.quake-code/
├── agent-memory/
├── agent-rooms/          ← Multi-agent odaları (messages, tasks, artifacts)
├── rules/                ← Path bazlı kurallar
├── web-settings.json
└── web-token
```

Kullanıcıya özel konfigürasyon ve session geçmişi burada saklanır.

---

## 🔐 Güvenlik Modeli (Web)

- Varsayılan: `127.0.0.1` + per-process token
- Workspace allowlist desteği
- Terminal komut policy (`safe` | `allow-all` | `disabled`)
- Dosya önizleme limitleri
- Uzak erişim için ekstra hardening gerekir (`QUAKE_WEB_ALLOW_REMOTE`)

---

## 📚 Dokümantasyon

- Root: `README.md`, `QUAKE.md`, `WORKSPACE_OVERVIEW.md` (bu dosya)
- `apps/quake-desktop/docs/` → architecture, security, roadmap, qa, keyboard-shortcuts...
- `apps/grok-premium/README.md` → Grok workspace, agent worker, browser panel
- `packages/coding-agent/docs/` → development, models, skills, themes, tui vs.

---

## 📌 Mevcut Durum (2026-06-26)

- **CLI / TUI / AI katmanı:** Olgun ve production-ready
- **quake-desktop:** Aktif geliştirme, MVP hedeflerine büyük ölçüde ulaşmış, runtime parity güçlü
- **grok-premium:** Monorepo içinde; quakecode-cli runtime paylaşıyor, farklı ürün yüzeyi (Next.js + Grok UX)
- **Mobile:** Erken
- **De-upstream:** Devam ediyor (eski pi isimleri için compat alias'lar var)
- **En hareketli alanlar:** `apps/quake-desktop`, `apps/grok-premium`, coding-agent extensions/skills, web güvenlik/policy

---

## 🏁 Hızlı Başlangıç

```bash
npm install
npm run build
quake
# Quake Code web IDE
npm run dev:web

# Grok workspace (tam mod: web + agent worker)
npm run dev:grok-premium:full
```

---

## Not

Bu dosya 2026-06-26 tarihinde yapılan kapsamlı incelemeye dayanır.
Workspace geliştikçe güncellenmesi önerilir.

Daha detaylı inceleme için ilgili klasör ve dosyaları doğrudan oku.
```

The file has been created successfully.