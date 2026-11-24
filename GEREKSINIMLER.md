# N&N Nail Studio — Online Randevu Sistemi: Geliştirilmiş Gereksinimler

Bu belge, ilk talebin; Fresha, Booksy, Treatwell, Planity gibi güzellik salonu randevu platformlarında
yerleşmiş uygulamalar ve Türkiye'deki salon işleyişi (KVKK, WhatsApp kullanımı, telefon formatı) dikkate alınarak
genişletilmiş halidir. **[v1]** ile işaretlenenler bu sürümde yapıldı, **[Sonra]** olanlar yol haritasındadır.

## 1. Müşteri tarafı (mobil öncelikli)

| # | Özellik | Neden | Durum |
|---|---|---|---|
| 1 | Kategoriye göre hizmet listesi (Manikür, Kalıcı Oje, Protez, Nail Art, Pedikür) | Müşteri aradığını hızlı bulsun | [v1] |
| 2 | Birden fazla hizmet seçimi, **süre + fiyat** görünür, alt barda canlı toplam | Fiyat şeffaflığı, iptal ve sürprizleri azaltır | [v1] |
| 3 | Uzman seçimi **veya "Fark etmez"** (ilk müsait uzman otomatik atanır) | Dolu takvimde dönüşümü artırır | [v1] |
| 4 | Sadece seçilen hizmetlerin **hepsini yapabilen** personelin gösterilmesi | Protez yapmayan personele protez randevusu düşmez | [v1] |
| 5 | Randevu süresi = seçilen hizmetlerin süre toplamı; slotlar buna göre hesaplanır | Çakışma ve taşmayı önler | [v1] |
| 6 | Kaydırılabilir gün şeridi, müsait olmayan günler pasif; saatler Sabah / Öğleden sonra / Akşam grupları | Tek elle kullanım | [v1] |
| 7 | En erken randevu süresi (örn. 2 saat sonra) ve en ileri tarih (örn. 30 gün) | Son dakika sürprizlerini önler | [v1] |
| 8 | Ad, telefon (Türkiye formatı doğrulama), isteğe bağlı e-posta ve not | Minimum sürtünme, üyelik zorunlu değil | [v1] |
| 9 | **KVKK aydınlatma metni** onayı | Türkiye'de kişisel veri işlemek için yasal gereklilik | [v1] (metin hukukçuya kontrol ettirilmeli) |
| 10 | Onay ekranında randevu kodu, **takvime ekle (.ics)**, WhatsApp ile salona yaz | Unutulan randevuları azaltır | [v1] |
| 11 | **Randevumu yönet**: kod + telefon ile görüntüleme ve iptal (örn. 12 saat kuralı) | Telefon trafiğini azaltır, boşalan saat yeniden satılır | [v1] |
| 12 | Aynı telefona en fazla N aktif randevu, IP başına istek sınırı | Sahte/spam rezervasyonu engeller | [v1] |
| 13 | Tekrar gelen müşterinin bilgilerinin cihazda hatırlanması | Hızlı tekrar rezervasyon | [v1] |
| 14 | SMS / WhatsApp onay ve **24 saat önce hatırlatma** | No-show oranını ciddi düşürür | [Sonra] (Netgsm/İleti Merkezi veya WhatsApp Business API) |
| 15 | Kapora / ön ödeme (iyzico, PayTR) — özellikle protez gibi uzun işlemlerde | Gelmeme kaybını önler | [Sonra] |
| 16 | Hizmet görselleri, galeri, Instagram bağlantısı, Google Haritalar | Güven ve satış | [Sonra] |
| 17 | Google İşletme Profili "Randevu al" butonuna site linki | Ücretsiz trafik | [Sonra] (yayına alınınca) |

## 2. Admin paneli (mobil öncelikli)

| # | Özellik | Durum |
|---|---|---|
| 1 | Şifreli giriş, varsayılan şifre değiştirme uyarısı | [v1] |
| 2 | **Tek takvim**: gün görünümünde her personel ayrı renkli sütun, personel filtre çipleri | [v1] |
| 3 | Hafta/liste görünümü (mobilde en okunaklı), günlük randevu sayısı ve tahmini ciro | [v1] |
| 4 | Takvimde boş alana dokunarak **telefonla gelen randevuyu elle ekleme**; çakışma uyarısı | [v1] |
| 5 | Randevu detayı: ara / WhatsApp, durum (Onaylı, Tamamlandı, Gelmedi, İptal), taşıma, iç not | [v1] |
| 6 | Hizmet tanımlama: kategori, ad, açıklama, süre, fiyat, sıra, aktif/pasif | [v1] |
| 7 | Personel: ad, unvan, renk, telefon, yapabildiği hizmetler, **haftalık çalışma saatleri + mola** | [v1] |
| 7b | **2 fiyat listesi** (örn. Standart / Stüdyo sahibi): her hizmete 2 fiyat, her personele 1 liste atanır. Müşteri hizmet seçerken fiyat aralığını, uzman seçerken o uzmanın kesin toplamını görür. "Fark etmez" seçilirse önce uygun fiyatlı müsait uzman atanır. Randevu başka listedeki personele taşınırsa fiyat otomatik güncellenir. Liste adları Ayarlar'dan değişir. | [v1] |
| 8 | **Çalışma günleri takvimi**: ay görünümünde günlere dokunup çoklu seçim → Kapat / Aç (saatli) / Varsayılan. Salon geneli veya personel bazlı (izin, rapor, bayram) | [v1] |
| 9 | Kapatılan günde mevcut randevu varsa uyarı | [v1] |
| 10 | Ayarlar: slot aralığı, randevular arası temizlik/hazırlık süresi, en erken / en ileri rezervasyon, iptal süresi, iletişim bilgileri | [v1] |
| 11 | Müşteri kartı (geçmiş randevular, no-show sayısı, notlar/alerji bilgisi) | [Sonra] |
| 12 | Raporlar: personel bazlı ciro, en çok satan hizmet, doluluk | [Sonra] |
| 13 | Çoklu admin / personel girişi (personel sadece kendi takvimini görür) | [Sonra] |
| 14 | Google Takvim senkronizasyonu | [Sonra] |

## 3. Teknik
- Yerelde çalışır: Node.js 22+ (yerleşik SQLite), **harici paket yok**.
- Tek dosya veritabanı: `data/nn-nail.db` (yedeklemek için bu dosyayı kopyalamak yeterli).
- Aynı Wi-Fi'daki telefondan test için sunucu yerel ağ adresini de yazdırır.
- Yayına alırken: HTTPS, alan adı, düzenli yedek, gerçek KVKK metni, SMS sağlayıcı.
