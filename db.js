import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'nn-nail.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Genel',
  description TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL,
  price REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#b76e79',
  phone TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS staff_services (
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);

CREATE TABLE IF NOT EXISTS working_hours (
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL,              -- 0 = Pazar ... 6 = Cumartesi
  enabled INTEGER NOT NULL DEFAULT 1,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  break_start INTEGER,
  break_end INTEGER,
  PRIMARY KEY (staff_id, weekday)
);

-- staff_id NULL => salon geneli
CREATE TABLE IF NOT EXISTS day_overrides (
  id INTEGER PRIMARY KEY,
  staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  closed INTEGER NOT NULL,
  start_min INTEGER,
  end_min INTEGER,
  note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_override ON day_overrides (IFNULL(staff_id, 0), date);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  total_price REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',  -- confirmed | completed | no_show | cancelled
  source TEXT NOT NULL DEFAULT 'web',        -- web | admin
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS ix_bookings_date ON bookings (date, staff_id);
CREATE INDEX IF NOT EXISTS ix_bookings_phone ON bookings (phone);

CREATE TABLE IF NOT EXISTS booking_items (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id INTEGER,
  name TEXT NOT NULL,
  duration_min INTEGER NOT NULL,
  price REAL NOT NULL
);
`);

// ---------- Şema güncellemeleri (mevcut veritabanları için) ----------
const hasCol = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasCol('services', 'price2')) {
  db.exec('ALTER TABLE services ADD COLUMN price2 REAL');
  // Mevcut hizmetler için başlangıç değeri: Liste 1 fiyatının ~%30 fazlası (50'ye yuvarlanmış). Panelden düzenlenir.
  db.exec('UPDATE services SET price2 = ROUND(price * 1.3 / 50.0) * 50');
}
if (!hasCol('staff', 'price_list')) {
  db.exec('ALTER TABLE staff ADD COLUMN price_list INTEGER NOT NULL DEFAULT 1');
}

// ---------- Şifre ----------
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 64);
  const real = Buffer.from(hash, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}

// ---------- Ayarlar ----------
const DEFAULT_SETTINGS = {
  salon_name: 'N&N Nail Studio',
  tagline: 'Tırnaklarınız için özenli dokunuş',
  phone: '0555 555 55 55',
  whatsapp: '905555555555',
  address: 'İstanbul',
  instagram: 'nnnailstudio',
  slot_interval: '15',
  buffer_min: '10',
  min_notice_hours: '2',
  max_days_ahead: '30',
  cancel_limit_hours: '12',
  max_active_per_phone: '3',
  default_open: '10:00',
  default_close: '20:00',
  price_list1_name: 'Standart',
  price_list2_name: 'Özel (Stüdyo sahibi)',
  admin_password_hash: '',
  password_is_default: '1',
};

const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);
if (!db.prepare("SELECT value FROM settings WHERE key = 'admin_password_hash'").get().value) {
  db.prepare("UPDATE settings SET value = ? WHERE key = 'admin_password_hash'").run(hashPassword('admin123'));
}

let cache = null;
export function getSettings() {
  if (!cache) {
    cache = {};
    for (const r of db.prepare('SELECT key, value FROM settings').all()) cache[r.key] = r.value;
  }
  return cache;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  cache = null;
}

// Ortam değişkeniyle şifre verildiyse (canlı/demo sunucu) onu kullan
if (process.env.ADMIN_PASSWORD) {
  setSetting('admin_password_hash', hashPassword(process.env.ADMIN_PASSWORD));
  setSetting('password_is_default', '0');
}

// ---------- Örnek veri (ilk çalıştırmada) ----------
if (db.prepare('SELECT COUNT(*) AS c FROM services').get().c === 0) seedSample();

/** Tüm hizmet, personel, takvim ve randevuları silip örnek verileri yükler (ayarlar korunur). */
export function resetAll() {
  db.exec('BEGIN');
  for (const t of ['booking_items', 'bookings', 'day_overrides', 'staff_services', 'working_hours', 'staff', 'services']) db.exec(`DELETE FROM ${t}`);
  seedSample();
  db.exec('COMMIT');
}

function seedSample() {
  const services = [ // [kategori, ad, açıklama, süre dk, Liste 1 fiyatı] — Liste 2 = ~%30 fazlası
    ['Manikür', 'Klasik Manikür', 'Şekillendirme, kütikül bakımı ve nemlendirme', 40, 450],
    ['Manikür', 'Kalıcı Oje (El)', 'Uzun süre kalıcı, parlak jel oje uygulaması', 60, 650],
    ['Manikür', 'Kalıcı Oje Çıkarma', 'Tırnağa zarar vermeden güvenli çıkarma', 20, 200],
    ['Protez Tırnak', 'Protez Tırnak (Jel)', 'İstediğiniz uzunluk ve formda jel protez', 120, 1400],
    ['Protez Tırnak', 'Protez Tırnak Dolgu', '3-4 haftalık bakım dolgusu', 90, 1000],
    ['Protez Tırnak', 'Protez Tırnak Çıkarma', 'Bakım ile birlikte çıkarma', 30, 300],
    ['Nail Art', 'French Uygulama', 'Klasik veya renkli french', 20, 250],
    ['Nail Art', 'Nail Art (10 tırnak)', 'Çizim, desen, ombre ve özel tasarımlar', 30, 400],
    ['Nail Art', 'Taş / Süsleme', 'Taş, folyo ve aksesuar uygulaması', 15, 150],
    ['Pedikür', 'Klasik Pedikür', 'Ayak bakımı, topuk ve tırnak bakımı', 50, 600],
    ['Pedikür', 'Kalıcı Oje (Ayak)', 'Ayak tırnaklarına kalıcı oje', 50, 600],
    ['Pedikür', 'Spa Pedikür', 'Peeling, maske ve masaj ile bakım', 70, 850],
  ];
  const insSvc = db.prepare('INSERT INTO services (category, name, description, duration_min, price, price2, sort) VALUES (?, ?, ?, ?, ?, ?, ?)');
  services.forEach((s, i) => insSvc.run(...s, Math.round((s[4] * 1.3) / 50) * 50, i));

  // Nehir örnek olarak "stüdyo sahibi" fiyat listesinde (Liste 2)
  const insStaff = db.prepare('INSERT INTO staff (name, title, color, price_list, sort) VALUES (?, ?, ?, ?, ?)');
  const a = insStaff.run('Nehir', 'Stüdyo Sahibi · Nail Artist', '#b76e79', 2, 0).lastInsertRowid;
  const b = insStaff.run('Naz', 'Manikür & Pedikür Uzmanı', '#7b8fc9', 1, 1).lastInsertRowid;

  const allSvc = db.prepare('SELECT id, category FROM services').all();
  const insSS = db.prepare('INSERT INTO staff_services (staff_id, service_id) VALUES (?, ?)');
  for (const s of allSvc) {
    insSS.run(a, s.id);
    if (s.category !== 'Protez Tırnak') insSS.run(b, s.id);
  }

  const insWH = db.prepare('INSERT INTO working_hours (staff_id, weekday, enabled, start_min, end_min, break_start, break_end) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (let wd = 0; wd < 7; wd++) {
    insWH.run(a, wd, wd === 0 ? 0 : 1, 600, 1200, 840, 870);                 // Pazar kapalı
    insWH.run(b, wd, wd === 0 || wd === 3 ? 0 : 1, 600, 1200, 870, 900);     // Pazar + Çarşamba izinli
  }
}
