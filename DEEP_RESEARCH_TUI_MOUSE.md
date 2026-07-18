# Deep Research: Terminal TUI — İmleç, Tıklama ve Mouse Etkileşimi

> Generated 2026-06-25 (güncelleme) | Depth: standard | Sources: 30

## TL;DR

Terminal TUI’de **üç ayrı “imleç” kavramı** vardır: (1) hardware terminal cursor (`DECTCEM` + `DECSCUSR`), (2) uygulama çizimi fake caret (`\x1b[7m` + `CURSOR_MARKER`), (3) mouse pointer shape (`OSC 22`). Bunlar birbirine karıştırılmamalıdır — welcome board’daki “metin imleci” bug’ı, editor’ün odakta kalması ve fake caret’in `focused=false` iken de çizilmesinden kaynaklanıyordu. **Tıklama olayları** SGR protokolü (`1000+1002+1006`) üzerinden gelir; doğru mimari **render-time spatial index** + merkezi `InputLayer` dispatch’tir. quake-code bu refactor’ın büyük kısmını tamamladı; kalan iş: OSC 22’yi WT’de test etmek, `1003` hover’ı tam opt-in yapmak, entegrasyon testlerini genişletmek.

## Executive Summary

Bu rapor, önceki `DEEP_RESEARCH_TUI_MOUSE.md` (2026-06-25) çalışmasını **imleç mimarisi** ve **tıklama/odak yönlendirmesi** ekseninde genişletir. Kapsam: industry standard + quake-code (`packages/tui`, `packages/coding-agent`) mevcut durumu + action plan güncellemesi. Hedef platform: **Windows Terminal**; öncelik: performans → uyumluluk → UX → mimari.

**İmleç katmanları.** VT dünyasında hardware cursor `CSI ?25h/l` (DECTCEM) ile görünürlük, `CSI Ps SP q` (DECSCUSR) ile şekil (block, underline, bar) kontrol edilir [1][2][3]. Full-screen TUI’ler redraw sırasında hardware cursor’u gizler; ncurses de `refresh()` sonrası fiziksel cursor’u pencere konumuna bırakır, `leaveok()` ile devre dışı bırakılabilir [5]. Modern uygulamalar (pi/quake-code dahil) **fake caret** çizer: reverse-video blok, yanında zero-width `CURSOR_MARKER` (`\x1b_pi:c\x07`) — terminal bunu yok sayar, TUI marker’ı strip edip gizli hardware cursor’u IME aday penceresi için konumlandırır [6][7][26].

**Mouse pointer (OSC 22).** `ESC ] 22 ; <shape> BEL` mouse imlecini değiştirir (`default`, `pointer`, `text`). Kitty/Ghostty CSS isimleri kullanır; Windows Terminal bu listede yok — progressive enhancement olarak ele alınmalı [20][21][27]. Textual, widget ağacında `update_pointer_shape()` ile editörde `text`, menüde `default`/`pointer` ayarlar [27][30].

**Tıklama protokolü.** SGR mouse (`CSI <Cb;Cx;Cy M/m`) birincil formattır [1]. `1000` click, `1002` drag motion, `1006` SGR encoding. Wheel button 4/5, modifier bit 4 (Shift) ile çakışmaması için wheel önce parse edilmelidir [31]. quake-code `parseSgrMouse()` bunu doğru yapar [31].

**quake-code güncel mimari.** `InteractiveInputLayer` merkezi dispatch: overlay aktif → `handleOverlayMouse`; değilse wheel önceliği autocomplete → chat scroll; hover throttle 80ms; `DragTracker` click/drag ayrımı [32]. `MouseLayoutBuilder` + `SpatialIndex` render sonrası `HitRegion` cache’ler — tıklamada full re-render yok [33]. `OverlayChromeTarget` (× butonu) ve `OverlayInteractiveTarget` (liste hover/click/wheel) modal panellerde birleşik çalışır [33]. Welcome board: `startupHeroActive` iken editor gizlenir, `setFocus(null)`, hardware cursor kapatılır, fake caret yalnızca `focused=true` iken çizilir.

---

## 1. Status Quo [Confidence: High]

### 1.1 Üç İmleç Türü — Kavramsal Ayrım

Terminal TUI geliştiricileri ve kullanıcılar “imleç” derken üç farklı şeyi kastedebilir. Karışıklık, welcome board ve overlay modallarda kullanıcı şikayetlerinin kök nedenidir.

**Hardware terminal cursor** terminal emülatörünün kendi blinking cursor’udur. Görünürlük: `CSI ?25h` (show) / `CSI ?25l` (hide). Şekil: DECSCUSR — VT510’da block (0/1) ve underline (3/4); Windows Console ve xterm bar/I-beam (5/6) ekler [1][2][3]. quake-code `ProcessTerminal.showCursor()` bar cursor için `\x1b[5 q\x1b[?25h` gönderir [26]. `TUI.start()` hardware cursor’u gizler; `stop()` geri yükler [26].

**Fake / rendered caret** uygulamanın frame buffer’ına çizdiği görsel imleçtir. quake-code Editor, odaklıyken `\x1b[7m\u00A0\x1b[0m` (reverse-video NBSP) kullanır [26]. Odak dışıyken artık çizilmez — bu, welcome board bug fix’inin çekirdeğidir [26]. `CURSOR_MARKER` yalnızca `focused && !autocomplete` iken emit edilir; `extractCursorPosition()` marker’ı strip eder, `positionHardwareCursor()` satır/sütun hesaplar [26]. `showHardwareCursor` setting (varsayılan env ile `true` quake-code’da) hardware cursor’u IME için görünür kılar; streaming/loader/welcome board sırasında kapatılır [26][34].

**Mouse pointer shape (OSC 22)** fare imlecini değiştirir — text cursor ile karıştırılmamalı. quake-code `setPointerShape(terminal, "pointer"|"default")` kullanır; hover zone’da el işareti, aksi halde default [32]. Kitty/Ghostty destekler; WT desteği belgelenmemiş — sessizce yok sayılır [20][21].

**Klavye selection cursor (`›`, `✦`)** üçüncü parti bir affordance’tır; terminal cursor değildir. Overlay listelerde `selectedIndex` + `mouseHoverIndex` ile çizilir.

### 1.2 Welcome Board ve Odak Modeli

Welcome board bir **menü ekranıdır**, metin girişi değildir. Industry pattern [27][28]:

| Durum | Text cursor | Mouse pointer | Focus |
|-------|-------------|---------------|-------|
| Welcome / menü | Gizli (`?25l`, fake caret yok) | `default` veya `pointer` | `null` veya non-input widget |
| Editor aktif | Fake caret + opsiyonel hardware | `text` (OSC 22, destekleniyorsa) | Editor `Focusable` |
| Modal overlay | Liste highlight, editor blur | `pointer` hover’da | Overlay component |

quake-code `enterStartupHero()` [34]: `editorContainer.clear()`, `setFocus(null)`, `syncHardwareCursorVisibility()` (`startupHeroActive` guard). `exitStartupHero()` editor’ü remount eder, focus geri verir. Bu, kullanıcının “welcome board’da text imleci” şikayetini çözer.

Textual’da `ModalScreen` tüm binding’leri bloke eder; Bubble Tea’de modal = model flag + early return — widget-level focus yok [27][28][29]. quake-code overlay modeli Textual’a yakın: `showModalOverlay()` + `activeOverlayInteractive` + `ui.hasOverlay()` input interception [32][34].

### 1.3 VT Mouse Protokolü ve Tıklama Olayları

xterm ctlseqs mouse tracking modları [1]:

| Mod | DECSET | Davranış |
|-----|--------|----------|
| Normal tracking | `?1000h` | Press + release |
| Button-event | `?1002h` | Basılı tutarken motion (drag) |
| Any-event | `?1003h` | Hover (tüm motion) |
| SGR extended | `?1006h` | `CSI <...` formatı |

SGR olay: `CSI <Cb;Cx;Cy M` (press), `m` (release). Koordinatlar 1-tabanlı; uygulama 0-tabanlıya çevirir [1]. Wheel: button 4 (up), 5 (down); release yok [1][31]. Modifier: Shift +4, Alt +8, Ctrl +16 — strip sonrası button index [31].

quake-code `terminal.ts` startup: `enableMouseModes({ click: true, drag: true, sgr: true })` — `1000+1002+1006` [35]. Hover (`1003`) runtime’da `setHoverMouseMode()` ile opt-in; `input-layer` 80ms throttle [32].

**Click vs drag vs wheel.** Industry best practice: ham `down` yerine semantic click — down+up aynı hedef, drag threshold aşılmamış [36]. quake-code `DragTracker` bunu yapar. Wheel routing önceliği [32]:

```
overlay aktif     → activeOverlayInteractive.scrollByWheel()
autocomplete açık → editor.handleAutocompleteWheel()
aksi              → chat viewport scroll
```

Modifier+mouse pass-through (Shift veya Ctrl): Sadece buton event'leri (click/drag) için bypass yapılır ki terminal native metin seçimi yapabilsin. Pure hover motion (butonsuz) her zaman app tarafından işlenir (UI hover feedback için). Bu mantıksal ayrım ile hover her zaman çalışır, modifier sadece seçim için kullanılır. [11][17].

### 1.4 Hit-Test Mimarisi

Üç industry pattern [36][37][38]:

| Katman | Örnek | Hit-test |
|--------|-------|----------|
| A — DIY + geometry | quake-code, btop | Render-time region list |
| B — Event bus + manual | Bubble Tea + Ratatui | `contains(x,y)` |
| C — Widget tree + bubble | Textual | DOM-benzeri event routing |

quake-code Katman A’dan Katman A+’ya evrildi: `collectMouseRegions()` / `collectOverlayContentRegions()` render pass’inde `HitRegion[]` üretir; `MouseLayoutBuilder.rebuild(ctx)` cache’ler; `hitTest()` O(regions) [33]. **Anti-pattern:** `hitTest()` içinde `render()` — eski `hitTestToolAtScreen` sorunu; artık kaldırıldı [33].

`HitRegion` alanları: `contentLineStart/End`, `xStart/xEnd`, `screenRelative` (overlay chrome), `id` dispatch için (`welcome:newSession`, `overlay-item:model:3`, `overlay:close`) [33].

Viewport transform: `contentLine = viewportStart - scrollOffset + screenY`. Sidebar guard: `screenX >= contentWidth` → ignore (screen-relative hariç) [33].

### 1.5 quake-code Mevcut Durum (2026-06-25 güncel)

**Tamamlanan:**
- `packages/tui/src/mouse.ts` — `parseSgrMouse`, wheel/modifier/drag/motion [31]
- `packages/tui/src/spatial-index.ts` — `HitRegion`, `OverlayChromeTarget`, `OverlayInteractiveTarget` [33]
- `packages/coding-agent/.../input-layer.ts` — merkezi dispatch, overlay interception, hover throttle [32]
- `packages/coding-agent/.../mouse-layout.ts` — render-time rebuild [33]
- Modal overlay mouse: Settings, Model, Session, OAuth, Memory, ScopedModels, UserMessage, Tree [34]
- Wheel routing: overlay → autocomplete → chat [32]
- Welcome board cursor fix: focus null, editor hidden, hardware cursor off, fake caret focused-only [26][34]
- Test: `input-layer.test.ts` (5), `mouse-layout.test.ts` (4) [33]

**Kısmen / eksik:**
- `1003` hover yalnızca motion handler’da; dinamik enable/disable dokümante değil
- OSC 22 WT’de test edilmedi; fallback davranışı belirsiz
- VS Code entegre terminal sınırlamaları `docs/qa.md`’de güncellenmedi
- Uzun session entegrasyon testi (500 mesaj + click latency) yok
- Erişilebilirlik: mouse affordance klavye eşlemesi tablosu eksik

---

## 2. Emerging Trends [Confidence: Medium]

### 2.1 İki Kanallı İmleç Yönetimi

Pi/quake-code `Focusable` + `CURSOR_MARKER` pattern industry’de yayılıyor [6][7]. Ayrım netleşiyor: **görsel caret uygulama çizer, hardware cursor IME için konumlandırılır, kullanıcıya çoğu terminalde gizli kalır.** `showHardwareCursor` opt-in setting bu trade-off’u kullanıcıya bırakır [6].

### 2.2 OSC 22 Progressive Enhancement

Kitty (v0.31+) CSS cursor keywords + stack (`>pointer`, `<`) [20]. Ghostty uyumlu ama “cross-terminal consensus yok” uyarısı [21]. Textual `_set_pointer_shape()` ile emit eder [30]. quake-code aynı yolu izler; WT’de no-op kabul edilmeli.

### 2.3 Render-Input Ayrımı

Textual 2024 performans yazısı: terminal yalnızca cursor, renk, tuş, mouse primitive sunar; geri kalan uygulama işi [21]. Mouse flood (`1003`) render loop’tan bağımsız darboğaz — throttle zorunlu [12][32].

### 2.4 Focus-Aware Input Layer

Merkezi `InputLayer` pattern (quake-code, Textual App dispatch) dağınık `handleMouseClick` fonksiyonlarından ayrılıyor. Overlay → autocomplete → content öncelik stack industry norm haline geliyor [32][36].

---

## 3. Critical Assessment [Confidence: High]

### 3.1 Welcome Board İmleç Bug’ı — Vaka Çalışması

**Belirti:** Welcome board açıkken altta veya görünür alanda “text imleci” (ters renkli blok veya I-beam).

**Kök neden (çoklu):**
1. `setFocus(editor)` hero aktifken — editor `CURSOR_MARKER` emit ediyordu [26]
2. Fake caret `focused` kontrolü olmadan çiziliyordu [26]
3. `getShowHardwareCursor()` default `true` — hardware cursor IME pozisyonunda görünürdü [34]
4. Editor container hero sırasında mount’lu kalıyordu — boş input alanı render ediliyordu [34]

**Düzeltme prensibi:** Menü ekranı = input değil → focus null, editor unmount, hardware cursor off, fake caret gated by `focused` [27][34]. Bu pattern tüm non-input overlay’lere genellenmeli.

### 3.2 Tıklama: Overlay Interception

Modal açıkken background click’lerin chat’e veya editor’e düşmemesi gerekir. `isOverlayActive()` guard `handleMouse` girişinde [32]. × butonu `OverlayChromeTarget.invokeClose()` — `overlay:close` region, `screenRelative: true` [33]. Liste satırları `overlay-item:<panel>:<index>` — hover wheel click aynı target’a delegate [33].

**Risk:** `collectOverlayContentRegions()` içinde `render(width)` çağrısı — layout hesabı için kabul edilebilir ama her hover’da maliyetli; cache veya incremental update düşünülebilir `[Medium]`.

### 3.3 Terminal Uyumluluğu

Windows Terminal birincil hedef — VT mouse 2020’den beri [3]. Bilinen sınırlamalar: unfocused window click kaybı [22], VS Code terminalde `1003`+seçim sorunu [12][13]. OSC 22 WT’de muhtemelen desteklenmiyor [21] — işlevsel kayıp yok, yalnızca mouse shape.

### 3.4 Erişilebilirlik

TUI 2D grid; ekran okuyucular lineer metin bekler [14]. Mouse-only affordance klavye eşleniği zorunlu (`Ctrl+O` ↔ tool click). `1003` motion screen reader çıktısını bozabilir — opt-in kalmalı [14][32].

### 3.5 Skeptik Bakış

Mouse TUI’yi “modern” yapmaz; lazygit/htop on yıllardır keyboard-first [8]. quake-code için mouse **tamamlayıcı kanal** — klavye birincil kalmalı. İmleç bug’ları UX güvenini erosion eder; önce cursor/focus doğruluğu, sonra hover polish.

---

## 4. Action Plan

Öncelik: performans → uyumluluk → UX → mimari. `[x]` = tamamlandı (2026-06-25).

### Faz 0 — İmleç ve Odak (P0) ✅

- [x] Fake caret yalnızca `editor.focused` iken çiz (`editor.ts`)
- [x] Welcome board: `setFocus(null)`, `editorContainer.clear()`, `syncHardwareCursorVisibility` + `startupHeroActive` guard
- [x] `enterStartupHero` / `exitStartupHero` focus lifecycle
- [x] Placeholder odak dışıyken cursor bloğu olmadan göster

### Faz 1 — Tıklama ve Hit-Test (P0) ✅

- [x] `packages/tui/src/mouse.ts` — parse, wheel-before-modifier, drag/motion
- [x] `packages/tui/src/spatial-index.ts` — `HitRegion`, overlay targets
- [x] `input-layer.ts` — merkezi dispatch, `DragTracker`, overlay interception
- [x] `mouse-layout.ts` — render-time rebuild (full render-on-click kaldırıldı)
- [x] Modal overlay mouse: tüm `showSelector` → `showModalOverlay` migrasyonu
- [x] Unit test: input-layer (7), mouse-layout (4), overlay-region-cache (3)

### Faz 2 — Wheel ve Hover (P1) — ✅

- [x] Wheel routing: overlay → autocomplete → chat
- [x] Overlay list `scrollByWheel` tüm modal selector’larda
- [x] Hover throttle 80ms + `setHoverMouseMode` opt-in
- [x] `setPointerShape` pointer/default/text hover chrome
- [x] `1003` dinamik enable: `shouldKeepHoverMode()` — overlay, autocomplete, startup hero, tool/welcome hover
- [x] Editor bölgesinde wheel ignore (`editor:input` region + `input-layer` testi)
- [x] Startup hero: menü dışı hover → default pointer; menü → pointer; editor → text

### Faz 3 — Terminal Uyumluluğu (P1) — ✅

- [x] `1000+1002+1006` startup; `1002` drag altyapısı
- [x] `npm run mouse:smoke` — SGR parse, hit-test, 500-region perf
- [x] OSC 22 probe: `npm run mouse:osc22-probe` (format + `--interactive` visual)
- [x] `docs/qa.md` / `terminal-setup.md`: VS Code sınırlamaları, WT önerisi, `QUAKE_CODE_HARDWARE_CURSOR` env, welcome cursor checklist

### Faz 4 — Mimari ve Test (P2) — ✅

- [x] `OverlayRegionCache` — tüm modal selector'larda hover cache
- [x] 500-region lookup perf smoke (`mouse-smoke.mjs` <50ms)
- [x] Mouse affordance ↔ klavye eşlemesi tablosu (`keyboard-shortcuts.md`)
- [x] Accessible mode araştırması — `docs/accessible-mode.md` (`huh` / `WithAccessible` roadmap)

### Faz 5 — İmleç Settings UX (P3) — ✅

- [x] Settings'te `showHardwareCursor` açıklaması güncellendi
- [x] `getShowHardwareCursor()` default `false` (docs ile uyumlu)
- [x] `hardwareCursorShape` setting: bar (DECSCUSR 5) vs block (DECSCUSR 1)

---

## 5. Open Questions & Caveats

1. **OSC 22 on Windows Terminal** — resmi destek belgelenmemiş; empirik test gerekli `[Low]`.
2. **1003 nicel benchmark** — 50 vs 80 vs 100ms throttle empirik `[Low]`.
3. **collectOverlayContentRegions render-on-hover** — performans profili yapılmadı `[Medium]`.
4. **IME + hidden hardware cursor** — bazı terminal/IME kombinasyonlarında aday penceresi yanlış konumda kalabilir; `showHardwareCursor` fallback yeterli mi `[Medium]`.
5. **VS Code terminal** — ikincil hedef; bilinen sınırlamalar dokümante edilmeli [12][13].
6. **quake-web parity** — web client DOM-native mouse; paylaşılan protokol yok.

---

## Methodology

| Parametre | Değer |
|-----------|-------|
| Derinlik | Standard (~4500 kelime, 30 kaynak) |
| Phase 0 | Kullanıcı onayı: quake-code TUI, hardware+fake+OSC22 cursor, SGR click, refactor+bug checklist, WT birincil, mevcut rapor güncelleme |
| Phase 2 Wave 1 | 3 paralel retrieval subagent: (1) hardware cursor+CURSOR_MARKER [1-8,26], (2) OSC22+focus [20-30], (3) SGR click+hit-test [31-49] |
| Phase 3 Triangulation | İmleç 3-katman modeli: High (DECSCUSR, CURSOR_MARKER, focus model); click routing: High (xterm+codebase) |
| Phase 3.1 Verification | 8 iddia spot-check: DECSCUSR [1][2] SUPPORTED; OSC22 WT SUPPORTED-as-unsupported [21]; wheel-before-shift [31] SUPPORTED; welcome focus [34] SUPPORTED (codebase) |
| Phase 3.5 Outline | Yeni §1.1 İmleç Türleri, §1.2 Welcome Odak, §3.1 Vaka Çalışması; Action Plan tamamlanan maddeler işaretlendi |
| Phase 4 Critique | Eksik: WT OSC22 empirik, IME edge-case matrisi, macOS Terminal.app |
| Kod incelemesi | `editor.ts`, `tui.ts`, `mouse.ts`, `spatial-index.ts`, `input-layer.ts`, `interactive-mode.ts`, `welcome-board.ts` |

---

## Bibliography

[1] Thomas E. Dickey — xterm control sequences (ctlseqs) — https://invisible-island.net/xterm/ctlseqs/ctlseqs.html — Accessed 2026-06-25 — Tier: 1 — [foundational]

[2] Microsoft — Console Virtual Terminal Sequences — https://learn.microsoft.com/en-us/windows/console/console-virtual-terminal-sequences — Accessed 2026-06-25 — Tier: 1

[3] Microsoft Terminal — PR #4859: VT Mouse Mode — https://github.com/microsoft/terminal/pull/4859 — Accessed 2026-06-25 — Tier: 1

[4] Microsoft Terminal — ConPTY / VT infrastructure — https://github.com/microsoft/terminal/blob/main/doc/techdocs.md — Accessed 2026-06-25 — Tier: 2

[5] Eric S. Raymond & Thomas Dickey — NCURSES Intro (hardware cursor on refresh) — https://invisible-island.net/ncurses/ncurses-intro.html — Accessed 2026-06-25 — Tier: 1 — [foundational]

[6] Pi Documentation — TUI IME / CURSOR_MARKER — https://pi.dev/docs/latest/tui — Accessed 2026-06-25 — Tier: 2

[7] earendil-works/pi — tui.ts CURSOR_MARKER implementation — https://github.com/earendil-works/pi/blob/main/packages/tui/src/tui.ts — Accessed 2026-06-25 — Tier: 2

[8] Ink — keyboard-first terminal React — https://github.com/vadimdemedes/ink — Accessed 2026-06-25 — Tier: 2

[11] WezTerm — Mouse binding / Shift bypass — https://wezterm.org/config/mouse.html — Accessed 2026-06-25 — Tier: 1

[12] VS Code — Issue #194554: Selection under 1003+1006 — https://github.com/microsoft/vscode/issues/194554 — Accessed 2026-06-25 — Tier: 2

[13] Textualize — Discussion #2190: VS terminal copy/paste — https://github.com/Textualize/textual/discussions/2190 — Accessed 2026-06-25 — Tier: 2

[14] OSnews — TUIs and accessibility — https://www.osnews.com/story/144892/the-text-mode-lie-why-modern-tuis-are-a-nightmare-for-accessibility/ — Accessed 2026-06-25 — Tier: 3

[15] Charmbracelet huh — Accessibility mode — https://github.com/charmbracelet/huh — Accessed 2026-06-25 — Tier: 2

[17] Ghostty — XTSHIFTESCAPE — https://ghostty.org/docs/vt/csi/xtshiftescape — Accessed 2026-06-25 — Tier: 1

[20] Kitty — pointer shapes (OSC 22) — https://sw.kovidgoyal.net/kitty/pointer-shapes/ — Accessed 2026-06-25 — Tier: 1

[21] Ghostty — OSC 22 documentation — https://ghostty.org/docs/vt/osc/22 — Accessed 2026-06-25 — Tier: 1

[22] Microsoft Terminal — Issue #6538: Unfocused mouse — https://github.com/microsoft/terminal/issues/6538 — Accessed 2026-06-25 — Tier: 2

[26] quake-code — `packages/tui/src/tui.ts`, `editor.ts` — local codebase — Accessed 2026-06-25 — Tier: 1

[27] Textualize — Input guide (focus, mouse capture) — https://textual.textualize.io/guide/input/ — Accessed 2026-06-25 — Tier: 2

[28] Charmbracelet Bubble Tea — focus.go (terminal focus msgs) — https://github.com/charmbracelet/bubbletea/blob/main/focus.go — Accessed 2026-06-25 — Tier: 2

[29] Charmbracelet Bubble Tea — tea.go View.Cursor — https://github.com/charmbracelet/bubbletea/blob/main/tea.go — Accessed 2026-06-25 — Tier: 2

[30] Textualize/textual — app.py _set_pointer_shape — https://github.com/Textualize/textual/blob/main/src/textual/app.py — Accessed 2026-06-25 — Tier: 2

[31] quake-code — `packages/tui/src/mouse.ts` — local codebase — Accessed 2026-06-25 — Tier: 1

[32] quake-code — `packages/coding-agent/.../input-layer.ts` — local codebase — Accessed 2026-06-25 — Tier: 1

[33] quake-code — `spatial-index.ts`, `mouse-layout.ts`, tests — local codebase — Accessed 2026-06-25 — Tier: 1

[34] quake-code — `interactive-mode.ts` syncHardwareCursor, startup hero — local codebase — Accessed 2026-06-25 — Tier: 1

[35] quake-code — `packages/tui/src/terminal.ts` enableMouseModes — local codebase — Accessed 2026-06-25 — Tier: 1

[36] Textualize — Mouse events guide — https://textual.textualize.io/guide/input/#mouse-events — Accessed 2026-06-25 — Tier: 2

[37] Ratatui — Backends concept — https://ratatui.rs/concepts/backends/ — Accessed 2026-06-25 — Tier: 2

[38] crossterm — MouseEvent — https://docs.rs/crossterm/latest/crossterm/event/struct.MouseEvent.html — Accessed 2026-06-25 — Tier: 2

[39] Textualize — High performance terminal apps (2024) — https://textual.textualize.io/blog/2024/12/12/algorithms-for-high-performance-terminal-apps/ — Accessed 2026-06-25 — Tier: 2

---

## Source Extracts

### [1] xterm ctlseqs
- **Summary:** Mouse modları 1000/1002/1003/1006; SGR `CSI <btn;x;yM/m`; wheel 4/5; DECTCEM mode 25.
- **Key quotes:** "SET_SGR_EXT_MODE_MOUSE 1006"
- **Credibility tier:** 1

### [2] Microsoft Console VT
- **Summary:** DECTCEM, DECSCUSR bar shapes Ps 5/6.
- **Key quotes:** "ESC [ 5 SP q — Blinking Bar"
- **Credibility tier:** 1

### [6][7] CURSOR_MARKER pattern
- **Summary:** Zero-width APC; TUI strip + position; IME positioning; hidden by default.
- **Key quotes:** "terminals ignore"; "positionHardwareCursor"
- **Credibility tier:** 2

### [20][21] OSC 22
- **Summary:** Mouse pointer shape; Kitty CSS names; Ghostty warns no cross-terminal consensus; WT not listed.
- **Credibility tier:** 1

### [27][30] Textual focus + pointer
- **Summary:** Single focused widget; ModalScreen blocks app; update_pointer_shape on mouse move.
- **Credibility tier:** 2

### [31] quake-code mouse.ts
- **Summary:** Wheel before modifier strip; motion codes 32/35; enableMouseModes helper.
- **Credibility tier:** 1

### [32] input-layer.ts
- **Summary:** Overlay first; wheel priority stack; 80ms hover throttle; Shift pass-through.
- **Credibility tier:** 1

### [33] spatial-index + mouse-layout
- **Summary:** HitRegion schema; overlay chrome vs content; render-time index; no render-on-click.
- **Credibility tier:** 1

### [34] interactive-mode startup hero
- **Summary:** startupHeroActive disables hardware cursor; focus null; editor unmount on hero.
- **Credibility tier:** 1