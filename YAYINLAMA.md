# Demoyu Render.com'da yayınlama (ücretsiz, ~15 dakika)

Sonuçta müşteriniz şu iki linki açabilir:
- Müşteri sitesi: `https://nn-nail-demo.onrender.com`
- Admin paneli: `https://nn-nail-demo.onrender.com/admin` (şifre giriş ekranında yazar: `nndemo`)

## 1. GitHub'a yükleme
1. https://github.com adresinde ücretsiz hesap açın (varsa giriş yapın).
2. Sağ üstte **+ → New repository**. Ad: `nn-nail-demo`. **Private** seçebilirsiniz. **Create repository**.
3. Açılan sayfada **"uploading an existing file"** bağlantısına tıklayın.
4. `nn-nail-yukle.zip` dosyasını bilgisayarınızda **açın (klasöre çıkarın)**. İçindeki **tüm dosya ve klasörleri** (public klasörü dahil) tarayıcıdaki alana sürükleyin.
   - Zip'in kendisini değil, içindekileri sürükleyin.
   - `.gitignore` gizli dosyadır; görünmüyorsa sorun değil, olmadan da çalışır.
5. Alttaki **Commit changes** butonuna basın.

Kontrol: depo sayfasında `server.js`, `render.yaml`, `package.json` ve `public` klasörünü görmelisiniz.

## 2. Render'a bağlama
1. https://render.com adresinde **GitHub ile giriş** yapın (Sign in with GitHub).
2. **New + → Blueprint**.
3. GitHub erişimi isterse `nn-nail-demo` deposuna izin verin ve depoyu seçin.
4. Render `render.yaml` dosyasını okuyup **nn-nail-demo** servisini gösterir. **Apply / Deploy Blueprint**.
5. 2–3 dakika sonra durum **Live** olur. Servis sayfasının üstündeki `https://nn-nail-demo....onrender.com` linki demonuzdur.
   (Bu ad alınmışsa Render sonuna birkaç harf ekler.)

**Blueprint kart bilgisi isterse veya hata verirse — elle kurulum:** **New + → Web Service** → depoyu seçin ve şunları girin:
- Language: **Node**, Region: **Frankfurt**, Instance type: **Free**
- Build Command: `echo ok` · Start Command: `npm start`
- **Environment Variables** bölümüne şunları ekleyin: `NODE_VERSION=24`, `TZ=Europe/Istanbul`, `DEMO_MODE=1`, `TRUST_PROXY=1`, `ADMIN_PASSWORD=nndemo`
- **Deploy Web Service**.

## Bilinmesi gerekenler
- **İlk açılış yavaş olabilir:** Ücretsiz planda 15 dakika kimse girmezse sunucu uyur; sonraki ilk açılış ~30–60 sn sürer. Sunumdan önce linki bir kez açın.
- **Veriler kendini yeniler:** Her gün ve sunucu her uyanışta demo veriler bugünün tarihine göre yeniden üretilir. Müşterinin denemeleri kalıcı değildir — demo için istenen durum budur.
- **Demo şeridi:** Müşteri sitesinin üstünde "Demo sürüm" yazar; Google'a kapalıdır (noindex).
- **Güncelleme:** Kodda değişiklik olursa GitHub'da ilgili dosyayı yeniden yükleyin; Render otomatik yeniden yayınlar.
- **Gerçek kullanıma geçerken** bu demo kurulumu kullanılmaz: kalıcı disk (VPS veya Render ücretli disk), `DEMO_MODE` kapalı, güçlü bir `ADMIN_PASSWORD` ve günlük yedek gerekir.

## Ortam değişkenleri (render.yaml içinde)
| Değişken | Anlamı |
|---|---|
| `DEMO_MODE=1` | Demo şeridi, günlük veri yenileme, şifre değiştirme kapalı |
| `ADMIN_PASSWORD` | Admin şifresi (demo modunda giriş ekranında gösterilir) |
| `TZ=Europe/Istanbul` | Randevu saatleri Türkiye saatine göre |
| `TRUST_PROXY=1` | Gerçek ziyaretçi IP'si (spam koruması) ve HTTPS çerezi |
| `DATA_DIR` | (isteğe bağlı) Veritabanı klasörü — kalıcı disk takılırsa oraya yönlendirilir |
