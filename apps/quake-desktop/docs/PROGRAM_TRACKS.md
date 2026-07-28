# Program tracks (güncel)

Son tur (**Wave E**): OS helper harden, updater feed UI, MCP bearer vault, ajan konuşma + merge conflict, E2E/a11y genişletme.

| Track | Durum |
|-------|--------|
| **OS helper** | `quake-command-runner.mjs` MVP: FS roots, env strip, `isolation: mvp-helper`. **RestrictedToken yok.** |
| **Ağ** | Cooperative proxy + durable hosts + audit + desktop auto-default |
| **Guardian / MCP always** | Disk + Settings listeleri |
| **Ajanlar** | Canlı log, **Konuşma** thread, merge uygula, conflict paths, klasörde aç |
| **Trust onboarding** | İlk-run modal |
| **E2E** | Smoke CI zorunlu yeşil; agents-settings optional e2e |
| **Updater** | Feed URL Settings’ten; electron-updater scaffold |
| **Signing** | Docs + optional CI `package_signed` (secret yoksa skip) |
| **MCP auth** | Bearer → vault + `${vault:NAME}` headers; browser OAuth Phase 2 |
| **PTY** | Dürüst “sandbox dışı” banner |
| **Multi-root** | Aynı pencerede açık kök kaydı, native çoklu klasör seçimi, kök başına dosya/ayar/MCP bağlamı ve kapanmadan park edilen ajan oturumları |

## Hâlâ bilerek yok / Phase B

- Windows **RestrictedToken** native sandbox  
- Transparent network MITM  
- Browser **OAuth** (refresh/token exchange)  
- Cloud sandbox görevleri  
- EV production signing without cert  

## UI haritası

| Özellik | Yer |
|---------|-----|
| Kalıcı izinler | Ayarlar → İzinler |
| Feed / güncelleme | Ayarlar → Hakkında |
| MCP Bearer vault | Ayarlar → MCP |
| Ajan konuşma / merge | Sağ panel → Ajanlar |
| Trust | İlk açılış modalı |
