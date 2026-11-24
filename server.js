import './tz.js';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, getSettings, setSetting, hashPassword, verifyPassword, resetAll } from './db.js';
import { generateDemo } from './demo-data.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const DEMO_MODE = process.env.DEMO_MODE === '1';
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // Render, Caddy, Nginx gibi bir vekil sunucunun arkasında
const clientIp = (req) =>
  (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
const isHttps = (req) => TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https';

// ============ Yardımcılar ============
class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const bad = (msg, extra) => { throw new HttpError(400, msg, extra); };

const pad = (n) => String(n).padStart(2, '0');
const toMin = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 1440 && Number(m[2]) < 60 ? v : null;
};
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;
const weekday = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const startsAt = (date, min) => new Date(`${date}T${fromMin(min)}:00`);
const int = (v, def = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : def);
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

function normPhone(p) {
  let d = String(p ?? '').replace(/\D/g, '');
  if (d.startsWith('90') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith('5')) d = '0' + d;
  return /^0\d{10}$/.test(d) ? d : null;
}
function cfg() {
  const s = getSettings();
  return {
    interval: Math.max(5, int(s.slot_interval, 15)),
    buffer: Math.max(0, int(s.buffer_min, 0)),
    notice: Math.max(0, Number(s.min_notice_hours) || 0),
    maxDays: Math.max(1, int(s.max_days_ahead, 30)),
    cancelHours: Math.max(0, Number(s.cancel_limit_hours) || 0),
    maxActive: Math.max(1, int(s.max_active_per_phone, 3)),
  };
}
const CODE_CHARS = 'ABCDEFGHJKLMNPRSTUVYZ23456789';
function newCode() {
  for (;;) {
    let c = '';
    for (const b of crypto.randomBytes(6)) c += CODE_CHARS[b % CODE_CHARS.length];
    if (!db.prepare('SELECT 1 FROM bookings WHERE code = ?').get(c)) return c;
  }
}
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// ============ Takvim / müsaitlik ============
const ACTIVE_STATUSES = "('confirmed','completed')";
const activeStaff = () => db.prepare('SELECT * FROM staff WHERE active = 1 AND deleted = 0 ORDER BY sort, id').all();
const getOverride = (staffId, date) =>
  db.prepare('SELECT * FROM day_overrides WHERE IFNULL(staff_id, 0) = ? AND date = ?').get(staffId ?? 0, date);
const staffServiceIds = (id) => db.prepare('SELECT service_id FROM staff_services WHERE staff_id = ?').all(id).map((r) => r.service_id);

/** Personelin o günkü çalışma aralığı ya da null (çalışmıyor). */
function staffWindow(staffId, date) {
  const salon = getOverride(null, date);
  if (salon?.closed) return null;
  const own = getOverride(staffId, date);
  if (own) return own.closed ? null : { start: own.start_min, end: own.end_min, source: 'override' };
  if (salon) return { start: salon.start_min, end: salon.end_min, source: 'salon' };
  const wh = db.prepare('SELECT * FROM working_hours WHERE staff_id = ? AND weekday = ?').get(staffId, weekday(date));
  if (!wh || !wh.enabled) return null;
  return { start: wh.start_min, end: wh.end_min, break_start: wh.break_start, break_end: wh.break_end, source: 'weekly' };
}

function busyRanges(staffId, date, excludeId = 0) {
  const { buffer } = cfg();
  return db
    .prepare(`SELECT start_min, end_min FROM bookings WHERE staff_id = ? AND date = ? AND id <> ? AND status IN ${ACTIVE_STATUSES}`)
    .all(staffId, date, excludeId)
    .map((b) => [b.start_min - buffer, b.end_min + buffer]);
}

function slotsForStaff(staffId, date, duration) {
  const c = cfg();
  const today = localDate();
  if (date < today || date > addDays(today, c.maxDays)) return [];
  const win = staffWindow(staffId, date);
  if (!win) return [];
  let minStart = win.start;
  const earliest = new Date(Date.now() + c.notice * 3600e3);
  const eDate = localDate(earliest);
  if (date < eDate) return [];
  if (date === eDate) minStart = Math.max(minStart, earliest.getHours() * 60 + earliest.getMinutes());
  const busy = busyRanges(staffId, date);
  if (win.break_start != null && win.break_end > win.break_start) busy.push([win.break_start, win.break_end]);
  const out = [];
  for (let t = win.start; t + duration <= win.end; t += c.interval) {
    if (t < minStart) continue;
    if (busy.some(([a, b]) => t < b && t + duration > a)) continue;
    out.push(t);
  }
  return out;
}

function resolveServices(raw) {
  const ids = [...new Set((Array.isArray(raw) ? raw : String(raw ?? '').split(',')).map(Number).filter((n) => n > 0))];
  if (!ids.length) bad('Lütfen en az bir hizmet seçin.');
  const rows = ids.map((id) => db.prepare('SELECT * FROM services WHERE id = ? AND active = 1 AND deleted = 0').get(id));
  if (rows.some((r) => !r)) bad('Seçtiğiniz hizmetlerden biri artık sunulmuyor. Lütfen sayfayı yenileyin.');
  return rows;
}
function capableStaff(serviceIds) {
  return activeStaff().filter((s) => {
    const set = new Set(staffServiceIds(s.id));
    return serviceIds.every((id) => set.has(id));
  });
}
function pickStaff(services, staffParam) {
  const list = capableStaff(services.map((s) => s.id));
  if (!staffParam || staffParam === 'any') return list;
  const s = list.find((x) => x.id === Number(staffParam));
  if (!s) bad('Seçilen uzman bu hizmet(ler)i sunmuyor.');
  return [s];
}
/** Personelin fiyat listesine göre hizmet fiyatı (Liste 2 boşsa Liste 1 kullanılır). */
const priceFor = (svc, staff) => (staff?.price_list === 2 && svc.price2 != null ? svc.price2 : svc.price);
const totals = (services, staff) => ({
  duration: services.reduce((a, s) => a + s.duration_min, 0),
  price: services.reduce((a, s) => a + priceFor(s, staff), 0),
});

function bookingView(b, admin = false) {
  const items = db.prepare('SELECT service_id, name, duration_min, price FROM booking_items WHERE booking_id = ? ORDER BY id').all(b.id);
  const staff = db.prepare('SELECT name, color FROM staff WHERE id = ?').get(b.staff_id);
  const v = {
    code: b.code, date: b.date, time: fromMin(b.start_min), end_time: fromMin(b.end_min),
    staff_name: staff?.name ?? '', customer_name: b.customer_name, total_price: b.total_price,
    status: b.status, services: items.map((i) => ({ name: i.name, price: i.price, duration: i.duration_min })),
  };
  if (admin) {
    Object.assign(v, {
      id: b.id, staff_id: b.staff_id, staff_color: staff?.color, start_min: b.start_min, end_min: b.end_min,
      phone: b.phone, email: b.email, note: b.note, admin_note: b.admin_note, source: b.source, created_at: b.created_at,
      service_ids: items.map((i) => i.service_id),
    });
  }
  return v;
}

function insertBooking({ staffId, date, start, services, name, phone, email, note, source }) {
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId);
  const t = totals(services, staff);
  const code = newCode();
  const id = db
    .prepare(`INSERT INTO bookings (code, staff_id, date, start_min, end_min, customer_name, phone, email, note, total_price, source)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(code, staffId, date, start, start + t.duration, name, phone, email, note, t.price, source).lastInsertRowid;
  const ins = db.prepare('INSERT INTO booking_items (booking_id, service_id, name, duration_min, price) VALUES (?, ?, ?, ?, ?)');
  for (const s of services) ins.run(id, s.id, s.name, s.duration_min, priceFor(s, staff));
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}

// ============ Basit istek sınırlama ============
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, 'Çok fazla deneme yaptınız. Lütfen biraz sonra tekrar deneyin.');
  arr.push(now);
  hits.set(key, arr);
}

// ============ Oturum ============
const sessions = new Map(); // token -> expires
const SESSION_MS = 12 * 3600e3;
function getCookie(req, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : null;
}
function isAdmin(req) {
  const t = getCookie(req, 'nn_admin');
  const exp = t && sessions.get(t);
  if (!exp || exp < Date.now()) { if (t) sessions.delete(t); return false; }
  sessions.set(t, Date.now() + SESSION_MS);
  return true;
}

// ============ Router ============
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, rx, keys, handler, admin: pattern.startsWith('/api/admin/') && pattern !== '/api/admin/login' });
}

// ---------- Public API ----------
route('GET', '/api/public/info', () => {
  const s = getSettings();
  const c = cfg();
  return {
    salon_name: s.salon_name, tagline: s.tagline, phone: s.phone, whatsapp: s.whatsapp,
    address: s.address, instagram: s.instagram, max_days_ahead: c.maxDays, cancel_limit_hours: c.cancelHours,
    today: localDate(), demo: DEMO_MODE,
    ...(DEMO_MODE && process.env.ADMIN_PASSWORD ? { demo_admin_password: process.env.ADMIN_PASSWORD } : {}),
  };
});

// Fiyat, hizmeti yapan personelin listesine göre değişir; müşteriye en düşük–en yüksek aralık gösterilir.
route('GET', '/api/public/services', () => {
  const staff = activeStaff().map((st) => ({ ...st, svc: new Set(staffServiceIds(st.id)) }));
  return db.prepare('SELECT * FROM services WHERE active = 1 AND deleted = 0 ORDER BY sort, id').all()
    .map((s) => {
      const prices = staff.filter((st) => st.svc.has(s.id)).map((st) => priceFor(s, st));
      if (!prices.length) return null;
      return { id: s.id, category: s.category, name: s.name, description: s.description, duration_min: s.duration_min,
        price_min: Math.min(...prices), price_max: Math.max(...prices) };
    })
    .filter(Boolean);
});

route('GET', '/api/public/staff', ({ query }) => {
  const services = resolveServices(query.services);
  return capableStaff(services.map((s) => s.id))
    .map((s) => ({ id: s.id, name: s.name, title: s.title, color: s.color, total_price: totals(services, s).price }));
});

route('GET', '/api/public/days', ({ query }) => {
  const services = resolveServices(query.services);
  const staff = pickStaff(services, query.staff);
  const { duration } = totals(services);
  const today = localDate();
  const out = [];
  for (let i = 0; i <= cfg().maxDays; i++) {
    const date = addDays(today, i);
    out.push({ date, available: staff.some((s) => slotsForStaff(s.id, date, duration).length > 0) });
  }
  return out;
});

route('GET', '/api/public/slots', ({ query }) => {
  const services = resolveServices(query.services);
  const staff = pickStaff(services, query.staff);
  if (!isDate(query.date)) bad('Geçersiz tarih.');
  const { duration } = totals(services);
  const map = new Map();
  for (const s of staff) for (const t of slotsForStaff(s.id, query.date, duration)) map.set(t, (map.get(t) || 0) + 1);
  return [...map.keys()].sort((a, b) => a - b).map((t) => fromMin(t));
});

route('POST', '/api/public/bookings', ({ body, ip }) => {
  rateLimit('book:' + ip, 10, 10 * 60e3);
  const services = resolveServices(body.services);
  const staffList = pickStaff(services, body.staff);
  if (!isDate(body.date)) bad('Geçersiz tarih.');
  const start = toMin(body.time);
  if (start == null) bad('Geçersiz saat.');
  const name = str(body.name, 80);
  if (name.length < 3) bad('Lütfen adınızı ve soyadınızı yazın.');
  const phone = normPhone(body.phone);
  if (!phone) bad('Lütfen geçerli bir cep telefonu girin (05xx xxx xx xx).');
  const email = str(body.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) bad('E-posta adresi geçersiz görünüyor.');
  if (!body.consent) bad('Devam etmek için KVKK aydınlatma metnini onaylamanız gerekir.');
  const c = cfg();

  return tx(() => {
    const activeCount = db
      .prepare("SELECT COUNT(*) AS n FROM bookings WHERE phone = ? AND status = 'confirmed' AND date >= ?")
      .get(phone, localDate()).n;
    if (activeCount >= c.maxActive)
      throw new HttpError(409, `Bu telefon numarasıyla zaten ${activeCount} aktif randevunuz var. Yeni randevu için lütfen bizi arayın.`);

    const { duration } = totals(services);
    const candidates = staffList.filter((s) => slotsForStaff(s.id, body.date, duration).includes(start));
    if (!candidates.length) throw new HttpError(409, 'Üzgünüz, bu saat az önce doldu. Lütfen başka bir saat seçin.', { slot_taken: true });
    // "Fark etmez" seçildiyse: önce en uygun fiyatlı (standart listedeki) uzman, eşitse o gün en az randevusu olan
    const load = (id) => db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE staff_id = ? AND date = ? AND status IN ${ACTIVE_STATUSES}`).get(id, body.date).n;
    candidates.sort((a, b) => totals(services, a).price - totals(services, b).price || load(a.id) - load(b.id));
    const b = insertBooking({
      staffId: candidates[0].id, date: body.date, start, services, name, phone, email,
      note: str(body.note, 500), source: 'web',
    });
    return bookingView(b);
  });
});

function findCustomerBooking(code, phone) {
  const p = normPhone(phone);
  const b = db.prepare('SELECT * FROM bookings WHERE code = ?').get(str(code, 12).toUpperCase());
  if (!b || !p || b.phone !== p) throw new HttpError(404, 'Bu kod ve telefonla eşleşen bir randevu bulunamadı.');
  return b;
}
route('POST', '/api/public/bookings/lookup', ({ body, ip }) => {
  rateLimit('lookup:' + ip, 20, 10 * 60e3);
  return bookingView(findCustomerBooking(body.code, body.phone));
});
route('POST', '/api/public/bookings/cancel', ({ body, ip }) => {
  rateLimit('lookup:' + ip, 20, 10 * 60e3);
  const b = findCustomerBooking(body.code, body.phone);
  if (b.status !== 'confirmed') bad('Bu randevu zaten aktif değil.');
  const { cancelHours } = cfg();
  const hoursLeft = (startsAt(b.date, b.start_min) - Date.now()) / 3600e3;
  if (hoursLeft < cancelHours)
    bad(`Randevunuza ${cancelHours} saatten az kaldığı için online iptal yapılamıyor. Lütfen bizi arayın: ${getSettings().phone}`);
  db.prepare("UPDATE bookings SET status = 'cancelled', admin_note = TRIM(admin_note || ' [Müşteri online iptal etti]') WHERE id = ?").run(b.id);
  return bookingView(db.prepare('SELECT * FROM bookings WHERE id = ?').get(b.id));
});

// ---------- Admin: oturum ----------
route('POST', '/api/admin/login', ({ req, body, ip, res }) => {
  rateLimit('login:' + ip, 10, 10 * 60e3);
  if (!verifyPassword(body.password, getSettings().admin_password_hash)) throw new HttpError(401, 'Şifre hatalı.');
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  res.setHeader('Set-Cookie', `nn_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${isHttps(req) ? '; Secure' : ''}`);
  return { ok: true };
});
route('POST', '/api/admin/logout', ({ req, res }) => {
  sessions.delete(getCookie(req, 'nn_admin'));
  res.setHeader('Set-Cookie', 'nn_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return { ok: true };
});
route('GET', '/api/admin/me', () => ({
  ok: true, password_is_default: getSettings().password_is_default === '1', today: localDate(), demo: DEMO_MODE,
  price_list_names: { 1: getSettings().price_list1_name, 2: getSettings().price_list2_name },
}));
route('POST', '/api/admin/password', ({ body }) => {
  if (DEMO_MODE) bad('Demo sürümünde şifre değiştirilemez.');
  if (!verifyPassword(body.current, getSettings().admin_password_hash)) bad('Mevcut şifre hatalı.');
  if (String(body.next ?? '').length < 6) bad('Yeni şifre en az 6 karakter olmalı.');
  setSetting('admin_password_hash', hashPassword(body.next));
  setSetting('password_is_default', '0');
  return { ok: true };
});

// ---------- Admin: ayarlar ----------
const EDITABLE_SETTINGS = ['salon_name', 'tagline', 'phone', 'whatsapp', 'address', 'instagram', 'slot_interval', 'buffer_min',
  'min_notice_hours', 'max_days_ahead', 'cancel_limit_hours', 'max_active_per_phone', 'default_open', 'default_close',
  'price_list1_name', 'price_list2_name'];
route('GET', '/api/admin/settings', () => Object.fromEntries(EDITABLE_SETTINGS.map((k) => [k, getSettings()[k]])));
route('PUT', '/api/admin/settings', ({ body }) => {
  for (const k of EDITABLE_SETTINGS) if (k in body) setSetting(k, str(body[k], 300));
  return Object.fromEntries(EDITABLE_SETTINGS.map((k) => [k, getSettings()[k]]));
});

// ---------- Admin: hizmetler ----------
function serviceInput(b) {
  const name = str(b.name, 100);
  if (!name) bad('Hizmet adı zorunlu.');
  const duration = int(b.duration_min);
  if (duration < 5 || duration > 600) bad('Süre 5-600 dakika arasında olmalı.');
  const price = Number(b.price);
  if (!Number.isFinite(price) || price < 0) bad('Liste 1 fiyatı geçersiz.');
  let price2 = b.price2 === '' || b.price2 == null ? null : Number(b.price2);
  if (price2 != null && (!Number.isFinite(price2) || price2 < 0)) bad('Liste 2 fiyatı geçersiz.');
  return [name, str(b.category, 60) || 'Genel', str(b.description, 300), duration, price, price2, bool(b.active ?? 1), int(b.sort)];
}
route('GET', '/api/admin/services', () => db.prepare('SELECT * FROM services WHERE deleted = 0 ORDER BY sort, id').all());
route('POST', '/api/admin/services', ({ body }) => {
  const id = db.prepare('INSERT INTO services (name, category, description, duration_min, price, price2, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(...serviceInput(body)).lastInsertRowid;
  if (body.assign_all) for (const s of activeStaff()) db.prepare('INSERT OR IGNORE INTO staff_services VALUES (?, ?)').run(s.id, id);
  return db.prepare('SELECT * FROM services WHERE id = ?').get(id);
});
route('PUT', '/api/admin/services/:id', ({ params, body }) => {
  db.prepare('UPDATE services SET name=?, category=?, description=?, duration_min=?, price=?, price2=?, active=?, sort=? WHERE id=?')
    .run(...serviceInput(body), int(params.id));
  return db.prepare('SELECT * FROM services WHERE id = ?').get(int(params.id));
});
route('DELETE', '/api/admin/services/:id', ({ params }) => {
  db.prepare('UPDATE services SET deleted = 1, active = 0 WHERE id = ?').run(int(params.id));
  db.prepare('DELETE FROM staff_services WHERE service_id = ?').run(int(params.id));
  return { ok: true };
});

// ---------- Admin: personel ----------
function staffFull(s) {
  const hours = db.prepare('SELECT * FROM working_hours WHERE staff_id = ? ORDER BY weekday').all(s.id);
  return {
    ...s,
    service_ids: staffServiceIds(s.id),
    hours: [0, 1, 2, 3, 4, 5, 6].map((wd) => {
      const h = hours.find((x) => x.weekday === wd);
      return h
        ? { weekday: wd, enabled: !!h.enabled, start: fromMin(h.start_min), end: fromMin(h.end_min),
            break_start: h.break_start != null ? fromMin(h.break_start) : '', break_end: h.break_end != null ? fromMin(h.break_end) : '' }
        : { weekday: wd, enabled: false, start: getSettings().default_open, end: getSettings().default_close, break_start: '', break_end: '' };
    }),
  };
}
function saveStaff(id, b) {
  const name = str(b.name, 60);
  if (!name) bad('Personel adı zorunlu.');
  const color = /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : '#b76e79';
  const priceList = int(b.price_list, 1) === 2 ? 2 : 1;
  const vals = [name, str(b.title, 80), color, str(b.phone, 30), bool(b.active ?? 1), int(b.sort), priceList];
  return tx(() => {
    if (id) db.prepare('UPDATE staff SET name=?, title=?, color=?, phone=?, active=?, sort=?, price_list=? WHERE id=?').run(...vals, id);
    else id = db.prepare('INSERT INTO staff (name, title, color, phone, active, sort, price_list) VALUES (?, ?, ?, ?, ?, ?, ?)').run(...vals).lastInsertRowid;
    if (Array.isArray(b.service_ids)) {
      db.prepare('DELETE FROM staff_services WHERE staff_id = ?').run(id);
      for (const sid of new Set(b.service_ids.map(Number).filter(Boolean))) {
        if (db.prepare('SELECT 1 FROM services WHERE id = ? AND deleted = 0').get(sid)) db.prepare('INSERT INTO staff_services VALUES (?, ?)').run(id, sid);
      }
    }
    if (Array.isArray(b.hours)) {
      db.prepare('DELETE FROM working_hours WHERE staff_id = ?').run(id);
      for (const h of b.hours) {
        const wd = int(h.weekday, -1);
        if (wd < 0 || wd > 6) continue;
        const st = toMin(h.start), en = toMin(h.end);
        const enabled = bool(h.enabled);
        if (enabled && (st == null || en == null || en <= st)) bad('Çalışma saatlerinde başlangıç bitişten önce olmalı.');
        let bs = toMin(h.break_start), be = toMin(h.break_end);
        if (bs == null || be == null || be <= bs) { bs = null; be = null; }
        db.prepare('INSERT INTO working_hours VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, wd, enabled, st ?? 600, en ?? 1200, bs, be);
      }
    }
    return staffFull(db.prepare('SELECT * FROM staff WHERE id = ?').get(id));
  });
}
route('GET', '/api/admin/staff', () => db.prepare('SELECT * FROM staff WHERE deleted = 0 ORDER BY sort, id').all().map(staffFull));
route('POST', '/api/admin/staff', ({ body }) => saveStaff(null, body));
route('PUT', '/api/admin/staff/:id', ({ params, body }) => saveStaff(int(params.id), body));
route('DELETE', '/api/admin/staff/:id', ({ params }) => {
  const id = int(params.id);
  const n = db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE staff_id = ? AND status = 'confirmed' AND date >= ?").get(id, localDate()).n;
  if (n) bad(`Bu personelin ${n} ileri tarihli randevusu var. Önce randevuları başka personele taşıyın veya iptal edin.`);
  db.prepare('UPDATE staff SET deleted = 1, active = 0 WHERE id = ?').run(id);
  return { ok: true };
});

// ---------- Admin: çalışma günleri ----------
function dayInfo(scope, date) {
  const bookingsQ = scope === 'salon'
    ? db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE date = ? AND status IN ${ACTIVE_STATUSES}`).get(date)
    : db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE date = ? AND staff_id = ? AND status IN ${ACTIVE_STATUSES}`).get(date, scope);
  const salonOv = getOverride(null, date);
  if (scope === 'salon') {
    const wins = activeStaff().map((s) => staffWindow(s.id, date)).filter(Boolean);
    return {
      date, open: wins.length > 0, working: wins.length,
      start: wins.length ? fromMin(Math.min(...wins.map((w) => w.start))) : null,
      end: wins.length ? fromMin(Math.max(...wins.map((w) => w.end))) : null,
      override: salonOv ? (salonOv.closed ? 'closed' : 'open') : null, note: salonOv?.note ?? '', bookings: bookingsQ.n,
    };
  }
  const own = getOverride(scope, date);
  const w = staffWindow(scope, date);
  return {
    date, open: !!w, start: w ? fromMin(w.start) : null, end: w ? fromMin(w.end) : null,
    override: own ? (own.closed ? 'closed' : 'open') : null, salon_closed: !!salonOv?.closed,
    note: own?.note ?? salonOv?.note ?? '', bookings: bookingsQ.n,
  };
}
const parseScope = (v) => (v === 'salon' || v == null || v === '' ? 'salon' : int(v));
route('GET', '/api/admin/days', ({ query }) => {
  const scope = parseScope(query.scope);
  if (!isDate(query.from) || !isDate(query.to) || query.to < query.from) bad('Geçersiz tarih aralığı.');
  const out = [];
  for (let d = query.from; d <= query.to && out.length < 62; d = addDays(d, 1)) out.push(dayInfo(scope, d));
  return out;
});
route('PUT', '/api/admin/days', ({ body }) => {
  const scope = parseScope(body.scope);
  const dates = (Array.isArray(body.dates) ? body.dates : []).filter(isDate);
  if (!dates.length || dates.length > 370) bad('Lütfen en az bir gün seçin.');
  const mode = body.mode;
  if (!['open', 'closed', 'default'].includes(mode)) bad('Geçersiz işlem.');
  let st = null, en = null;
  if (mode === 'open') {
    st = toMin(body.start); en = toMin(body.end);
    if (st == null || en == null || en <= st) bad('Açılış saati kapanıştan önce olmalı.');
  }
  const staffKey = scope === 'salon' ? 0 : scope;
  tx(() => {
    for (const d of dates) {
      db.prepare('DELETE FROM day_overrides WHERE IFNULL(staff_id, 0) = ? AND date = ?').run(staffKey, d);
      if (mode !== 'default')
        db.prepare('INSERT INTO day_overrides (staff_id, date, closed, start_min, end_min, note) VALUES (?, ?, ?, ?, ?, ?)')
          .run(scope === 'salon' ? null : scope, d, mode === 'closed' ? 1 : 0, st, en, str(body.note, 120));
    }
  });
  // Kapanan günlerde/saat dışında kalan randevular için uyarı
  const conflicts = [];
  for (const d of dates) {
    const rows = scope === 'salon'
      ? db.prepare("SELECT * FROM bookings WHERE date = ? AND status = 'confirmed'").all(d)
      : db.prepare("SELECT * FROM bookings WHERE date = ? AND staff_id = ? AND status = 'confirmed'").all(d, scope);
    for (const b of rows) {
      const w = staffWindow(b.staff_id, d);
      if (!w || b.start_min < w.start || b.end_min > w.end) conflicts.push(bookingView(b, true));
    }
  }
  return { ok: true, conflicts };
});

// ---------- Admin: randevular ----------
route('GET', '/api/admin/bookings', ({ query }) => {
  if (!isDate(query.from) || !isDate(query.to)) bad('Geçersiz tarih aralığı.');
  const rows = db.prepare('SELECT * FROM bookings WHERE date BETWEEN ? AND ? ORDER BY date, start_min').all(query.from, query.to);
  return rows.map((b) => bookingView(b, true));
});
route('GET', '/api/admin/schedule', ({ query }) => {
  if (!isDate(query.date)) bad('Geçersiz tarih.');
  return db.prepare('SELECT id FROM staff WHERE deleted = 0 AND active = 1 ORDER BY sort, id').all().map((s) => {
    const w = staffWindow(s.id, query.date);
    return { staff_id: s.id, window: w && { start: w.start, end: w.end, break_start: w.break_start ?? null, break_end: w.break_end ?? null } };
  });
});

function adminConflicts(staffId, date, start, end, excludeId) {
  const problems = [];
  const w = staffWindow(staffId, date);
  if (!w) problems.push('Personel bu gün çalışmıyor.');
  else if (start < w.start || end > w.end) problems.push(`Çalışma saatleri dışında (${fromMin(w.start)}-${fromMin(w.end)}).`);
  if (busyRanges(staffId, date, excludeId).some(([a, b]) => start < b && end > a)) problems.push('Bu saatte personelin başka randevusu var.');
  return problems;
}
route('POST', '/api/admin/bookings', ({ body }) => {
  const services = (Array.isArray(body.services) ? body.services : []).map(Number)
    .map((id) => db.prepare('SELECT * FROM services WHERE id = ? AND deleted = 0').get(id)).filter(Boolean);
  if (!services.length) bad('En az bir hizmet seçin.');
  const staffId = int(body.staff_id);
  if (!db.prepare('SELECT 1 FROM staff WHERE id = ? AND deleted = 0').get(staffId)) bad('Personel seçin.');
  if (!isDate(body.date)) bad('Geçersiz tarih.');
  const start = toMin(body.time);
  if (start == null) bad('Geçersiz saat.');
  const name = str(body.customer_name, 80);
  if (name.length < 2) bad('Müşteri adı zorunlu.');
  const phone = normPhone(body.phone) ?? str(body.phone, 30);
  if (!phone) bad('Telefon zorunlu.');
  return tx(() => {
    const problems = adminConflicts(staffId, body.date, start, start + totals(services).duration, 0);
    if (problems.length && !body.force) throw new HttpError(409, problems.join(' '), { conflict: true });
    return bookingView(insertBooking({ staffId, date: body.date, start, services, name, phone, email: str(body.email, 120), note: str(body.note, 500), source: 'admin' }), true);
  });
});
route('PATCH', '/api/admin/bookings/:id', ({ params, body }) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(int(params.id));
  if (!b) throw new HttpError(404, 'Randevu bulunamadı.');
  return tx(() => {
    if ('status' in body) {
      if (!['confirmed', 'completed', 'no_show', 'cancelled'].includes(body.status)) bad('Geçersiz durum.');
      db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(body.status, b.id);
    }
    if ('admin_note' in body) db.prepare('UPDATE bookings SET admin_note = ? WHERE id = ?').run(str(body.admin_note, 500), b.id);
    if ('customer_name' in body && str(body.customer_name, 80)) db.prepare('UPDATE bookings SET customer_name = ? WHERE id = ?').run(str(body.customer_name, 80), b.id);
    if ('phone' in body && str(body.phone, 30)) db.prepare('UPDATE bookings SET phone = ? WHERE id = ?').run(normPhone(body.phone) ?? str(body.phone, 30), b.id);
    if ('date' in body || 'time' in body || 'staff_id' in body) {
      const date = body.date ?? b.date;
      const start = body.time != null ? toMin(body.time) : b.start_min;
      const staffId = body.staff_id != null ? int(body.staff_id) : b.staff_id;
      if (!isDate(date) || start == null) bad('Geçersiz tarih/saat.');
      if (!db.prepare('SELECT 1 FROM staff WHERE id = ? AND deleted = 0').get(staffId)) bad('Personel bulunamadı.');
      const end = start + (b.end_min - b.start_min);
      const problems = adminConflicts(staffId, date, start, end, b.id);
      if (problems.length && !body.force) throw new HttpError(409, problems.join(' '), { conflict: true });
      db.prepare('UPDATE bookings SET date = ?, start_min = ?, end_min = ?, staff_id = ? WHERE id = ?').run(date, start, end, staffId, b.id);
      // Personel değiştiyse fiyatları yeni personelin fiyat listesine göre güncelle
      if (staffId !== b.staff_id) {
        const ns = db.prepare('SELECT * FROM staff WHERE id = ?').get(staffId);
        for (const it of db.prepare('SELECT * FROM booking_items WHERE booking_id = ?').all(b.id)) {
          const svc = it.service_id && db.prepare('SELECT * FROM services WHERE id = ?').get(it.service_id);
          if (svc) db.prepare('UPDATE booking_items SET price = ? WHERE id = ?').run(priceFor(svc, ns), it.id);
        }
        db.prepare('UPDATE bookings SET total_price = (SELECT SUM(price) FROM booking_items WHERE booking_id = ?) WHERE id = ?').run(b.id, b.id);
      }
    }
    return bookingView(db.prepare('SELECT * FROM bookings WHERE id = ?').get(b.id), true);
  });
});

// ============ HTTP sunucu ============
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin' || pathname === '/admin/') pathname = '/admin.html';
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Sayfa bulunamadı'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache',
      ...(DEMO_MODE ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}), // demo Google'da çıkmasın
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new HttpError(413, 'İstek çok büyük.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Geçersiz istek.')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, decodeURIComponent(url.pathname));
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.rx.exec(url.pathname);
      if (!m) continue;
      if (r.admin && !isAdmin(req)) throw new HttpError(401, 'Oturum süresi doldu, lütfen tekrar giriş yapın.');
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const data = await r.handler({ req, res, params, body, query: Object.fromEntries(url.searchParams), ip: clientIp(req) });
      return send(200, data);
    }
    throw new HttpError(404, 'Bulunamadı.');
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    send(e.status || 500, { error: e instanceof HttpError ? e.message : 'Sunucu hatası oluştu.', ...(e.extra || {}) });
  }
});

// Demo sunucu: her gün (ve her açılışta) veriyi bugünün tarihine göre sıfırdan üretir,
// böylece takvim hep dolu görünür ve ziyaretçilerin yaptığı değişiklikler birikmez.
function refreshDemo() {
  if (getSettings().demo_generated_on === localDate()) return;
  resetAll();
  generateDemo({ log: () => {} });
  console.log(`  Demo veri yenilendi (${localDate()})`);
}
if (DEMO_MODE) {
  refreshDemo();
  setInterval(refreshDemo, 15 * 60e3).unref();
}

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  console.log('\n  N&N Nail randevu sistemi çalışıyor');
  console.log(`  Müşteri sitesi : http://localhost:${PORT}`);
  console.log(`  Admin paneli   : http://localhost:${PORT}/admin`);
  if (lan) console.log(`  Telefondan (aynı Wi-Fi): http://${lan}:${PORT}`);
  if (DEMO_MODE) console.log('  DEMO MODU açık: veriler her gün sıfırlanır, şifre değiştirilemez');
  if (getSettings().password_is_default === '1') console.log('  Varsayılan admin şifresi: admin123 (panelden değiştirin)');
  console.log('');
});
