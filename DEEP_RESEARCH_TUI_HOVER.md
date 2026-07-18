# Deep Research: TUI Mouse Hover — Neden Çalışmıyor?

> Generated 2026-06-25 | Depth: standard | Sources: 15+

## TL;DR

Hover görsel geri bildirimi (altı çizili tool satırı, overlay liste highlight, `/` autocomplete) **xterm mode `1003` (all-motion)** gerektirir. Terminal, `1003` kapalıyken fare hareketi göndermez. quake-code `1003`'ü yalnızca ilk motion event'inden *sonra* açıyordu — bu **tavuk-yumurta döngüsü** hover'ı tamamen kırıyordu. Düzeltme: `syncHoverTracking()` ile overlay/autocomplete/hero **ve** viewport'ta hover hedefi varken `1003` proaktif açılır. VS Code entegre terminalinde ek olarak Shift-select + `1003+1006` bilinen kısıtları vardır.

---

## 1. Kök Neden: 1003 Chicken-and-Egg [Confidence: High]

### Protokol

| Mod | DECSET | Davranış |
|-----|--------|----------|
| Click | `?1000h` | Press + release |
| Button-event | `?1002h` | Basılı tutarken motion (drag) |
| **Any-event** | **`?1003h`** | **Hover — düğme basılı olmadan tüm motion** |
| SGR | `?1006h` | `CSI <Cb;Cx;Cy M/m` formatı |

Kaynak: [xterm ctlseqs — Any-event tracking](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html)

### Döngü

```
Uygulama: "İlk motion gelince 1003 açarım"
Terminal: "1003 kapalıyken motion göndermem"
→ Hover hiç başlamaz
```

### quake-code önceki durum

- Startup: `1000+1002+1006` (`packages/tui/src/terminal.ts`) — **1003 yok**
- `setHoverMouseMode(true)` yalnızca `updateHoverChrome()` içinde, motion handler'dan sonra
- Overlay/autocomplete için `shouldKeepHoverMode()` true olsa bile `updateHoverChrome()` motion olmadan çağrılmıyordu
- Normal chat'te tool satırı hover: hiçbir proaktif enable yok

### Düzeltme (2026-06-25)

`InteractiveInputLayer.syncHoverTracking()`:

- Her render sonrası (`afterRender` listener)
- Overlay açılış/kapanış
- `hasHoverTargets()` — tool/welcome/autocomplete/overlay-item region varsa
- İlk mouse down (bootstrap)

---

## 2. Hover Pipeline (End-to-End)

```
Terminal 1003 ON
  → CSI <35;x;yM  (pure motion, button=35)
  → parseSgrMouse() → type: "motion"
  → InteractiveInputLayer.handleHoverMotion() [80ms throttle]
  → SpatialIndex.hitTest(x, y)
  → setHoveredTool / setHoveredOverlayItem / setAutocompleteMouseHover
  → requestRender()
  → Component render (applyMouseHoverStyle / theme.hoverText)
```

### Motion button kodları [Confidence: High]

SGR motion: raw button `32` (btn0+motion), `34` (btn2+motion), **`35` (no button + motion = hover)**

Kaynak: [charmbracelet/x ansi/mouse.go](https://github.com/charmbracelet/x/blob/main/ansi/mouse.go)

quake-code `mouse.ts` satır 107: `32 | 35 | 34` → `type: "motion"` ✓

---

## 3. İkincil Bug: Overlay Hit-Test + Scroll [Confidence: High]

`SpatialIndex.hitTest()` screen-relative overlay region'lar için `screenY - scrollOffset` kullanıyordu. Overlay satırları viewport satırıdır; chat scroll offset uygulanmamalı.

**Düzeltme:** `screenRelative ? screenY : contentLine`

---

## 4. Terminal Matrisi

| Terminal | 1003 hover | Shift-select + 1003 | Not |
|----------|------------|---------------------|-----|
| **Windows Terminal** | ✅ | ✅ (Shift bypass) | Birincil hedef |
| WezTerm / Ghostty | ✅ | ✅ | Tam destek |
| **VS Code integrated** | ⚠️ | ❌/⚠️ | [#194554](https://github.com/microsoft/vscode/issues/194554) — `1003+1006` ile seçim motion'da silinir |
| VS Code aux window | ⚠️ | — | [#202410](https://github.com/microsoft/vscode/issues/202410) — click/drag eksik |

### VS Code özel durum

- Textual gibi `1003` kullanan uygulamalarda Shift+select copy güvenilmez ([textual#2190](https://github.com/Textualize/textual/discussions/2190))
- quake-code mitigation: `1003` opt-in, 80ms throttle, Shift pass-through (`input-layer.ts` line 90)
- **Hover VS Code'da çalışsa bile görsel underline seçimle çakışabilir**

---

## 5. Industry Karşılaştırma

| Yaklaşım | Örnek | 1003 |
|----------|-------|------|
| Always-on hover | Textual (`linux_driver.py`) | Startup'ta `?1003h` |
| Zone + cell motion | bubblezone | `1002` (drag), hover sınırlı |
| Opt-in proactive | **quake-code (yeni)** | UI state + hover targets |
| Opt-in reactive (eski) | quake-code (bug) | Motion sonrası — **kırık** |

Textual FAQ: Shift basılı tutarak native seçim — https://textual.textualize.io/FAQ/

---

## 6. Hangi Yüzeyler Hover Destekler?

| Yüzey | Görsel | Region ID | 1003 proaktif? |
|-------|--------|-----------|----------------|
| Tool `◇` satırı | underline | `tool:*` | ✅ hasHoverTargets |
| Welcome menü | bold/hover style | `welcome:*` | ✅ startup hero |
| `/` autocomplete | underline/accent | `autocomplete:*` | ✅ editor + autocomplete active |
| Modal liste | underline + `›` | `overlay-item:*` | ✅ overlay active |
| × kapat | pointer shape | `overlay:close` | ✅ overlay active |
| Editor kutusu | OSC 22 text | `editor:input` | ✅ hasHoverTargets |

---

## 7. QA Checklist (Hover)

Windows Terminal'de:

- [ ] Tool `◇` satırı üzerine gel → underline görünür, ayrılınca kaybolur
- [ ] `/` yaz → dropdown açıkken satır hover → highlight
- [ ] `/settings` veya model selector → liste satırı hover → underline
- [ ] Welcome board menü satırı hover → vurgu
- [ ] Chat scroll yukarıdayken overlay açık → hover hâlâ doğru satırda

VS Code'da (bilinen sınırlamalar):

- [ ] Hover çalışıyor mu? (1003 proaktif sonrası test et)
- [ ] Shift+drag seçim çalışıyor mu? (1003 kapalıyken daha iyi)

---

## 8. Kaynaklar

1. https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
2. https://github.com/microsoft/vscode/issues/194554
3. https://github.com/microsoft/vscode/issues/202410
4. https://github.com/Textualize/textual/discussions/2190
5. https://textual.textualize.io/FAQ/
6. https://github.com/microsoft/terminal/issues/15977
7. https://github.com/microsoft/terminal/issues/18712
8. https://github.com/charmbracelet/x/blob/main/ansi/mouse.go
9. https://github.com/lrstanley/bubblezone
10. quake-code: `input-layer.ts`, `mouse.ts`, `spatial-index.ts`, `mouse-layout.ts`