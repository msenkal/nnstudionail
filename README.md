# N&N Nail Studio — Online Randevu

Mobil öncelikli müşteri randevu sitesi + admin paneli. Harici paket gerektirmez (Node.js 22.13+ yeterli).

## Çalıştırma
```
npm start
```
- Müşteri sitesi: http://localhost:3000
- Admin paneli: http://localhost:3000/admin — varsayılan şifre `admin123` (ilk girişte Ayarlar'dan değiştirin)
- Aynı Wi-Fi'daki telefondan açmak için sunucunun yazdırdığı `http://192.168.x.x:3000` adresini kullanın.

## Demoyu internette yayınlama
Adım adım: `YAYINLAMA.md` (Render.com ücretsiz plan, `render.yaml` hazır).

## Fiyat listeleri
Her hizmetin iki fiyatı vardır (Hizmetler sekmesi). Her personel bir listeye bağlıdır (Personel sekmesi → Fiyat listesi).
Müşteri, seçtiği uzmanın listesindeki fiyatı öder. Liste 2 fiyatı boş bırakılırsa Liste 1 fiyatı kullanılır.

## Demo veri
- `npm run demo` — son 3 hafta + önümüzdeki 3 hafta için ~330 gerçekçi randevu, 3. personel (Nisa), izin ve özel günler üretir. Tekrar çalıştırınca eski demo verisini silip yeniden üretir.
- `npm run demo:temizle` — yalnızca demo verisini siler (kodu `DM` ile başlayan randevular, `[demo]` notlu günler). Sizin girdiğiniz kayıtlara dokunmaz.

## Dosyalar
- `server.js` — API, müsaitlik hesaplama, oturum
- `db.js` — SQLite şeması, varsayılan ayarlar, örnek hizmet/personel
- `public/` — müşteri sitesi (`index.html`, `app.js`) ve admin paneli (`admin.html`, `admin.js`)
- `data/nn-nail.db` — tüm veriler (yedek için bu dosyayı kopyalayın; silerseniz örnek verilerle sıfırdan başlar)
- `GEREKSINIMLER.md` — geliştirilmiş gereksinim listesi ve yol haritası

## Müsaitlik kuralları
Bir saat, müşteriye şu koşullar sağlanırsa gösterilir:
1. Seçilen hizmetlerin hepsini yapabilen aktif bir personel var,
2. Personel o gün çalışıyor (haftalık plan → personel özel günü → salon geneli kapalı günü öncelik sırasıyla),
3. Toplam hizmet süresi mesai ve mola dışına taşmıyor,
4. Mevcut randevularla, aradaki hazırlık süresi dahil çakışmıyor,
5. "En erken" ve "en ileri" rezervasyon sınırları içinde.
