# 🧠 Quake Memory Extension

**Kalıcı, çoklu-oturum, branching-aware bellek sistemi**

## Özellikler

| Faz | Özellik | Durum |
|:---:|---------|:-----:|
| 1 | `remember`/`recall`/`forget`/`remember-multi` tool'ları (LLM kontrollü) | ✅ |
| 1 | `/memory` kullanıcı komutları (list, search, show, delete, stats, export) | ✅ |
| 1 | `context` event → working memory inject (token budget: 2048 varsayılan) | ✅ |
| 1 | `before_agent_start` → system prompt augmentation | ✅ |
| 1 | Cross-session persistence (`~/.quake-code/agent/memory.json`) | ✅ |
| 1 | File locking ile concurrent-safe JSON store | ✅ |
| 1 | Full-text search (tokenize + score) | ✅ |
| 1 | 5 namespace: project, user, learnings, session, wip | ✅ |
| 2 | `agent_end` → pattern-based auto-extraction (ücretsiz, LLM çağırmaz) | ✅ |
| 2 | `session_before_compact` → compaction'da memory koruma | ✅ |
| 2 | `session_tree` → branching snapshot (CustomEntry) | ✅ |
| 2 | CLI flag: `--memory-max-tokens`, `--memory-auto-extract` | ✅ |
| — | TUI Widget | ⏳ |
| — | Settings entegrasyonu | ⏳ |

## Kullanım

```bash
# Geçici yükleme
quake --extension examples/extensions/memory

# Token budget override
quake --extension examples/extensions/memory --memory-max-tokens 4096

# Auto-extract kapatma
quake --extension examples/extensions/memory --memory-auto-extract false
```

### LLM Tool'ları

| Tool | Ne işe yarar |
|------|------------|
| `remember(key, title, content, type?, namespace?, tags?)` | Bir anıyı kaydeder |
| `recall(query?, key?, namespace?, tags?, type?, limit?)` | Anıları arar/getirir |
| `forget(key)` | Anıyı siler |
| `remember-multi(entries[])` | Toplu anı kaydetme |

### Kullanıcı Komutları

| Komut | Açıklama |
|-------|---------|
| `/memory list [namespace]` | Tüm anıları listele |
| `/memory search <query>` | Full-text arama |
| `/memory show <key>` | Detay göster |
| `/memory delete <key>` | Sil |
| `/memory stats` | İstatistikler |
| `/memory export [namespace]` | JSON dışa aktar |
| `/memory clear` | Tümünü temizle |

## Mimarî

```
quake-memory/
├── index.ts               ← Ana giriş (extension factory + 7 event hook)
├── types.ts               ← Tip tanımları (MemoryEntry, MemoryStoreData, MemoryQuery)
├── memory-store.ts         ← JSON file store (CRUD, indexing, search, locking)
├── memory-tools.ts         ← LLM tool'ları (defineTool ile tip güvenli)
├── memory-injector.ts      ← Context injection (working memory)
├── memory-prompts.ts       ← System prompt + extraction prompt şablonları
├── memory-commands.ts      ← Kullanıcı komutları
└── memory-extractor.ts     ← Auto-extraction (pattern matching + compaction)
```

### Event Hook'ları

```
session_start ──→ Diskten yükle, flag'leri parse et
     ↓
before_agent_start ──→ System prompt'a memory bölümü ekle
     ↓
agent loop ──→ context (her turda working memory inject)
     ↓
agent_end ──→ Pattern-based extraction + diske kaydet
     ↓
session_before_compact ──→ Compaction'da memory koruma
     ↓
session_tree ──→ Branching snapshot
     ↓
session_shutdown ──→ Final save
```

### Storage Katmanı

```
┌─────────────────────────────────────────────┐
│            ~/.quake-code/agent/             │
│              memory.json                     │
│  (JSON file store, proper-lockfile ile       │
│   concurrent-safe, otomatik index)           │
├─────────────────────────────────────────────┤
│  L1: Working Memory (context inject)        │
│  L2: Explicit Memory (LLM tool'ları)        │
│  L3: Implicit Memory (auto-extraction)      │
│  L4: Cross-Session (disk persistence)       │
└─────────────────────────────────────────────┘
```

## Geliştirme

```bash
# Build kontrolü
cd packages/coding-agent
npx tsc --noEmit --pretty 2>&1 | grep examples/extensions/memory

# Kalıcı yap
cp -r examples/extensions/memory ~/.quake-code/agent/extensions/quake-memory/
```

## Dosyalar

| Dosya | Satır | Açıklama |
|-------|:-----:|---------|
| `types.ts` | 151 | Tip tanımları |
| `memory-store.ts` | 481 | JSON file store |
| `memory-prompts.ts` | 87 | Prompt şablonları |
| `memory-tools.ts` | 267 | LLM tool'ları |
| `memory-commands.ts` | 241 | Kullanıcı komutları |
| `memory-injector.ts` | 55 | Context injection |
| `memory-extractor.ts` | 338 | Auto-extraction |
| `index.ts` | 189 | Ana giriş + event hooks |
| **Toplam** | **~1800** | |
