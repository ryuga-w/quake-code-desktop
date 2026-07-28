# Grok Provider Rehberi

Bu doküman, Quake Code'a **Grok** entegrasyonunun nasıl yapıldığını, ileride benzer bir provider'ın nasıl ekleneceğini ve **auth süresi dolduğunda** ne yapılacağını anlatır.

İlgili genel dokümanlar:

- [providers.md](providers.md) — ortam değişkenleri ve `auth.json`
- [models.md](models.md) — `~/.quake-code/agent/models.json` ile kod yazmadan provider ekleme
- [custom-provider.md](custom-provider.md) — extension ile runtime provider kaydı

---

## Kavramlar

Quake Code'da üç katman vardır:

| Katman | Örnek | Ne işe yarar |
|--------|-------|--------------|
| **Provider** | `grok-cli`, `grok` | Kimlik + endpoint (`model.provider`) |
| **API** | `openai-completions` | İstek formatı / stream kodu (`model.api`) |
| **Model** | `grok-build` | Spesifik LLM (`model.id`) |

Bir mesaj gönderildiğinde:

1. `ModelRegistry` provider + model seçer
2. `getEnvApiKey(provider)` veya `auth.json` ile token çözülür
3. `model.api` hangi stream fonksiyonunun çalışacağını belirler (`openai-completions` → OpenAI uyumlu HTTP)

---

## Grok entegrasyonu — ne eklendi?

Grok için **iki ayrı provider** tanımlandı; ikisi de aynı JWT'yi kullanır ama farklı endpoint'lere gider.

### 1. `grok-cli` — Grok CLI Proxy

| Alan | Değer |
|------|-------|
| Endpoint | `https://cli-chat-proxy.grok.com/v1` |
| Modeller | `grok-build`, `grok-composer-2.5-fast`, `grok-composer-2` |
| Özel header'lar | `X-XAI-Token-Auth`, `x-grok-model-override`, `x-grok-client-version` |

### 2. `grok` — xAI resmi API

| Alan | Değer |
|------|-------|
| Endpoint | `https://api.x.ai/v1` |
| Modeller | `grok-4.3`, `grok-4.20-*`, `grok-build-0.1` |
| Header | Standart `Authorization: Bearer <JWT>` |

### Değişen dosyalar

| Dosya | Görev |
|-------|-------|
| `packages/ai/src/grok-auth.ts` | `~/.grok/auth.json` ve `version.json` okuyucu |
| `packages/ai/src/types.ts` | `KnownProvider`'a `grok-cli`, `grok` eklendi |
| `packages/ai/src/models.ts` | Model registry'ye Grok modelleri eklendi |
| `packages/ai/src/env-api-keys.ts` | Token çözümleme (`GROK_AUTH_TOKEN` → dosya → `XAI_API_KEY`) |
| `packages/ai/src/providers/openai-completions.ts` | CLI proxy için zorunlu header'lar |
| `packages/ai/src/index.ts` | `grok-auth` export |
| `packages/coding-agent/src/core/model-resolver.ts` | Varsayılan modeller |
| `packages/coding-agent/src/cli/args.ts` | `GROK_AUTH_TOKEN` yardım metni |

---

## Auth nasıl çalışır?

### Kaynak dosya

Grok CLI `grok login` sonrası token'ı şuraya yazar:

```
~/.grok/auth.json
```

Windows örneği:

```
C:\Users\<kullanıcı>\.grok\auth.json
```

Dosya **iç içe** yapıdadır; root'ta düz `"key"` yoktur:

```json
{
  "https://auth.x.ai::<client-id>": {
    "key": "eyJ...",
    "refresh_token": "...",
    "expires_at": "2026-06-25T02:31:02Z",
    "email": "user@example.com"
  }
}
```

`grok-auth.ts` hem düz hem iç içe yapıyı destekler; ilk bulunan `key` alanını JWT olarak kullanır.

### Öncelik sırası

`grok-cli` ve `grok` için token şu sırayla aranır:

1. `GROK_AUTH_TOKEN` ortam değişkeni
2. `~/.grok/auth.json` → `getGrokAuthToken()`
3. `XAI_API_KEY` ortam değişkeni (yedek)

`xai` provider'ı da `XAI_API_KEY` yoksa aynı Grok JWT'ye fallback yapar.

### CLI proxy için ek gereksinim

`cli-chat-proxy.grok.com` ham curl ile **426** dönebilir. Quake Code şu header'ları otomatik ekler:

```
X-XAI-Token-Auth: xai-grok-cli
x-grok-model-override: <model-id>
x-grok-client-version: <~/.grok/version.json içindeki version>
```

Sürüm dosyası: `~/.grok/version.json` (ör. `"version": "0.2.64"`).

---

## Auth süresi dolunca ne yapılır?

Grok JWT'leri süreli olur (`expires_at` alanı). Süre dolunca tipik hatalar:

- `401 Unauthorized`
- `403` + kredi / abonelik mesajı
- `Invalid token` benzeri API cevapları

### Yöntem 1 — Grok CLI ile yenile (önerilen)

```bash
grok login
```

Bu komut `~/.grok/auth.json` dosyasını günceller. Quake Code bir sonraki istekte yeni token'ı okur.

**Not:** Token process içinde cache'lenir. Uzun süre açık kalan bir Quake oturumunda auth dosyası diskte güncellense bile bellekteki cache eski kalabilir. En güvenlisi **Quake'ı yeniden başlatmak**.

### Yöntem 2 — Ortam değişkeni ile manuel token

JWT'yi elle koymak için:

**PowerShell (oturum boyunca):**

```powershell
$env:GROK_AUTH_TOKEN = "eyJ..."
```

**Kalıcı (kullanıcı ortamı):**

```powershell
[Environment]::SetEnvironmentVariable("GROK_AUTH_TOKEN", "eyJ...", "User")
```

Token'ı dosyadan almak (PowerShell):

```powershell
$auth = Get-Content "$env:USERPROFILE\.grok\auth.json" -Raw | ConvertFrom-Json
$token = ($auth.PSObject.Properties | Select-Object -First 1).Value.key
$env:GROK_AUTH_TOKEN = $token
```

### Yöntem 3 — Quake `auth.json`

`~/.quake-code/agent/auth.json` içine de yazılabilir (diğer provider'lar gibi):

```json
{
  "grok-cli": {
    "type": "api_key",
    "key": "eyJ..."
  },
  "grok": {
    "type": "api_key",
    "key": "eyJ..."
  }
}
```

Bu dosyadaki key, ortam değişkeninden **önce** `AuthStorage` tarafından okunur (Quake CLI akışında).

### Yöntem 4 — xAI API key

Resmi xAI API key'in varsa:

```powershell
$env:XAI_API_KEY = "xai-..."
```

`grok` provider'ı bunu `~/.grok/auth.json` yoksa yedek olarak kullanır.

### Auth kontrol listesi

1. `~/.grok/auth.json` var mı?
2. `expires_at` geçmiş mi?
3. `grok login` tekrar çalıştırıldı mı?
4. Quake yeniden başlatıldı mı?
5. `GROK_AUTH_TOKEN` / `XAI_API_KEY` doğru mu?

---

## Kullanım

```bash
# Grok Build (CLI proxy)
quake --provider grok-cli --model grok-build -p "selam"

# Grok Composer hızlı
quake --provider grok-cli --model grok-composer-2.5-fast -p "selam"

# xAI API üzerinden Grok 4.3
quake --provider grok --model grok-4.3 -p "selam"
```

Kalıcı varsayılan (`~/.quake-code/agent/settings.json`):

```json
{
  "defaultProvider": "grok-cli",
  "defaultModel": "grok-build"
}
```

---

## Build (zorunlu)

Kaynak kod değişikliği **tek başına yetmez**. İki paket build edilmelidir:

```bash
cd packages/ai && npm run build
cd ../coding-agent && npm run build
```

Monorepo kökünden:

```bash
npm run build
```

**Sık yapılan hata:** Sadece `packages/ai` build edilip `packages/coding-agent` atlanırsa `quake` komutu eski `dist/` ile çalışır ve yeni provider görünmez.

### Doğrulama

```bash
cd packages/ai
node --input-type=module -e "
  import { getProviders, getModels } from './dist/models.js';
  console.log(getProviders().filter(p => p.includes('grok')));
  console.log(getModels('grok-cli').map(m => m.id));
"
```

Beklenen: `grok-cli`, `grok` ve model listesi.

---

## İleride yeni provider nasıl eklenir?

Grok örneği üzerinden **OpenAI uyumlu** yeni bir provider ekleme checklist'i:

### A) Kod yazmadan (en kolay)

OpenAI uyumlu bir API varsa → `~/.quake-code/agent/models.json`:

```json
{
  "providers": {
    "benim-api": {
      "baseUrl": "https://api.example.com/v1",
      "api": "openai-completions",
      "apiKey": "MY_API_KEY",
      "models": [{ "id": "model-1" }]
    }
  }
}
```

Detay: [models.md](models.md)

### B) Built-in provider (Grok gibi)

Aşağıdaki adımlar Grok entegrasyonunun şablonudur.

#### 1. Tip tanımı

`packages/ai/src/types.ts` → `KnownProvider`'a yeni isim:

```typescript
| "benim-provider"
```

#### 2. Model registry

`packages/ai/src/models.ts`:

```typescript
const benimModels = new Map<string, Model<any>>();
benimModels.set("model-id", {
  id: "model-id",
  name: "Görünen Ad",
  api: "openai-completions",
  provider: "benim-provider",
  baseUrl: "https://api.example.com/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
});
modelRegistry.set("benim-provider", benimModels);
```

Yeni model eklemek çoğu zaman **tek satır** `benimModels.set(...)` yeterlidir.

#### 3. Auth çözümleme

`packages/ai/src/env-api-keys.ts`:

```typescript
if (provider === "benim-provider") {
  return process.env.BENIM_API_KEY || readFromCustomFile();
}
```

Harici dosyadan okuma gerekiyorsa → ayrı modül (Grok'taki `grok-auth.ts` gibi).

#### 4. Özel HTTP header'ları (gerekirse)

`packages/ai/src/providers/openai-completions.ts` → `createClient()` içinde:

```typescript
if (model.provider === "benim-provider") {
  Object.assign(headers, { "X-Custom": "deger" });
}
```

`detectCompat()` içinde `supportsDeveloperRole`, `supportsReasoningEffort` gibi bayrakları endpoint'e göre ayarla.

#### 5. Varsayılan model

`packages/coding-agent/src/core/model-resolver.ts`:

```typescript
"benim-provider": "model-id",
```

#### 6. Export + build

- Gerekirse `packages/ai/src/index.ts`'e export ekle
- `packages/ai` + `packages/coding-agent` build et

### C) Tamamen özel API protokolü

OpenAI uyumlu değilse:

1. `packages/ai/src/providers/benim-provider.ts` — `stream` + `streamSimple` yaz
2. `packages/ai/src/types.ts` → `KnownApi`'ye yeni API tipi
3. `packages/ai/src/providers/register-builtins.ts` → `registerApiProvider({ api: "benim-api", ... })`
4. Modellerde `api: "benim-api"` kullan

Örnekler: `gratisfy-free.ts`, `mimo-free.ts`, `puter.ts`

### D) Extension ile (runtime)

Kod derlemeden, extension içinde:

```typescript
quake.registerProvider("benim-llm", {
  baseUrl: "https://api.example.com/v1",
  apiKey: "MY_KEY",
  api: "openai-completions",
  models: [/* ... */],
});
```

Detay: [custom-provider.md](custom-provider.md)

---

## Yeni Grok modeli ekleme

Mevcut provider'a model eklemek için sadece `packages/ai/src/models.ts` yeterli:

**CLI proxy:**

```typescript
grokCliModels.set("yeni-model", createGrokCliModel("yeni-model", "Yeni Model"));
```

**xAI API:**

```typescript
grokApiModels.set("yeni-model", createGrokApiModel("yeni-model", "Yeni Model"));
```

Sonra `npm run build` (ai + coding-agent).

Model ID'si endpoint'in gerçekten desteklediği isimle aynı olmalı. Listelemek için:

```bash
curl -s -H "Authorization: Bearer $TOKEN" https://api.x.ai/v1/models
```

---

## Sorun giderme

| Belirti | Olası sebep | Çözüm |
|---------|-------------|-------|
| Provider listede yok | `coding-agent` build edilmemiş | `cd packages/coding-agent && npm run build` |
| `No API key for provider` | Token okunamıyor | `grok login`, `GROK_AUTH_TOKEN` kontrol |
| CLI proxy 426 | `x-grok-client-version` eksik | Quake güncel build kullan; `~/.grok/version.json` var mı bak |
| 401 / token expired | JWT süresi dolmuş | `grok login` + Quake'ı yeniden başlat |
| 403 spending-limit | Grok kredisi / abonelik | grok.com hesabını kontrol et |
| Eski token kullanılıyor | Bellek cache | Quake oturumunu kapat, yeniden aç |

---

## Mimari özet (Grok)

```
grok login
    ↓
~/.grok/auth.json (JWT)
    ↓
getGrokAuthToken()  ← packages/ai/src/grok-auth.ts
    ↓
getEnvApiKey("grok-cli" | "grok")  ← packages/ai/src/env-api-keys.ts
    ↓
streamOpenAICompletions()  ← packages/ai/src/providers/openai-completions.ts
    ↓
cli-chat-proxy.grok.com/v1  veya  api.x.ai/v1
```

---

## Özet

- Grok, **kod tabanına built-in** olarak eklendi; auth **harici** (`~/.grok/auth.json`).
- İki provider: `grok-cli` (proxy) ve `grok` (resmi API).
- Auth yenileme: **`grok login`** → Quake'ı yeniden başlat.
- Yeni provider: `types` → `models` → `env-api-keys` → (gerekirse header) → `model-resolver` → **build x2**.
- Kod yazmadan provider: `models.json` veya extension.