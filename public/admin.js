'use strict';
// ============ Yardımcılar ============
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tl = (n) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} sa${m % 60 ? ' ' + (m % 60) + ' dk' : ''}` : `${m} dk`);
const pad = (n) => String(n).padStart(2, '0');
const fromMin = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const fmtDay = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => parseDate(s).toLocaleDateString('tr-TR', opts);
const initials = (n) => n.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toLocaleUpperCase('tr-TR');
const WD = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const STATUS = { confirmed: ['Onaylı', 'ok'], completed: ['Tamamlandı', 'gray'], no_show: ['Gelmedi', 'warn'], cancelled: ['İptal', 'danger'] };
const waLink = (phone, text) => {
  const d = String(phone).replace(/\D/g, '');
  const intl = d.startsWith('0') ? '90' + d.slice(1) : d;
  return `https://wa.me/${intl}${text ? '?text=' + encodeURIComponent(text) : ''}`;
};
const pref = {
  get(k, def) { try { return JSON.parse(localStorage.getItem('nn_admin_' + k)) ?? def; } catch { return def; } },
  set(k, v) { try { localStorage.setItem('nn_admin_' + k, JSON.stringify(v)); } catch { /* yok say */ } },
};

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/api/admin/login') { showLogin(); }
  if (!r.ok) throw Object.assign(new Error(data.error || 'Bir hata oluştu.'), { status: r.status, data });
  return data;
}
let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 3500);
}
function openSheet(title, html) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = html;
  if (!$('#sheet').open) $('#sheet').showModal();
  $('#sheet-body').scrollTop = 0;
  return $('#sheet-body');
}
const closeSheet = () => $('#sheet').close();
$('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === $('#sheet')) closeSheet(); });

// ============ Durum ============
const state = {
  tab: 'calendar', me: null, staff: [], services: [],
  cal: { date: today(), mode: pref.get('mode', window.innerWidth < 640 ? 'list' : 'day'), filter: pref.get('filter', []) },
  days: { scope: 'salon', month: today().slice(0, 7), selected: new Set(), data: [] },
};
const activeStaff = () => state.staff.filter((s) => s.active);
const listName = (n) => state.me?.price_list_names?.[n] || `Liste ${n}`;
async function loadRefs() {
  [state.staff, state.services] = await Promise.all([api('GET', '/api/admin/staff'), api('GET', '/api/admin/services')]);
}

// ============ Giriş ============
function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#pw').focus();
  // Demo sunucuda şifreyi giriş ekranında göster ve doldur
  fetch('/api/public/info').then((r) => r.json()).then((i) => {
    if (!i.demo_admin_password) return;
    $('#pw').value = i.demo_admin_password;
    const h = $('#demo-hint');
    h.textContent = `🧪 Demo sürüm · şifre: ${i.demo_admin_password} (otomatik dolduruldu)`;
    h.classList.remove('hidden');
  }).catch(() => {});
}
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/api/admin/login', { password: $('#pw').value });
    $('#pw').value = '';
    await boot();
  } catch (err) { toast(err.message, true); }
});
async function boot() {
  try { state.me = await api('GET', '/api/admin/me'); } catch { return; }
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  await loadRefs();
  show(state.tab);
}

// ============ Sekmeler ============
const TITLES = { calendar: 'Takvim', days: 'Çalışma Günleri', services: 'Hizmetler', staff: 'Personel', settings: 'Ayarlar' };
$('#tabbar').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
function show(tab) {
  state.tab = tab;
  $$('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('#page-title').textContent = TITLES[tab];
  $('#sub').innerHTML = '';
  $('#page').innerHTML = '<div class="spinner"></div>';
  document.querySelector('.fab')?.remove();
  document.querySelector('.selbar')?.remove();
  ({ calendar: viewCalendar, days: viewDays, services: viewServices, staff: viewStaff, settings: viewSettings })[tab]();
}
const banner = () => (state.me?.demo
  ? '<div class="banner">🧪 Demo sürüm: istediğiniz gibi deneyin. Tüm veriler her gün otomatik olarak sıfırlanır. <a href="/" target="_blank">Müşteri sitesi ↗</a></div>'
  : state.me?.password_is_default
    ? '<div class="banner">⚠️ Varsayılan şifreyi kullanıyorsunuz. <a href="#" data-goto="settings">Ayarlar</a>\'dan değiştirin.</div>' : '');
document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) { e.preventDefault(); show(g.dataset.goto); } });

// ============ TAKVİM ============
async function viewCalendar() {
  const c = state.cal;
  const shown = activeStaff().filter((s) => !c.filter.length || c.filter.includes(s.id));
  const label = c.mode === 'day'
    ? (c.date === today() ? 'Bugün · ' : '') + fmtDay(c.date, { weekday: 'long', day: 'numeric', month: 'long' })
    : `${fmtDay(c.date, { day: 'numeric', month: 'short' })} – ${fmtDay(addDays(c.date, 6), { day: 'numeric', month: 'short' })}`;
  $('#sub').innerHTML = `
    <div class="datenav">
      <button class="icon-btn" data-nav="-1" aria-label="Önceki">‹</button>
      <label class="label">${label}<input type="date" id="cal-date" value="${c.date}" aria-label="Tarih seç"></label>
      <button class="icon-btn" data-nav="1" aria-label="Sonraki">›</button>
    </div>
    <div style="display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <div class="seg"><button data-mode="day" class="${c.mode === 'day' ? 'on' : ''}">Gün</button><button data-mode="list" class="${c.mode === 'list' ? 'on' : ''}">7 Gün Liste</button></div>
      <button class="btn ghost sm" data-today>Bugün</button>
    </div>
    <div class="chips">
      <button class="chip ${!c.filter.length ? 'on' : ''}" data-filter="all">Tümü</button>
      ${activeStaff().map((s) => `<button class="chip ${c.filter.includes(s.id) ? 'on' : ''}" data-filter="${s.id}"><span class="dot" style="background:${s.color};margin-right:6px"></span>${esc(s.name)}</button>`).join('')}
    </div>`;
  $('#cal-date').addEventListener('change', (e) => { if (e.target.value) { c.date = e.target.value; viewCalendar(); } });
  $('#sub').onclick = (e) => {
    const n = e.target.closest('[data-nav]');
    if (n) { c.date = addDays(c.date, Number(n.dataset.nav) * (c.mode === 'day' ? 1 : 7)); return viewCalendar(); }
    const m = e.target.closest('[data-mode]');
    if (m) { c.mode = m.dataset.mode; pref.set('mode', c.mode); return viewCalendar(); }
    if (e.target.closest('[data-today]')) { c.date = today(); return viewCalendar(); }
    const f = e.target.closest('[data-filter]');
    if (f) {
      if (f.dataset.filter === 'all') c.filter = [];
      else { const id = Number(f.dataset.filter); c.filter = c.filter.includes(id) ? c.filter.filter((x) => x !== id) : [...c.filter, id]; }
      pref.set('filter', c.filter);
      return viewCalendar();
    }
  };

  if (!document.querySelector('.fab')) {
    const fab = document.createElement('button');
    fab.className = 'fab'; fab.textContent = '+'; fab.setAttribute('aria-label', 'Yeni randevu');
    fab.onclick = () => openNewBooking({ date: state.cal.date });
    document.body.appendChild(fab);
  }

  const to = c.mode === 'day' ? c.date : addDays(c.date, 6);
  try {
    const [all, schedule] = await Promise.all([
      api('GET', `/api/admin/bookings?from=${c.date}&to=${to}`),
      c.mode === 'day' ? api('GET', `/api/admin/schedule?date=${c.date}`) : null,
    ]);
    const ids = new Set(shown.map((s) => s.id));
    const bookings = all.filter((b) => ids.has(b.staff_id) || (!c.filter.length && !activeStaff().some((s) => s.id === b.staff_id)));
    const live = bookings.filter((b) => b.status !== 'cancelled');
    const stats = `<div class="stats" style="margin-bottom:10px"><span><b>${live.length}</b> randevu</span>·<span>Tahmini ciro <b>${tl(live.filter((b) => b.status !== 'no_show').reduce((a, b) => a + b.total_price, 0))}</b></span></div>`;
    $('#page').innerHTML = banner() + stats + (c.mode === 'day' ? dayGrid(shown, bookings, schedule) : listView(bookings, c.date));
    bindCalendar(bookings);
  } catch (err) { $('#page').innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}

const PPM = 1.3; // dakika başına piksel
function dayGrid(shown, bookings, schedule) {
  if (!shown.length) return '<div class="empty">Gösterilecek personel yok. Personel sekmesinden ekleyin.</div>';
  const win = (id) => schedule.find((s) => s.staff_id === id)?.window;
  const mins = [];
  for (const s of shown) { const w = win(s.id); if (w) mins.push(w.start, w.end); }
  for (const b of bookings) if (b.status !== 'cancelled') mins.push(b.start_min, b.end_min);
  const start = mins.length ? Math.floor(Math.min(...mins) / 60) * 60 : 540;
  const end = mins.length ? Math.ceil(Math.max(...mins) / 60) * 60 : 1260;
  const H = (end - start) * PPM;
  const y = (m) => (m - start) * PPM;
  const off = (a, b) => (b > a ? `<div class="off" style="top:${y(a)}px;height:${(b - a) * PPM}px"></div>` : '');
  let times = '';
  for (let m = start; m <= end; m += 60) times += `<span style="top:${y(m)}px">${fromMin(m)}</span>`;
  const isToday = state.cal.date === today();
  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
  const cols = shown.map((s) => {
    const w = win(s.id);
    let o = w ? off(start, w.start) + off(w.end, end) + (w.break_start != null ? off(w.break_start, w.break_end) : '') : off(start, end);
    const evts = bookings.filter((b) => b.staff_id === s.id && b.status !== 'cancelled').map((b) => `
      <div class="evt ${b.status}" data-bk="${b.id}" style="top:${y(b.start_min)}px;height:${Math.max(24, (b.end_min - b.start_min) * PPM - 2)}px;background:${s.color}22;border-left-color:${s.color}">
        <b>${b.time} ${esc(b.customer_name)}</b><div class="s">${esc(b.services.map((x) => x.name).join(', '))}</div>
      </div>`).join('');
    const nl = isToday && nowMin > start && nowMin < end ? `<div class="now-line" style="top:${y(nowMin)}px"></div>` : '';
    return `<div class="cal-col" data-col="${s.id}" style="height:${H}px;background-image:linear-gradient(var(--line) 1px, transparent 1px);background-size:100% ${60 * PPM}px">${o}${evts}${nl}</div>`;
  }).join('');
  return `<div class="cal-wrap"><div class="cal" style="grid-template-columns:48px repeat(${shown.length}, minmax(140px, 1fr))">
    <div class="cal-head"></div>
    ${shown.map((s) => `<div class="cal-head"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</div>`).join('')}
    <div class="cal-times" style="height:${H}px">${times}</div>${cols}
  </div></div><p class="muted small">Boş bir alana dokunarak o saate randevu ekleyebilirsiniz. Taralı alanlar çalışma saati dışıdır.</p>
  <input type="hidden" id="grid-start" value="${start}">`;
}

function listView(bookings, from) {
  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    const items = bookings.filter((b) => b.date === d);
    const live = items.filter((b) => b.status !== 'cancelled');
    html += `<div class="day-group"><h3><span>${d === today() ? 'Bugün · ' : ''}${fmtDay(d, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      <span>${live.length ? `${live.length} randevu` : ''}</span></h3>
      ${items.length ? items.map((b) => {
        const [lbl, cls] = STATUS[b.status];
        return `<div class="card bk ${b.status}" data-bk="${b.id}">
          <div class="bar-c" style="background:${b.staff_color}"></div>
          <div class="tm">${b.time}<small>${b.end_time}</small></div>
          <div class="bd"><b>${esc(b.customer_name)}</b><div class="s">${esc(b.services.map((x) => x.name).join(', '))}</div>
            <div class="s">${esc(b.staff_name)} · ${tl(b.total_price)}</div></div>
          ${b.status !== 'confirmed' ? `<span class="badge ${cls}" style="align-self:center">${lbl}</span>` : ''}
        </div>`;
      }).join('') : `<div class="muted small" style="padding:4px 2px 8px">Randevu yok · <a href="#" data-add-day="${d}">Ekle</a></div>`}
    </div>`;
  }
  return html;
}

function bindCalendar(bookings) {
  const page = $('#page');
  page.onclick = (e) => {
    const bk = e.target.closest('[data-bk]');
    if (bk) return openBooking(bookings.find((b) => b.id === Number(bk.dataset.bk)));
    const add = e.target.closest('[data-add-day]');
    if (add) { e.preventDefault(); return openNewBooking({ date: add.dataset.addDay }); }
    const col = e.target.closest('[data-col]');
    if (col) {
      const start = Number($('#grid-start').value);
      const rect = col.getBoundingClientRect();
      const m = Math.floor((start + (e.clientY - rect.top) / PPM) / 15) * 15;
      openNewBooking({ date: state.cal.date, staff_id: Number(col.dataset.col), time: fromMin(m) });
    }
  };
}

function staffOptions(sel, includeInactive = false) {
  return state.staff.filter((s) => includeInactive || s.active || s.id === sel)
    .map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
}

function openBooking(b) {
  const [lbl, cls] = STATUS[b.status];
  const remind = `Merhaba ${b.customer_name.split(' ')[0]}, ${fmtDay(b.date, { day: 'numeric', month: 'long', weekday: 'long' })} saat ${b.time}'daki N&N Nail randevunuzu hatırlatmak isteriz. Görüşmek üzere 💅`;
  const body = openSheet(b.customer_name, `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <span class="badge ${cls}">${lbl}</span><span class="badge gray">${b.source === 'web' ? 'Online' : 'Panelden'}</span><span class="badge gray">Kod ${esc(b.code)}</span>
    </div>
    <div class="card summary">
      <div class="when">📅 ${fmtDay(b.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${b.time}–${b.end_time}</div>
      <div class="line muted"><span>Uzman</span><span><span class="dot" style="background:${b.staff_color}"></span> ${esc(b.staff_name)}</span></div>
      ${b.services.map((s) => `<div class="line"><span>${esc(s.name)} <span class="muted">· ${dur(s.duration)}</span></span><span>${tl(s.price)}</span></div>`).join('')}
      <div class="line total"><span>Toplam</span><span>${tl(b.total_price)}</span></div>
      ${b.note ? `<p class="small" style="margin:10px 0 0"><b>Müşteri notu:</b> ${esc(b.note)}</p>` : ''}
    </div>
    <div class="row" style="margin-bottom:10px">
      <a class="btn ghost sm" href="tel:${esc(b.phone)}">📞 ${esc(b.phone)}</a>
      <a class="btn ghost sm" href="${waLink(b.phone)}" target="_blank" rel="noopener">💬 WhatsApp</a>
    </div>
    ${b.status === 'confirmed' ? `<a class="btn soft block sm" style="margin-bottom:16px" href="${waLink(b.phone, remind)}" target="_blank" rel="noopener">🔔 WhatsApp ile hatırlatma gönder</a>` : ''}
    <div class="field"><label>Durum</label>
      <div class="seg" style="display:flex;flex-wrap:wrap">${Object.entries(STATUS).map(([k, [l]]) => `<button type="button" data-status="${k}" class="${b.status === k ? 'on' : ''}" style="flex:1">${l}</button>`).join('')}</div>
    </div>
    <form id="move-form">
      <div class="row">
        <div class="field"><label>Tarih</label><input class="input" type="date" name="date" value="${b.date}" required></div>
        <div class="field"><label>Saat</label><input class="input" type="time" name="time" step="300" value="${b.time}" required></div>
      </div>
      <div class="field"><label>Personel</label><select class="input" name="staff_id">${staffOptions(b.staff_id)}</select></div>
      <div class="field"><label>İç not (müşteri görmez)</label><textarea class="input" name="admin_note">${esc(b.admin_note)}</textarea></div>
      <button class="btn block" type="submit">Kaydet</button>
    </form>
    <p class="muted small">Oluşturulma: ${esc(b.created_at)}</p>`);

  body.querySelectorAll('[data-status]').forEach((btn) => btn.addEventListener('click', async () => {
    const st = btn.dataset.status;
    if (st === 'cancelled' && !confirm('Randevu iptal edilsin mi? Saat tekrar müsait hale gelir.')) return;
    try { const nb = await api('PATCH', `/api/admin/bookings/${b.id}`, { status: st }); toast('Durum güncellendi'); openBooking(nb); refreshCalendar(); }
    catch (err) { toast(err.message, true); }
  }));
  $('#move-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const patch = { admin_note: f.admin_note };
    if (f.date !== b.date || f.time !== b.time || Number(f.staff_id) !== b.staff_id) Object.assign(patch, { date: f.date, time: f.time, staff_id: Number(f.staff_id) });
    await withForce((force) => api('PATCH', `/api/admin/bookings/${b.id}`, { ...patch, force }), () => { toast('Randevu güncellendi'); closeSheet(); refreshCalendar(); });
  });
}

async function withForce(call, done) {
  try { await call(false); done(); }
  catch (err) {
    if (err.data?.conflict) {
      if (confirm(`${err.message}\n\nYine de kaydedilsin mi?`)) { try { await call(true); done(); } catch (e2) { toast(e2.message, true); } }
    } else toast(err.message, true);
  }
}
const refreshCalendar = () => { if (state.tab === 'calendar') viewCalendar(); };

function openNewBooking({ date, staff_id, time }) {
  const staffId = staff_id || activeStaff()[0]?.id;
  const groups = {};
  for (const s of state.services.filter((x) => x.active)) (groups[s.category] ||= []).push(s);
  const body = openSheet('Yeni randevu', `
    <form id="nb-form">
      <div class="field"><label>Hizmetler</label>
        ${Object.entries(groups).map(([cat, items]) => `<div class="mini">${esc(cat)}</div><div class="check-grid">${items.map((s) =>
          `<label><input type="checkbox" name="svc" value="${s.id}" data-d="${s.duration_min}" data-p1="${s.price}" data-p2="${s.price2 ?? s.price}"><span style="flex:1">${esc(s.name)}</span><span class="muted small">${s.duration_min} dk</span></label>`).join('')}</div>`).join('')}
      </div>
      <p class="small" id="nb-total" style="margin-top:-6px"></p>
      <div class="row">
        <div class="field"><label>Tarih</label><input class="input" type="date" name="date" value="${date || today()}" required></div>
        <div class="field"><label>Saat</label><input class="input" type="time" name="time" step="300" value="${time || '10:00'}" required></div>
      </div>
      <div class="field"><label>Personel</label><select class="input" name="staff_id">${staffOptions(staffId)}</select></div>
      <div class="field"><label>Müşteri adı</label><input class="input" name="customer_name" required autocomplete="off"></div>
      <div class="field"><label>Telefon</label><input class="input" name="phone" type="tel" inputmode="tel" placeholder="05xx xxx xx xx" required></div>
      <div class="field"><label>Not</label><textarea class="input" name="note"></textarea></div>
      <button class="btn block" type="submit">Randevuyu oluştur</button>
    </form>`);
  const form = $('#nb-form', body);
  const upd = () => {
    const c = $$('input[name=svc]:checked', form);
    const list = state.staff.find((s) => s.id === Number(form.staff_id.value))?.price_list === 2 ? 2 : 1;
    const d = c.reduce((a, x) => a + Number(x.dataset.d), 0), p = c.reduce((a, x) => a + Number(x.dataset['p' + list]), 0);
    $('#nb-total').textContent = c.length ? `Toplam: ${dur(d)} · ${tl(p)} (${listName(list)})${form.time.value ? ` · Bitiş ${fromMin(toMin(form.time.value) + d)}` : ''}` : '';
  };
  form.addEventListener('change', upd);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = { ...Object.fromEntries(fd), services: fd.getAll('svc').map(Number), staff_id: Number(fd.get('staff_id')) };
    if (!payload.services.length) return toast('En az bir hizmet seçin.', true);
    await withForce((force) => api('POST', '/api/admin/bookings', { ...payload, force }), () => {
      toast('Randevu oluşturuldu'); closeSheet();
      state.cal.date = payload.date; refreshCalendar();
    });
  });
}

// ============ ÇALIŞMA GÜNLERİ ============
async function viewDays() {
  const d = state.days;
  const [y, m] = d.month.split('-').map(Number);
  const first = `${d.month}-01`;
  const last = ymd(new Date(y, m, 0));
  $('#sub').innerHTML = `<div class="chips">
      <button class="chip ${d.scope === 'salon' ? 'on' : ''}" data-scope="salon">🏠 Salon geneli</button>
      ${activeStaff().map((s) => `<button class="chip ${d.scope === s.id ? 'on' : ''}" data-scope="${s.id}"><span class="dot" style="background:${s.color};margin-right:6px"></span>${esc(s.name)}</button>`).join('')}
    </div>`;
  $('#sub').onclick = (e) => {
    const s = e.target.closest('[data-scope]');
    if (s) { d.scope = s.dataset.scope === 'salon' ? 'salon' : Number(s.dataset.scope); d.selected.clear(); viewDays(); }
  };
  try {
    d.data = await api('GET', `/api/admin/days?scope=${d.scope}&from=${first}&to=${last}`);
  } catch (err) { $('#page').innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  const lead = (parseDate(first).getDay() + 6) % 7;
  const scopeName = d.scope === 'salon' ? 'Salon geneli' : state.staff.find((s) => s.id === d.scope)?.name;
  $('#page').innerHTML = `${banner()}
    <p class="muted small" style="margin-top:0"><b>${esc(scopeName)}</b> için günlere dokunarak seçin, sonra alttan <b>Kapat / Aç / Varsayılan</b> yapın. Gün başlığına (Pzt, Sal…) dokunursanız ayın o günlerinin hepsi seçilir.</p>
    <div class="month-nav">
      <button class="icon-btn" data-mon="-1" aria-label="Önceki ay">‹</button>
      <h3>${parseDate(first).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}</h3>
      <button class="icon-btn" data-mon="1" aria-label="Sonraki ay">›</button>
    </div>
    <div class="mgrid">
      ${['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((w, i) => `<button class="wd" style="border:0;background:none" data-wd="${(i + 1) % 7}">${w}</button>`).join('')}
      ${'<div></div>'.repeat(lead)}
      ${d.data.map((x) => {
        const past = x.date < today();
        const cls = ['mday', x.open ? '' : 'closed', x.override ? 'ov' : '', past ? 'past' : '', d.selected.has(x.date) ? 'sel' : ''].join(' ');
        const sub = x.open ? `${x.start}<br>${x.end}` : (x.salon_closed ? 'Salon kapalı' : 'Kapalı');
        return `<button class="${cls}" data-day="${x.date}" ${past ? 'disabled' : ''} title="${esc(x.note)}"><b>${Number(x.date.slice(8))}</b>${sub}${x.bookings ? `<span class="cnt">${x.bookings} rnd</span>` : ''}</button>`;
      }).join('')}
    </div>
    <div class="legend">
      <span><i class="dot" style="background:var(--ok-soft);border:1px solid var(--ok)"></i>Açık</span>
      <span><i class="dot" style="background:#f1ecec;border:1px solid #ccc"></i>Kapalı</span>
      <span><i class="dot" style="background:var(--brand)"></i>Özel ayar (haftalık plandan farklı)</span>
    </div>
    <p class="muted small">Haftalık varsayılan plan <a href="#" data-goto="staff">Personel</a> sekmesindeki çalışma saatlerinden gelir. Salon genelinde kapattığınız gün herkes için kapanır.</p><div style="height:150px"></div>`;
  $('#page').onclick = (e) => {
    const mon = e.target.closest('[data-mon]');
    if (mon) { const nd = new Date(y, m - 1 + Number(mon.dataset.mon), 1); d.month = ymd(nd).slice(0, 7); d.selected.clear(); return viewDays(); }
    const day = e.target.closest('[data-day]');
    if (day && !day.disabled) { d.selected.has(day.dataset.day) ? d.selected.delete(day.dataset.day) : d.selected.add(day.dataset.day); day.classList.toggle('sel'); return renderSelbar(); }
    const wd = e.target.closest('[data-wd]');
    if (wd) {
      const days = d.data.filter((x) => parseDate(x.date).getDay() === Number(wd.dataset.wd) && x.date >= today()).map((x) => x.date);
      const allSel = days.every((x) => d.selected.has(x));
      days.forEach((x) => (allSel ? d.selected.delete(x) : d.selected.add(x)));
      $$('[data-day]').forEach((el) => el.classList.toggle('sel', d.selected.has(el.dataset.day)));
      renderSelbar();
    }
  };
  renderSelbar();
}

function renderSelbar() {
  const d = state.days;
  document.querySelector('.selbar')?.remove();
  if (!d.selected.size) return;
  const bar = document.createElement('div');
  bar.className = 'selbar';
  bar.innerHTML = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center"><b>${d.selected.size} gün seçildi</b><button class="btn ghost sm" data-act="clear">Seçimi temizle</button></div>
    <div class="row">
      <button class="btn danger sm" data-act="closed">Kapat</button>
      <button class="btn ok sm" data-act="open">Aç / Saat</button>
      <button class="btn ghost sm" data-act="default">Varsayılan</button>
    </div></div>`;
  bar.onclick = async (e) => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (!a) return;
    if (a === 'clear') { d.selected.clear(); $$('.mday.sel').forEach((x) => x.classList.remove('sel')); return bar.remove(); }
    if (a === 'open') return openHoursSheet();
    if (a === 'closed') {
      const body = openSheet('Seçili günleri kapat', `
        <p class="muted small" style="margin-top:0">${d.selected.size} gün rezervasyona kapatılacak.</p>
        <form id="close-form"><div class="field"><label>Not (isteğe bağlı)</label><input class="input" name="note" placeholder="Örn. Bayram, yıllık izin, rapor"></div>
        <button class="btn danger block" type="submit">Günleri kapat</button></form>`);
      $('#close-form', body).addEventListener('submit', (ev) => { ev.preventDefault(); closeSheet(); applyDays({ mode: 'closed', note: ev.target.note.value }); });
      return;
    }
    applyDays({ mode: 'default' });
  };
  document.body.appendChild(bar);
}

async function openHoursSheet() {
  const s = await api('GET', '/api/admin/settings');
  const body = openSheet('Seçili günleri aç', `
    <p class="muted small" style="margin-top:0">${state.days.selected.size} gün, belirttiğiniz saatlerde rezervasyona açılacak.</p>
    <form id="hrs-form"><div class="row">
      <div class="field"><label>Açılış</label><input class="input" type="time" name="start" value="${s.default_open}" required></div>
      <div class="field"><label>Kapanış</label><input class="input" type="time" name="end" value="${s.default_close}" required></div>
    </div>
    <div class="field"><label>Not (isteğe bağlı)</label><input class="input" name="note" placeholder="Örn. Özel gün mesaisi"></div>
    <button class="btn block ok" type="submit">Kaydet</button></form>`);
  $('#hrs-form', body).addEventListener('submit', (e) => {
    e.preventDefault();
    closeSheet();
    applyDays({ mode: 'open', ...Object.fromEntries(new FormData(e.target)) });
  });
}

async function applyDays(opts) {
  const d = state.days;
  try {
    const r = await api('PUT', '/api/admin/days', { scope: d.scope, dates: [...d.selected], ...opts });
    d.selected.clear();
    toast('Günler güncellendi');
    await viewDays();
    if (r.conflicts.length) {
      openSheet('Dikkat: etkilenen randevular', `<p class="small">Aşağıdaki randevular artık çalışma saatleri dışında kalıyor. Müşteriyi arayıp taşıyın veya iptal edin.</p>
        ${r.conflicts.map((b) => `<div class="card bk" style="cursor:default"><div class="bar-c" style="background:${b.staff_color}"></div>
          <div class="tm">${b.time}<small>${fmtDay(b.date, { day: 'numeric', month: 'short' })}</small></div>
          <div class="bd"><b>${esc(b.customer_name)}</b><div class="s">${esc(b.staff_name)} · ${esc(b.phone)}</div></div>
          <a class="btn ghost sm" href="tel:${esc(b.phone)}" style="align-self:center">Ara</a></div>`).join('')}
        <button class="btn block" data-close>Tamam</button>`);
    }
  } catch (err) { toast(err.message, true); }
}

// ============ HİZMETLER ============
async function viewServices() {
  state.services = await api('GET', '/api/admin/services');
  const groups = {};
  for (const s of state.services) (groups[s.category] ||= []).push(s);
  $('#page').innerHTML = `${banner()}<div class="section-head"><h2>${state.services.length} hizmet</h2><button class="btn sm" id="add-svc">+ Hizmet ekle</button></div>
    ${Object.entries(groups).map(([cat, items]) => `<div class="mini" style="margin:14px 0 6px;text-transform:uppercase;letter-spacing:1px;font-weight:700">${esc(cat)}</div>
      ${items.map((s) => `<div class="card list-item" data-svc="${s.id}">
        <div class="grow"><b>${esc(s.name)}</b><div class="t2">${dur(s.duration_min)} · ${esc(listName(1))}: <b>${tl(s.price)}</b> · ${esc(listName(2))}: <b>${tl(s.price2 ?? s.price)}</b></div></div>
        ${s.active ? '' : '<span class="badge gray">Pasif</span>'}<span class="muted">›</span></div>`).join('')}`).join('') || '<div class="empty">Henüz hizmet yok.</div>'}`;
  $('#add-svc').onclick = () => openService(null);
  $('#page').onclick = (e) => { const r = e.target.closest('[data-svc]'); if (r) openService(state.services.find((s) => s.id === Number(r.dataset.svc))); };
}
function openService(s) {
  const cats = [...new Set(state.services.map((x) => x.category))];
  const body = openSheet(s ? 'Hizmeti düzenle' : 'Yeni hizmet', `
    <form id="svc-form">
      <div class="field"><label>Hizmet adı</label><input class="input" name="name" value="${esc(s?.name)}" required></div>
      <div class="field"><label>Kategori</label><input class="input" name="category" list="cats" value="${esc(s?.category ?? cats[0] ?? '')}" required>
        <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="field"><label>Açıklama</label><textarea class="input" name="description">${esc(s?.description)}</textarea></div>
      <div class="row">
        <div class="field"><label>Süre (dk)</label><input class="input" type="number" name="duration_min" min="5" max="600" step="5" value="${s?.duration_min ?? 30}" required></div>
        <div class="field"><label>Sıra</label><input class="input" type="number" name="sort" value="${s?.sort ?? state.services.length}"></div>
      </div>
      <div class="row">
        <div class="field"><label>${esc(listName(1))} fiyatı (₺)</label><input class="input" type="number" name="price" min="0" step="10" value="${s?.price ?? ''}" required></div>
        <div class="field"><label>${esc(listName(2))} fiyatı (₺)</label><input class="input" type="number" name="price2" min="0" step="10" value="${s?.price2 ?? ''}" placeholder="Boşsa 1. liste"></div>
      </div>
      <p class="muted small" style="margin-top:-6px">Müşteri, seçtiği uzmanın bağlı olduğu listedeki fiyatı görür. Liste atamasını Personel sekmesinden yapın.</p>
      <label class="check" style="margin-bottom:12px"><input type="checkbox" name="active" ${!s || s.active ? 'checked' : ''}><span>Online randevuda görünsün</span></label>
      ${s ? '' : '<label class="check" style="margin-bottom:16px"><input type="checkbox" name="assign_all" checked><span>Tüm personel bu hizmeti yapabilsin</span></label>'}
      <button class="btn block" type="submit">Kaydet</button>
      ${s ? '<button class="btn danger block" type="button" id="del-svc" style="margin-top:10px">Hizmeti sil</button>' : ''}
    </form>`);
  $('#svc-form', body).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    f.active = !!f.active; f.assign_all = !!f.assign_all;
    try {
      await api(s ? 'PUT' : 'POST', s ? `/api/admin/services/${s.id}` : '/api/admin/services', f);
      toast('Hizmet kaydedildi'); closeSheet(); await loadRefs(); viewServices();
    } catch (err) { toast(err.message, true); }
  });
  $('#del-svc', body)?.addEventListener('click', async () => {
    if (!confirm(`"${s.name}" silinsin mi? Geçmiş randevular etkilenmez.`)) return;
    try { await api('DELETE', `/api/admin/services/${s.id}`); toast('Hizmet silindi'); closeSheet(); await loadRefs(); viewServices(); }
    catch (err) { toast(err.message, true); }
  });
}

// ============ PERSONEL ============
async function viewStaff() {
  state.staff = await api('GET', '/api/admin/staff');
  const summary = (s) => WD_ORDER.filter((wd) => s.hours[wd].enabled).map((wd) => WD[wd].slice(0, 3)).join(', ') || 'Çalışma günü yok';
  $('#page').innerHTML = `${banner()}<div class="section-head"><h2>${state.staff.length} personel</h2><button class="btn sm" id="add-staff">+ Personel ekle</button></div>
    ${state.staff.map((s) => `<div class="card list-item" data-staff="${s.id}">
      <div class="avatar" style="background:${s.color};width:44px;height:44px;font-size:16px;margin:0">${esc(initials(s.name))}</div>
      <div class="grow"><b>${esc(s.name)}</b> <span class="t2">${esc(s.title)}</span>
        <div class="t2">${s.service_ids.length} hizmet · ${summary(s)}</div>
        <span class="badge ${s.price_list === 2 ? '' : 'gray'}" style="margin-top:4px">💰 ${esc(listName(s.price_list))}</span></div>
      ${s.active ? '' : '<span class="badge gray">Pasif</span>'}<span class="muted">›</span></div>`).join('') || '<div class="empty">Henüz personel yok.</div>'}`;
  $('#add-staff').onclick = () => openStaff(null);
  $('#page').onclick = (e) => { const r = e.target.closest('[data-staff]'); if (r) openStaff(state.staff.find((s) => s.id === Number(r.dataset.staff))); };
}
function openStaff(s) {
  const COLORS = ['#b76e79', '#7b8fc9', '#5fa58a', '#d39a4a', '#9a6fc0', '#d16b8f', '#4aa3b5', '#8c8c4a'];
  const hours = s?.hours ?? [0, 1, 2, 3, 4, 5, 6].map((wd) => ({ weekday: wd, enabled: wd !== 0, start: '10:00', end: '20:00', break_start: '', break_end: '' }));
  const groups = {};
  for (const x of state.services) (groups[x.category] ||= []).push(x);
  const has = (id) => (s ? s.service_ids.includes(id) : true);
  const body = openSheet(s ? s.name : 'Yeni personel', `
    <form id="staff-form">
      <div class="field"><label>Ad</label><input class="input" name="name" value="${esc(s?.name)}" required></div>
      <div class="field"><label>Unvan</label><input class="input" name="title" value="${esc(s?.title)}" placeholder="Örn. Nail Artist"></div>
      <div class="field"><label>Telefon</label><input class="input" name="phone" type="tel" value="${esc(s?.phone)}"></div>
      <div class="field"><label>Fiyat listesi</label><select class="input" name="price_list">
        <option value="1" ${s?.price_list !== 2 ? 'selected' : ''}>${esc(listName(1))}</option>
        <option value="2" ${s?.price_list === 2 ? 'selected' : ''}>${esc(listName(2))}</option>
      </select></div>
      <div class="field"><label>Takvim rengi</label><div class="row" style="flex-wrap:wrap;gap:8px">${COLORS.map((c) => `
        <label style="flex:none"><input type="radio" name="color" value="${c}" ${(s?.color ?? COLORS[state.staff.length % COLORS.length]) === c ? 'checked' : ''} style="display:none">
        <span class="dot" style="width:34px;height:34px;background:${c};cursor:pointer;outline-offset:2px"></span></label>`).join('')}</div></div>
      <label class="check" style="margin-bottom:16px"><input type="checkbox" name="active" ${!s || s.active ? 'checked' : ''}><span>Aktif (online randevu alabilir)</span></label>

      <h4 style="margin:18px 0 8px">Yapabildiği hizmetler</h4>
      ${Object.entries(groups).map(([cat, items]) => `<div class="mini">${esc(cat)}</div><div class="check-grid">${items.map((x) =>
        `<label><input type="checkbox" name="svc" value="${x.id}" ${has(x.id) ? 'checked' : ''}>${esc(x.name)}</label>`).join('')}</div>`).join('')}

      <h4 style="margin:18px 0 0">Haftalık çalışma saatleri</h4>
      <p class="muted small" style="margin:4px 0 0">Mola isteğe bağlıdır. Tek seferlik izin/kapanış için "Günler" sekmesini kullanın.</p>
      ${WD_ORDER.map((wd) => { const h = hours.find((x) => x.weekday === wd); return `
        <div class="hours-row ${h.enabled ? '' : 'disabled'}" data-wd="${wd}">
          <label class="day"><input type="checkbox" name="en_${wd}" ${h.enabled ? 'checked' : ''}>${WD[wd].slice(0, 3)}</label>
          <div class="times">
            <div><div class="mini">Başlangıç</div><input class="input" type="time" name="st_${wd}" value="${h.start}"></div>
            <div><div class="mini">Bitiş</div><input class="input" type="time" name="en2_${wd}" value="${h.end}"></div>
            <div><div class="mini">Mola başı</div><input class="input" type="time" name="bs_${wd}" value="${h.break_start}"></div>
            <div><div class="mini">Mola sonu</div><input class="input" type="time" name="be_${wd}" value="${h.break_end}"></div>
          </div>
        </div>`; }).join('')}
      <button class="btn block" type="submit" style="margin-top:16px">Kaydet</button>
      ${s ? '<button class="btn danger block" type="button" id="del-staff" style="margin-top:10px">Personeli sil</button>' : ''}
    </form>`);
  const form = $('#staff-form', body);
  const paintColors = () => $$('input[name=color]', form).forEach((r) => (r.nextElementSibling.style.outline = r.checked ? '3px solid var(--ink)' : 'none'));
  paintColors();
  form.addEventListener('change', (e) => {
    if (e.target.name === 'color') paintColors();
    if (e.target.name?.startsWith('en_')) e.target.closest('.hours-row').classList.toggle('disabled', !e.target.checked);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      name: fd.get('name'), title: fd.get('title'), phone: fd.get('phone'), color: fd.get('color'), active: !!fd.get('active'),
      price_list: Number(fd.get('price_list')),
      sort: s?.sort ?? state.staff.length, service_ids: fd.getAll('svc').map(Number),
      hours: WD_ORDER.map((wd) => ({ weekday: wd, enabled: !!fd.get('en_' + wd), start: fd.get('st_' + wd), end: fd.get('en2_' + wd), break_start: fd.get('bs_' + wd), break_end: fd.get('be_' + wd) })),
    };
    try {
      await api(s ? 'PUT' : 'POST', s ? `/api/admin/staff/${s.id}` : '/api/admin/staff', payload);
      toast('Personel kaydedildi'); closeSheet(); await loadRefs(); viewStaff();
    } catch (err) { toast(err.message, true); }
  });
  $('#del-staff', body)?.addEventListener('click', async () => {
    if (!confirm(`${s.name} silinsin mi? Geçmiş randevular kayıtlarda kalır.`)) return;
    try { await api('DELETE', `/api/admin/staff/${s.id}`); toast('Personel silindi'); closeSheet(); await loadRefs(); viewStaff(); }
    catch (err) { toast(err.message, true); }
  });
}

// ============ AYARLAR ============
async function viewSettings() {
  const s = await api('GET', '/api/admin/settings');
  const f = (k, label, type = 'text', extra = '') => `<div class="field"><label>${label}</label><input class="input" name="${k}" type="${type}" value="${esc(s[k])}" ${extra}></div>`;
  $('#page').innerHTML = `${banner()}
    <form id="set-form" class="card" style="padding:16px;margin-bottom:16px">
      <h3 style="margin-top:0">Salon bilgileri</h3>
      ${f('salon_name', 'Salon adı')}${f('tagline', 'Slogan')}${f('phone', 'Telefon', 'tel')}
      ${f('whatsapp', 'WhatsApp numarası (90 ile, boşluksuz)', 'tel', 'placeholder="905xxxxxxxxx"')}${f('address', 'Adres')}${f('instagram', 'Instagram kullanıcı adı')}
      <h3>Fiyat listeleri</h3>
      <div class="row">${f('price_list1_name', '1. liste adı')}${f('price_list2_name', '2. liste adı')}</div>
      <h3>Rezervasyon kuralları</h3>
      <div class="row">${f('slot_interval', 'Saat aralığı (dk)', 'number', 'min="5" step="5"')}${f('buffer_min', 'Randevular arası hazırlık (dk)', 'number', 'min="0" step="5"')}</div>
      <div class="row">${f('min_notice_hours', 'En erken (saat sonra)', 'number', 'min="0" step="0.5"')}${f('max_days_ahead', 'En ileri (gün)', 'number', 'min="1"')}</div>
      <div class="row">${f('cancel_limit_hours', 'Online iptal son (saat önce)', 'number', 'min="0"')}${f('max_active_per_phone', 'Telefon başı aktif randevu', 'number', 'min="1"')}</div>
      <div class="row">${f('default_open', 'Varsayılan açılış', 'time')}${f('default_close', 'Varsayılan kapanış', 'time')}</div>
      <button class="btn block" type="submit">Ayarları kaydet</button>
    </form>
    <form id="pw-form" class="card ${state.me?.demo ? 'hidden' : ''}" style="padding:16px;margin-bottom:16px">
      <h3 style="margin-top:0">Şifre değiştir</h3>
      <div class="field"><label>Mevcut şifre</label><input class="input" type="password" name="current" autocomplete="current-password" required></div>
      <div class="field"><label>Yeni şifre (en az 6 karakter)</label><input class="input" type="password" name="next" autocomplete="new-password" minlength="6" required></div>
      <button class="btn block" type="submit">Şifreyi değiştir</button>
    </form>
    <button class="btn ghost block" id="logout">Çıkış yap</button>`;
  $('#set-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('PUT', '/api/admin/settings', Object.fromEntries(new FormData(e.target)));
      state.me.price_list_names = { 1: r.price_list1_name, 2: r.price_list2_name };
      toast('Ayarlar kaydedildi');
    }
    catch (err) { toast(err.message, true); }
  });
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/admin/password', Object.fromEntries(new FormData(e.target)));
      state.me.password_is_default = false; toast('Şifre değiştirildi'); viewSettings();
    } catch (err) { toast(err.message, true); }
  });
  $('#logout').onclick = async () => { await api('POST', '/api/admin/logout'); showLogin(); };
}

// ============ Başlat ============
boot();
