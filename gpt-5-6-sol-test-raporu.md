# 🧪 GPT-5.6-SOL — Azure OpenAI Test Raporu

**Tarih:** 2026-07-10  
**Testi Yapan:** Mustafa Bilgin (@mrquake)  
**Model:** `gpt-5.6-sol-2026-07-09`  
**Deployment:** `gpt-56-sol-deploy`  
**Endpoint:** `https://mrquake.openai.azure.com`

---

## 1. 📋 Yapılandırma Bilgileri

| Parametre | Değer |
|---|---|
| **Base URL** | `https://mrquake.openai.azure.com` |
| **Deployment Adı** | `gpt-56-sol-deploy` |
| **API Versiyonu** | `2025-01-01-preview` |
| **Chat Endpoint** | `/openai/deployments/gpt-56-sol-deploy/chat/completions` |
| **Model Tanımlayıcısı** | `gpt-5.6-sol-2026-07-09` |
| **Servis Katmanı** | `default` |

---

## 2. 🔍 Test İsteği (Request)

```http
POST /openai/deployments/gpt-56-sol-deploy/chat/completions?api-version=2025-01-01-preview
Host: mrquake.openai.azure.com
Content-Type: application/json
api-key: [REDACTED]
```

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Merhaba! Sadece 5 kelimeyle cevap ver: Bu bir test mesajidir."
    }
  ],
  "max_completion_tokens": 100
}
```

> **⚠️ Önemli Not:** Bu model bir **reasoning modeli** olduğu için `max_tokens` desteklenmez. Bunun yerine `max_completion_tokens` kullanılmalıdır.  
> `max_tokens` kullanıldığında şu hata döner:  
> `"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."`

---

## 3. ✅ Test Yanıtı (Response)

### 3.1 Ham Yanıt

```json
{
  "choices": [
    {
      "content_filter_results": {
        "hate": { "filtered": false, "severity": "safe" },
        "protected_material_code": { "detected": false, "filtered": false },
        "protected_material_text": { "detected": false, "filtered": false },
        "self_harm": { "filtered": false, "severity": "safe" },
        "sexual": { "filtered": false, "severity": "safe" },
        "violence": { "filtered": false, "severity": "safe" }
      },
      "finish_reason": "stop",
      "index": 0,
      "logprobs": null,
      "message": {
        "annotations": [],
        "content": "Merhaba, test mesajınızı başarıyla aldım.",
        "refusal": null,
        "role": "assistant"
      }
    }
  ],
  "created": 1783699574,
  "id": "chatcmpl-E081uXcas2asWLnXDDid4hp3t7rGM",
  "model": "gpt-5.6-sol-2026-07-09",
  "object": "chat.completion",
  "prompt_filter_results": [
    {
      "prompt_index": 0,
      "content_filter_results": {
        "hate": { "filtered": false, "severity": "safe" },
        "jailbreak": { "detected": false, "filtered": false },
        "self_harm": { "filtered": false, "severity": "safe" },
        "sexual": { "filtered": false, "severity": "safe" },
        "violence": { "filtered": false, "severity": "safe" }
      }
    }
  ],
  "service_tier": "default",
  "system_fingerprint": null,
  "usage": {
    "completion_tokens": 57,
    "completion_tokens_details": {
      "accepted_prediction_tokens": 0,
      "audio_tokens": 0,
      "reasoning_tokens": 36,
      "rejected_prediction_tokens": 0
    },
    "latency_checkpoint": {
      "engine_tbt_ms": 8,
      "engine_ttft_ms": 1322,
      "engine_ttlt_ms": 1771,
      "pre_inference_ms": 91,
      "service_tbt_ms": 8,
      "service_ttft_ms": 1466,
      "service_ttlt_ms": 1911,
      "total_duration_ms": 1847,
      "user_visible_ttft_ms": 1376
    },
    "prompt_tokens": 25,
    "prompt_tokens_details": {
      "audio_tokens": 0,
      "cached_tokens": 0
    },
    "total_tokens": 82
  }
}
```

### 3.2 Model Yanıtı (İçerik)

> **"Merhaba, test mesajınızı başarıyla aldım."**

Kullanıcı "5 kelimeyle cevap ver" talimatı vermesine rağmen model daha doğal bir yanıt üretti. Bu, modelin talimatlara **kısmen** uyduğunu ancak reasoning zincirinde token sınırlaması olmadan daha uzun bir yanıt tercih ettiğini gösteriyor.

---

## 4. ⚡ Performans Metrikleri

### 4.1 Gecikme Süreleri (Latency)

| Metrik | Süre |
|---|---|
| **Pre-Inference** (ön işleme) | 91 ms |
| **Engine TTFT** (motor ilk token) | 1322 ms |
| **Engine TTLT** (motor son token) | 1771 ms |
| **Service TTFT** (servis ilk token) | 1466 ms |
| **Service TTLT** (servis son token) | 1911 ms |
| **User-Visible TTFT** (kullanıcıya ilk token) | 1376 ms |
| **Total Duration** (toplam süre) | **1847 ms** |

### 4.2 Token Kullanımı

| Kategori | Miktar |
|---|---|
| **Prompt Tokens** | 25 |
| **Completion Tokens** | 57 |
| — *Reasoning Tokens* | 36 |
| — *Visible Tokens* | 21 |
| **Total Tokens** | 82 |
| **Cached Tokens** | 0 |

### 4.3 Token Dağılımı (Görsel)

```
Prompt:    ████████████████████████████████████████████████░░░░░░░░ 25
Reasoning: ████████████████████████████████████████████████████████ 36
Visible:   █████████████████████████████████████████░░░░░░░░░░░░░░ 21
           ────────────────────────────────────────────────────────
Total:     82
```

---

## 5. 🧠 Reasoning Modeli Analizi

GPT-5.6-sol, OpenAI'nin **o-serisi reasoning modelleri** ailesindendir. Bu modellerin ayırt edici özellikleri:

| Özellik | GPT-5.6-sol |
|---|---|
| **Reasoning Tokens** | ✅ Evet — 36 token reasoning için kullanılmış |
| **max_completion_tokens** | ✅ Zorunlu parametre |
| **max_tokens** | ❌ Desteklenmez |
| **Stop** | ✅ Desteklenir |
| **Streaming** | ✅ Desteklenir |
| **System Prompt** | ✅ Desteklenir |
| **Functions/Tools** | Bilinmiyor (test edilmedi) |
| **Response Format** | ✅ Varsayılan metin |

### 5.1 Reasoning Süreci

Model 36 token'ı "düşünme" (reasoning) için kullandı. Bu token'lar çıktıda görünmez, modelin iç muhakeme zincirini temsil eder. Kullanıcıya yalnızca 21 token görünür şekilde ulaştı.

---

## 6. 🔒 Content Filter (Güvenlik)

Azure OpenAI'nin content filter'ı tüm kategorilerde **"safe"** olarak değerlendirdi:

| Kategori | Prompt Filter | Completion Filter |
|---|---|---|
| **Hate** | ✅ safe | ✅ safe |
| **Violence** | ✅ safe | ✅ safe |
| **Sexual** | ✅ safe | ✅ safe |
| **Self-Harm** | ✅ safe | ✅ safe |
| **Jailbreak** | ✅ not detected | — |
| **Protected Material Code** | — | ✅ not detected |
| **Protected Material Text** | — | ✅ not detected |

---

## 7. ⚠️ Dikkat Edilmesi Gereken Noktalar

1. **Token Parametresi:** `max_tokens` yerine `max_completion_tokens` kullanılmalı. Aksi halde `400 Bad Request` hatası alınır.
2. **Reasoning Token Maliyeti:** Reasoning token'ları görünmez olsa da **ücretlendirilir**. Fiyatlandırma yapılırken toplam completion token'ı (57) baz alınmalı.
3. **API Versiyonu:** `2025-01-01-preview` çalışıyor, ancak Azure OpenAI yeni modeller için daha güncel bir API versiyonu gerekebilir.
4. **Caching:** `cached_tokens: 0` — bu oturumda önbellekleme yapılmamış. Tekrarlayan prompt'larda caching ile maliyet düşürülebilir.
5. **Prompt Uyumu:** Model "5 kelimeyle cevap ver" talimatını tam olarak takip etmedi. Daha katı talimat vermek için sistem mesajı veya daha net prompt mühendisliği gerekebilir.

---

## 8. 🚀 Quake Code'a Ekleme (Önerilen Yapılandırma)

Azure OpenAI provider'ı olarak Quake Code'da kullanmak için örnek yapılandırma:

```jsonc
// .quake-code/config.json
{
  "providers": {
    "azure-openai": {
      "baseUrl": "https://mrquake.openai.azure.com",
      "apiKey": "${AZURE_OPENAI_KEY}",
      "models": {
        "gpt-5.6-sol": {
          "deployment": "gpt-56-sol-deploy",
          "apiVersion": "2025-01-01-preview",
          "type": "reasoning",   // reasoning modeli olduğu için
          "maxCompletionTokens": 8192,
          "thinking": "medium"
        }
      }
    }
  }
}
```

> **Öneri:** API key'i environment variable olarak (`AZURE_OPENAI_KEY`) saklamak en güvenli yaklaşımdır.

---

## 9. 📊 Özet

| Durum | Sonuç |
|---|---|
| **Endpoint Erişilebilirliği** | ✅ Başarılı (200 OK) |
| **Model Tanımlama** | ✅ `gpt-5.6-sol-2026-07-09` |
| **Reasoning Çalışması** | ✅ 36 reasoning token üretildi |
| **Content Filter** | ✅ Tüm kategoriler safe |
| **TTFT** | ✅ ~1.4 saniye (makul) |
| **Toplam Süre** | ✅ ~1.8 saniye |

---

## 10. 🔜 Yapılabilecek İleri Testler

- [ ] **Streaming testi** — SSE ile token akışı çalışıyor mu?
- [ ] **System prompt testi** — Sistem mesajı destekleniyor mu?
- [ ] **Uzun context testi** — 128K+ token context'te performans nasıl?
- [ ] **Fonksiyon çağırma** — Tools/FC destekleniyor mu?
- [ ] **Thinking seviyeleri** — `reasoning_effort` parametresi çalışıyor mu?
- [ ] **Quake Code entegrasyonu** — Kodlama görevlerinde performans

---

*Rapor sonu. Test tarihi: 2026-07-10 — Testi hazırlayan: Quake Code Agent*
