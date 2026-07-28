# Quake Mobile Studio — Android

Mobile Studio, Quake Desktop içinde Android uygulamalarını keşfetme, derleme, kurma, canlı izleme, semantik olarak kontrol etme ve Maestro ile test etme çalışma alanıdır.

## Gereksinimler

1. Android Studio veya Android Command-line Tools kurun.
2. `ANDROID_SDK_ROOT` değerini Android SDK klasörüne ayarlayın.
3. SDK Manager ile `platform-tools`, `emulator`, `cmdline-tools`, bir system image ve güncel `build-tools` kurun.
4. Düşük gecikmeli ekran için scrcpy 3.x kurun. PATH dışında ise `QUAKE_SCRCPY_PATH` ayarlayın.
5. Testler için Maestro kurun. PATH dışında ise `MAESTRO_PATH` ayarlayın.

Panelde **Tanı** sekmesi eksik araçları ve yeniden kontrol eylemini gösterir. Screenshot fallback, scrcpy olmadan çalışmaya devam eder.

## Cihazlar

- USB cihazda Developer Options ve USB debugging açılmalıdır. `unauthorized` durumunda cihazdaki RSA penceresini onaylayın.
- Wireless debugging ile eşleştirilen cihazlar `host:port` kimliğiyle gösterilir.
- AVD yöneticisi system image kurabilir; cihaz oluşturabilir, cold/quick boot, wipe data ve snapshot işlemleri yapabilir.

## Projeler ve adapter’lar

Monorepo taraması Android application modüllerini library modüllerinden ayırır. Desteklenen adapter’lar:

- Native Gradle
- React Native CLI ve Expo
- Flutter
- Capacitor
- NativeScript
- Godot
- Custom `mobile.json`

## `.quake-code/mobile.json`

Şema: `src/server/mobile/mobile.schema.json`

```json
{
  "$schema": "../../apps/quake-desktop/src/server/mobile/mobile.schema.json",
  "version": 1,
  "applications": [{
    "id": "app",
    "name": "My App",
    "android": {
      "build": "my-compiler build android",
      "artifact": "out/app.apk",
      "appId": "com.example.app",
      "variant": "debug",
      "environment": { "MODE": "debug" }
    }
  }]
}
```

Artifact ve working directory workspace dışına çıkamaz. Bozuk config otomatik profilleri durdurmaz; Tanı sekmesine hata ekler.

## Semantik kontrol

Ajan veya panel önce snapshot alır. Elementler snapshot ID, revision ve fingerprint tabanlı `ref=m:<hash>` kimliği taşır. UI değişmişse stale veya belirsiz hedefe dokunulmaz. Koordinat yalnız açık fallback’tir.

## Maestro

Maestro YAML flow’unu workspace içinde oluşturun ve Test sekmesinden cihazda çalıştırın. Job çıktısı, screenshot/video/log artifact’leri oturuma aittir. Sonradan Appium/Espresso/Detox adapter’ları aynı test-job sözleşmesine bağlanabilir.

## Güvenlik

- Uninstall, clear data, proxy/TLS inspection ve baseline değişiklikleri açık onay ister.
- Package, device, path ve port değerleri doğrulanır.
- Sandbox yalnız debuggable uygulamalarda `run-as` ile açılır.
- SQLite görünümü yalnız `SELECT` ve `PRAGMA` kabul eder.
- Artifact’ler hassas kabul edilir ve `.quake-code/mobile-artifacts/<session>/` altında sınırlı retention ile tutulur.

## Sorun giderme

- **ADB bulunamadı:** `ANDROID_SDK_ROOT` ve `platform-tools` kontrol edin.
- **unauthorized:** Cihaz ekranındaki USB debugging RSA onayını kabul edin.
- **offline:** USB/Wi-Fi bağlantısını yenileyin veya ADB server’ı yeniden başlatın.
- **scrcpy stream yok:** `scrcpy --version` ve `QUAKE_SCRCPY_PATH` kontrol edin; PNG fallback otomatik devrededir.
- **Build profili yok:** Proje kökündeki framework dosyalarını veya `mobile.json` yapılandırmasını kontrol edin.
- **Unicode yazılamıyor:** Quake companion IME kurulumu önerilir; modern Android’de clipboard fallback kullanılır.
- **Sandbox kapalı:** Uygulamanın debug build olduğundan ve `run-as <package>` komutunun çalıştığından emin olun.
