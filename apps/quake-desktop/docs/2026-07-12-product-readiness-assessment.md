# Quake Desktop — Ürün Hazırlık ve Eksik Alanlar Değerlendirmesi

**Tarih:** 12 Temmuz 2026  
**Durum:** Gelecek çalışmalar için kayıt  
**Kapsam:** Ürün, güvenilirlik, güvenlik, test, Electron, performans, mimari, erişilebilirlik, yayın ve operasyon

> Bu belge, 12 Temmuz 2026 tarihinde yapılan geniş kapsamlı proje incelemesinin bulgularını kaydeder. Maddelerin tamamı daha sonra ele alınacaktır; bu belge şu anda bir uygulama taahhüdü veya tamamlanmış iş listesi değildir.

---

## 1. Yönetici özeti

Quake’in ürün çekirdeği güçlü durumdadır. Özellikle aşağıdaki alanlarda önemli bir olgunluk seviyesi yakalanmıştır:

- Streaming ve tamamlanmış mesajların aynı Markdown renderer sözleşmesini kullanması
- Streamdown, Shiki ve Mermaid entegrasyonu
- Turn seviyesinde kalıcı Semantic Flow yaklaşımı
- Plan Mode’un otoritatif state modeli
- Oturum bazlı composer ve sağ panel izolasyonu
- Abort sonrası geç event’lerin karantinaya alınması
- Terminal güvenlik politikaları
- MCP secret vault altyapısı
- Electron’da `contextIsolation`, sandbox ve kapalı Node entegrasyonu
- Browser ve computer-use bridge’lerinin ayrılması
- Tool geçmişinde bounded selection ve windowing optimizasyonları
- Güncel Vitest doğrulamasında 20 test dosyası ve 73/73 başarılı test

Bununla birlikte Quake’in “iyi çalışan geliştirici ürünü”nden “dağıtıma hazır, güvenilir masaüstü ürünü”ne geçişinde sistemsel eksikler bulunmaktadır. En yüksek öncelikli ihtiyaçlar şunlardır:

1. E2E test altyapısını tekrar çalışır hâle getirmek
2. Production dependency açıklarını gidermek
3. Paketleme, imzalama, yayınlama ve otomatik güncelleme hattı kurmak
4. Hassas token ve diagnostic verilerinin güvenliğini artırmak
5. Electron izin ve webview yüzeyini sıkılaştırmak
6. Abort, streaming ve session izolasyonu gibi kritik davranışları gerçek entegrasyon testleriyle korumak
7. Yapılandırılmış gözlemlenebilirlik ve diagnostic export oluşturmak
8. Aşırı büyüyen dosyaları kontrollü biçimde ayrıştırmak
9. İlk yükleme ve bundle boyutunu azaltmak
10. Erişilebilirlik, recovery ve güven onboarding’ini ürün seviyesine taşımak

---

# 2. P0 — Yayın öncesi engelleyiciler

## 2.1. E2E test altyapısının onarılması

### Doğrulanmış durum

`npm run test:e2e -- --list` komutu şu anda başarısız olmaktadır.

İlk somut hata:

- `test/e2e/terminal.spec.ts:16`

Bozuk selector/sözdizimi:

```ts
page.locator("[data-testid='terminal-run"')
```

Bunun yanında bazı E2E sözleşmeleri güncel uygulamadan kopmuştur:

- `scripts/e2e.mjs` hâlâ `Sohbete dön` metnini arıyor.
- `test/e2e/settings.spec.ts` hâlâ `Sohbete dön` metnini kullanıyor.
- `scripts/e2e.mjs` kaldırılmış `TypewriterMarkdown` render yoluna bağlı source assertion’lar içeriyor.
- Ayarlar, composer ve Markdown mimarisindeki son değişiklikler E2E senaryolarına tam olarak yansıtılmamış.

### Risk

Vitest testlerinin geçmesi değerlidir; ancak testlerin önemli bir kısmı kaynak kod içinde string veya yapı sözleşmesi aramaktadır. Gerçek kullanıcı akışının browser/runtime üzerinde çalıştığını doğrulayan Playwright katmanı şu an parse aşamasında başarısız olduğu için güvence üretmemektedir.

### Gelecekte yapılacaklar

- Tüm Playwright dosyalarının parse edilmesini sağlamak
- Bozuk terminal selector’ını düzeltmek
- Ayarlar geri dönüş senaryosunu `Uygulamaya geri dön` kontrolüne taşımak
- Typewriter’a ait eski sözleşmeleri kaldırmak
- Güncel composer `+` menüsünü gerçek browser etkileşimiyle doğrulamak
- Mermaid render, fullscreen, kopyalama ve hata durumlarını test etmek
- CI’da şu zorunlu zinciri kurmak:

```text
typecheck → unit tests → e2e tests → production build
```

---

## 2.2. Production dependency açıklarının giderilmesi

### Doğrulanmış durum

`npm audit --omit=dev` taramasında beş production vulnerability raporlanmıştır:

- 1 kritik
- 3 yüksek
- 1 düşük

Öne çıkan paketler:

- `shell-quote`: kritik, transitif
- `undici`: yüksek, doğrudan bağımlılık
- `vite`: yüksek, doğrudan bağımlılık
- `protobufjs`: yüksek, transitif
- `esbuild`: düşük, transitif

Audit çıktısı ilgili açıklar için düzeltme bulunduğunu bildirmiştir.

### Risk

Quake aşağıdaki yüksek yetkili alanlarla çalıştığı için dependency açığının etkisi sıradan bir içerik uygulamasından daha yüksektir:

- Terminal komutları
- Yerel dosya sistemi
- MCP servisleri
- Browser bridge
- Computer use
- Ağ erişimi
- Secret yönetimi

### Gelecekte yapılacaklar

- Her açığın production erişilebilirliğini analiz etmek
- Doğrudan ve transitif bağımlılık zincirini çıkarmak
- Güvenli sürümlere kontrollü güncelleme yapmak
- Güncelleme sonrası typecheck, unit, E2E ve build doğrulaması çalıştırmak
- Dependency audit’i CI release kapısına eklemek
- Kritik ve yüksek production açıklarında release’i engelleyen politika tanımlamak

---

## 2.3. Paketleme, imzalama ve güncelleme altyapısı

### Doğrulanmış durum

İncelenen proje kapsamında aşağıdakiler için belirgin bir production konfigürasyonu bulunamamıştır:

- Electron Builder veya Electron Forge
- Windows NSIS/MSIX installer üretimi
- Kod imzalama
- macOS notarization
- Artifact yayınlama
- Otomatik güncelleme
- Güncelleme rollback mekanizması
- Stable/beta kanal ayrımı

Mevcut scriptler build ve Electron çalıştırma akışına sahiptir; ancak son kullanıcıya güvenli ve tekrar üretilebilir dağıtım hattı görünmemektedir.

### Gelecekte yapılacaklar

- Windows installer üretimi
- İmzalı executable ve installer
- macOS hedefleniyorsa notarization
- Stable ve preview kanalları
- Update manifest ve checksum
- Otomatik güncelleme
- Güncelleme başarısızlığında rollback
- Reproducible release build
- CI üzerinden artifact üretimi ve yayınlama
- Release öncesi smoke test
- Sürüm yükseltme ve veri migration testi

---

## 2.4. Hassas web token’ının loglanmasının kaldırılması

### Doğrulanmış durum

`src/server/index.ts` içinde web authentication token’ı açık biçimde loglanmaktadır:

```ts
if (auth.enabled) console.log(`Quake Code web token: ${auth.token}`);
```

### Risk

Token aşağıdaki yüzeylere sızabilir:

- Terminal çıktısı
- Log dosyaları
- CI logları
- Diagnostic paketleri
- Crash raporları
- Destek ekran görüntüleri

### Gelecekte yapılacaklar

Token değerinin kendisini hiçbir log kanalına yazmamak. Yalnızca durum bilgisi verilmelidir:

```text
Quake Code web kimlik doğrulaması etkin.
```

Ek olarak log redaction sistemi secret, token, API key ve authorization header değerlerini merkezi biçimde maskelemelidir.

---

# 3. P1 — Güvenlik ve güvenilirlik

## 3.1. Electron güvenlik yüzeyinin sıkılaştırılması

### Güçlü mevcut ayarlar

Ana BrowserWindow için aşağıdaki güvenli ayarlar doğrulanmıştır:

```ts
contextIsolation: true
nodeIntegration: false
sandbox: true
```

Harici linklerin dış tarayıcıda açılması ve ana pencerenin yerel sunucu dışında gezinmesinin engellenmesi için kontroller de bulunmaktadır.

### Geliştirilmesi gereken alanlar

Ana pencerede:

```ts
webviewTag: true
```

kullanılmaktadır.

CSP tarafında geniş izinler bulunmaktadır:

```text
script-src 'self' 'unsafe-inline'
style-src 'self' 'unsafe-inline'
frame-src http: https:
```

Ayrıca Electron session seviyesinde merkezi ve açık bir permission request policy doğrulanamamıştır.

### Riskler

- `webviewTag` ayrıcalıklı ve geniş bir saldırı yüzeyidir.
- `'unsafe-inline'`, olası XSS’in etkisini artırabilir.
- `frame-src http: https:` gereğinden geniş olabilir.
- Kamera, mikrofon, konum, bildirim ve clipboard izinleri merkezi bir deny-by-default politikasına bağlı olmayabilir.

### Gelecekte yapılacaklar

- `webviewTag` zorunlu değilse kapatmak
- Zorunluysa `will-attach-webview` ile URL, preload, partition ve webPreferences allowlist uygulamak
- `session.setPermissionRequestHandler` eklemek
- Kamera, mikrofon, konum ve bildirim izinlerini varsayılan reddetmek
- Clipboard izinlerini kontrollü hâle getirmek
- CSP nonce/hash mimarisine geçmek
- `frame-src` kapsamını gerçek ihtiyaçlarla sınırlandırmak
- Harici URL açma politikasını merkezi bir URL güvenlik modülüne taşımak
- IPC kanallarına açık allowlist ve payload validation uygulamak

---

## 3.2. Abort ve geç event davranışlarının gerçek E2E ile korunması

### Mevcut güçlü davranış

Quake’in abort tasarımı aşağıdaki sözleşmeyi hedeflemektedir:

- Kullanıcı `Yanıtı durdur` dediğinde renderer streaming görünümünü anında keser.
- Server abort sonucunu beklemeden pending UI temizlenir.
- Geç gelen `message_update`, assistant `message_end`, `tool_execution_*` ve browser activity event’leri karantinaya alınır.
- Yeni prompt veya session geçişine kadar eski streaming durumu maskelenir.
- Abort sonrasındaki `agent_end`, completion bildirimi veya queued prompt flush tetiklemez.

### Eksik güvence

Bu sözleşmenin gerçek SSE/WebSocket ve UI akışıyla çalışan deterministik bir entegrasyon testi görünmemektedir.

### Gelecekte yapılacak E2E senaryosu

1. Uzun bir assistant cevabı başlat
2. Tool streaming başlat
3. `Yanıtı durdur` kontrolüne bas
4. Geç `message_update` gönder
5. Geç `tool_execution_end` gönder
6. Geç `agent_end` gönder
7. UI’ın yeniden streaming’e dönmediğini doğrula
8. Completion bildirimi oluşmadığını doğrula
9. Yeni prompt gönder
10. Yeni turn’ün normal başladığını doğrula

---

## 3.3. Session izolasyonunun uçtan uca doğrulanması

### Korunması gereken sözleşme

Session izolasyonu yalnızca composer draft için değil, sağ panelin tamamı için geçerlidir:

- Panel açık/kapalı durumu
- Aktif sekme
- Dock sekme seti ve sırası
- Dosya bağlamı
- Browser bağlamı
- Preview bağlamı
- Plan bağlamı
- Launcher ve gelecekteki sekmeler
- Composer draft
- Pending UI yüzeyleri

### Gelecekte yapılacaklar

- İki session arasında ileri/geri geçiş testi
- Yeni session’ın temiz başlangıç testi
- Draft izolasyonu testi
- Sağ panel snapshot restore testi
- Plan pending request izolasyonu testi
- Abort quarantine’ın session geçişinde doğru temizlenmesi testi

---

## 3.4. Yapılandırılmış gözlemlenebilirlik ve diagnostic altyapısı

### Doğrulanmış durum

Projede ağırlıklı olarak şu mekanizmalar kullanılmaktadır:

```ts
console.log
console.warn
console.error
```

Window unresponsive gibi bazı crash diagnostic event’leri kaydedilmektedir. Ancak aşağıdaki sistemler belirgin değildir:

- Yapılandırılmış JSON log
- Log rotation
- Session/turn/tool correlation ID
- Tool latency metriği
- Model first-token latency
- SSE reconnect metriği
- Crash dump yönetimi
- Kullanıcı kontrollü diagnostic export
- Health/readiness endpoint’i
- Destek paketi oluşturma

### Gelecekte yapılacaklar

Yerel-first bir diagnostic modeli oluşturulmalıdır. Önerilen alanlar:

```text
timestamp
severity
event
sessionId
turnId
toolId
provider
model
durationMs
result
```

Gizlilik kuralları:

- Prompt metni varsayılan olarak loglanmamalı
- Model yanıtı varsayılan olarak loglanmamalı
- Dosya içeriği loglanmamalı
- Secret ve token’lar merkezi olarak maskelenmeli
- Diagnostic export kullanıcı onayı gerektirmeli
- Kullanıcı paketin içeriğini göndermeden önce inceleyebilmeli

Ayarlar altında gelecekte şu kontrol eklenebilir:

> Tanılama paketi oluştur

---

## 3.5. Bağlantı ve recovery durumu

### Mevcut risk

Server event stream sorunları loglanabilse de kullanıcıya dönük merkezi bir bağlantı durum modeli tam görünür değildir.

### Gelecekte desteklenmesi gereken durumlar

- Yeniden bağlanıyor
- Bağlantı kesildi
- Runtime yeniden başlatıldı
- Turn korunuyor
- Tekrar dene
- Tanılama göster
- Session restore başarısız
- Partial state recovery

Bu durumlar Semantic Flow headline’a yüklenmemeli; global bağlantı/recovery katmanında gösterilmelidir.

---

# 4. P1 — Test stratejisi

## 4.1. Source-contract testlerinin davranış testleriyle tamamlanması

### Mevcut durum

Aşağıdaki testler mimari sözleşmeleri kaynak kod seviyesinde korumaktadır:

- `test/semantic-flow-source.test.ts`
- `test/timeline-markdown-source.test.ts`
- `test/composer-controls-source.test.ts`
- `test/settings-navigation-source.test.ts`
- `test/plan-card-source.test.ts`

Bunlar yararlıdır; ancak bir string’in veya fonksiyon adının kaynakta bulunması davranışın gerçekten çalıştığını garanti etmez.

### Gelecekte eklenecek katmanlar

#### Bileşen testleri

- `MarkdownMessage`
- `SemanticHeadlineTransition`
- `TurnSemanticFlow`
- `ChatComposer`
- `SettingsPage`
- `PlanArtifactPanel`
- Tool detail disclosure’ları

#### Fake timer testleri

Semantic Flow için:

- 240 ms leave
- 480 ms enter
- 850 ms minimum hold
- 140 ms coalescing
- Latest snapshot wins
- Reduced-motion fallback

#### Durum makinesi testleri

```text
thinking → read → edit → done
thinking → concurrent tools → error
edit A → edit B → latest only
thinking → no tool → completed
abort → late event suppression
```

#### Electron entegrasyon testleri

- Allowlist dışı IPC reddediliyor mu?
- External URL policy çalışıyor mu?
- Webview güvenlik ayarları korunuyor mu?
- Secret değerleri renderer’a sızıyor mu?
- Preload API yalnızca beklenen metotları sunuyor mu?

---

## 4.2. Semantic Flow gerçek runtime testi

Gelecekte gerçek bir request şu aşamaları içermelidir:

- `[thinking]` içeriği
- Dosya okuma
- Web veya repo araması
- Dosya düzenleme
- Komut çalıştırma
- 3–4 eşzamanlı tool
- Tamamlanma

Aynı turn-level headline’ın aşağıdaki durumlara morph ettiği doğrulanmalıdır:

```text
Düşünüyor
Okunuyor
Aranıyor
Düzenleniyor
Çalıştırılıyor
Tamamlandı
```

Ayrıca:

- Edit state’in 850 ms hold ve 140 ms coalescing nedeniyle gereksiz şekilde kaybolup kaybolmadığı
- Thinking ayrıntılarının erişilebilir kaldığı
- `Araç ayrıntıları` disclosure’ının çalıştığı
- Aynı anda iki okunabilir headline katmanının görünmediği
- Headline yüksekliğinin sabit kaldığı

doğrulanmalıdır.

---

## 4.3. Markdown ve Mermaid davranış testleri

Gelecekte aşağıdakiler gerçek render üzerinden doğrulanmalıdır:

- Streaming ve settled DOM sözleşmesinin eşitliği
- Eksik Markdown parsing
- Fenced code içinde protocol marker’larının işlenmemesi
- GFM table render’ı
- Shiki lazy language yükleme
- Kod kopyalama
- Quake file links
- Güvenli URL protokolleri
- Mermaid strict security
- Mermaid copy/fullscreen/pan-zoom
- Geçersiz Mermaid için kullanıcı dostu hata
- Çok büyük code block ve diyagramlarda performans

---

# 5. P1 — Mimari teknik borç

## 5.1. Büyük dosyalar ve ownership sınırları

İnceleme sırasında öne çıkan yaklaşık dosya boyutları:

- `src/client/src/main.tsx`: 267 KB
- `src/client/styles.css`: 154 KB
- `src/client/src/components/settings/SettingsPanels.tsx`: 93 KB
- `src/client/src/components/markdown/MarkdownMessage.tsx`: 70 KB
- `src/server/runtime.ts`: 57 KB
- `src/server/index.ts`: 51 KB
- `src/client/src/components/browser/BrowserPanel.tsx`: yaklaşık 50 KB
- `src/client/src/components/settings/ProvidersSection.tsx`: yaklaşık 37 KB
- `electron/main.ts`: 38 KB
- `src/client/src/components/files/FilesPanel.tsx`: yaklaşık 26 KB

Bu durum yalnızca stil veya dosya uzunluğu problemi değildir. Aşağıdaki riskleri artırır:

- Ownership belirsizliği
- Regresyon riski
- Test kurulumu zorluğu
- Merge conflict
- Gizli coupling
- Render performansını analiz etme güçlüğü
- Yeni geliştirici onboarding maliyeti

---

## 5.2. `main.tsx` ayrıştırma planı

`main.tsx` çok sayıda ürün sorumluluğunu taşımaktadır:

- Session lifecycle
- Server/SSE event handling
- Composer
- Timeline
- Plan Mode
- Abort quarantine
- Right panel
- Workspace
- Notifications
- Browser event’leri
- Settings navigation

Gelecekte önerilen modül sınırları:

```text
features/session/
features/timeline/
features/plan/
features/composer/
features/right-panel/
runtime/event-reducer/
runtime/abort-controller/
```

Yaklaşım büyük rewrite olmamalıdır. Önce şu düşük riskli parçalar çıkarılmalıdır:

1. Saf selector fonksiyonları
2. Event reducer’ları
3. Abort/quarantine state machine
4. Session-owned panel snapshot modeli
5. Plan UI adaptörleri
6. Timeline windowing yardımcıları

---

## 5.3. `MarkdownMessage.tsx` ayrıştırma planı

Dosya şu anda birden fazla sistemin sahibi durumundadır:

- Streamdown render
- Mermaid
- Thinking parsing ve ayrıntıları
- Turn-level Semantic Flow
- Tool aggregation
- Tool detail cards
- Diff istatistikleri
- Tool output preview
- Syntax highlighting
- URL güvenliği

Önerilen ayrım:

```text
markdown/MarkdownMessage.tsx
markdown/markdown-segments.ts
semantic-flow/TurnSemanticFlow.tsx
semantic-flow/semantic-headline.ts
tools/ToolCallNotice.tsx
tools/ToolRunDetails.tsx
tools/tool-preview.ts
```

Semantic Flow artık ayrı ve birinci sınıf bir ürün modülü olarak ele alınmalıdır.

---

## 5.4. Settings mimarisinin bölünmesi

`SettingsPanels.tsx` yaklaşık 93 KB boyutundadır. Gelecekte her ayar alanı kendi veri sözleşmesine ve bileşenine ayrılmalıdır:

```text
settings/appearance/
settings/models/
settings/providers/
settings/security/
settings/mcp/
settings/diagnostics/
settings/about/
```

Ayar kontrolü şu ortak sözleşmeleri kullanmalıdır:

- Persistence
- Validation
- Default value
- Reset
- Search metadata
- Import/export eligibility
- Restart requirement
- Session/global scope

---

## 5.5. Repository hygiene

Projede `_backups` ve ayrıca `backups` altında büyük kaynak kopyaları bulunmaktadır. Migration backup’ları operasyonel olarak faydalı olabilir; ancak uzun vadede repository boyutunu ve kaynak doğruluğu algısını bozabilir.

Gelecekte yapılacaklar:

- Hangi backup’ların geçici, hangilerinin kalıcı olduğunu belirlemek
- Geçici backup’ları repo dışında veya artifact storage’da tutmak
- Migration kaydı için kaynak kopyası yerine özet/manifest kullanmak
- Generated test/build çıktılarının commit durumunu netleştirmek
- `playwright-report`, `test-results` ve benzeri çıktılar için ignore politikası doğrulamak

---

# 6. P1 — Performans ve bundle

## 6.1. Mevcut artifact boyutu

Doğrulanan production client dizini yaklaşık 30 MB boyutundadır.

Öne çıkan artifact’ler:

- TypeScript worker: yaklaşık 6 MB
- Monaco: yaklaşık 3.87 MB
- Ana bundle: yaklaşık 1.68 MB
- CSS worker: yaklaşık 1 MB
- Emacs Lisp grammar: yaklaşık 780 KB
- Bazı dil ve diagram modülleri: yaklaşık 400–700 KB
- Xterm chunk: yaklaşık 327 KB

### Risk

Monaco, Shiki, Mermaid, terminal ve browser paneli ilk açılışta gereğinden fazla ağ, parse ve memory maliyeti oluşturabilir. Electron yerel çalışsa bile JS parse/compile ve renderer memory maliyeti devam eder.

### Gelecekte yapılacaklar

- Monaco’yu yalnızca editör açıldığında yüklemek
- Mermaid’i yalnızca Mermaid fence bulunduğunda yüklemek
- Xterm’i yalnızca terminal sekmesi açıldığında yüklemek
- Browser panelini ayrı chunk yapmak
- Settings ve Providers alanlarını lazy-load etmek
- Shiki language allowlist kullanmak
- Düşük kullanım ihtimalli grammar’ları isteğe bağlı yüklemek
- Main bundle için bundle budget tanımlamak
- Build sırasında budget aşımını raporlamak
- Cold start, first paint ve memory ölçmek

### Önerilen hedefler

- Ana shell JS gzip boyutunu mümkünse 300 KB altına yaklaştırmak
- İlk paint sırasında Monaco yüklememek
- Kod ve diyagram özelliklerini ihtiyaç halinde yüklemek
- Splash’tan kullanılabilir composer’a kadar süreyi ölçmek

---

## 6.2. Uzun streaming performansı

Quake uzun tool geçmişi ve streaming cevaplar için çeşitli bounded/windowed optimizasyonlara sahiptir. Bunlar gerçek benchmark ile korunmalıdır.

Gelecekte ölçülecek senaryolar:

- 1.000+ mesajlık session
- 5.000+ tool event’i
- Çok büyük patch output
- Uzun code block
- Çok sayıda concurrent tool
- Uzun süre açık renderer
- Session’lar arasında tekrar tekrar geçiş

Ölçümler:

- Renderer memory
- Commit süresi
- Timeline scroll FPS
- Stream sırasında CPU
- Garbage collection baskısı
- Tool state prune süresi
- Session restore süresi

---

# 7. P2 — Ürün deneyimi

## 7.1. Appearance ayarlarının ürün seviyesine taşınması

Mevcut Appearance alanında tema, yoğunluk ve araç etkinliğiyle ilgili sınırlı seçenekler bulunmaktadır. Gelecekte yüksek değer üreten, küratörlü bir paket önerilir:

- Sistem / Koyu / Açık tema
- Arayüz kontrastı
- Sohbet genişliği
- Sohbet yazı boyutu
- Semantic Flow / Kompakt / Ayrıntılı araç görünümü
- Tamamlanmış araçların varsayılan açık/kapalı durumu
- Hareket seviyesi
- Kod satırı sarma

Bu alan bir “ayar çöplüğü”ne dönüştürülmemelidir. Yalnızca okunabilirlik, erişilebilirlik, performans veya çalışma biçimine gerçek etkisi olan seçenekler eklenmelidir.

---

## 7.2. Güven onboarding’i

Quake aşağıdaki yüksek yetkili özelliklere sahiptir:

- Terminal
- Dosya yazma
- Browser erişimi
- MCP
- Computer use
- Goal scheduler

İlk kullanım deneyimi kısa ve açık bir güven sözleşmesi sunmalıdır:

1. Çalışma alanı sınırı
2. Terminal güvenlik politikası
3. Browser erişim modeli
4. Computer-use özelliğinin varsayılan durumu
5. Secret saklama yöntemi
6. Hangi eylemlerin kullanıcı onayı istediği
7. Log ve diagnostic gizlilik politikası

Bu pazarlama onboarding’i değil, ürün güven modeli olmalıdır.

---

## 7.3. Ayar export, restore ve recovery

Gelecekte aşağıdaki işlemler değerlendirilebilir:

- Ayarları dışa aktar
- Kısayolları dışa aktar
- MCP yapılandırmasını secret’sız dışa aktar
- Tema ve görünüm ayarlarını dışa aktar
- Fabrika ayarlarına dön
- Session veritabanını doğrula/onar
- Tanılama paketi oluştur

Kurallar:

- Secret’lar export’a dahil edilmemeli
- Token’lar export’a dahil edilmemeli
- Workspace’e özel yollar kullanıcıya açıkça gösterilmeli
- Import öncesinde preview ve validation yapılmalı

---

## 7.4. Hata deneyimi

Hatalar yalnızca toast veya console log olarak ele alınmamalıdır. Ürün seviyesinde hata sınıfları belirlenmelidir:

- Provider authentication hatası
- Model erişim hatası
- Rate limit
- Ağ bağlantısı
- Runtime crash
- Tool timeout
- Dosya izni
- Workspace dışına çıkma girişimi
- MCP bağlantı hatası
- Browser bridge hatası
- Update hatası

Her sınıf için kullanıcıya şunlar sunulmalıdır:

- Ne oldu?
- Veriler korundu mu?
- Ne tekrar denenebilir?
- Hangi ayar düzeltilmeli?
- Diagnostic ayrıntısı nerede?

---

# 8. P2 — Erişilebilirlik

Temel ARIA kullanımı mevcut olsa da aşağıdaki matris gerçek testlerle doğrulanmalıdır:

- Yalnızca klavyeyle tüm uygulama
- Dock ve popover gezinmesi
- Focus restore
- Modal focus trap
- Screen reader
- Semantic Flow announcement coalescing
- Reduced-motion
- Yüksek kontrast
- %200 zoom
- Windows display scaling
- Renk dışında durum işaretleri
- Mermaid fullscreen erişilebilirliği
- Composer menülerinin Escape davranışı
- Tool disclosure’larının klavye davranışı

Semantic Flow `aria-live="polite"` kullanırken hızlı tool değişimlerinin screen reader spam’i üretmemesi gerekir. Görsel coalescing ile accessibility announcement coalescing aynı durum modeline bağlanmalıdır.

---

# 9. P2 — Release ve operasyon

## 9.1. CI matrisi

Gelecekte önerilen CI aşamaları:

```text
Install
Typecheck
Lint
Unit tests
Component tests
Playwright web E2E
Electron integration tests
Production build
Dependency audit
Bundle budget
Package
Sign
Smoke install
Publish artifact
```

İşletim sistemi matrisi, ürün hedeflerine göre en az Windows’u kapsamalıdır. macOS/Linux desteklenirse ilgili runner ve smoke test’ler eklenmelidir.

---

## 9.2. Release kanalları

Önerilen model:

- `stable`
- `preview`
- Gerekirse internal/nightly

Her release için:

- Sürüm notları
- Breaking change bilgisi
- Migration bilgisi
- Bilinen sorunlar
- Checksum
- İmzalı artifact
- Rollback bilgisi
- Minimum desteklenen işletim sistemi

---

## 9.3. Veri migration ve rollback

Session, settings, plan artifact ve secret storage formatları sürümlenmelidir.

Gelecekte:

- Schema version
- İleri migration
- Migration öncesi güvenli backup
- Başarısız migration rollback
- Eski sürüme dönüş uyumluluğu
- Corrupt state recovery

test edilmelidir.

---

# 10. Önerilen uygulama yol haritası

## Faz 1 — Güvenilir temel

1. Playwright testlerini tekrar çalışır hâle getir
2. Stale `scripts/e2e.mjs` sözleşmelerini temizle
3. Production dependency açıklarını gider
4. Web token loglamasını kaldır
5. Abort/late-event E2E testi ekle
6. Session izolasyonu E2E testi ekle
7. Semantic Flow lifecycle E2E testi ekle
8. Mermaid gerçek render testi ekle

## Faz 2 — Production readiness

9. Electron permission ve webview hardening
10. Yapılandırılmış yerel logging
11. Diagnostic export
12. Health/readiness modeli
13. Electron paketleme
14. Kod imzalama
15. Auto-update ve rollback
16. Stable/preview release kanalları
17. CI release pipeline

## Faz 3 — Mimari ve performans

18. `main.tsx` sorumluluklarını kontrollü ayır
19. Semantic Flow’u ayrı modüle çıkar
20. `MarkdownMessage.tsx` sorumluluklarını böl
21. `SettingsPanels.tsx` bölümlerini ayır
22. Server route/runtime sınırlarını netleştir
23. Monaco’yu lazy-load et
24. Mermaid, terminal ve browser panelini lazy-load et
25. Shiki dil kapsamını optimize et
26. Bundle budget testi ekle
27. Uzun session benchmark’ları oluştur

## Faz 4 — Ürün olgunluğu

28. Appearance ayarlarını gerçek kontrollerle genişlet
29. Bağlantı ve recovery deneyimi ekle
30. Güven onboarding’i ekle
31. Erişilebilirlik matrisi uygula
32. Ayar export/import ve reset ekle
33. Diagnostic/support workflow oluştur
34. Release ve upgrade dokümantasyonu tamamla

---

# 11. İlk uygulanması önerilen çalışma paketi

## Reliability & Release Readiness

Önerilen ilk paket:

- E2E testlerinin onarılması
- Dependency güvenliği
- Token log temizliği
- Semantic Flow gerçek davranış testleri
- Abort ve late-event testleri
- Session izolasyon testleri
- Electron permission hardening
- Paketleme ve güncelleme planı

### Gerekçe

Quake’in görsel ve etkileşim kalitesi güçlü bir seviyeye ulaşmıştır. En büyük ihtiyaç artık yeni bir görsel özellik değil; mevcut kaliteli deneyimi:

- Her makinede
- Güvenli biçimde
- Ölçülebilir olarak
- Güncellenebilir şekilde
- Regresyona karşı korunmuş hâlde

dağıtabilmektir.

---

# 12. Doğrulanmış bulgular ile değerlendirme ayrımı

## Doğrulanmış bulgular

- 20 Vitest test dosyası ve 73/73 başarılı test
- Playwright test listesi parse hatası nedeniyle çalışmıyor
- `test/e2e/terminal.spec.ts` içinde bozuk selector var
- E2E dosyalarında eski `Sohbete dön` metni bulunuyor
- `scripts/e2e.mjs` içinde eski `TypewriterMarkdown` referansları bulunuyor
- Production audit’te 5 vulnerability raporlandı
- Web auth token’ı server loguna açık değer olarak yazılıyor
- Electron’da `contextIsolation`, `nodeIntegration: false` ve `sandbox: true` kullanılıyor
- `webviewTag: true` kullanılıyor
- CSP’de `'unsafe-inline'` ve geniş `frame-src` izinleri bulunuyor
- Client production artifact dizini yaklaşık 30 MB
- Monaco ve worker chunk’ları büyük boyutta
- Bazı ana kaynak dosyaları 50–267 KB aralığında
- Belirgin bir installer/signing/auto-update yapılandırması bulunamadı
- Gözlemlenebilirlik ağırlıklı olarak console logging üzerinden ilerliyor

## Değerlendirme ve muhtemel riskler

- Büyük dosyalar ownership ve regresyon riskini artırabilir
- Webview ve geniş CSP izinleri saldırı yüzeyini artırabilir
- E2E katmanının çalışmaması kritik kullanıcı akışlarında görünmeyen regresyonlara yol açabilir
- Paketleme/update altyapısı olmadan son kullanıcı dağıtımı operasyonel risk taşır
- Büyük bundle cold start ve memory maliyetini artırabilir
- Yapılandırılmış diagnostic eksikliği production sorunlarının kök neden analizini zorlaştırabilir

Bu risklerin etkisi uygulama sırasında ayrıca ölçülmeli ve doğrulanmalıdır.

---

# 13. Notlar

- Bu belge 12 Temmuz 2026 tarihli proje durumunu yansıtır.
- Maddeler gelecekte toplu veya fazlar hâlinde uygulanacaktır.
- Her çalışma başlamadan önce ilgili alan yeniden doğrulanmalıdır; kod ve bağımlılıklar zamanla değişebilir.
- Güvenlik güncellemeleri ve release blocker’lar yeniden tarandığında öncelik sırası değişebilir.
- Uygulama sırasında mevcut Quake davranışları, session izolasyonu, Semantic Flow sözleşmesi ve streaming renderer bütünlüğü korunmalıdır.
