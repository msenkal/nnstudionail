'use strict';
// ============ Yardımcılar ============
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tl = (n) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);
const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} sa${m % 60 ? ' ' + (m % 60) + ' dk' : ''}` : `${m} dk`);
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtLong = (s) => parseDate(s).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
const initials = (n) => n.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toLocaleUpperCase('tr-TR');
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* yok say */ } },
};

async function api(url, body) {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Bağlantı hatası, lütfen tekrar deneyin.'), { data });
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
  $('#sheet').showModal();
  return $('#sheet-body');
}
$('#sheet').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target === $('#sheet')) $('#sheet').close();
});

// ============ Durum ============
const STEPS = ['Hizmet', 'Uzman', 'Zaman', 'Bilgiler'];
const state = {
  step: 0, info: {}, services: [], selected: [], category: 'Tümü',
  staffList: [], staffId: 'any', days: [], date: null, slots: null, time: null, booking: null,
};
const selectedServices = () => state.services.filter((s) => state.selected.includes(s.id));
const range = (min, max) => (min === max ? tl(min) : `${tl(min)} – ${tl(max)}`);
/** Süre + fiyat (uzman seçildiyse onun fiyat listesine göre, değilse olası aralık). */
function totals() {
  const svc = selectedServices();
  const d = svc.reduce((a, s) => a + s.duration_min, 0);
  const st = state.step >= 1 && state.staffId !== 'any' && state.staffList.find((s) => s.id === state.staffId);
  if (st) return { d, min: st.total_price, max: st.total_price };
  if (state.step >= 1 && state.staffList.length) {
    const ps = state.staffList.map((s) => s.total_price);
    return { d, min: Math.min(...ps), max: Math.max(...ps) };
  }
  return { d, min: svc.reduce((a, s) => a + s.price_min, 0), max: svc.reduce((a, s) => a + s.price_max, 0) };
}
const svcParam = () => state.selected.join(',');

function go(step) {
  state.step = step;
  render();
  window.scrollTo({ top: step === 0 ? 0 : $('#steps').offsetTop, behavior: 'smooth' });
}

// ============ Render ============
function render() {
  $('#steps').innerHTML = state.step > 3 ? '' : STEPS.map((s, i) =>
    `<div class="${i < state.step ? 'done' : i === state.step ? 'cur' : ''}"><i></i><span>${s}</span></div>`).join('');
  [renderServices, renderStaff, renderTime, renderForm, renderSuccess][state.step]();
  renderBar();
}

function stepHead(title) {
  return `<div class="step-title">${state.step > 0 ? '<button class="back" type="button" data-back aria-label="Geri">←</button>' : ''}<h2>${title}</h2></div>`;
}

function renderServices() {
  const cats = ['Tümü', ...new Set(state.services.map((s) => s.category))];
  const list = state.services.filter((s) => state.category === 'Tümü' || s.category === state.category);
  const groups = {};
  for (const s of list) (groups[s.category] ||= []).push(s);
  $('#view').innerHTML = `<section class="step">${stepHead('Hizmet seçin')}
    <p class="muted small" style="margin-top:-6px">Birden fazla hizmet seçebilirsiniz. Fiyatlar uzmana göre değişebilir; kesin fiyatı bir sonraki adımda görürsünüz.</p>
    <div class="chips" role="tablist">${cats.map((c) => `<button class="chip ${c === state.category ? 'on' : ''}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`).join('')}</div>
    ${list.length ? '' : '<div class="empty">Şu anda online randevuya açık hizmet bulunmuyor.</div>'}
    ${Object.entries(groups).map(([cat, items]) => `<div class="cat-title">${esc(cat)}</div>` + items.map((s) => {
      const on = state.selected.includes(s.id);
      return `<button class="svc ${on ? 'on' : ''}" data-svc="${s.id}" type="button" aria-pressed="${on}">
        <span class="tick">${on ? '✓' : ''}</span>
        <span class="info"><span class="name">${esc(s.name)}</span>${s.description ? `<span class="desc" style="display:block">${esc(s.description)}</span>` : ''}</span>
        <span class="meta"><span class="price" style="display:block">${s.price_min === s.price_max ? tl(s.price_min) : `${tl(s.price_min)}<small class="dur" style="display:block">– ${tl(s.price_max)}</small>`}</span><span class="dur">${dur(s.duration_min)}</span></span>
      </button>`;
    }).join('')).join('')}
  </section>`;
}

function renderStaff() {
  const ps = state.staffList.map((s) => s.total_price);
  const cards = [{ id: 'any', name: 'Fark etmez', title: 'Uygun fiyatlı ilk müsait uzman', color: '#c9b6bb', price: ps.length ? range(Math.min(...ps), Math.max(...ps)) : '' },
    ...state.staffList.map((s) => ({ ...s, price: tl(s.total_price) }))];
  $('#view').innerHTML = `<section class="step">${stepHead('Uzman seçin')}
    ${state.staffList.length ? '' : '<div class="empty">Seçtiğiniz hizmetlerin tamamını yapabilen bir uzman bulunamadı. Lütfen hizmetleri ayrı randevularla alın veya bizi arayın.</div>'}
    <div class="staff-grid">${state.staffList.length ? cards.map((s) => `
      <button class="staff-card ${String(state.staffId) === String(s.id) ? 'on' : ''}" data-staff="${s.id}" type="button">
        <div class="avatar" style="background:${esc(s.color)}">${s.id === 'any' ? '✦' : esc(initials(s.name))}</div>
        <div><b>${esc(s.name)}</b></div><div class="t">${esc(s.title || '')}</div>
        <div class="badge" style="margin-top:8px">${s.price}</div>
      </button>`).join('') : ''}</div>
  </section>`;
}

function renderTime() {
  const v = $('#view');
  let html = `<section class="step">${stepHead('Tarih ve saat')}`;
  if (!state.days.length) {
    v.innerHTML = html + '<div class="spinner"></div></section>';
    return;
  }
  const anyDay = state.days.some((d) => d.available);
  if (!anyDay) {
    v.innerHTML = html + `<div class="empty">Önümüzdeki ${state.info.max_days_ahead} gün içinde uygun saat kalmadı. Lütfen farklı bir uzman seçin veya bizi arayın.</div></section>`;
    return;
  }
  const month = parseDate(state.date).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  html += `<div class="month-label" id="month-label">${month}</div><div class="dates" id="dates">` + state.days.map((d) => {
    const dt = parseDate(d.date);
    return `<button class="date ${d.date === state.date ? 'on' : ''}" data-date="${d.date}" type="button" ${d.available ? '' : 'disabled'}
      aria-label="${fmtLong(d.date)}${d.available ? '' : ' (dolu)'}">
      <small>${d.date === state.info.today ? 'Bugün' : dt.toLocaleDateString('tr-TR', { weekday: 'short' })}</small><b>${dt.getDate()}</b>
      <small>${dt.toLocaleDateString('tr-TR', { month: 'short' })}</small></button>`;
  }).join('') + '</div>';

  if (state.slots == null) html += '<div class="spinner"></div>';
  else if (!state.slots.length) html += '<div class="empty">Bu gün için uygun saat kalmadı. Başka bir gün seçin.</div>';
  else {
    const groups = [['Sabah', (t) => t < '12:00'], ['Öğleden sonra', (t) => t >= '12:00' && t < '17:00'], ['Akşam', (t) => t >= '17:00']];
    for (const [label, fn] of groups) {
      const ts = state.slots.filter(fn);
      if (ts.length) html += `<div class="slot-group"><h4>${label}</h4><div class="slots">${ts.map((t) =>
        `<button class="slot ${t === state.time ? 'on' : ''}" data-time="${t}" type="button">${t}</button>`).join('')}</div></div>`;
    }
  }
  v.innerHTML = html + '</section>';
  const on = $('.date.on', v);
  if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function summaryCard() {
  const t = totals();
  const staff = state.staffId === 'any' ? 'İlk müsait uzman' : state.staffList.find((s) => s.id === state.staffId)?.name;
  return `<div class="card summary">
    <div class="when">📅 ${fmtLong(state.date)} · ${state.time}</div>
    <div class="line muted"><span>Uzman</span><span>${esc(staff)}</span></div>
    ${selectedServices().map((s) => `<div class="line"><span>${esc(s.name)}</span><span class="muted">${dur(s.duration_min)}</span></div>`).join('')}
    <div class="line total"><span>Toplam · ${dur(t.d)}</span><span>${range(t.min, t.max)}</span></div>
    ${t.min !== t.max ? '<p class="muted small" style="margin:8px 0 0">Kesin fiyat, atanan uzmanın fiyat listesine göre onay ekranında gösterilir. Önce uygun fiyatlı müsait uzman atanır.</p>' : ''}
  </div>`;
}

function renderForm() {
  const saved = store.get('nn_customer') || {};
  $('#view').innerHTML = `<section class="step">${stepHead('Bilgileriniz')}
    ${summaryCard()}
    <form id="form" novalidate>
      <div class="field"><label for="f-name">Ad Soyad</label><input class="input" id="f-name" name="name" autocomplete="name" required value="${esc(saved.name)}"></div>
      <div class="field"><label for="f-phone">Cep telefonu</label><input class="input" id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="05xx xxx xx xx" required value="${esc(saved.phone)}"></div>
      <div class="field"><label for="f-email">E-posta <span class="muted">(isteğe bağlı)</span></label><input class="input" id="f-email" name="email" type="email" autocomplete="email" value="${esc(saved.email)}"></div>
      <div class="field"><label for="f-note">Not <span class="muted">(isteğe bağlı)</span></label><textarea class="input" id="f-note" name="note" placeholder="Örn. istediğiniz model, alerji bilgisi…"></textarea></div>
      <label class="check"><input type="checkbox" name="consent" id="f-consent"><span><a href="#" id="kvkk-link">KVKK Aydınlatma Metni</a>'ni okudum; randevu için kişisel verilerimin işlenmesini kabul ediyorum.</span></label>
      <label class="check" style="margin-top:10px"><input type="checkbox" name="remember" ${saved.name ? 'checked' : ''}><span>Bilgilerimi bu cihazda hatırla</span></label>
    </form>
  </section>`;
}

function renderSuccess() {
  const b = state.booking;
  const wa = state.info.whatsapp
    ? `https://wa.me/${state.info.whatsapp}?text=${encodeURIComponent(`Merhaba, ${b.code} kodlu ${fmtLong(b.date)} ${b.time} randevum hakkında yazıyorum.`)}`
    : null;
  $('#view').innerHTML = `<section class="success">
    <div class="big-check">✓</div>
    <h2>Randevunuz oluşturuldu</h2>
    <p class="muted">Sizi ${esc(b.staff_name)} ile bekliyoruz.</p>
    <div class="code" aria-label="Randevu kodu">${esc(b.code)}</div>
    <p class="muted small" style="margin-top:-8px">Bu kod ve telefon numaranızla randevunuzu görüntüleyip iptal edebilirsiniz.</p>
    <div style="text-align:left">${bookingCard(b)}</div>
    <div class="actions">
      <button class="btn" id="add-cal" type="button">📅 Takvimime ekle</button>
      ${wa ? `<a class="btn ghost" href="${wa}" target="_blank" rel="noopener">💬 WhatsApp'tan yaz</a>` : ''}
      <button class="btn ghost" id="new-booking" type="button">Yeni randevu al</button>
    </div>
  </section>`;
}

function bookingCard(b) {
  const statusMap = { confirmed: ['Onaylı', 'ok'], completed: ['Tamamlandı', 'gray'], cancelled: ['İptal edildi', 'danger'], no_show: ['Gelinmedi', 'warn'] };
  const [label, cls] = statusMap[b.status] || [b.status, 'gray'];
  return `<div class="card summary">
    <div class="line"><span class="when" style="margin:0">📅 ${fmtLong(b.date)} · ${b.time}–${b.end_time}</span><span class="badge ${cls}">${label}</span></div>
    <div class="line muted"><span>Uzman</span><span>${esc(b.staff_name)}</span></div>
    ${b.services.map((s) => `<div class="line"><span>${esc(s.name)}</span><span>${tl(s.price)}</span></div>`).join('')}
    <div class="line total"><span>Toplam</span><span>${tl(b.total_price)}</span></div>
  </div>`;
}

function renderBar() {
  const bar = $('#bar');
  const t = totals();
  if (state.step > 3 || (state.step === 0 && !state.selected.length)) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('#bar-sum').innerHTML = `<b>${range(t.min, t.max)}</b><span>${state.selected.length} hizmet · ${dur(t.d)}</span>`;
  const next = $('#bar-next');
  next.textContent = state.step === 3 ? 'Randevuyu onayla' : 'Devam';
  next.disabled = (state.step === 1 && !state.staffList.length) || (state.step === 2 && !state.time);
}

// ============ Akış ============
async function loadStaff() {
  state.staffList = await api(`/api/public/staff?services=${svcParam()}`);
  if (state.staffId !== 'any' && !state.staffList.some((s) => s.id === state.staffId)) state.staffId = 'any';
}
async function loadDays() {
  state.days = []; state.slots = null; state.time = null;
  render();
  state.days = await api(`/api/public/days?services=${svcParam()}&staff=${state.staffId}`);
  const prev = state.date && state.days.find((d) => d.date === state.date && d.available);
  state.date = prev ? prev.date : (state.days.find((d) => d.available) || state.days[0]).date;
  await loadSlots();
}
async function loadSlots() {
  state.slots = null; state.time = null;
  render();
  state.slots = await api(`/api/public/slots?services=${svcParam()}&staff=${state.staffId}&date=${state.date}`);
  render();
}

async function next() {
  const btn = $('#bar-next');
  try {
    btn.disabled = true;
    if (state.step === 0) { await loadStaff(); go(1); }
    else if (state.step === 1) { go(2); await loadDays(); }
    else if (state.step === 2) go(3);
    else if (state.step === 3) await submit();
  } catch (e) { toast(e.message, true); }
  finally { renderBar(); }
}

async function submit() {
  const f = $('#form');
  const data = Object.fromEntries(new FormData(f));
  if ((data.name || '').trim().length < 3) { f.name.focus(); return toast('Lütfen adınızı ve soyadınızı yazın.', true); }
  if ((data.phone || '').replace(/\D/g, '').length < 10) { f.phone.focus(); return toast('Lütfen geçerli bir cep telefonu girin.', true); }
  if (!data.consent) return toast('Lütfen KVKK aydınlatma metnini onaylayın.', true);
  $('#bar-next').textContent = 'Gönderiliyor…';
  try {
    state.booking = await api('/api/public/bookings', {
      services: state.selected, staff: state.staffId, date: state.date, time: state.time,
      name: data.name, phone: data.phone, email: data.email, note: data.note, consent: true,
    });
    store.set('nn_customer', data.remember ? { name: data.name, phone: data.phone, email: data.email } : null);
    const mine = store.get('nn_bookings') || [];
    store.set('nn_bookings', [{ code: state.booking.code, phone: data.phone }, ...mine].slice(0, 5));
    go(4);
  } catch (e) {
    toast(e.message, true);
    if (e.data?.slot_taken) { go(2); await loadDays(); }
  }
}

function downloadIcs(b) {
  const dt = (d, t) => d.replace(/-/g, '') + 'T' + t.replace(':', '') + '00';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NN Nail//Randevu//TR', 'BEGIN:VEVENT',
    `UID:${b.code}@nn-nail`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${dt(b.date, b.time)}`, `DTEND:${dt(b.date, b.end_time)}`,
    `SUMMARY:${state.info.salon_name} randevusu`,
    `DESCRIPTION:${b.services.map((s) => s.name).join(', ')} - Uzman: ${b.staff_name} - Kod: ${b.code}`,
    `LOCATION:${state.info.address || ''}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Randevu hatırlatma', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = `nn-nail-randevu-${b.code}.ics`;
  a.click();
}

// ============ Randevumu yönet ============
function openManage() {
  const last = (store.get('nn_bookings') || [])[0] || {};
  const body = openSheet('Randevumu yönet', `
    <form id="manage-form">
      <div class="field"><label for="m-code">Randevu kodu</label><input class="input" id="m-code" name="code" autocapitalize="characters" placeholder="Örn. 7AP8MT" value="${esc(last.code)}" required></div>
      <div class="field"><label for="m-phone">Telefon</label><input class="input" id="m-phone" name="phone" type="tel" inputmode="tel" placeholder="05xx xxx xx xx" value="${esc(last.phone)}" required></div>
      <button class="btn block" type="submit">Randevuyu bul</button>
    </form><div id="manage-result" style="margin-top:16px"></div>`);
  const form = $('#manage-form', body);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = Object.fromEntries(new FormData(form));
    try { showManaged(await api('/api/public/bookings/lookup', q), q); } catch (err) { $('#manage-result').innerHTML = `<p class="badge danger">${esc(err.message)}</p>`; }
  });
}
function showManaged(b, q) {
  const box = $('#manage-result');
  const canCancel = b.status === 'confirmed';
  box.innerHTML = bookingCard(b) + (canCancel
    ? `<button class="btn danger block" id="cancel-btn" type="button">Randevuyu iptal et</button>
       <p class="muted small">Randevuya ${state.info.cancel_limit_hours} saatten az kaldıysa online iptal yapılamaz; lütfen bizi arayın.</p>` : '');
  $('#cancel-btn', box)?.addEventListener('click', async () => {
    if (!confirm('Randevunuzu iptal etmek istediğinize emin misiniz?')) return;
    try { const r = await api('/api/public/bookings/cancel', q); toast('Randevunuz iptal edildi.'); showManaged(r, q); }
    catch (err) { toast(err.message, true); }
  });
}

function openKvkk() {
  const i = state.info;
  openSheet('KVKK Aydınlatma Metni', `<div class="kvkk-text">
    <p><b>Veri sorumlusu:</b> ${esc(i.salon_name)}${i.address ? ', ' + esc(i.address) : ''}.</p>
    <p><b>İşlenen veriler:</b> Ad soyad, telefon, (varsa) e-posta, randevu notu ve randevu bilgileri.</p>
    <p><b>Amaç:</b> Randevunuzun oluşturulması, yönetilmesi, gerektiğinde sizinle iletişime geçilmesi ve yasal yükümlülüklerin yerine getirilmesi.</p>
    <p><b>Hukuki sebep:</b> 6698 sayılı KVKK m.5/2-c (sözleşmenin kurulması ve ifası) ve m.5/2-f (meşru menfaat).</p>
    <p><b>Aktarım:</b> Verileriniz üçüncü kişilerle paylaşılmaz; yalnızca yasal zorunluluk halinde yetkili kurumlara aktarılabilir.</p>
    <p><b>Haklarınız:</b> KVKK m.11 kapsamındaki haklarınız için ${esc(i.phone)} numarasından bize ulaşabilirsiniz.</p>
    <p class="small"><i>Not: Bu metin örnektir; yayına almadan önce bir hukukçuya kontrol ettirilmelidir.</i></p>
  </div><button class="btn block" data-close type="button">Anladım</button>`);
}

// ============ Olaylar ============
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.closest('[data-back]')) return go(state.step - 1);
  const cat = t.closest('[data-cat]');
  if (cat) { state.category = cat.dataset.cat; return render(); }
  const svc = t.closest('[data-svc]');
  if (svc) {
    const id = Number(svc.dataset.svc);
    state.selected = state.selected.includes(id) ? state.selected.filter((x) => x !== id) : [...state.selected, id];
    return render();
  }
  const st = t.closest('[data-staff]');
  if (st) { state.staffId = st.dataset.staff === 'any' ? 'any' : Number(st.dataset.staff); return render(); }
  const dt = t.closest('[data-date]');
  if (dt && !dt.disabled) {
    state.date = dt.dataset.date;
    try { await loadSlots(); } catch (err) { toast(err.message, true); }
    return;
  }
  const sl = t.closest('[data-time]');
  if (sl) { state.time = sl.dataset.time; render(); setTimeout(() => $('#bar-next').scrollIntoView({ block: 'nearest' }), 0); return; }
  if (t.id === 'kvkk-link') { e.preventDefault(); return openKvkk(); }
  if (t.id === 'add-cal') return downloadIcs(state.booking);
  if (t.id === 'new-booking') { Object.assign(state, { selected: [], staffId: 'any', date: null, time: null, booking: null }); return go(0); }
});
$('#bar-next').addEventListener('click', next);
$('#btn-manage').addEventListener('click', openManage);

// Gün şeridi kaydırılınca ay etiketini güncelle
document.addEventListener('scroll', (e) => {
  if (e.target.id !== 'dates') return;
  const strip = e.target;
  const first = [...strip.children].find((c) => c.offsetLeft + c.offsetWidth > strip.scrollLeft);
  if (first) $('#month-label').textContent = parseDate(first.dataset.date).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
}, true);

// ============ Başlat ============
(async function init() {
  try {
    const [info, services] = await Promise.all([api('/api/public/info'), api('/api/public/services')]);
    state.info = info; state.services = services;
    document.title = `${info.salon_name} · Online Randevu`;
    $('#tagline').textContent = info.tagline;
    if (info.demo) {
      document.body.insertAdjacentHTML('afterbegin',
        '<div class="demo-bar">🧪 Demo sürüm: burada alınan randevular gerçek değildir. <a href="/admin">Yönetim panelini deneyin →</a></div>');
    }
    $('#lnk-phone').href = 'tel:' + info.phone.replace(/\s/g, '');
    if (info.whatsapp) $('#lnk-wa').href = 'https://wa.me/' + info.whatsapp; else $('#lnk-wa').remove();
    if (info.address) $('#lnk-map').href = 'https://maps.google.com/?q=' + encodeURIComponent(info.salon_name + ' ' + info.address); else $('#lnk-map').remove();
    render();
  } catch (e) {
    $('#view').innerHTML = `<div class="empty">Sistem şu anda yanıt vermiyor. Lütfen biraz sonra tekrar deneyin.<br><br>${esc(e.message)}</div>`;
  }
})();
