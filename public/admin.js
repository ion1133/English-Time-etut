(() => {
  const $ = s => document.querySelector(s);
  const DAYS = ['', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let tt; const toast = (m, bad) => { const el = $('#toast'); el.textContent = m; el.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), 3000); };
  const api = async (url, method = 'GET', body) => {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { showLogin(); throw new Error('login'); }
    if (!r.ok) { toast(d.error || 'Hata', true); throw new Error(d.error); }
    return d;
  };
  const fmtDate = d => { const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}.${m}.${y}`; };
  const fmtTs = s => new Date(s).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short' });

  let D = null; // overview data

  function showLogin() { $('#login').classList.remove('hidden'); $('#panel').classList.add('hidden'); $('#logout').classList.add('hidden'); }
  async function start() {
    const me = await (await fetch('/api/admin/me')).json();
    if (!me.admin) return showLogin();
    $('#login').classList.add('hidden'); $('#panel').classList.remove('hidden'); $('#logout').classList.remove('hidden');
    await load();
  }
  $('#loginBtn').onclick = async () => {
    const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('#pw').value }) });
    if (!r.ok) { $('#pwErr').textContent = 'Şifre hatalı'; return; }
    $('#pwErr').textContent = ''; start();
  };
  $('#pw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loginBtn').click(); });
  $('#logout').onclick = async () => { await fetch('/api/admin/logout', { method: 'POST' }); location.reload(); };

  $('#tabs').querySelectorAll('button').forEach(b => b.onclick = () => {
    $('#tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('hidden', t.id !== 'tab-' + b.dataset.tab));
  });

  async function load() {
    D = await api('/api/admin/overview');
    renderOverview(); renderSchedule(); renderTeachers(); renderBookings(); renderMessages(); fillSettings();
  }

  /* ---- overview ---- */
  function renderOverview() {
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = D.bookings.flatMap(b => b.slots.map(s => ({ ...s, name: b.first_name + ' ' + b.last_name, lvl: b.level }))).filter(s => s.date >= today);
    const week = upcoming.filter(s => s.date <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
    const cancelled = D.slots.filter(s => s.cancelled).length; // now includes per-date cancellations
    $('#stats').innerHTML = [
      [D.total_bookings, 'Toplam kayıt'], [week.length, 'Bu hafta etüt katılımı'], [D.slots.length, 'Programdaki etüt'],
      [cancelled, 'İptal edilmiş etüt'], [D.teachers.length, 'Öğretmen'],
    ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
    const url = D.site_url;
    $('#qrImg').src = '/api/admin/qr.png?url=' + encodeURIComponent(url) + '&t=' + Date.now();
    $('#qrDl').href = $('#qrImg').src; $('#openSite').href = url; $('#siteUrl').textContent = url;
    const byDate = {};
    for (const s of upcoming) (byDate[s.date + ' ' + s.start] ||= { ...s, n: 0 }).n++;
    const rows = Object.values(byDate).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)).slice(0, 12);
    $('#upcoming').innerHTML = rows.length ? `<table class="tbl">${rows.map(r => `<tr><td>${fmtDate(r.date)} ${DAYS[r.day]}</td><td>${r.start}–${r.end}</td><td><span class="tag y">${esc(r.level)}</span></td><td>${esc(r.teacher)}</td><td><b>${r.n}</b> öğrenci</td></tr>`).join('')}</table>` : '<div class="note">Henüz yaklaşan kayıt yok.</div>';
  }

  /* ---- schedule ---- */
  function renderSchedule() {
    const el = $('#aSched'); el.innerHTML = '';
    for (let d = 1; d <= 7; d++) {
      const col = document.createElement('div'); col.className = 'daycol show' + (d >= 6 ? ' weekend' : '');
      col.innerHTML = `<div class="dayhead d${d}">${DAYS[d]}</div>`;
      for (const s of D.slots.filter(x => x.day === d)) {
        const b = document.createElement('button'); b.type = 'button';
        b.className = 'tile' + (s.cancelled ? ' cancel' : '');
        // A cancellation applies to ONE date, so the tile says which —
        // "İPTAL" alone left a coordinator unsure whether the whole
        // weekly slot was gone.
        const cancelTag = s.date_cancelled
          ? `İPTAL ${fmtDate(s.next_date)}`
          : s.legacy_cancelled ? 'KAPALI' : null;
        b.innerHTML = `<span class="edit">${cancelTag || '✎ ' + s.booked}</span><span class="time">${s.start_time}–${s.end_time}</span><span class="lvl">${esc(s.level)}</span><span class="meta">${esc(s.teacher_name || '— öğretmen yok')}</span>`;
        b.onclick = () => openSlot(s); col.appendChild(b);
      }
      el.appendChild(col);
    }
  }
  let curSlot = null;
  function openSlot(s) {
    curSlot = s;
    $('#slotTitle').textContent = s ? 'Etütü düzenle' : 'Yeni etüt';
    $('#sTeacher').innerHTML = '<option value="">— seçilmedi —</option>' + D.teachers.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    $('#sDay').value = s?.day || 1; $('#sLevel').value = s?.level || ''; $('#sStart').value = s?.start_time || ''; $('#sEnd').value = s?.end_time || '';
    $('#sTeacher').value = s?.teacher_id || ''; $('#sCap').value = s?.capacity || 0; $('#sRoom').value = s?.classroom || '';
    $('#sCancel').checked = !!s?.cancelled;
    $('#sNote').value = s?.cancel_note || '';
    // Defaults to the next occurrence of this weekly slot, which is
    // almost always the one being cancelled.
    $('#sCancelDate').value = s?.next_date || '';
    $('#sDelete').classList.toggle('hidden', !s);
    $('#slotBg').classList.add('show');
  }
  $('#addSlot').onclick = () => openSlot(null);
  $('#sClose').onclick = () => $('#slotBg').classList.remove('show');
  $('#sSave').onclick = async () => {
    const body = { day: $('#sDay').value, level: $('#sLevel').value.trim().toUpperCase(), start_time: $('#sStart').value, end_time: $('#sEnd').value,
      teacher_id: $('#sTeacher').value || null, capacity: $('#sCap').value, classroom: $('#sRoom').value.trim() };
    if (!body.level || !body.start_time || !body.end_time) return toast('Seviye ve saatleri doldur', true);
    const saved = curSlot ? await api('/api/admin/slots/' + curSlot.id, 'PUT', body) : await api('/api/admin/slots', 'POST', body);
    // Cancelling texts every student booked on THAT DATE, so the result
    // is reported back rather than failing silently.
    const cx = await api(`/api/admin/slots/${saved.id}/cancel`, 'POST', {
      cancelled: $('#sCancel').checked,
      date: $('#sCancelDate').value,
      note: $('#sNote').value.trim(),
    });
    if ($('#sCancel').checked && cx && typeof cx.notified === 'number') {
      toast(cx.notified > 0
        ? `${cx.notified} ogrenciye iptal SMS'i gonderildi`
        : 'Iptal edildi. Bu tarihte kayitli ogrenci yoktu.');
    }
    $('#slotBg').classList.remove('show'); toast('Kaydedildi'); load();
  };
  $('#sDelete').onclick = async () => { if (!confirm('Bu etüt programdan silinsin mi?')) return; await api('/api/admin/slots/' + curSlot.id, 'DELETE'); $('#slotBg').classList.remove('show'); toast('Silindi'); load(); };

  /* ---- teachers ---- */
  function renderTeachers() {
    const rows = D.teachers.map(t => {
      const n = D.slots.filter(s => s.teacher_id === t.id).length;
      return `<tr><td><b>${esc(t.name)}</b></td><td>${esc(t.phone)}</td><td>${esc(t.note)}</td><td>${n} etüt</td>
        <td class="inline"><button class="btn ghost sm" data-e="${t.id}">Düzenle</button><button class="btn danger sm" data-d="${t.id}">Sil</button></td></tr>`;
    }).join('');
    $('#tTable').innerHTML = `<tr><th>Ad Soyad</th><th>Telefon</th><th>Not</th><th>Atama</th><th></th></tr>${rows || '<tr><td colspan=5 class="note">Henüz öğretmen yok. "Öğretmen ekle" ile başla.</td></tr>'}`;
    $('#tTable').querySelectorAll('[data-e]').forEach(b => b.onclick = () => openTeacher(D.teachers.find(t => t.id == b.dataset.e)));
    $('#tTable').querySelectorAll('[data-d]').forEach(b => b.onclick = async () => { if (!confirm('Öğretmen silinsin mi?')) return; await api('/api/admin/teachers/' + b.dataset.d, 'DELETE'); load(); });
  }
  let curT = null;
  function openTeacher(t) { curT = t; $('#tTitle').textContent = t ? 'Öğretmeni düzenle' : 'Yeni öğretmen'; $('#tName').value = t?.name || ''; $('#tPhone').value = t?.phone || ''; $('#tNote').value = t?.note || ''; $('#tBg').classList.add('show'); }
  $('#addTeacher').onclick = () => openTeacher(null);
  $('#tClose').onclick = () => $('#tBg').classList.remove('show');
  $('#tSave').onclick = async () => {
    const body = { name: $('#tName').value.trim(), phone: $('#tPhone').value.trim(), note: $('#tNote').value.trim() };
    if (!body.name) return toast('İsim gerekli', true);
    curT ? await api('/api/admin/teachers/' + curT.id, 'PUT', body) : await api('/api/admin/teachers', 'POST', body);
    $('#tBg').classList.remove('show'); toast('Kaydedildi'); load();
  };

  /* ---- bookings ---- */
  function renderBookings() {
    const qv = ($('#bSearch').value || '').toLowerCase();
    const rows = D.bookings.filter(b => !qv || `${b.first_name} ${b.last_name} ${b.phone} ${b.level} ${b.topic}`.toLowerCase().includes(qv)).map(b =>
      `<tr><td>${fmtTs(b.created_at)}</td><td><b>${esc(b.first_name)} ${esc(b.last_name)}</b><br><small>${esc(b.phone)}</small></td><td><span class="tag y">${esc(b.level)}</span></td>
       <td>${b.slots.map(s => `<div>${fmtDate(s.date)} ${DAYS[s.day]?.slice(0, 3)} ${s.start}–${s.end} <span class="tag">${esc(s.level)}</span> ${esc(s.teacher)}</div>`).join('')}</td>
       <td>${esc(b.topic)}</td><td><button class="btn danger sm" data-d="${b.id}">Sil</button></td></tr>`).join('');
    $('#bTable').innerHTML = `<tr><th>Kayıt</th><th>Öğrenci</th><th>Seviye</th><th>Etütler</th><th>Konu</th><th></th></tr>${rows || '<tr><td colspan=6 class="note">Kayıt yok.</td></tr>'}`;
    $('#bTable').querySelectorAll('[data-d]').forEach(b => b.onclick = async () => { if (!confirm('Kayıt silinsin mi?')) return; await api('/api/admin/bookings/' + b.dataset.d, 'DELETE'); load(); });
  }
  $('#bSearch').addEventListener('input', renderBookings);

  /* ---- messages ---- */
  function renderMessages() {
    const cls = { sent: 'g', failed: 'r', logged: 'b' }, lbl = { sent: 'Gönderildi', failed: 'Hata', logged: 'Test modu' };
    $('#mTable').innerHTML = `<tr><th>Zaman</th><th>Kanal</th><th>Alıcı</th><th>Durum</th><th>Mesaj</th></tr>` +
      (D.messages.map(m => `<tr><td>${fmtTs(m.created_at)}</td><td>SMS</td><td>${esc(m.recipient)}</td>
        <td><span class="tag ${cls[m.status]}">${lbl[m.status]}</span><br><small class="note">${esc(m.detail)}</small></td><td style="white-space:pre-wrap;max-width:420px">${esc(m.body)}</td></tr>`).join('') || '<tr><td colspan=5 class="note">Henüz mesaj yok.</td></tr>');
  }

  /* ---- settings ---- */
  function fillSettings() { document.querySelectorAll('[data-s]').forEach(el => el.value = D.settings[el.dataset.s] ?? ''); }
  $('#saveSettings').onclick = async () => {
    const body = {};
    const SECRETS = ['wa_token', 'netgsm_password', 'admin_password'];
    document.querySelectorAll('[data-s]').forEach(el => {
      const key = el.dataset.s;
      const value = el.value;
      // A secret is only saved when it has actually been typed and is not
      // the unchanged value already stored. This stops a browser autofill,
      // or an empty box, from silently destroying a working token.
      if (SECRETS.includes(key)) {
        if (!value || value === D.settings[key]) return;
      }
      body[key] = value;
    });
    if ($('#newPw').value) body.admin_password = $('#newPw').value;
    await api('/api/admin/settings', 'PUT', body); $('#newPw').value = ''; toast('Ayarlar kaydedildi'); load();
  };
  /**
   * Each button previews AND sends the real template with sample data,
   * so the wording can be checked exactly as a recipient will see it.
   */
  const smsTest = (template, label) => async () => {
    const r = await api('/api/admin/test-message', 'POST', {
      channel: 'sms', template, to: $('#testTo').value,
    });
    if (r.preview) console.log(label + ':\n' + r.preview);
    toast(
      r.mode === 'log'
        ? 'Test modu - gonderilmedi. Netgsm bilgilerini girin. (' + (r.parts || 1) + ' SMS olacakti)'
        : r.ok ? label + ' gonderildi (' + (r.parts || 1) + ' SMS)'
        : 'Hata: ' + String(r.detail || r.error || 'bilinmiyor'),
      !r.ok || r.mode === 'log'
    );
    load();
  };

  $('#testSms').onclick = smsTest('student', 'Ogrenci SMS');
  $('#testTeacher').onclick = smsTest('teacher', 'Ogretmen SMS');
  $('#testCancel').onclick = smsTest('cancel', 'Iptal SMS');

  document.querySelectorAll('.modal-bg').forEach(m => m.onclick = e => { if (e.target === m) m.classList.remove('show'); });
  start();
})();
