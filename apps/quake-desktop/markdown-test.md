# Markdown Test Dökümanı ­şôØ

Bu dosya, markdown render özelliklerini test etmek için hazırlanmıştır.

---

## 1. Başlıklar (Headings)

# H1 Başlık
## H2 Başlık
### H3 Başlık
#### H4 Başlık
##### H5 Başlık
###### H6 Başlık

---

## 2. Metin Biçimlendirme

**Kalın metin**  
*İtalik metin*  
***Kalın ve italik***  
~~Üstü çizili~~  
<mark>Vurgulanmış metin</mark>  
`inline kod`

---

## 3. Listeler

### Madde İmli Liste
- React
- Vue
  - Vue 2
  - Vue 3
- Angular
  - 17+
  - Signals
- Svelte

### Numaralı Liste
1. İlk adım
2. İkinci adım
   1. Alt adım 1
   2. Alt adım 2
3. Üçüncü adım

### Görev Listesi (Task List)
- [x] useState öğrenildi
- [x] useEffect öğrenildi
- [ ] useMemo öğrenilecek
- [ ] useCallback öğrenilecek
- [ ] Custom hook yazılacak

---

## 4. Kod Blokları

### JavaScript
```javascript
function fibonacci(n) {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}

const memoizedFib = (() => {
  const cache = {}
  return (n) => {
    if (n in cache) return cache[n]
    if (n <= 1) return n
    cache[n] = memoizedFib(n - 1) + memoizedFib(n - 2)
    return cache[n]
  }
})()

console.log(memoizedFib(40)) // 102334155
```

### TypeScript React
```tsx
import { useState, useEffect, useMemo, useCallback, useRef, useContext, createContext } from 'react'

interface User {
  id: string
  name: string
  email: string
}

const UserContext = createContext<User | null>(null)

export function useUser() {
  const user = useContext(UserContext)
  if (!user) throw new Error('useUser must be used within UserProvider')
  return user
}

export function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    fetch(`/api/users/${userId}`)
      .then(res => res.json())
      .then(data => {
        setUser(data)
        setLoading(false)
      })
    
    intervalRef.current = window.setInterval(() => {
      console.log('polling...')
    }, 5000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [userId])

  const displayName = useMemo(
    () => user ? `${user.name} <${user.email}>` : '—',
    [user]
  )

  const handleUpdate = useCallback(
    (data: Partial<User>) => {
      fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(data)
      })
    },
    [userId]
  )

  if (loading) return <div>Yükleniyor...</div>
  if (!user) return <div>Kullanıcı bulunamadı</div>

  return (
    <div>
      <h2>{displayName}</h2>
      <button onClick={() => handleUpdate({ name: 'Güncellendi' })}>
        Güncelle
      </button>
    </div>
  )
}
```

### Python
```python
from typing import Optional
from dataclasses import dataclass
import asyncio


@dataclass
class Product:
    id: int
    name: str
    price: float
    stock: int


class InventoryService:
    def __init__(self):
        self._products: dict[int, Product] = {}
    
    async def add_product(self, product: Product) -> None:
        await asyncio.sleep(0.1)  # Simulate DB write
        self._products[product.id] = product
    
    def get_product(self, product_id: int) -> Optional[Product]:
        return self._products.get(product_id)
    
    @property
    def total_value(self) -> float:
        return sum(p.price * p.stock for p in self._products.values())
```

### CSS
```css
:root {
  --primary: #6366f1;
  --secondary: #ec4899;
  --bg: #0f172a;
  --text: #f8fafc;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.card {
  background: linear-gradient(135deg, var(--primary), var(--secondary));
  border-radius: 1rem;
  padding: 1.5rem;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  transition: transform 0.2s ease;
}

.card:hover {
  transform: translateY(-4px);
}
```

---

## 5. Alıntılar (Blockquotes)

> Yazılım mimarisi, bir binanın temeli gibidir — görünmez ama her şeyi ayakta tutar.
>
> — *Robert C. Martin*

> **Önemli Not:** `useEffect` içinde async fonksiyon doğrudan kullanılamaz. Bunun yerine:
> ```javascript
> useEffect(() => {
>   const fetchData = async () => {
>     const result = await api.getData()
>     setData(result)
>   }
>   fetchData()
> }, [])
> ```

---

## 6. Tablolar

### React Hook Karşılaştırması

| Hook | Kullanım Amacı | Render Tetikler | Cleanup Desteği |
|------|----------------|:---------------:|:---------------:|
| `useState` | State yönetimi | Ô£à Evet | ÔØî |
| `useEffect` | Yan etkiler | ÔØî (sonrası) | Ô£à |
| `useMemo` | Değer memoization | ÔØî | ÔØî |
| `useCallback` | Fonksiyon memoization | ÔØî | ÔØî |
| `useRef` | DOM/ mutable değer | ÔØî | ÔØî |
| `useContext` | Context tüketimi | Ô£à (context değişirse) | ÔØî |
| `useReducer` | Karmaşık state | Ô£à Evet | ÔØî |
| `useLayoutEffect` | Senkron yan etkiler | ÔØî (öncesi) | Ô£à |

### Framework Karşılaştırması

| Özellik | React 18+ | Vue 3 | Svelte 5 | Angular 17+ |
|----------|:---------:|:-----:|:--------:|:-----------:|
| Rendering | JSX | Template | Svelte | TypeScript |
| State | Hooks | ref/reactive | $state | Signals |
| Bundle | ~40KB | ~33KB | ~2KB | ~200KB+ |
| Learning Curve | Orta | Düşük | Düşük | Yüksek |
| SSR | Next.js | Nuxt | SvelteKit | Angular Universal |

---

## 7. Linkler ve Görseller

### Linkler
- [React Resmi Dokümantasyonu](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [MDN Web Docs](https://developer.mozilla.org)
- [Sayfa içi bağlantı](#1-başlıklar-headings)

### Görsel
![React Logo](https://upload.wikimedia.org/wikipedia/commons/a/a7/React-icon.svg)

---

## 8. HTML Karışımı

<div align="center">
  <p style="font-size: 1.2em; color: #6366f1;">
    ÔÜí <strong>Bu kısım HTML ile yazıldı</strong> ÔÜí
  </p>
  <details>
    <summary><strong>Detayları göster/gizle</strong></summary>
    <p>Bu içerik <code>&lt;details&gt;</code> elementi ile gizlenmiştir.</p>
    <table style="margin: 0 auto;">
      <tr>
        <td style="background: #10b981; color: white; padding: 8px 16px;">Ô£à Başarılı</td>
        <td style="background: #f59e0b; color: white; padding: 8px 16px;">ÔÜá´©Å Uyarı</td>
        <td style="background: #ef4444; color: white; padding: 8px 16px;">ÔØî Hata</td>
      </tr>
    </table>
  </details>
</div>

---

## 9. Emoji ve Semboller

­şÄë ­şÜÇ ÔÜí ­şöÑ ­şÆí ­şôĞ ­şğ® ­şøá´©Å Ô£à ÔØî ÔÜá´©Å ­şôØ ­şöğ ­şÆ╗ ­şîÉ ­şôè ­şÄ» ­şöù ­şôé ­şğ¬ ­şÅù´©Å

:smile: :rocket: :zap: :fire: :bulb: :package: :puzzle_piece:

---

## 10. Matematiksel İfadeler

Karmaşıklık analizi:

- **Big O (En Kötü Durum):** O(n┬▓), O(n log n), O(n), O(log n), O(1)
- **╬® (En İyi Durum):** ╬®(n), ╬®(log n), ╬®(1)

Fibonacci (naive): O(2Ôü┐) → **çok yavaş**  
Fibonacci (memoized): O(n) → **çok hızlı**  
Merge sort: O(n log n) her durumda

```
Özyineleme ağacı (Fibonacci(5)):

         fib(5)
        /      \
    fib(4)    fib(3)
    /    \    /    \
 fib(3) fib(2) fib(2) fib(1)
 /   \
...  ...
```

---

## 11. İç İçe Geçmiş Yapılar

> **­şôî Proje Yapısı Önerisi**
>
> ```
> src/
> Ôö£ÔöÇÔöÇ components/        # Atomik bileşenler
> Ôöé   Ôö£ÔöÇÔöÇ ui/           # Buton, Input, Card...
> Ôöé   ÔööÔöÇÔöÇ layout/       # Header, Sidebar, Footer
> Ôö£ÔöÇÔöÇ features/         # Feature-based modüller
> Ôöé   Ôö£ÔöÇÔöÇ auth/
> Ôöé   Ôöé   Ôö£ÔöÇÔöÇ components/
> Ôöé   Ôöé   Ôö£ÔöÇÔöÇ hooks/
> Ôöé   Ôöé   ÔööÔöÇÔöÇ services/
> Ôöé   ÔööÔöÇÔöÇ dashboard/
> Ôö£ÔöÇÔöÇ hooks/            # Global custom hooks
> Ôö£ÔöÇÔöÇ services/         # API servis katmanı
> Ôö£ÔöÇÔöÇ store/            # Global state (Zustand/Redux)
> Ôö£ÔöÇÔöÇ types/            # TypeScript tipleri
> ÔööÔöÇÔöÇ utils/            # Yardımcı fonksiyonlar
> ```
>
> *Bu yapı, özellikle orta ve büyük ölçekli React projeleri için önerilir.*

---

## 12. Horizontal Rule Çeşitleri

---

***

---

---

## 13. Kaçış Karakterleri (Escape)

\*Bu metin italik değil\*  
\_Bu da öyle\_  
\`kod değil\`  
# Bu başlık değil

---

## 14. Çok Dilli İçerik

­şç╣­şçÀ **Türkçe:** Merhaba Dünya! Bu bir markdown test dosyasıdır.

­şç¼­şçğ **English:** Hello World! This is a markdown test file.

­şç®­şç¬ **Deutsch:** Hallo Welt! Dies ist eine Markdown-Testdatei.

­şç½­şçÀ **Français:** Bonjour le Monde! Ceci est un fichier de test Markdown.

­şç»­şçÁ **µùÑµ£¼×¬Ş:** ÒüôÒéôÒü½ÒüíÒü»õ©ûòî´╝üÒüôÒéîÒü»ÒâŞÒâ╝Òé»ÒâÇÒéĞÒâ│ÒâåÒé╣ÒâêÒâòÒéíÒéñÒâ½ÒüğÒüÖÒÇé

­şç¿­şç│ **õ©¡µûç:** õ¢áÕÑ¢õ©ûòî´╝ü×┐Öµİ»õ©Çõ©¬ Markdown µÁï×»òµûçõ╗ÂÒÇé

---

## 15. Adım Adım Rehber (Collapsible)

<details>
<summary><strong>­şæÂ Yeni Başlayanlar için React Kurulumu</strong></summary>

1. **Node.js kur** → [nodejs.org](https://nodejs.org)
2. **Yeni proje oluştur:**
   ```bash
   npx create-react@latest my-app
   # veya
   npm create vite@latest my-app -- --template react-ts
   ```
3. **Projeyi başlat:**
   ```bash
   cd my-app
   npm install
   npm run dev
   ```
4. **Tarayıcıda aç:** `http://localhost:5173`
</details>

<details>
<summary><strong>­şÉ│ Docker ile Çalıştırma</strong></summary>

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```
</details>

---

## ­şÅü Sonuç

Bu dosya, markdown render motorunun aşağıdaki özelliklerini test etmek için hazırlanmıştır:

| # | Özellik | Durum |
|:-:|---------|:-----:|
| 1 | Başlıklar (H1-H6) | ÔÅ│ Test ediliyor |
| 2 | Metin biçimlendirme | ÔÅ│ Test ediliyor |
| 3 | Listeler (sıralı/sırasız/görev) | ÔÅ│ Test ediliyor |
| 4 | Kod blokları (dil vurgulu) | ÔÅ│ Test ediliyor |
| 5 | Alıntılar | ÔÅ│ Test ediliyor |
| 6 | Tablolar | ÔÅ│ Test ediliyor |
| 7 | Linkler ve görseller | ÔÅ│ Test ediliyor |
| 8 | HTML karışımı | ÔÅ│ Test ediliyor |
| 9 | Emoji ve semboller | ÔÅ│ Test ediliyor |
| 10 | Kod içinde kod (nested) | ÔÅ│ Test ediliyor |

---

*Test dosyası sonu — 2026-06-28*
