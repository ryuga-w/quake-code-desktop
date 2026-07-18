# Quake Code Self-Improvement Architecture v1

Bu doküman, Quake Code'u kendi kendini test eden, kendi kendini geliştiren, rakiplerle kıyaslayabilen ve uzun süreli otonom geliştirme döngüleri çalıştırabilen bir sisteme dönüştürme vizyonunu özetler.

---

## Amaç

Uzun vadeli hedef:
- Quake Code'un kendi CLI/TUI/OS akışlarını test edebilmesi
- kendi bug'larını bulup çözebilmesi
- kendi yeteneklerini benchmark edip geliştirebilmesi
- model/provider/fallback stratejileri ile çalışmayı sürdürebilmesi
- rakip CLI'larla kendini kıyaslayıp ürün kalitesini artırabilmesi

Bu vizyon sadece bir coding agent değil, bir **self-improving coding system** hedefidir.

---

## Ana fikir

Sistem 4 ana katmandan oluşur:

1. **Coding agent**
   - repo okur
   - plan yapar
   - kod yazar
   - test/build çalıştırır

2. **OS/TUI execution agent**
   - Windows desktop kullanır
   - Quake Code CLI/TUI akışlarını gerçek kullanıcı gibi test eder
   - pencere/focus/clipboard/input davranışlarını doğrular

3. **Self-improvement orchestrator**
   - hangi probleme saldırılacağını seçer
   - benchmark ve issue kuyruğunu yönetir
   - patch/test/retry döngülerini koordine eder
   - budget/model/provider fallback kararları verir

4. **Comparative optimization layer**
   - rakip CLI'larla kıyas yapar
   - skor farklarını analiz eder
   - ürün geliştirme öncelikleri üretir

---

## Bu mimaride OS agent'in rolü

OS agent bu sistemin kritik parçasıdır.

OS agent olmadan Quake Code:
- kendi interactive TUI akışlarını güvenilir test edemez
- login/model-switch/provider-switch akışlarını gerçek ortamda doğrulayamaz
- desktop tabanlı edge-case'leri yakalayamaz
- gerçek kullanıcı davranışına yakın regression testler koşturamaz

OS agent bu büyük sistemde şu rolleri oynar:
- **eller**: click/type/drag/scroll/hotkey
- **gözler**: inspect/screenshot/window/focused element
- **durum algısı**: hwnd/foreground/focus/clipboard
- **doğrulama motoru**: os_perform_step + state verification

---

## Mevcut durum

Halihazırda oluşmuş temel yetenekler:
- foreground ve ghost input desteği
- hwnd-aware action execution
- focus/activate window
- hotkey/send_keys/scroll/clipboard shortcuts
- focused element observation
- clipboard observation
- os_perform_step ile verification
- native fallback ile sahte success'in kaldırılması
- action surface'in aşamalı genişletilmesi

Bu, self-improvement mimarisinin OS tarafı için güçlü bir başlangıçtır.

---

## Hedef sistem bileşenleri

### 1) Benchmark Runner

Görevleri:
- standart görev setleri koşturmak
- başarı/başarısızlık toplamak
- latency, retry, verification quality ölçmek
- geçmiş sonuçları saklamak

Örnek benchmark tipleri:
- repo okuma / edit / build / test
- TUI kullanım akışları
- login / provider switch akışları
- OS interaction flows
- long-context / compaction / recovery senaryoları

---

### 2) Autonomous Improvement Loop

Temel döngü:
1. problem seç
2. repo taraması yap
3. plan üret
4. değişiklik uygula
5. build/test çalıştır
6. OS/TUI smoke test yap
7. sonuçları skorla
8. gerekirse retry / fallback / rollback yap
9. sonraki probleme geç

Bu loop kontrollü şekilde çalışmalıdır.

---

### 3) Provider / Model Fallback Layer

Amaç:
- tek modele bağımlı kalmamak
- quota, maliyet, hata, hız gibi nedenlerle model değiştirebilmek
- local proxy ve farklı provider akışlarını sürdürülebilir biçimde yönetmek

Desteklenecek karar tipleri:
- mevcut model başarısızsa alternatif modele düş
- maliyet yüksekse daha ucuz modele geç
- reasoning gerekiyorsa güçlü modele çık
- login/proxy state uygunsa farklı rotaya yönel

Not: Bu katman policy-aware ve budget-aware olmalıdır.

---

### 4) Governor / Safety Layer

Bu katman olmadan tam otonomi risklidir.

Sorumlulukları:
- budget limiti
- çalışma süresi limiti
- retry üst sınırı
- riskli değişiklikleri izole etme
- branch/worktree izolasyonu
- başarısız loop'ları durdurma
- hata tekrarlarını sınıflandırma
- rapor üretme

---

### 5) Comparative CLI Evaluation Layer

Amaç:
- Quake Code'un diğer coding CLI'lara göre nerede zayıf/güçlü olduğunu ölçmek
- ürün iyileştirmelerini sezgiyle değil veriyle önceliklendirmek

Karşılaştırma eksenleri:
- görev tamamlama başarısı
- doğruluk
- hız
- tool-use kalitesi
- recovery başarısı
- TUI/UX akıcılığı
- maliyet / token verimliliği
- gerçek desktop task başarısı

---

## Mimari veri akışı

Yüksek seviyeli akış:

1. orchestrator bir hedef seçer
2. coding agent repo üzerinde çalışır
3. build/test sonuçları toplanır
4. gerekiyorsa OS agent gerçek uygulama testi yapar
5. benchmark runner sonuçları skorlar
6. governor devam/rollback/escalation kararı verir
7. sonuçlar history/ledger içine yazılır
8. sistem yeni iterasyona geçer

---

## Kısa vadeli roadmap

### Faz 1 — Strong OS self-test foundation
- OS action surface tamamlama
- focused element / clipboard / diagnostics güçlendirme
- terminal/TUI heuristics
- gerçek smoke test akışları

### Faz 2 — Controlled autonomous patch loop
- issue queue
- patch/test/retry workflow
- scoring
- branch/worktree izolasyonu
- result ledger

### Faz 3 — Comparative optimization
- rakip CLI benchmark suite
- gap analysis
- otomatik önceliklendirme
- ürün iyileştirme öneri motoru

---

## OS agent için kısa vadeli teknik öncelikler

1. terminal/TUI reliability
2. deeper element discovery
3. richer focused-element verification
4. clipboard doğrulamasını daha güçlü hale getirme
5. app-profile / strategy layer başlangıcı
6. tool-level smoke tests in fresh sessions

---

## Orta vadeli sistem öncelikleri

1. self-improvement orchestrator
2. benchmark result storage
3. provider/model fallback policy
4. budget-aware execution
5. competitor comparison harness

---

## Başarı kriterleri

Sistem aşağıdaki seviyelere geldikçe vizyon somutlaşmış sayılır:

### Seviye 1
- Quake Code kendi interactive akışlarını test ediyor
- temel bug'ları bulup patch öneriyor
- build/test + OS smoke loop çalışıyor

### Seviye 2
- belirli görevlerde yarı-otonom self-improvement yapıyor
- model/provider fallback ile işi sürdürüyor
- benchmark history tutuyor

### Seviye 3
- rakip CLI'larla kıyas yapıyor
- zayıf alanlarını otomatik çıkarıyor
- otonom şekilde iyileştirme kuyruğu oluşturuyor

---

## Önemli ilke

Bu sistemin amacı sadece daha çok otomasyon değil; daha çok:
- ölçülebilir kalite
- güvenilir otonomi
- kontrollü self-improvement
- gerçek dünya test kabiliyeti

olmalıdır.

---

## Son cümle

Quake Code için hedeflenen şey sıradan bir coding assistant değil; kendi davranışını gözleyebilen, kendi ürününü geliştirebilen, kendi sınırlarını benchmark edebilen ve zamanla daha iyi hale gelen bir **self-improving CLI platformu**dur.
