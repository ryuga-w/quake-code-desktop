# Ayarlar İşlevsellik Denetimi

Tarih: 2026-07-19

Bu belge, Quake Desktop ayarlarında görünen kontrollerin gerçek uygulama davranışına bağlı olup olmadığını özetler. Amaç; yalnızca arayüzde kaydedilen fakat runtime tarafından tüketilmeyen tercihleri, kısmi entegrasyonları ve gerçekten çalışan akışları ayırmaktır.

## Öncelikli sonuç

Ayarların önemli bir bölümü gerçek runtime, API veya Electron katmanına bağlıdır. Ancak özellikle **Tarayıcı**, **Genel** ve **Görünüm** sayfalarında bazı kontroller yalnızca `localStorage` değerini değiştirir; ilgili uygulama davranışı bu değerleri okumaz.

Önerilen uygulama sırası:

1. Tarayıcı tercihlerini `BrowserPanel` ve Electron tarayıcı katmanına bağla.
2. Genel sayfasındaki kaydedilip tüketilmeyen tercihleri bağla veya geçici olarak gizle.
3. Görünüm sayfasındaki özel tema/font seçeneklerini gerçek tema runtime'ına bağla.
4. “Onay iste / Read Only” açıklaması ile terminal davranışını eşitle.
5. Kalan placeholder eylemleri gerçek akışlara bağla.

---

## 1. Tarayıcı sayfası

### Kaydediliyor fakat uygulanmıyor

Aşağıdaki değerler `quake-web:browserPreferences` içine yazılır ancak tarayıcı veya Electron katmanı tarafından tüketilmez:

- Yerleşik tarayıcıyı etkinleştir/devre dışı bırak
- Web URL açma hedefi (`webOpenTarget`)
- Yerel URL açma hedefi (`localOpenTarget`)
- Açıklama ekran görüntüsü politikası (`screenshotPolicy`)
- İndirme klasörü (`downloadDirectory`)
- Her indirmede konum sorma (`askDownloadLocation`)
- Site açma onayı (`siteApproval`)

Not: İndirme klasörü için masaüstü klasör seçici gerçekten açılır ve yol kaydedilir; fakat seçilen yol indirme motoruna uygulanmaz.

### Placeholder eylemler

Bu eylemler yalnızca “çalışma katmanı sonraki aşamada bağlanacak” bildirimi gösterir:

- Tarayıcı verilerini içe aktarma
- Tarama verilerini temizleme
- Şifre yöneticisini yönetme
- İletişim bilgilerini yönetme
- İndirme geçmişini yönetme

### Bağlanması gereken katmanlar

- `src/client/src/components/settings/BrowserSettings.tsx`
- `src/client/src/components/dock/BrowserPanel.tsx`
- `electron/main.ts`
- `electron/preload.ts`

---

## 2. Genel sayfası

### Kaydediliyor fakat uygulanmıyor

Aşağıdaki tercihler `quake-web:generalPreferences` içine kaydedilir ancak uygulamada gerçek tüketicileri yoktur:

- Varsayılan dosya açma hedefi (`fileOpenTarget`)
- Arayüz dili (`language`)
- Alt panel düğmesini göster (`showBottomPanelAction`)
- Gönderme kısayolu (`sendShortcut`)
- Takip davranışı (`followBehavior`)
- Global açılır pencere kısayolu (`popupShortcut`)
- Projesiz görevi varsayılan yap (`defaultNoProject`)
- İzin bildirimleri (`permissionNotifications`)
- Soru bildirimleri (`questionNotifications`)
- Otomatik inceleme (`autoReview`)

### Somut davranış farkları

- `sendShortcut = ctrl-enter` seçilse bile composer hâlâ normal Enter ile gönderir.
- `followBehavior = queue` seçilse bile aktif tur sırasında yeni mesaj steer akışına gider.
- `defaultNoProject` yeni görev başlangıcını değiştirmez.
- `showBottomPanelAction` titlebar terminal düğmesinin görünürlüğünü değiştirmez.
- `permissionNotifications` ve `questionNotifications` onay/soru akışlarında okunmaz.

### Placeholder eylemler

- Diğer AI uygulamalarından çalışmaları içe aktarma
- Açık kaynak lisanslarını görüntüleme

### Gerçekten çalışan tercihler

- Varsayılan izinler / terminal policy
- Tam erişim
- Entegre terminal kabuğu
- Bağlam penceresi kullanımını göster
- Tur tamamlama bildirimi tercihi

### Bağlanması gereken katmanlar

- `src/client/src/components/settings/GeneralSettings.tsx`
- `src/client/src/lib/general-preferences.ts`
- `src/client/src/components/composer/ChatComposer.tsx`
- `src/client/src/app/App.tsx`
- `src/client/src/components/chrome/Titlebar.tsx`
- Electron global shortcut katmanı

---

## 3. Görünüm sayfası

### Gerçekten çalışanlar

- Açık / koyu / sistem teması
- Arayüz yoğunluğu
- Composer petini gösterme
- Hareketi azaltma (özellikle composer pet animasyonları)

### Kaydediliyor fakat uygulanmıyor

Aşağıdaki değerler `quake-web:appearancePreferences` içine yazılır ancak gerçek tema/runtime tarafından tüketilmez:

- Açık kod teması (`lightCodeTheme`)
- Koyu kod teması (`darkCodeTheme`)
- Tema vurgu rengi (`accent`)
- Tema arka plan rengi (`background`)
- Tema ön plan rengi (`foreground`)
- Arayüz yazı tipi (`uiFont`)
- Kod yazı tipi (`codeFont`)
- Yarı saydam sidebar (`translucentSidebar`)
- Kontrast (`contrast`)
- İşaretçi imleçleri (`pointerCursors`)
- Arayüz yazı tipi boyutu (`uiFontSize`)
- Kod yazı tipi boyutu (`codeFontSize`)
- Fark işaretleri (`differenceMarkers`)

Tema JSON içe aktarma ve panoya kopyalama çalışır; ancak yukarıdaki özel değerlerin çoğu gerçek arayüze uygulanmaz.

### Mevcut runtime sınırı

`src/client/src/lib/appearance-runtime.ts` şu anda yalnızca aşağıdaki tercihleri uygular:

- `composerPet`
- `motion`

### Bağlanması gereken katmanlar

- `src/client/src/lib/appearance-runtime.ts`
- Global CSS semantik tokenları
- Monaco / Shiki tema seçimi
- NavRail yüzey davranışı
- Diff ve değişiklik göstergeleri
- Xterm font ve renk seçenekleri

---

## 4. Davranış uyuşmazlığı: Onay iste / Read Only

Arayüz açıklaması, `disabled` modunu riskli yazma ve komut işlemlerinden önce kullanıcıya soran “Onay iste / Read Only” rejimi gibi sunar.

Ancak tek seferlik terminal politikasında `disabled` modu şu davranışı uygular:

- Komutu onaya göndermek yerine doğrudan reddeder.
- “Terminal paneli kapalı” sonucu üretir.

İlgili dosya:

- `src/server/terminal-policy.ts`

Düzeltilmesi gereken seçeneklerden biri:

1. `disabled` modunu gerçekten approval akışına bağlamak, veya
2. Arayüz metnini “Terminal komutlarını kapat” şeklinde dürüstçe değiştirmek.

---

## 5. Kısmen çalışan özellikler

### MCP OAuth

Çalışanlar:

- Bearer token
- Electron güvenli secret kasası
- Header secret referansları

Eksik:

- Tarayıcı OAuth giriş akışı
- Authorization code değişimi
- Refresh token yönetimi

### Kısayollar

- Listelenen mevcut kısayollar çalışır.
- Kullanıcı tarafından yeniden atanamazlar.

### Uzantılar

- Mevcut uzantıları etkinleştirme/devre dışı bırakma çalışır.
- Yeni uzantı yükleme/kurma akışı bağlı değildir.

### Otomatik güncelleme

- Electron masaüstü kabuğunda ve update feed yapılandırılmışsa çalışır.
- Web ortamında uygulanmaz; bu beklenen sınırdır.

---

## 6. Gerçek runtime veya API'ye bağlı çalışan bölümler

- Model seçimi
- Düşünme seviyesi
- Varsayılan model ve varsayılan düşünme seviyesi
- Composer model sabitleme
- Provider OAuth / API anahtarı / hesap rotasyonu
- Sistem bildirimleri ve sesler
- Goal tur bütçesi
- Goal ilerlemesiz tur toleransı
- Goal otomatik devam
- Goal uyku engelleme
- Goal tamamlanma bildirimi
- Computer Use eklentisi ve politikası
- Computer Use adım limiti ve araç modu
- MCP sunucu ekleme/silme/başlatma/durdurma
- MCP araç politikaları
- MCP resource ve prompt akışları
- MCP secret kasası
- Terminal erişim politikası
- İşbirlikçi ağ proxy'si
- Deneysel OS sandbox bayrağı
- Paralel ajan worktree izolasyonu
- Görsel gönderme ve gösterme politikaları
- Kalıcı guardian izinleri
- Sohbet dışa aktarma
- Ayar dışa/içe aktarma
- Bağlam sıkıştırma
- Komut geçmişini temizleme
- Electron otomatik güncelleme

---

## 7. Uygulama planı

### P0 — Yanıltıcı kontrolleri düzelt

- Çalışmayan ayarları bağlayana kadar “yakında” olarak işaretle veya devre dışı bırak.
- Read Only / Onay iste açıklaması ile terminal politikasını eşitle.

### P1 — Tarayıcı entegrasyonu

- Tercihleri merkezi bir `browser-preferences` modülünden oku.
- Browser açma hedeflerini tüm URL açma girişlerine uygula.
- Download konumu ve “her seferinde sor” tercihini Electron `will-download` akışına bağla.
- Site approval politikasını browser navigation/tool katmanına bağla.
- Screenshot politikasını annotation bundle üretimine bağla.
- Tarama verilerini temizleme için gerçek Electron API ekle.

### P2 — Genel tercihler

- Composer Enter/Ctrl+Enter davranışını `sendShortcut` ile yönet.
- Aktif tur mesajını `followBehavior` ile queue veya steer olarak yönlendir.
- Titlebar alt panel düğmesini `showBottomPanelAction` ile yönet.
- Yeni sohbet başlangıcında `defaultNoProject` uygula.
- Dosya açma hedefini tüm dosya girişlerinde uygula.
- Global popup shortcut için Electron registration ekle.
- İzin ve soru bildirimlerini ilgili event akışlarına bağla.

### P3 — Görünüm runtime'ı

- Tema draft değerlerinden semantik CSS tokenları üret.
- UI ve kod font boyutlarını runtime değişkenlerine bağla.
- Monaco/Shiki/Xterm kod teması ve fontunu bağla.
- Sidebar saydamlığını NavRail tokenlarına uygula.
- Pointer ve diff marker tercihlerini CSS data attribute olarak uygula.

### P4 — Kalan ürün akışları

- AI uygulamalarından içe aktarma
- Açık kaynak lisansları görünümü
- Tarayıcı parola/iletişim/indirme geçmişi yönetimi
- Tam MCP OAuth
- Kullanıcı tarafından düzenlenebilir klavye kısayolları
- Uzantı kurma/yükleme akışı
