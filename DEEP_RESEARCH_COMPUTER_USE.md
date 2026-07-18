# Deep Research: Quake Computer-Use Eklentisi

> Oluşturulma: 2026-07-07 | Derinlik: standard | Kaynak: 32 (birleştirilmiş)

## TL;DR

Quake Desktop için **tam masaüstü computer-use** eklentisi, mevcut `quake-browser-tools` (web/CDP) katmanından ayrı bir **OS-level harness** gerektirir: Electron `desktopCapturer` ile ekran yakalama, ayrıcalıklı bir Node child process'te `@nut-tree/nut-js` ile fare/klavye yürütme ve her adımda kullanıcı onayı + adım limiti. Endüstri standardı **screenshot → vision → action → tool_result** döngüsüdür; OSWorld'de insan başarısı ~%72 iken en iyi modeller ~%12 civarındadır [3][12]. Quake için önerilen yol: **hibrit mimari** (koordinat tabanlı vision + isteğe bağlı Windows UI Automation), Windows-first, provider-bağımsız custom tool şeması; Claude kullanıldığında `computer_20250124` passthrough. MVP 6–8 haftalık fazlı plan ile başlamalı; otonom tam masaüstü kontrolü üretimde güvenilir değildir [51][52].

## Executive Summary

Bu rapor, Quake Code ekosisteminde **tam masaüstü computer-use** yeteneği için sıfırdan bir araştırma ve implementasyon planı sunar. Kapsam, kullanıcının Phase 0 yanıtına göre **native uygulama kontrolü** (ekran görüntüsü, fare, klavye) ile sınırlıdır; tarayıcı otomasyonu (`quake-browser-tools`) kapsam dışı bırakılmış, ancak mimari sınırlar açıkça tanımlanmıştır.

Pazar ve araştırma literatürü, computer-use'un **provider-model + yerel harness** desenine yakınsadığını gösteriyor [1][2][40]. Anthropic `computer_20251124`, OpenAI Computer-Using Agent (CUA) ve Microsoft UFO/UFO2 gibi Windows-native hibrit yaklaşımlar aynı temel döngüyü paylaşır: model ekranı görür, yapılandırılmış aksiyon üretir, harness yerel olarak yürütür, yeni screenshot döner [1][2][4][43]. Güvenilirlik hâlâ düşüktür; OSWorld benchmark'ında insanlar görevlerin %72,36'sını tamamlarken en iyi model yalnızca %12,24 başarı göstermiştir [3]. Üretimde tipik sorunlar koordinat sapması, ekran enjeksiyonu (prompt injection), adım başına 3–6 saniye gecikme ve maliyet patlamasıdır [10][51][52].

Quake'in mevcut mimarisi bu eklenti için güçlü bir temel sunar. `packages/coding-agent` içindeki bundled extension modeli (`quake-agent-room`, `quake-browser-tools`) tool registry entegrasyonunu kanıtlamıştır. `quake-browser-tools` zaten Electron bridge (port 9223), CDP screencast ve accessibility snapshot sağlar; computer-use ise **farklı bir güvenlik ve yürütme sınırı** gerektirir çünkü tüm masaüstüne erişim açar [20][27]. Electron `desktopCapturer` ekran yakalama için Tier-1 resmi API sunar [27]; girdi otomasyonu için `@nut-tree/nut-js` (robotjs'un halefi) Windows'ta Win32 binding'leri kullanır [31][55].

Önerilen karar: **`quake-computer-use`** adlı yeni bundled extension; Windows-first, vision-capable herhangi bir model ile custom tool şeması (`desktop_screenshot`, `desktop_click`, `desktop_type`, `desktop_key`, `desktop_scroll`); Claude modellerinde opsiyonel native `computer_*` passthrough. Güvenlik katmanı: adım limiti (30–50), yüksek etkili aksiyonlarda onay, trajectory logging, isteğe bağlı pencere kapsamı (`node-window-manager`), screenshot injection classifier hook'u [20][24][52]. Fazlı rollout: (1) read-only screenshot + onaylı click/type MVP, (2) UIA hibrit + overlay UI, (3) provider passthrough + enterprise policy.

## 1. Mevcut Durum ve Endüstri Pratiği [Güven: Yüksek]

Computer-use, 2024 sonundan itibaren Anthropic ve OpenAI tarafından API düzeyinde ürünleştirilmiş bir yetenektir. Anthropic'in resmi dokümantasyonu, computer use'un **beta** statüsünde olduğunu ve Messages API üzerinden `computer_20251124` tool tipi ile screenshot, fare ve klavye kontrolü sağladığını belirtir [1]. Uygulama tarafı, modelin tool çağrılarını yerel ortamda çalıştırıp sonuçları `tool_result` blokları (özellikle screenshot'lar) olarak geri gönderen bir **agent loop** kurmalıdır; bu döngü adım 3–4'ün tekrarıyla tanımlanır [1][40].

OpenAI tarafında Computer-Using Agent, Responses API `computer` tool'u veya özel harness ile aynı prensibi izler: model yazılımı kullanıcı arayüzü üzerinden işletir; geliştiricinin izole tarayıcı veya VM ortamı sağlaması, screenshot yakalayıp dönen aksiyonları yürütmesi beklenir [2]. Resmi kurulum örneği `viewport: { width: 1280, height: 720 }` kullanır; bu, token maliyeti ve model grounding'i için endüstride yaygınlaşmış bir normalizasyon hedefidir [2][49]. Anthropic'in metodoloji yazısı da yoğun UI'larda kırılganlık, çok adımlı akışlarda yavaşlık ve **ekranda render edilen içerikten prompt injection** riskini açıkça dokümante eder [12].

Benchmark sonuçları, computer-use'un henüz "demo dışı üretim hazır" olmadığını sayısal olarak doğrular. OSWorld, Ubuntu/Windows/macOS üzerinde 369 gerçek masaüstü görevi içeren ölçeklenebilir bir benchmark'tır [3][44]. İnsan performansı %72,36 iken en iyi model %12,24 başarıya ulaşmıştır; temel darboğazlar GUI grounding ve operasyonel bilgi eksikliğidir [3]. WebArena (812 web görevi) tarayıcı ajanları için benzer ayrımı gösterir ve browser-use ile computer-use'un farklı değerlendirme eksenlerinde ölçülmesi gerektiğini ima eder [46][47].

Açık kaynak ve araştırma alternatifleri, provider API'lerine bağımlılığı azaltmak için referans mimariler sunar. Microsoft UFO, Windows'a özgü **dual-agent** çerçevesiyle GPT-Vision'ı GUI ve kontrol bilgisi analiziyle birleştirir; "control interaction module" insan müdahalesi olmadan action grounding sağlar [4][7]. Agent S, hiyerarşik planlama ve Agent-Computer Interface (ACI) ile OSWorld'te anlamlı iyileşme bildirir [5]. CUA (`trycua/acu`) gibi hafif OSS kütüphaneler, VLM'leri OS-level screenshot + input kontrolüne bağlamak için harness katmanı olarak kullanılabilir [9]. Zylos'un 2026 sentezi, koordinat tabanlı, erişilebilirlik ağacı tabanlı ve hibrit pattern'lerin yanı sıra üretimdeki yaygın hata modlarını (yanlış tıklama, bayat screenshot, token şişmesi) özetler [10].

Quake bağlamında kritik ayrım şudur: `quake-browser-tools` zaten Playwright/CDP, Electron bridge ve accessibility snapshot ile **web kapsamındaki** computer-use'un büyük bölümünü karşılar. Tam masaüstü computer-use, Explorer, Outlook, native IDE'ler, sistem ayarları gibi web dışı yüzeylere erişim gerektirir ve bu nedenle ayrı bir extension olarak tasarlanmalıdır. README'nin "browser/OS tools registered in the runtime" ifadesi, runtime'un bu tür araçları desteklediğini; ancak OS-level harness'in henüz tamamlanmadığını gösterir.

## 2. Yükselen Trendler ve Teknik Mimari [Güven: Yüksek]

Son 12–18 ayda computer-use ekosisteminde üç yapısal trend öne çıkmaktadır. Birincisi, **client-executed versioned tools**: Anthropic `computer_20241022` → `20250124` → `20251124` sürüm zinciriyle scroll, hold_key, wait, zoom gibi aksiyonları genişletmiştir; adapter katmanının tool versiyonuna göre dallanması zorunludur [40][43][57]. İkincisi, **hibrit perception**: saf koordinat/vision yerine Windows UI Automation (UIA) veya accessibility tree ile vision'ın birleştirilmesi, grounding hatalarını azaltma yönünde Microsoft UFO/UFO2 ve nut.js `element-inspector` ile somutlaşmıştır [4][28][31]. Üçüncüsü, **üretim harness disiplini**: screenshot downscaling (1280×720), koordinat remapping, text-before-image sıralaması, trajectory recording ve zoom/region crop (`computer_20251124`) yoğun UI'lar için resmi best practice haline gelmiştir [49][57].

Teknik mimari, Quake için dört katmanlı bir stack olarak modellenebilir.

**Algılama katmanı (Perceive):** Electron main process'te `desktopCapturer.getSources({ types: ['screen', 'window'] })` ile ekran veya pencere kaynaklarını listelemek resmi ve Electron-native bir yoldur [27]. Windows'ta daha yüksek performans veya tam ekran capture için Desktop Duplication API (DXGI) düşünülebilir; ancak MVP için `desktopCapturer` yeterlidir [29]. Screenshot'lar API limitlerine göre 1280×800 veya 1280×720'ye downscale edilmeli; macOS HiDPI'da scale multiplier dikkate alınmalıdır [49][54].

**Planlama katmanı (Plan):** AgentSession runtime'ındaki mevcut tool loop kullanılır. Model vision-capable olmalıdır; screenshot tabanlı grounding için vision zorunludur [40][49]. İsteğe bağlı olarak Windows UIA tree özeti (metin) screenshot'a ek context olarak eklenebilir — UFO pattern'i [4].

**Yürütme katmanı (Act):** Renderer sandbox'ından **kesinlikle çıkarılmalıdır**. `@nut-tree/nut-js` ile `mouse.setPosition`, `mouse.leftClick`, `keyboard.type`, `keyboard.pressKey` gibi primitifler Node child process veya Electron main + IPC üzerinden çalıştırılmalıdır [31][55]. `node-window-manager` ile hedef pencere focus/bounds alınarak etki alanı sınırlandırılabilir [56]. Anthropic `computer.py` referans implementasyonu, API koordinatları ile fiziksel display arasında ölçekleme yapan `scale_coordinates` mantığını gösterir; Quake adapter'ı bunu birebir veya tutarlı şekilde devre dışı bırakmalıdır [43][57].

**Geri bildirim katmanı (Verify):** Her aksiyon sonrası yeni screenshot + opsiyonel cursor_position döndürülür. Agent loop, `stop_reason !== tool_use` olana kadar devam eder [1]. Adım sayacı ve timeout zorunludur [52].

Codex Desktop'ın computer use implementasyonu, Quake için en yakın ürün referansıdır. OpenAI dokümantasyonu, macOS'ta Screen Recording + Accessibility, Windows'ta foreground oturum kısıtları ve **her yeni masaüstü uygulaması için onay** akışını tanımlar [23]. İzin profilleri (`:read-only`, `:workspace-write`, özel filesystem/network kuralları) dosya ve shell eylemleriyle computer-use'u aynı güvenlik çerçevesinde birleştirir [24][25][26]. Quake'in mevcut approval/plan-mode desenleri (`test/e2e/plan-mode.spec.ts`, auxiliary pane onayları) bu UX'e adapte edilebilir.

Claude Code'un referans yolu Docker + Xvfb + Linux desktop (Mutter, xdotool) kullanır [42]; Quake Windows-first olduğundan bu yol doğrudan kopyalanmaz, ancak agent loop ve tool_result sözleşmesi aynıdır. Native macOS quickstart Anthropic tarafından ayrıca dokümante edilmiştir [40].

## 3. Kritik Değerlendirme: Riskler, Sınırlar ve Karşı Görüşler [Güven: Orta-Yüksek]

Computer-use'un en ciddi riski **dolaylı prompt injection**'dır: ekranda görünen herhangi bir metin (web sayfası, e-posta, bildirim, README'deki gizli talimat) modelin kullanıcı niyetini geçersiz kılabilir [12][20][21]. Anthropic, sınıflandırıcı tabanlı screenshot injection savunmaları sunar ancak bunların kusursuz olmadığını kabul eder; VM izolasyonu, domain allowlist ve geri dönüşü olmayan aksiyonlarda insan onayı önerir [12][20]. Quake bir kodlama IDE'si olduğundan, agent'ın tarayıcıda veya terminal çıktısında gördüğü kötü niyetli içerik özellikle relevanttir.

Performans ve güvenilirlik eleştirileri serttir. Understanding AI'nin 2025 hands-on değerlendirmesi, Operator'ın basit alışveriş listesi görevinde insan müdahalesi gerektirdiğini, 30+ dakika sürdüğünü ve manuel 4 dakikaya kıyasla "yavaş, hantal, çok hata yapan" olduğunu raporlar [51]. Technspire'in üretim karşılaştırması, 20 adımlık görevlerde 60–120 saniye uçtan uca süre ve **30–50 adım sert limiti** önerir; uzun görevlerin daha sık başarısız olduğunu vurgular [52]. Bu bulgular, Quake'te computer-use'u "arka planda otonom masaüstü operatörü" olarak değil, **denetimli, kısa görevli bir yardımcı** olarak konumlandırmayı zorunlu kılar.

Teknik failure mode'lar iyi kataloglanmıştır [10][49][52]: (1) display/API koordinat uyumsuzluğu ve sessiz downscale, (2) küçük hedeflerde miss-click, (3) dropdown/menu gibi viewport dışı UI, (4) stale screenshot ile yanlış plan, (5) runaway loop. Mitigasyonlar: tutarlı viewport, keyboard fallback (Tab/Enter), `wait` ve `hold_key` aksiyonları, zoom/region (`computer_20251124`), trajectory log ve insan checkpoint'leri [43][49][57].

Güvenlik sandbox'ı Windows'ta çok katmanlı düşünülmelidir. Codex native sandbox ve permission profile'ları dosya/shell için güçlü sınırlar sunar [24][26]; computer-use ise sandbox dışına çıkar. Pratik sınır: **pencere kapsamı** (yalnızca kullanıcı onaylı uygulamalar), **read-only mod** (yalnızca screenshot, aksiyon yok), **onay politikası** (her click vs oturum bazlı allowlist). PowerShell Constrained Language ve WDAC, shell araçlarıyla birlikte düşünüldüğünde ek savunma sağlar [30] — computer-use doğrudan bunların yerine geçmez.

Provider kilidi riski: Yalnızca Anthropic `computer_*` veya OpenAI CUA'ya bağımlı kalmak, Quake'in çoklu model stratejisini (Azure, Grok vb.) zayıflatır. Bu nedenle **provider-bağımsız custom tool şeması** birincil, native computer tool passthrough ikincil olmalıdır. MCP tarafında first-party desktop automation server bulunmamaktadır; desktop kontrol custom client tool veya köprü ile yapılır [48].

## 4. Quake İçin Mimari Karar ve Action Plan

Aşağıdaki kararlar, kullanıcının 4. ve 5. maddeleri modele bırakmasıyla türetilmiştir: **Windows-first**, **vision + custom tools birincil**, **bundled extension**, **mevcut Electron/AgentSession mimarisine uyum**, **standard derinlik araştırması**.

### 4.1 Mimari Karar Özeti

| Karar | Seçim | Gerekçe |
|-------|-------|---------|
| Extension adı | `quake-computer-use` | `quake-browser-tools` ile net ayrım [mevcut kod] |
| Hedef platform | Windows 10/11 (MVP), macOS faz 2 | Kullanıcı ortamı, UFO/UIA avantajı [4][28] |
| Algılama | Electron `desktopCapturer` | Tier-1, zaten Electron stack [27] |
| Yürütme | `@nut-tree/nut-js` child process | robotjs'un halefi, Node-native [31][55] |
| Tool API | Custom + opsiyonel `computer_*` passthrough | Multi-provider uyumu [40][48] |
| Güvenlik | Adım limiti + onay + trajectory + allowlist | Codex/Anthropic pattern [20][23][52] |
| UI | Sağ dock panel + ekran overlay + settings | Codex Computer Use settings benzeri [23] |

### 4.2 Önerilen Dosya Yapısı

```text
packages/coding-agent/src/bundled/extensions/quake-computer-use/
  index.ts                 # ExtensionAPI: tool kayıtları, hooks
  types.ts                 # Action, Display, Session, Policy tipleri
  harness.ts               # Agent loop köprüsü (screenshot ↔ act)
  capture-electron.ts      # desktopCapturer IPC contract (desktop tarafı)
  actuate-nut.ts           # nut-js wrapper (child process)
  coordinates.ts           # scale/remap (computer.py uyumlu)
  policy.ts                # step budget, allowlist, approval gates
  trajectory.ts            # step log, replay
  prompts.ts               # system prompt snippets
  package.json

apps/quake-desktop/electron/computer-use/
  capture.ts               # desktopCapturer implementasyonu
  bridge-server.ts         # HTTP/IPC: /computer-use/screenshot, /actuate
  overlay.ts               # opsiyonel fare izi görselleştirme

apps/quake-desktop/src/client/src/components/dock/ComputerUsePanel.tsx
apps/quake-desktop/src/server/computer-use.ts   # read-only status API
```

### 4.3 Tool Şeması (Provider-Bağımsız MVP)

Anthropic `computer.py` aksiyon seti referans alınır [57]:

- `desktop_screenshot` → display_number, region (opsiyonel)
- `desktop_mouse_move` → coordinate [x, y]
- `desktop_click` → left | right | double | triple, coordinate?, modifiers?
- `desktop_drag` → start_coordinate, coordinate
- `desktop_scroll` → direction, amount, coordinate?
- `desktop_type` → text
- `desktop_key` → key combo (ör. `ctrl+s`)
- `desktop_wait` → duration_ms
- `desktop_cursor_position` → okuma

Her tool çağrısı `ComputerUsePolicy` tarafından değerlendirilir: oturum allowlist, adım sayacı, `requiresApproval` flag.

### 4.4 Action Plan

- [ ] **ADR-001:** `quake-computer-use` extension charter'ı yaz — kapsam (OS vs browser), güvenlik ilkeleri, Windows-first MVP tanımı
- [ ] **Faz 1 (2 hafta):** Electron `desktopCapturer` + HTTP bridge iskeleti (`electron/computer-use/bridge-server.ts`); `desktop_screenshot` read-only tool; trajectory logging
- [ ] **Faz 1:** `@nut-tree/nut-js` child process PoC — click, type, key; native module Electron rebuild pipeline'ına ekle
- [ ] **Faz 1:** `coordinates.ts` — 1280×800 hedef çözünürlük, DPI scale testleri [49][54]
- [ ] **Faz 2 (2 hafta):** `quake-computer-use` bundled extension — tool registry, policy engine, step limit (varsayılan 40)
- [ ] **Faz 2:** Onay akışı — mevcut plan-mode/approval UI pattern'ine bağla; yüksek riskli aksiyon sınıflandırması
- [ ] **Faz 2:** `extension-catalog.ts` + Settings panel — Computer Use toggle, allowlist UI, "read-only mode"
- [ ] **Faz 3 (2 hafta):** Claude `computer_20250124` passthrough adapter (aynı harness üzerinde)
- [ ] **Faz 3:** Windows UIA hibrit — `node-window-manager` + opsiyonel UIA tree özeti (UFO-inspired) [4][56]
- [ ] **Faz 3:** `ComputerUsePanel` — canlı screenshot preview, adım geçmişi, durdurma butonu
- [ ] **Faz 4:** E2E test harness — OSWorld-lite internal fixture (kontrollü Notepad/Calculator görevleri); regresyon seti
- [ ] **Faz 4:** Prompt injection test suite — ekranda gizli talimat içeren fixture'lar [20][12]
- [ ] **Faz 5:** macOS capture/actuate path (Screen Recording permission UX)
- [ ] **Faz 5:** `quake-agent-room` entegrasyonu — lider agent computer-use görevlerini worker'a devretme kuralları

### 4.5 `quake-browser-tools` ile Birlikte Kullanım

| Görev tipi | Önerilen araç |
|------------|----------------|
| Web app, localhost dev, form doldurma | `browser_*` (mevcut) |
| Native app (Excel, Explorer, sistem dialog) | `desktop_*` (yeni) |
| Web + native karma | Lider agent planı: önce browser, gerekirse desktop |

`web-search.ts` zaten "yalnızca doğrudan sayfa etkileşimi gerektiğinde browser_* kullan" kuralını kodlar [mevcut kod]; benzer routing kuralı computer-use için de `prompts.ts`'e eklenmelidir.

## 5. Açık Sorular ve Uyarılar

**Çözülemedi / düşük güven:**
- Quake'in birincil model ailesinde (Grok, Azure GPT) native computer tool desteği olup olmadığı — custom tool şeması bu belirsizliği kapatır, ancak grounding kalitesi modele göre değişir [Düşük].
- `@nut-tree/nut-js` Electron paketleme (prebuild) Windows CI'da sürtünme yaratabilir; robotjs geçmişinde benzer sorunlar raporlanmıştır [55][Orta].
- Tam masaüstü allowlist vs "her uygulama onayı" UX'i için kullanıcı araştırması yapılmadı.

**Çelişen bulgular:**
- Anthropic grid overlay / SoM iyileştirmelerinin tutarlı kazanç sağlamadığı [12] vs WebVoyager/SoM başarıları — Quake MVP'de saf koordinat + UIA metin supplement yeterli; SoM ertelenmeli.
- Üretimde computer-use "dead end" [51] vs API ecosystem büyümesi [1][2] — Quake için konum: **denetimli yardımcı**, otonom operatör değil.

**Kritik uyarı:** Computer-use etkinleştirildiğinde Quake, kullanıcının tüm masaüstü saldırı yüzeyine yaklaşır. Varsayılan kapalı (opt-in), ilk kullanımda risk disclosure ve read-only önizleme modu şarttır [20][23].

## Methodology

- **Derinlik:** standard (3 Retrieval + 1 Gap-Fill + 1 Verification subagent)
- **Dalgalar:** Wave 1 (3 paralel retrieval), Wave 2 (gap-fill), Phase 3.1 (7 claim verification — 7/7 SUPPORTED)
- **Phase 0 yanıtları:** Kapsam A (tam masaüstü), Hedef C (karar + plan), Mevcut raporlar B (sıfırdan)
- **Varsayımlar (kullanıcı delegasyonu):** Windows-first, provider-bağımsız custom tools, bundled extension, adım limiti + onay güvenliği
- **Outline değişikliği:** Orijinal 6 alan korundu; Quake-spesifik Action Plan ve dosya yapısı eklendi (evidence-driven genişleme, <%50)
- **Codebase referansları:** `quake-browser-tools`, `docs/architecture.md`, `extension-catalog.ts`
- **Sınırlama:** T3 kaynak [51] tek yazarlı eleştiri — "dead end" iddiası Open Questions'da dengelendi

## Bibliography

[1] Anthropic — Computer use tool — https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool — Erişim: 2026-07-07 — Tier: 1

[2] OpenAI — Computer use API guide — https://developers.openai.com/api/docs/guides/tools-computer-use — Erişim: 2026-07-07 — Tier: 1

[3] Xie et al. — OSWorld (arXiv:2404.07972) — https://arxiv.org/abs/2404.07972 — Erişim: 2026-07-07 — Tier: 1

[4] Microsoft Research — UFO: A UI-Focused Agent for Windows — https://www.microsoft.com/en-us/research/publication/ufo-a-ui-focused-agent-for-windows-os-interaction/ — Erişim: 2026-07-07 — Tier: 1

[5] Agashe et al. — Agent S (arXiv:2410.08164) — https://arxiv.org/abs/2410.08164 — Erişim: 2026-07-07 — Tier: 1

[7] Microsoft Research — UFO2: The Desktop AgentOS — https://www.microsoft.com/en-us/research/publication/ufo2-the-desktop-agentos/ — Erişim: 2026-07-07 — Tier: 1

[9] trycua/acu — Open-source computer-use library — https://github.com/trycua/acu — Erişim: 2026-07-07 — Tier: 2

[10] Zylos Research — Computer-use GUI agents landscape (2026) — https://zylos.ai/research/2026-02-08-computer-use-gui-agents/ — Erişim: 2026-07-07 — Tier: 3

[12] Anthropic — Developing computer use — https://www.anthropic.com/news/developing-computer-use — Erişim: 2026-07-07 — Tier: 1

[20] Anthropic — Computer use (security) — https://platform.claude.com/docs/en/docs/build-with-claude/computer-use — Erişim: 2026-07-07 — Tier: 1

[23] OpenAI — Codex app Computer Use — https://developers.openai.com/codex/app/computer-use — Erişim: 2026-07-07 — Tier: 1

[24] OpenAI — Codex Permissions — https://developers.openai.com/codex/permissions — Erişim: 2026-07-07 — Tier: 1

[25] OpenAI — Agent approvals & security — https://developers.openai.com/codex/agent-approvals-security — Erişim: 2026-07-07 — Tier: 1

[26] OpenAI — Sandboxing — https://developers.openai.com/codex/concepts/sandboxing — Erişim: 2026-07-07 — Tier: 1

[27] Electron — desktopCapturer API — https://www.electronjs.org/docs/latest/api/desktop-capturer — Erişim: 2026-07-07 — Tier: 1

[28] Microsoft — UI Automation overview — https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32 — Erişim: 2026-07-07 — Tier: 1

[29] Microsoft — Desktop Duplication API — https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/desktop-dup-api — Erişim: 2026-07-07 — Tier: 1

[30] Microsoft — Application Control / Constrained Language — https://learn.microsoft.com/en-us/powershell/scripting/security/app-control/application-control — Erişim: 2026-07-07 — Tier: 1

[31] nut.js — Desktop Automation for Node.js — https://nutjs.dev/ — Erişim: 2026-07-07 — Tier: 2

[40] Anthropic — Tool reference — https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference — Erişim: 2026-07-07 — Tier: 1

[42] Anthropic — computer-use-demo (GitHub) — https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo — Erişim: 2026-07-07 — Tier: 1

[43] Anthropic — computer.py reference — https://raw.githubusercontent.com/anthropics/anthropic-quickstarts/main/computer-use-demo/computer_use_demo/tools/computer.py — Erişim: 2026-07-07 — Tier: 1

[44] OSWorld project site — http://osworld-v1.xlang.ai/ — Erişim: 2026-07-07 — Tier: 1

[46] WebArena — https://webarena.dev/ — Erişim: 2026-07-07 — Tier: 1

[47] Browser-use docs — https://docs.browser-use.com/ — Erişim: 2026-07-07 — Tier: 2

[48] Model Context Protocol — Example Servers — https://modelcontextprotocol.io/examples — Erişim: 2026-07-07 — Tier: 1

[49] Anthropic — Best practices for computer and browser use — https://claude.com/blog/best-practices-for-computer-and-browser-use-with-claude — Erişim: 2026-07-07 — Tier: 1

[51] Timothy B. Lee — Computer-use agents seem like a dead end — https://www.understandingai.org/p/computer-use-agents-seem-like-a-dead — Erişim: 2026-07-07 — Tier: 3

[52] Technspire — Browser-based agents in production — https://technspire.com/en/blog/browser-based-agents-production-computer-use-compared — Erişim: 2026-07-07 — Tier: 2

[54] nut.js — Image matching examples — https://nutjs.dev/examples/image-matching — Erişim: 2026-07-07 — Tier: 1

[55] nut.js GitHub — https://github.com/nut-tree/nut.js/ — Erişim: 2026-07-07 — Tier: 1

[56] node-window-manager — https://github.com/sentialx/node-window-manager — Erişim: 2026-07-07 — Tier: 2

[57] Anthropic computer.py (action schema) — https://github.com/anthropics/anthropic-quickstarts/blob/main/computer-use-demo/computer_use_demo/tools/computer.py — Erişim: 2026-07-07 — Tier: 1

## Source Extracts

### [3] OSWorld
- **Summary:** 369 gerçek masaüstü görevi; insan %72,36, en iyi model %12,24; GUI grounding ana darboğaz.
- **Key quotes:** "humans can accomplish over 72.36% of the tasks, the best model achieves only 12.24% success"
- **Source type:** academic
- **Credibility tier:** 1

### [4] Microsoft UFO
- **Summary:** Windows dual-agent; GPT-Vision + GUI/control bilgisi; control interaction module.
- **Key quotes:** "dual-agent framework to meticulously observe and analyze the graphical user interface (GUI) and control information"
- **Source type:** research lab
- **Credibility tier:** 1

### [12] Developing computer use
- **Summary:** Screenshot tabanlı perception; prompt injection riski; yoğun UI kırılganlığı.
- **Key quotes:** Prompt injection when Claude interprets screenshots from internet-connected machines.
- **Source type:** official
- **Credibility tier:** 1

### [23] Codex Computer Use
- **Summary:** Windows/macOS; per-app onay; Always allow listesi; foreground kısıtları.
- **Key quotes:** Codex asks before using each app; manageable in Computer Use settings.
- **Source type:** official docs
- **Credibility tier:** 1

### [27] Electron desktopCapturer
- **Summary:** screen/window kaynakları; getSources ile capture.
- **Key quotes:** types may be screen and window; each source represents a screen or individual window.
- **Source type:** official docs
- **Credibility tier:** 1

### [43] computer.py
- **Summary:** Versioned action sets; coordinate scaling; display_width/height params.
- **Key quotes:** Actions: screenshot, mouse_move, left_click, scroll, type, key, wait, zoom (version-dependent).
- **Source type:** reference implementation
- **Credibility tier:** 1

### [51] Understanding AI critique
- **Summary:** Hands-on Operator testi; yavaş, hatalı; tüketici kullanımına uygun değil iddiası.
- **Key quotes:** "slow, clunky, make a lot of mistakes"
- **Source type:** journalism/opinion
- **Credibility tier:** 3

### [52] Technspire production
- **Summary:** 20 adım = 60–120s; step cap 30–50 önerisi; koordinat miss failure modes.
- **Key quotes:** "long tasks fail more often"
- **Source type:** engineering blog
- **Credibility tier:** 2