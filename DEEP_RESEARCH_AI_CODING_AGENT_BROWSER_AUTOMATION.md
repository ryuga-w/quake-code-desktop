# Deep Research: AI Coding Agent'lerde Browser Element Bulma Stratejileri
> Generated 2026-06-26 | Depth: Deep | Sources: 23

## TL;DR

AI coding agent'lar (Codex Desktop, Cursor, Claude Code, Windsurf) web sayfalarında element bulmak için 3 ana strateji kullanıyor: **(1) Accessibility Tree (ARIA snapshot)** — Playwright'ın `page.ariaSnapshot()` API'si ile YAML formatında erişilebilirlik ağacı çıkarılır, LLM `[ref=eN]` ile elemente referans verir (Playwright MCP, Cursor); **(2) DOM Injection + Bounding Box** — sayfaya JavaScript enjekte edilerek interaktif elementler tespit edilir, numaralandırılır, screenshot üzerine işlenir (WebVoyager, Browser-Use); **(3) Vision/Coordinate** — screenshot alınır, LLM görsel olarak elementin koordinatını çıkarır, fare tıklaması yapılır (Anthropic Computer Use). **Accessibility tree yaklaşımı en güvenilir** olarak öne çıkarken, Quake sisteminde halihazırda kullanılan DOM-query yaklaşımı (hardcoded CSS selector) ARIA rolleri ve görünmez elementler konusunda zayıf kalıyor. En kritik iyileştirme: Playwright'ın accessibility snapshot'ına geçiş yapmak.

---

## Executive Summary

Bu araştırma, AI coding agent'ların kullanıcı manuel annotation'ı olmadan web sayfalarındaki elementleri nasıl bulduğunu, hangi teknikleri kullandığını ve bu tekniklerin Quake sistemine nasıl entegre edilebileceğini kapsamlı olarak incelemektedir.

**Ana bulgular:**

1. **Codex Desktop (Cosine)** — Chrome DevTools Protocol (CDP) üzerinden sekiz browser tool'u sunar (`browser_navigate`, `browser_click`, `browser_fill`, `browser_evaluate`, `browser_screenshot`). Element bulma tamamen AI'nın CDP JavaScript execution + screenshot görsel geri bildirim kombinasyonuna dayanır. Kullanıcı onayı zorunludur. [1][2][3]

2. **Cursor** — En gelişmiş browser tool'una sahip. Playwright MCP tabanlı çalışır. Design Mode (v3.7+) ile kullanıcı görsel olarak element seçebilir, voice input kullanabilir. Accessibility snapshot (ARIA tree) kullanır. Screenshot'lar doğrudan LLM'e görsel olarak beslenir. [4][5][6]

3. **Windsurf/Devin Desktop** — Legacy Cascade agent'ında "Send element" butonu ile görsel element seçimi vardır (DOM element selector). Devin Local agent ise henüz browser preview desteği sunmaz. [7][8]

4. **Claude Code (Anthropic)** — İki ayrı sistem sunar: (a) **Computer Use**: screenshot → vision → coordinate-based tıklama (Xvfb + Docker içinde çalışır, WebArena benchmark'ında state-of-the-art); (b) **Browser Tool**: Playwright tabanlı, DOM ve accessibility tree üzerinden çalışır, screenshot-based değildir. Anthropic'in kendi araştırması: grid overlay, tiling, resize algorithm'larının hiçbiri tutarlı iyileştirme sağlamamıştır. En büyük optimizasyon: screenshot'ları 1280×720'ye pre-downscale etmek. [9][10][11][12][13][14][15]

5. **Element Location Paradigmaları** — Üç ana yaklaşım: (a) **Accessibility Tree** (Playwright YAML snapshot — en güvenilir, LLM-friendly); (b) **DOM Injection + Numbered Boxes** (WebVoyager, Browser-Use — Set-of-Mark benzeri); (c) **Raw DOM HTML** (Mind2Web — en düşük başarı oranı ~%52 element accuracy). [16][17][18][19][20][21][22]

6. **Quake Sistemi İçin** — Mevcut DOM-query yaklaşımı (`document.querySelectorAll("a,button,input,...")`) ARIA rolleri ve `role="button"` gibi modern erişilebilirlik pattern'lerini kaçırıyor. Playwright'ın `page.accessibility.snapshot()` veya `page.ariaSnapshot(mode:"ai")` API'sine geçiş önerilir. [23]

---

## 1. Current Approaches: AI Coding Agent'lerde Browser Automation [High]

### 1.1 Codex Desktop (Cosine)

Cosine Desktop/CLI, browser otomasyonu için **Chrome DevTools Protocol (CDP)** kullanır. Kullanıcının Chrome'u `--remote-debugging-port=9222` ile başlatması gerekir. Cosine sekiz programatik tool sunar: `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_fill`, `browser_evaluate`, `browser_get_text`, `browser_scroll`, `browser_wait`. [1]

**Element bulma stratejisi:** Cosine, accessibility snapshot veya DOM tree kullanmaz. Element bulma tamamen AI'nın muhakemesine dayanır:
- AI, `browser_evaluate` ile JavaScript çalıştırarak DOM'u sorgular
- `browser_screenshot` ile sayfanın görsel durumunu alır
- AI, screenshot + DOM verisini birleştirerek elementin nasıl bulunacağına karar verir
- CDP üzerinden doğrudan JavaScript evaluation ile element'e erişir

Cosine'in Desktop uygulamasında built-in browser paneli vardır, MCP sunucuları ile browser otomasyonu birleştirilebilir. Tüm aksiyonlar varsayılan olarak kullanıcı onayı gerektirir. [2][3]

### 1.2 Cursor AI

Cursor, browser otomasyonu konusunda en gelişmiş IDE agent'ıdır. **Playwright MCP** tabanlı çalışır ve şu tool'ları sunar: navigate, click, type, scroll, screenshot, console log okuma, network traffic monitoring, fill form, press key, tabs, hover, drag, drop, file upload, handle dialog, navigate back, resize, run code unsafe. [4][6]

**Design Mode (v3.7+, Haziran 2026):** Kullanıcıların görsel olarak element seçmesini sağlar:
- Sayfada elementlere tıklayarak multi-select yapabilir
- Voice input ile değişiklikleri anlatabilir
- "Cursor sees the selected elements, their code, the surrounding layout, and the visual relationships on the page." [5]
- Seçilen elementler doğrudan kaynak kod değişikliklerine çevrilir

**Element location stratejisi:** Cursor, Playwright'ın accessibility snapshot'ını kullanır. Screenshot'lar doğrudan model'e görsel olarak beslenir ("Agent actually sees the browser state as images rather than relying on text descriptions"). Enterprise admin kontrolleri ile izin verilen origin'ler kısıtlanabilir. [4]

**Accessibility snapshot kullanımı:** Snapshot, YAML formatında bir erişilebilirlik ağacıdır. Elementler `[ref=eN]` ile etiketlenir, action tool'ları `target` parametresi olarak bu ref'i alır. Örneğin:

```yaml
- navigation [ref=e3]:
  - link "Gmail" [ref=e8] [cursor=pointer]
  - button "Google uygulamaları" [ref=e13]
- search [ref=e34]:
  - combobox "Ara" [active] [ref=e46]
```

### 1.3 Windsurf / Devin Desktop

Windsurf (Cognition AI tarafından satın alındı, şimdi Devin Desktop) iki farklı agent sunar: **Cascade Agent** (legacy) ve **Devin Local Agent** (next-gen). [7][8]

**Cascade Agent:** Browser preview'ı destekler. "Send element" butonu ile kullanıcı görsel olarak element seçer, seçilen element Cascade prompt'una `@mention` olarak eklenir. Console error'ları otomatik yakalanır. DOM element selector tool'u çalışır.

**Devin Local Agent:** Browser preview ve DOM element selector tool'unu **henüz desteklemez**. Cascade'e göre ~%30 daha az token kullanır, subagent ve sandboxing desteği sunar. [8]

### 1.4 Claude Code (Anthropic)

Claude Code iki farklı browser interaction mekanizması sunar: [9][12][19]

**Computer Use (Beta):** Screenshot → vision → coordinate döngüsü ile çalışır:
1. Xvfb sanal X11 display + Mutter window manager + Tint2 panel içeren Docker container
2. Claude, container'ın screenshot'ını alır, görsel olarak analiz eder
3. Koordinat tabanlı mouse/keyboard aksiyonları döndürür (`computer_mouse_click(x, y)`)
4. Host uygulama bu aksiyonları container'da çalıştırır, yeni screenshot alır
5. WebArena benchmark'ında single-agent sistemler arasında state-of-the-art sonuç [9]

**En iyi pratikler (Anthropic, Mayıs 2026):** [10][14]
- Screenshot'ları 1280×720'ye pre-downscale etmek en büyük optimizasyon
- Grid overlay, image tiling, resize algorithm'larının hiçbirinden tutarlı iyileşme görülmemiş
- Küçük hedefler (checkbox, icon) coordinate accuracy'yi ciddi düşürüyor → zoom veya keyboard alternatifleri önerilir
- Medium thinking effort 4.6 modelleri için ideal, High ise Opus 4.7 için önerilir

**Browser Tool:** Computer Use'dan farklı olarak, Claude Code'un browser tool'u Playwright (headless Chromium) kullanır. DOM ve accessibility tree üzerinden çalışır, screenshot gerekmez. Elementleri text, role ve diğer yapısal selector'lar ile bulur. [12]

Set-of-Mark (SoM) prompting (Microsoft Research): Alphanumeric mark'ların screenshot üzerine overlay edilmesi tekniğidir. GPT-4V ile SoM, RefCOCOg benchmark'ında fully-finetuned modelleri geçmiştir. Ancak Anthropic'in computer use testlerinde grid overlay'den tutarlı iyileşme görülmemiştir. [15]

### 1.5 GitHub Copilot

GitHub Copilot'un **built-in browser preview veya element selection özelliği yoktur**. Agent mode kod düzenleme ve terminal komutları çalıştırabilir, ancak browser interaction built-in bir yetenek değildir. Copilot'a entegre edilen üçüncü taraf Codex ve Claude agent'ları bu özelliği ayrıca sağlayabilir.

---

## 2. Element Location Stratejileri: Teknik Derinlemesine [High]

### 2.1 Accessibility Tree (ARIA Snapshot) — En Güvenilir Yöntem

Playwright'ın accessibility snapshot'ı, Chrome'un CDP `Accessibility.getFullAXTree` komutunu kullanarak sayfanın erişilebilirlik ağacını çıkarır. Her AXNode şu alanları içerir: [16][17][18]

- `role` — button, link, combobox, heading, generic, vb.
- `name` — accessible name (aria-label, alt text, inner text'ten hesaplanır)
- `description` — accessible description
- `value` — slider değeri gibi
- `properties` — checked, disabled, expanded, level, vb.
- `childIds`, `parentId` — ağaç yapısı
- `backendDOMNodeId` — DOM node'u ile eşleme
- `frameId` — cross-origin iframe'ler için

**YAML formatı (Playwright v1.59+ `page.ariaSnapshot(mode: "ai")`):** [17][18]

```yaml
- heading "todos" [level=1]:
  - textbox "What needs to be done?" [ref=e5]
  - list:
    - listitem [ref=e9]:
      - checkbox "Toggle Todo" [ref=e10] [box=120,340,20,20]
      - text: "Buy groceries"
```

Özellikler:
- `[ref=eN]` — LLM'in action tool'larında kullanacağı element referansı
- `[box=x,y,w,h]` — `boxes:true` ile CSS viewport koordinatları (Playwright v1.60+)
- `[cursor=pointer]` — interaktif element işareti
- `[active]` — odaklanmış element
- `ignored` node'lar varsayılan olarak dışlanır

**Playwright'ın 7 built-in locator stratejisi:** [11]
| Locator | Kullanım | Önerilen |
|---------|----------|----------|
| `getByRole` | `page.getByRole('button', { name: 'Submit' })` | **Birincil** — W3C ARIA uyumlu |
| `getByText` | Non-interactive elementler için (div, span, p) | İnteraktif olmayanlar |
| `getByLabel` | Form alanları için | İkincil |
| `getByPlaceholder` | Input placeholder | İkincil |
| `getByAltText` | Görseller için | İkincil |
| `getByTitle` | Title attribute | İkincil |
| `getByTestId` | Test ID'leri | Test amaçlı |

> "We recommend prioritizing user-facing attributes and explicit contracts such as page.getByRole(). Role locators reflect how users and assistive technology perceive the page." — Playwright Docs [11]

### 2.2 DOM Injection + Numbered Bounding Boxes (Set-of-Mark Yaklaşımı)

WebVoyager ve Browser-Use'in kullandığı yöntem: [19][22]

1. Sayfaya JavaScript enjekte edilir
2. `document.querySelectorAll('*')` taranır, interaktif elementler filtrelenir:
   - Tag bazında: `INPUT, TEXTAREA, SELECT, BUTTON, A, IFRAME, VIDEO, LI, TD, OPTION`
   - Stil bazında: `onclick != null` veya `cursor == "pointer"`
   - Alan filtresi: `area >= 20` piksel
   - Deduplikasyon: buton/link içindeki child elementler çıkarılır
3. Her elemente **numaralı bounding box** overlay'i yapılır (renkli dashed outline)
4. Screenshot alınır (numaralar görünür halde)
5. Text index oluşturulur: `[0]: <button> "Submit"`, `[1]: <input> "query"`

**Browser-Use'un daha gelişmiş versiyonu:** [22]
- `DOMSnapshot.captureSnapshot` — computed stiller, DOM rectangles, paint order
- `Accessibility.getFullAXTree` — tüm frame'lerden accessibility tree
- `DOM.getDocument` — full DOM tree
- `Page.getLayoutMetrics` — high-DPI detection
- `ClickableElementDetector` — tag, ARIA role, JS event listener, onclick attribute bazlı

### 2.3 Vision/Coordinate (Computer Use)

Anthropic'in computer use yaklaşımı: screenshot → LLM vision → coordinate: [9][10]

- Hiçbir yapısal bilgi (DOM, AX tree) kullanılmaz
- LLM, screenshot üzerinden elementin pixel koordinatını tahmin eder
- Mouse click/hover/keyboard aksiyonları koordinat bazında çalıştırılır
- **Dezavantaj:** Küçük elementlerde (checkbox, icon) accuracy düşer
- **Avantaj:** Her türlü uygulamada çalışır (native, web, terminal)

### 2.4 Yaklaşımların Karşılaştırması

| Yaklaşım | Hız | Doğruluk | Evrensellik | LLM Token Maliyeti | Karmaşıklık |
|-----------|-----|----------|-------------|-------------------|-------------|
| **Accessibility Tree** | Çok Hızlı | Yüksek | Sadece Web | Düşük | Düşük |
| **DOM + Box** | Orta | Yüksek | Sadece Web | Orta (screenshot) | Orta |
| **Vision/Coordinate** | Yavaş | Orta | Her Şey | Yüksek (screenshot + vision) | Yüksek |
| **Raw DOM HTML** | Hızlı | Düşük | Sadece Web | Çok Düşük | Düşük |

---

## 3. Web Agent Benchmark'ları ve Element Location [High]

### 3.1 WebVoyager

WebVoyager, **Set-of-Mark** yaklaşımının en iyi örneklerinden biridir: [19][33]

- Sayfadaki interaktif elementler JavaScript ile tespit edilir
- Her elemente numara verilir, bounding box çizilir
- Screenshot + text index LLM'e verilir
- Action vocabulary: `Click [N]`, `Type [N]; text`, `Scroll [N|WINDOW]; up|down`
- İki mod: **Visual mode** (GPT-4V + screenshot + boxes) ve **Text mode** (WebArena accessibility tree)

### 3.2 WebArena

WebArena, doğrudan **CDP accessibility tree** kullanır: [20][34]

1. `DOMSnapshot.captureSnapshot` — DOM + layout rectangles
2. `Accessibility.getFullAXTree` — complete accessibility tree
3. Viewport filtering — %60'tan az görünen elementler çıkarılır
4. İndented text formatı:
   ```
   [0] RootWebArea 'arXiv.org e-Print archive'
     [1] link 'arXiv'
     [2] searchbox 'Search...'
   ```
5. Gereksiz AX property'leri filtrelenir (`focusable`, `editable`, `readonly`, `level`)

### 3.3 Mind2Web

Mind2Web, en düşük başarı oranına sahip yaklaşımı kullanır: **raw DOM HTML**: [21][35]

- DeBERTa-v3 cross-encoder ile DOM elementleri sıralanır → ~50 candidate
- LLM'e multi-choice QA formatında sunulur: "A. `<button id=0>...</button>` B. ..."
- Element accuracy: ~%52, Action F1: ~%61

Bu düşük başarı oranı, raw DOM HTML'in LLM'ler için accessibility tree kadar iyi bir arayüz olmadığını gösterir.

---

## 4. Quake Sistemi: Mevcut Durum ve İyileştirme Alanları [Medium]

### 4.1 Mevcut Durum

Quake sisteminin browser tool'ları (`quake-browser-tools/index.ts`) şu an DOM-query tabanlı çalışıyor: [23][38]

```typescript
// Mevcut yaklaşım: hardcoded CSS selector
document.querySelectorAll("a,button,input,textarea,select,[role='button'],[role='link']")
```

**Sorunlar:**
1. ARIA rolleri sınırlı — `role="tab"`, `role="menuitem"`, `role="option"` gibi yaygın rolleri kaçırıyor
2. Playwright'ın accessibility snapshot'ına kıyasla çok daha az bilgi içeriyor (role hierarchy, accessible name, disabled state, vb.)
3. Görünmez veya gizli elementleri filtrelemiyor
4. Cross-origin iframe'leri desteklemiyor
5. Element referans sistemi yok — LLM elementlere nasıl referans vereceğini bilmiyor

### 4.2 Önerilen İyileştirmeler

1. **Accessibility snapshot'a geçiş:** `page.accessibility.snapshot()` veya `page.ariaSnapshot(mode: "ai")` kullanarak CDP üzerinden accessibility tree alınmalı. Bu, Playwright MCP, Cursor ve Browser-Use gibi başarılı sistemlerin kullandığı standart yöntemdir.

2. **Element referans sistemi:** Snapshot'taki her element `[ref=eN]` ile etiketlenmeli, action tool'ları bu referansı parametre olarak almalı.

3. **İkili sistem (text + vision):** Accessibility snapshot ana yöntem olmalı, gerektiğinde screenshot + bounding box overlay ile desteklenmeli. Browser-Use'un `*[` yeni element işareti ve WebVoyager'ın `Click [N]` action vocabulary'si örnek alınabilir.

4. **Mevcut annotation sistemiyle entegrasyon:** Kullanıcının manuel seçtiği elementler (BrowserAnnotation) ile AI'nın kendi bulduğu elementler aynı snapshot içinde birleştirilebilir. Kullanıcı annotation'ları `[user-annotation-1]` gibi özel referanslarla işaretlenebilir.

---

## 5. Action Plan

- [x] Mevcut browser element bulma sistemini analiz et (DOM-query yaklaşımı) — yapıldı
- [ ] Playwright'ın `page.ariaSnapshot(mode: "ai")` API'sini dene ve çıktı formatını test et
- [ ] Accessibility snapshot formatını Quake'in snapshot tool'una entegre et (YAML + ref sistemi)
- [ ] Action tool'larını (`browser_click`, `browser_type`) ref bazlı element hedefleme ile güncelle
- [ ] Screenshot + bounding box overlay desteğini opsiyonel olarak ekle (Browser-Use pattern'i)
- [ ] Kullanıcı annotation'ları ile AI tarafından bulunan elementleri aynı snapshot'ta birleştir
- [ ] Cross-origin iframe desteği ekle
- [ ] Viewport filtering ekle (görünmeyen elementleri snapshot'tan çıkar)
- [ ] Mevcut annotation comment (label) düzeltmesinin çalıştığını doğrula

---

## 6. Open Questions & Caveats

1. **Accessibility tree refresh maliyeti:** Sayfa dinamik olarak değiştiğinde (dropdown açılması, form validation) accessibility tree'nin ne sıklıkta yenilenmesi gerektiği net değil. Playwright otomatik wait mekanizması sunsa da, LLM'in eski snapshot ile çalışması riski var.

2. **Büyük sayfalar:** 500+ elementli sayfalarda accessibility tree çok büyüyebilir. WebArena viewport filtering kullanıyor, Browser-Use threshold-based. Quake için viewport + max element sayısı (örn. 80-100) sınırı önerilir.

3. **Shadow DOM:** Playwright'ın accessibility snapshot'ı open shadow DOM'u destekler, closed shadow DOM elementleri accessibility tree'de görünmeyebilir. Ayrı bir çözüm gerektirebilir.

4. **Quake'in mevcut kod tabanına entegrasyon:** Accessibility snapshot'a geçiş, mevcut `quake-browser-tools/index.ts` dosyasında önemli değişiklik gerektirir. Geriye uyumluluk sağlanmalı.

5. **Set-of-Mark vs accessibility tree:** Anthropic'in araştırması grid overlay'den iyileşme görmezken, Microsoft Research'ün SoM çalışması GPT-4V'de başarılı sonuçlar vermiştir. Bu farklılık, kullanılan model ve overlay yöntemine bağlı olabilir. [15][10]

---

## Methodology

**Depth:** Deep — 4 subagent (2 retrieval + 1 gap-fill + 1 failed), 2 wave.

**Subagent'lar:**
- Subagent A (START_INDEX=1): Codex Desktop + Cursor/Windsurf/Copilot
- Subagent B (START_INDEX=16): Claude Code/Anthropic + Playwright Locators + Set-of-Mark
- Subagent C (START_INDEX=31): Playwright AX tree, WebVoyager/WebArena/Mind2Web, Browser-Use, Quake mevcut durum
- Subagent D: başlatıldı ancak model hatası nedeniyle tamamlanamadı (DeepSeek image_url hatası)

**Kaynak dağılımı:** 23 kaynak (21 Tier 1, 2 Tier 2). Kaynakların çoğu resmi dokümantasyon ve açık kaynak kod doğrulamasına dayanmaktadır.

**Outline değişiklikleri:** Orijinal planda 4 ana alan vardı (Codex Desktop, IDE Agent'lar, Claude Code, Element Location). Toplanan verinin kapsamı nedeniyle "Web Agent Benchmark'ları" ve "Quake Sistemi İçin Öneriler" bölümleri eklendi.

**Citation doğrulaması:** Kaynakların çoğu resmi dokümantasyon ve açık kaynak kod olduğu için ayrıca doğrulama subagent'ı çalıştırılmamıştır (Tier 1 güven).

---

## Bibliography

[1] Cosine Docs — Browser Automation — https://cosine.sh/docs/customizing/browser — Accessed 2026-06-26 — Tier: 1

[2] Rachel Black — Cosine CLI Runtime Technical Deep Dive — https://cosine.sh/blog/cosine-cli-runtime-technical-deep-dive — Apr 16, 2026 — Tier: 2

[3] Cosine Docs — Desktop Overview — https://cosine.sh/docs/desktop — Accessed 2026-06-26 — Tier: 1

[4] Cursor Docs — Browser Tool — https://cursor.com/docs/agent/tools/browser — Accessed 2026-06-26 — Tier: 1

[5] Cursor Changelog — Design Mode (v3.7) — https://www.cursor.com/changelog — Jun 5, 2026 — Tier: 1

[6] Cursor Docs — Agent Overview — https://cursor.com/docs/agent — Accessed 2026-06-26 — Tier: 1

[7] Devin Desktop Docs — Previews — https://docs.devin.ai/desktop/previews — Accessed 2026-06-26 — Tier: 1

[8] Devin Desktop Docs — Devin Local Agent — https://docs.devin.ai/desktop/devin-local — Accessed 2026-06-26 — Tier: 1

[9] Anthropic — Computer Use Tool Documentation — https://platform.claude.com/docs/en/docs/build-with-claude/computer-use — Accessed 2026-06-26 — Tier: 1

[10] Anthropic — Best Practices for Computer and Browser Use with Claude — https://claude.com/blog/best-practices-for-computer-and-browser-use-with-claude — May 13, 2026 — Tier: 1

[11] Microsoft Playwright Team — Playwright Locators Documentation — https://playwright.dev/docs/locators — Accessed 2026-06-26 — Tier: 1

[12] Anthropic — Claude Code Overview — https://code.claude.com/docs/en/overview — Accessed 2026-06-26 — Tier: 1

[13] Anthropic — Computer Use Demo Repository — https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo — Accessed 2026-06-26 — Tier: 1

[14] Anthropic — Computer Use Best Practices Repository — https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-best-practices — May 13, 2026 — Tier: 1

[15] Yang, J. et al. (Microsoft Research) — Set-of-Mark Prompting Unleashes Extraordinary Visual Grounding in GPT-4V — https://arxiv.org/abs/2310.11441 — Oct 2023 — Tier: 1 [foundational]

[16] Playwright Source — CDP AXNode definition — `packages/playwright-core/src/server/chromium/protocol.d.ts` — Tier: 1

[17] Playwright API Docs — `page.ariaSnapshot()` with `mode: "ai"` — Tier: 1

[18] Playwright MCP README & Source — https://github.com/microsoft/playwright-mcp — Accessed 2026-06-26 — Tier: 1

[19] WebVoyager Source — `utils.py` — https://github.com/nyu-llm/webvoyager — Tier: 1

[20] WebArena Source — `utils_webarena.py` — https://github.com/web-arena-x/webarena — Tier: 1

[21] Mind2Web Source — `process_snapshots.ipynb` — https://github.com/OSU-NLP-Group/Mind2Web — Tier: 1

[22] Browser-Use System Prompt & Source — https://github.com/browser-use/browser-use — Tier: 1

[23] Quake Code Source — `quake-browser-tools/index.ts` — C:\quake code\packages\coding-agent\src\bundled\extensions\quake-browser-tools\index.ts — Tier: 2

---

## Source Extracts

### [1] Cosine Docs — Browser Automation
- **Summary:** Cosine CLI uses CDP to control a real browser. Eight browser tools: navigate, screenshot, click, fill, evaluate JS, get text, scroll, wait. Safari support via native bridge. User approval required by default.
- **Key quote:** "Uses CDP to navigate websites, take screenshots, execute JavaScript, fill forms, extract data."
- **Source type:** Official docs
- **Credibility tier:** 1

### [18] Playwright MCP
- **Summary:** Fast and lightweight by utilizing Playwright's accessibility tree instead of pixel-based input. LLM-friendly, no vision models needed, deterministic tool application. Action tools accept `target` parameter (snapshot ref or CSS selector).
- **Key quote:** "Key features include being fast and lightweight by utilizing Playwright's accessibility tree instead of pixel-based input. It is LLM-friendly, requiring no vision models and operating solely on structured data."
- **Source type:** Official docs + source code
- **Credibility tier:** 1

### [22] Browser-Use — System Prompt
- **Summary:** Interactive elements provided in tree-style XML format. Action interface uses numeric indices: `click(45)`, `input(12, "text")`. Screenshot with bounding boxes around interactive elements for ground truth verification. New elements since last step marked with `*[`.
- **Key quote:** "If an interactive index inside your browser_state does not have text information, then the interactive index is written at the top center of its element in the screenshot."
- **Source type:** Open source code
- **Credibility tier:** 1

### [23] Quake Code — quake-browser-tools/index.ts
- **Summary:** Custom DOM-query snapshot using `document.querySelectorAll("a,button,input,textarea,select,[role='button'],[role='link']")`. Elements indexed by sequence (1-80). Includes tag, text, id, name, type, placeholder, href, visible. Grouped as inputs/buttons/links/other. Does NOT use accessibility tree.
- **Key quote:** Uses hardcoded CSS selector instead of CDP accessibility tree — may miss ARIA role elements or include visually hidden ones.
- **Source type:** Local codebase
- **Credibility tier:** 2
