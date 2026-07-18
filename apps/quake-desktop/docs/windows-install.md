# Quake Code — Windows Kurulumu

## Gerekli sistem

- Windows 10 veya Windows 11, 64-bit (x64)
- İnternet bağlantısı (model sağlayıcılarına bağlanmak için)
- Uygulamanın kendisi için Node.js veya kaynak kod gerekmez
- Açacağınız projeye göre Git, Node.js, Python, .NET, Java gibi geliştirme araçları ayrıca gerekebilir

## Tek tık kurulum (önerilen)

Installer, `SHA256SUMS.txt` ve `KUR-QUAKE-CODE.bat` aynı klasördeyken `KUR-QUAKE-CODE.bat` dosyasına çift tıklayın. Betik:

1. Installer SHA-256 değerini doğrular.
2. Çalışan Quake Code Desktop sürecini kapatır.
3. Güncel sürümü mevcut Windows kullanıcısına sessizce kurar.
4. Desktop'a özel `%APPDATA%\Quake Code\agent` ayar dizisini oluşturur.
5. GPT-5.6 SOL sağlayıcısını 1.050.000 token bağlam ve 128.000 token azami çıktı metadata’sıyla mevcut Desktop modellerini bozmadan ekler; gerekirse Azure API anahtarını güvenli giriş alanında ister.
6. Kurulumu doğrulayıp Quake Code'u başlatır.

Paketli Desktop kendi gömülü `@mrquake/quakecode-cli` motorunu ve kendine ait ayar dizinini kullanır. Bilgisayardaki eski/global Quake CLI kurulumu değiştirilmez; onun `~\.grok\agent` veya `~\.quake-code\agent` ayarları Desktop motoru olarak kullanılmaz.

## Normal kurulum

1. `Quake-Code-Setup-<sürüm>-x64.exe` dosyasını diğer bilgisayara aktarın.
2. İsterseniz dosyanın sağlamasını `SHA256SUMS.txt` ile doğrulayın:

   ```powershell
   Get-FileHash .\Quake-Code-Setup-*-x64.exe -Algorithm SHA256
   Get-Content .\SHA256SUMS.txt
   ```

3. Installer dosyasını çift tıklayın.
4. Kurulum kapsamını seçin:
   - **Yalnızca benim için:** Yönetici yetkisi istemeyen, önerilen seçenek.
   - **Bu bilgisayardaki herkes için:** Yönetici yetkisi gerekir.
5. İsterseniz kurulum klasörünü değiştirin ve kurulumu tamamlayın.
6. Masaüstündeki veya Başlat menüsündeki **Quake Code** kısayolunu açın.
7. İlk açılışta çalışma klasörünü seçin ve Ayarlar üzerinden model hesabınızı/API anahtarınızı yapılandırın. Normal installer tek başına kullanıcıya özel GPT-5.6 SOL kaydını oluşturmaz; bunun için yukarıdaki `KUR-QUAKE-CODE.bat` akışını kullanın.

## Bir ajana sessiz kurdurma

Installer ile aynı klasörde PowerShell açıp şu akışı kullandırabilirsiniz:

```powershell
$installer = Get-ChildItem -Path . -Filter 'Quake-Code-Setup-*-x64.exe' | Select-Object -First 1
if (-not $installer) { throw 'Quake Code installer bulunamadı.' }
Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait
$quake = Get-ChildItem "$env:LOCALAPPDATA\Programs" -Filter 'QuakeCode.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $quake) { throw 'QuakeCode.exe kurulumdan sonra bulunamadı.' }
Start-Process -FilePath $quake.FullName
```

Sessiz kurulum varsayılan olarak mevcut Windows kullanıcısına yapılır. Kurulum klasörünü elle seçmek istiyorsanız sihirbazlı normal kurulumu kullanın.

## Windows SmartScreen uyarısı

Bu özel build henüz ticari bir kod imzalama sertifikasıyla imzalanmadığı için Windows **Bilinmeyen yayıncı** veya SmartScreen uyarısı gösterebilir. Dosyayı yalnızca güvendiğiniz aktarım kaynağından aldıysanız ve SHA-256 değeri eşleşiyorsa **Daha fazla bilgi → Yine de çalıştır** yolunu kullanın.

Kod imzalama (CSC_*, Azure Trusted Signing), imzasız ship-gate yolu ve otomatik güncelleme (electron-updater) için: [`windows-signing.md`](./windows-signing.md).

## Taşınmayan veriler

Installer kaynak kodu, projelerinizi ve eski bilgisayardaki hesap sırlarını bilerek içermez. Yeni bilgisayarda:

- Proje klasörlerinizi ayrıca taşıyın veya Git üzerinden klonlayın.
- Model sağlayıcısı hesabını/API anahtarını yeniden yapılandırın.
- Gerekirse eski `~/.quake-code` veya `~/.grok/agent` ayarlarını yalnızca güvenli bir yöntemle taşıyın; bu klasörlerde hassas kimlik bilgileri bulunabilir.

## Kaldırma

Windows **Ayarlar → Uygulamalar → Yüklü uygulamalar → Quake Code → Kaldır** yolunu kullanın. Proje dosyalarınız kaldırılmaz.
