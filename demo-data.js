// Demo veri oluşturur:  npm run demo        (önceki demo verisini silip yeniden üretir)
// Demo veriyi siler:     npm run demo:temizle
import './tz.js';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { db, setSetting } from './db.js';

const DEMO = '[demo]';

/** Demo veriyi (yeniden) üretir. clean=true ise sadece siler. Sunucu DEMO_MODE=1 iken bunu kendisi çağırır. */
export function generateDemo({ clean: CLEAN_ONLY = false, log = console.log } = {}) {
// ---------- Önceki demo verisini temizle ----------
db.exec('BEGIN');
db.prepare("DELETE FROM bookings WHERE code LIKE 'DM%'").run();
db.prepare('DELETE FROM day_overrides WHERE note LIKE ?').run(`%${DEMO}%`);
const oldDemoStaff = db.prepare('SELECT id FROM staff WHERE phone = ? OR title LIKE ?').all(DEMO, `%${DEMO}%`);
for (const s of oldDemoStaff) {
  if (!db.prepare('SELECT 1 FROM bookings WHERE staff_id = ?').get(s.id)) db.prepare('DELETE FROM staff WHERE id = ?').run(s.id);
}
db.exec('COMMIT');
if (CLEAN_ONLY) { log('Demo veriler silindi.'); return; }

// ---------- Yardımcılar ----------
let seed = 20261119;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOffset = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const CHARS = 'ABCDEFGHJKLMNPRSTUVYZ23456789';
const code = () => { for (;;) { let c = 'DM'; for (const b of crypto.randomBytes(4)) c += CHARS[b % CHARS.length]; if (!db.prepare('SELECT 1 FROM bookings WHERE code = ?').get(c)) return c; } };

const FIRST = ['Ayşe', 'Elif', 'Zeynep', 'Merve', 'Büşra', 'Selin', 'Ece', 'Deniz', 'Melis', 'Ceren', 'İrem', 'Gizem', 'Damla', 'Sude', 'Esra',
  'Nazlı', 'Pınar', 'Buse', 'Derya', 'Hande', 'Tuğba', 'Yasemin', 'Cansu', 'Ebru', 'Gamze', 'Aslı', 'Burcu', 'Şeyma', 'Dilara', 'Ezgi'];
const LAST = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Aydın', 'Öztürk', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Koç', 'Kurt',
  'Özdemir', 'Erdoğan', 'Polat', 'Korkmaz', 'Çetin', 'Uçar', 'Güneş', 'Aksoy', 'Tekin', 'Bulut'];
const NOTES = ['', '', '', '', '', 'Nude tonlarda düşünüyorum', 'Badem form olsun', 'İlk kez geliyorum', 'Pinterest\'ten örnek getireceğim',
  'Kırmızı oje istiyorum', 'Biraz geç kalabilirim', 'Kısa ve kare form lütfen', 'Ombre tasarım'];
const ADMIN_NOTES = ['', '', '', '', 'Düzenli müşteri', 'Kalıcı ojeye hassasiyeti var', 'Krom toz sever', 'Instagram\'dan geldi'];

// 30 kişilik sabit müşteri havuzu (tekrar gelen müşteriler gerçekçi görünsün)
const customers = Array.from({ length: 30 }, (_, i) => ({
  name: `${FIRST[i % FIRST.length]} ${pick(LAST)}`,
  phone: `05${pick(['32', '33', '35', '36', '41', '42', '43', '44', '45', '51', '52', '53', '54', '55'])}${String(Math.floor(rnd() * 1e7)).padStart(7, '0')}`,
}));

// ---------- 3. demo personel ----------
const svcAll = db.prepare('SELECT * FROM services WHERE deleted = 0 AND active = 1').all();
const demoStaffId = db.prepare('INSERT INTO staff (name, title, color, phone, sort) VALUES (?, ?, ?, ?, ?)')
  .run('Nisa', 'Protez Tırnak Uzmanı', '#5fa58a', DEMO, 2).lastInsertRowid; // telefon alanı demo işareti (müşteri görmez)
for (const s of svcAll) if (s.category !== 'Pedikür') db.prepare('INSERT INTO staff_services VALUES (?, ?)').run(demoStaffId, s.id);
for (let wd = 0; wd < 7; wd++) {   // Salı-Cumartesi 11:00-21:00
  db.prepare('INSERT INTO working_hours VALUES (?, ?, ?, ?, ?, ?, ?)').run(demoStaffId, wd, wd >= 2 && wd <= 6 ? 1 : 0, 660, 1260, 900, 930);
}

// ---------- Özel günler ----------
const staff = db.prepare('SELECT * FROM staff WHERE active = 1 AND deleted = 0 ORDER BY sort, id').all();
const insOv = db.prepare('INSERT OR REPLACE INTO day_overrides (staff_id, date, closed, start_min, end_min, note) VALUES (?, ?, ?, ?, ?, ?)');
// İkinci personel önümüzdeki hafta 2 gün izinli
const izinli = staff[1];
const izinGunleri = [9, 10].map((n) => ymd(dayOffset(n)));
if (izinli) for (const d of izinGunleri) insOv.run(izinli.id, d, 1, null, null, `Yıllık izin ${DEMO}`);
// 3 hafta sonraki pazar: salon özel açık gün (kampanya)
const sunday = dayOffset(0); sunday.setDate(sunday.getDate() + ((7 - sunday.getDay()) % 7) + 14);
insOv.run(null, ymd(sunday), 0, 660, 1080, `Yılbaşı öncesi özel açık gün ${DEMO}`);
// 19 gün sonra salon tamamen kapalı (bakım)
const kapali = ymd(dayOffset(19));
insOv.run(null, kapali, 1, null, null, `Tadilat / bakım ${DEMO}`);

// ---------- Çalışma aralığı ----------
const getOv = (sid, d) => db.prepare('SELECT * FROM day_overrides WHERE IFNULL(staff_id,0) = ? AND date = ?').get(sid ?? 0, d);
function windowOf(s, d, dateObj) {
  const salon = getOv(null, d);
  if (salon?.closed) return null;
  const own = getOv(s.id, d);
  if (own) return own.closed ? null : { start: own.start_min, end: own.end_min };
  if (salon) return { start: salon.start_min, end: salon.end_min };
  const wh = db.prepare('SELECT * FROM working_hours WHERE staff_id = ? AND weekday = ?').get(s.id, dateObj.getDay());
  return wh && wh.enabled ? { start: wh.start_min, end: wh.end_min, bs: wh.break_start, be: wh.break_end } : null;
}

// ---------- Randevuları üret ----------
const insB = db.prepare(`INSERT INTO bookings (code, staff_id, date, start_min, end_min, customer_name, phone, email, note, admin_note, total_price, status, source, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`);
const insI = db.prepare('INSERT INTO booking_items (booking_id, service_id, name, duration_min, price) VALUES (?, ?, ?, ?, ?)');
const now = new Date();
const nowMin = now.getHours() * 60 + now.getMinutes();
const BUFFER = 10;
const counts = { completed: 0, confirmed: 0, no_show: 0, cancelled: 0 };

// Gerçekçi hizmet kombinasyonları
function combo(staffSvc) {
  const by = (n) => staffSvc.find((s) => s.name === n);
  const options = [
    ['Kalıcı Oje (El)'], ['Kalıcı Oje (El)'], ['Kalıcı Oje (El)', 'Kalıcı Oje Çıkarma'], ['Klasik Manikür'],
    ['Klasik Manikür', 'Kalıcı Oje (El)'], ['Protez Tırnak (Jel)'], ['Protez Tırnak Dolgu'], ['Protez Tırnak Dolgu', 'Nail Art (10 tırnak)'],
    ['Protez Tırnak (Jel)', 'French Uygulama'], ['Kalıcı Oje (El)', 'Nail Art (10 tırnak)'], ['Klasik Pedikür'], ['Spa Pedikür'],
    ['Kalıcı Oje (El)', 'Kalıcı Oje (Ayak)'], ['Klasik Manikür', 'Klasik Pedikür'], ['Kalıcı Oje (El)', 'Taş / Süsleme'],
  ];
  for (let i = 0; i < 10; i++) {
    const list = pick(options).map(by);
    if (list.every(Boolean)) return list;
  }
  return [pick(staffSvc)];
}

db.exec('BEGIN');
for (let off = -21; off <= 21; off++) {
  const dateObj = dayOffset(off);
  const d = ymd(dateObj);
  // Doluluk: geçmiş ve yakın günler yoğun, uzak günler seyrek
  const fill = off < 0 ? 0.75 : off <= 3 ? 0.65 : off <= 10 ? 0.4 : 0.15;
  for (const s of staff) {
    const w = windowOf(s, d, dateObj);
    if (!w) continue;
    const staffSvc = db.prepare('SELECT sv.* FROM services sv JOIN staff_services ss ON ss.service_id = sv.id WHERE ss.staff_id = ? AND sv.deleted = 0').all(s.id);
    if (!staffSvc.length) continue;
    let t = w.start;
    while (t < w.end) {
      if (rnd() > fill) { t += pick([30, 45, 60]); continue; }
      const items = combo(staffSvc);
      const len = items.reduce((a, x) => a + x.duration_min, 0);
      const end = t + len;
      if (end > w.end) break;
      if (w.bs != null && t < w.be && end > w.bs) { t = w.be; continue; }
      const past = off < 0 || (off === 0 && end <= nowMin);
      let status;
      const r = rnd();
      if (past) status = r < 0.86 ? 'completed' : r < 0.93 ? 'no_show' : 'cancelled';
      else status = r < 0.92 ? 'confirmed' : 'cancelled';
      const c = pick(customers);
      const priceOf = (x) => (s.price_list === 2 && x.price2 != null ? x.price2 : x.price);
      const created = dayOffset(off - 1 - Math.floor(rnd() * 10));
      created.setHours(9 + Math.floor(rnd() * 13), Math.floor(rnd() * 60));
      const id = insB.run(code(), s.id, d, t, end, c.name, c.phone, pick(NOTES), status === 'cancelled' ? 'Müşteri iptal etti' : pick(ADMIN_NOTES),
        items.reduce((a, x) => a + priceOf(x), 0), status, rnd() < 0.7 ? 'web' : 'admin',
        `${ymd(created)} ${pad(created.getHours())}:${pad(created.getMinutes())}:00`).lastInsertRowid;
      for (const x of items) insI.run(id, x.id, x.name, x.duration_min, priceOf(x));
      counts[status]++;
      // İptal edilenler saati bloklamaz; aynı saate başka randevu düşebilir (gerçekçi)
      t = status === 'cancelled' ? t + 15 : end + BUFFER + pick([0, 0, 5, 20, 35]);
      t = Math.ceil(t / 15) * 15;
    }
  }
}
db.exec('COMMIT');

const total = Object.values(counts).reduce((a, b) => a + b, 0);
const revenue = db.prepare("SELECT SUM(total_price) AS s FROM bookings WHERE code LIKE 'DM%' AND status = 'completed'").get().s || 0;
setSetting('demo_generated_on', ymd(new Date()));
log(`Demo veri oluşturuldu:
  • ${total} randevu (son 3 hafta + önümüzdeki 3 hafta)
    tamamlanan ${counts.completed} · onaylı ${counts.confirmed} · gelmedi ${counts.no_show} · iptal ${counts.cancelled}
  • Geçmiş ciro (tamamlanan): ₺${revenue.toLocaleString('tr-TR')}
  • Yeni personel: Nisa (Protez Tırnak Uzmanı, Salı-Cumartesi)
  • ${izinli?.name ?? '-'} için 2 gün yıllık izin, salon için 1 kapalı gün ve 1 özel açık Pazar
Silmek için: npm run demo:temizle`);
}

// Komut satırından çalıştırıldıysa:  npm run demo  /  npm run demo:temizle
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateDemo({ clean: process.argv.includes('--temizle') });
}
