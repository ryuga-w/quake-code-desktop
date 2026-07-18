# Quake Code CLI — Yapılacaklar / İyileştirme Listesi

> Tarih: 2026-06-28
> Kapsam: `packages/coding-agent` (CLI çekirdeği)
> Sürüm: v1.11.2 (`@mrquake/quakecode-cli`)
> Toplam kaynak: ~67.000 satır TS

Öncelik sıralaması: **etki × risk × efor** dengesine göre. Yukarıdan aşağı yapılması önerilir.

---

## 🔴 P0 — Kritik (en yüksek etki)

### 1. `interactive-mode.ts` dev dosyasını parçala
- **Sorun:** 6.239 satır, 220KB, 307 fonksiyon, tek dosyada `InteractiveMode` + `HorizontalSplit` + mouse + theme + input + render + slash + overlay karışık.
- **Hedef:** Mantıksal modüllere böl:
  - `render/` — çizim, layout, overlay
  - `input/` — klavye, mouse, slash komut yönlendirme
  - `state/` — oturum durumu, faz yönetimi
  - `commands/` — slash komut handler'ları
  - `interactive-mode.ts` — sadece orkestrasyon (< 800 satır hedef)
- **Risk:** Yüksek (TUI'nin kalbi). Adım adım + her adımda `npm run check` + manuel test.
- **Efor:** Büyük (birkaç oturum).
- **Durum:** [ ]

---

## ✅ TAMAMLANDI (2026-06-28): 15 gerçek tip hatası düzeltildi

Repo'da yarım kalmış screencast/subagent-image işinden kalma **15 derleme hatası** vardı; hepsi giderildi. `npm run build` artık SIFIR hatayla geçiyor.

- `quake-web-search/index.ts`: `result.details` (`unknown`) cast + content union guard.
- `plan-mode/index.ts` (+ examples kopyası): type predicate'i `SessionMessageEntry`'e bağlandı.
- `quake-subagents/agent-runner.ts` & `index.ts`: eksik `ImageContent` (quakecode-ai) + `AgentMessage` (quakecode-agent-core) importları eklendi.
- `quake-subagents/index.ts`: `ctx.messages` (mevcut değil) → `sessionManager.getEntries()` ile son user mesajı; ölü `session_switch` handler'ı kaldırıldı (hiç emit edilmiyordu).
- `quake-subagents/agent-manager.ts`: `SpawnOptions.images` eklendi + `runAgent`'a iletildi.
- `quake-agent-room/index.ts`: `resolveAgentInvocationConfig` çağrılarında spread yerine açık alan geçişi + `IsolationMode` importu (isolation `string`↔union çakışması çözüldü).

**NOT:** Kalan typecheck hataları yalnızca `apps/quake-desktop` (React/JSX) ve `test/` (eksik `quake` global) kaynaklı — CLI üretim kodu (`src/`, `tsconfig.build.json`) temiz.

---

## 🟠 P1 — Yüksek (orta efor, somut kazanç)

### 2. `any` avı — 258 → 220 (devam ediyor)
- **Sorun:** QUAKE.md "TypeScript strict" diyor ama başlangıçta 258 `any` vardı.
- **En kirli dosyalar (öncelik):**
  - [x] `quake-browser-tools/index.ts` — **36 → 0** ✅ (2026-06-28)
    - DOM `evaluate` dönüşü zaten tipliydi → `(e: any)` filtreleri kaldırıldı.
    - `dot/statusLabel/detailForTool/renderCall/renderResult` → `Theme`, `AgentToolResult<unknown>`, `ToolRenderResultOptions` ile tiplendi; `str()`/`len()` güvenli erişim helper'ları eklendi.
    - `registerTool(def: any)` → generic `ToolDefinition<TParams, TDetails>` → 28 `execute(params: any)` şemadan otomatik tiplendi (`params: any` kaldırıldı).
    - **Bonus bug:** tip çıkarımı açılınca `browser_handle_dialog` action şemasının gevşek (`Type.String`) olduğu ortaya çıktı → `Type.Union(["accept","dismiss"])` ile daraltıldı (LLM'e de net).
    - Kalan 2 `evaluate(... as ...)`: Playwright string-body overload sınırlaması → `as unknown as () => unknown` + açıklama yorumu (meşru).
  - [ ] `core/tools/os-control.ts` — **23** (sıradaki hedef)
  - [ ] `core/tools/web-runtime.ts` — **13**
  - [ ] `components/tool-execution.ts` — **10**
  - [ ] `core/extensions/types.ts` — **10**
- **Hedef:** Kalan dosyalarda `any`'leri gerçek tiplere / `unknown` + guard'a çevir.
- **Risk:** Düşük-orta.
- **Efor:** Orta.
- **Durum:** [~] devam ediyor (258 → 220)

### 3. Dev dosyaları böl (interactive-mode dışı)
- `core/agent-session.ts` — 3.113 satır
- `core/package-manager.ts` — 2.196 satır (CLI için fazla büyük, gözden geçir)
- `bundled/extensions/plan-mode/index.ts` — 1.913 satır
- `bundled/extensions/quake-subagents/index.ts` — 1.804 satır
- **Hedef:** Her birini sorumluluk sınırlarına göre 2-3 dosyaya ayır.
- **Risk:** Orta.
- **Efor:** Orta-büyük.
- **Durum:** [ ]

---

## 🟡 P2 — Orta (hızlı, güvenli temizlik)

### 4. `console.log` denetimi (TUI bozma riski)
- **Sorun:** 45 `console.log`. TUI içinde `console.log` ekranı bozar.
- **DENETİM SONUCU (2026-06-28): TEMİZ — değişiklik gerekmiyor.**
  - `main.ts` (22): CLI çıktısı (usage/version/paket listesi), TUI öncesi → meşru.
  - `migrations.ts` (9): tek seferlik migration mesajları → meşru.
  - `model-resolver.ts` (3): `shouldPrintMessages` guard'lı startup mesajı → meşru.
  - `memory-mcp-server.ts` (2): **stdio MCP JSON-RPC protokolü, ZORUNLU** → dokunma.
  - `tools-manager.ts` (5): binary indirme bildirimleri, startup → meşru.
  - `cli/args.ts`, `cli/list-models.ts`: saf CLI çıktısı → meşru.
- **Sonuç:** Kaçak debug logu YOK. Risk artırmamak için bu madde kapatıldı.
- **Durum:** [x] İncelendi — temiz, aksiyon yok.

### 5. `setTimeout`/`sleep` denetimi — 49 kullanım
- **Sorun:** Çok sayıda timer = race condition'ı süreyle gizleme kokusu.
- **Hedef:** Her birini etiketle: meşru debounce mı, yoksa "UI otursun diye bekle" hack'i mi? Hack olanları event/promise tabanlı senkronizasyona çevir.
- **Risk:** Orta (davranış değişebilir).
- **Efor:** Orta.
- **Durum:** [ ]

### 6. Girinti tutarlılığı
- **Sorun:** QUAKE.md "2-space" diyor; bazı yerlerde tab/4-space karışık.
- **Hedef:** `biome check --write` ile tüm pakette tek tipe çek, sonra kuralı CI'da zorla.
- **Risk:** Çok düşük (sadece biçim).
- **Efor:** Küçük.
- **Durum:** [ ]

---

## 🟢 P3 — Düşük (özellik / cila)

### 7. Yeni slash komutları
- [ ] `/diff` — Oturumdaki dosya değişikliklerinin git özeti
- [ ] `/undo` — Son agent edit'ini geri al
- [ ] `/cost` — Token kullanımı + tahmini maliyet (model bazlı)
- [ ] `/retry` — Son kullanıcı mesajını farklı modelle tekrar dene
- [ ] `/pin` — Mesajı sabitle, compaction'da koru
- **Durum:** [ ]

### 8. UX iyileştirmeleri
- [ ] Slash komut fuzzy search
- [ ] Footer'da canlı token sayacı
- [ ] Komut/prompt geçmişi (Ctrl+R reverse search)
- [ ] `--help` çıktısını kategorize + renkli yap
- [ ] Yeni flag'ler: `--json-output`, `--quiet`
- **Durum:** [ ]

---

## ✅ İyi durumda olanlar (dokunma)
- Sadece **7 TODO/FIXME** — teknik borç düşük.
- Boş `catch {}` **yok** — hatalar yutulmuyor.
- `@ts-ignore` neredeyse yok (2 bilinçli `biome-ignore`).
- 27 slash komut, zengin TUI, mouse, memory sistemi çalışıyor.

---

## 📌 Önerilen başlangıç sırası
1. **P2.4 console.log** + **P2.6 girinti** → hızlı, güvenli, momentum kazandırır.
2. **P1.2 `any` avı** (ilk 5 dosya) → tip güvenliği somut artar.
3. **P0.1 interactive-mode refactor** → büyük iş, hazır olunca.
4. Kalanlar (P1.3, P2.5, P3) → fırsat buldukça.
