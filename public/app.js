(() => {
  const $ = s => document.querySelector(s);
  const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const DAYS = {
    tr: ['', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'],
    en: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  };
  const I18N = {
    tr: {
      tag: 'Language Schools & Overseas Education', s1: 'Bilgileriniz', s2: 'Etüt seçimi', s3: 'Onay',
      e1: 'Etüt kaydı', h1: 'Kaçırdığın ya da anlamadığın konuyu etütte telafi et.',
      p1: 'Bilgilerini gir, sana uygun etüt saatlerini seç. Kaydın hem sana SMS ile hem de öğretmenine iletilir.',
      fn: 'Ad', ln: 'Soyad', ph: 'Telefon', phs: '05XX XXX XX XX — SMS bu numaraya gidecek', lv: 'Şu an okuduğun seviye', lvp: 'Seviye seç',
      tp: 'Sormak istediğin konu', tps: 'İsteğe bağlı', tpph: 'Örn: Present perfect, relative clauses…', next: 'Etüt saatlerine geç',
      e2: 'Haftalık etüt programı', h2: 'Katılmak istediğin etütleri seç.', lg1: 'Seçilebilir', lg2: 'Seçildi', lg3: 'Seviyene uygun değil / dolu', lg4: 'İptal edildi',
      back: 'Geri', submit: 'Kaydı tamamla', h3: 'Kaydın alındı!', remind: 'Lütfen etüt saatinden 5 dakika önce sınıfta ol. İyi dersler dileriz.',
      again: 'Yeni kayıt', ok: 'Tamam',
      v_name: 'Sadece harf kullan (en az 2 harf).', v_phone: '05 ile başlayan 11 haneli numara gir.', v_level: 'Seviyeni seç.',
      sel: n => n ? `${n} etüt seçildi` : 'Henüz seçim yok',
      desc: (lvl, allowed, d) => `Seviyen <b>${lvl}</b>. Seçebileceğin etütler: <b>${allowed.join(', ')}</b>. En erken <b>${d === 1 ? 'yarın' : d + ' gün sonra'}</b>ki etütlere kayıt olabilirsin; seçtiğin gün en yakın tarihe işlenir.`,
      cancelT: 'Bu etüt iptal edildi', cancelB: 'Bu etüt Eğitim Koordinatörü tarafından iptal edilmiştir.',
      lockT: 'Seçilemez', lockB: 'Bu etüt senin seviyene uygun değil.', fullT: 'Etüt dolu', fullB: 'Bu etüt için kontenjan dolmuştur.',
      wkday: 'Hafta içi sınıf', wkend: 'Hafta sonu sınıf', sending: 'Kaydediliyor…',
      done: (name, mode) => `Sayın ${name}, etüt kaydın oluşturuldu.${mode === 'log' ? '' : ' Onay SMS\'i telefonuna gönderildi.'}`,
      netErr: 'Bağlantı hatası, tekrar dene.', teacher: 'Öğretmen',
    },
    en: {
      tag: 'Language Schools & Overseas Education', s1: 'Your details', s2: 'Pick etüts', s3: 'Done',
      e1: 'Etüt registration', h1: 'Catch up on anything you missed or didn\'t understand.',
      p1: 'Enter your details and choose the etüt sessions that suit you. You\'ll get an SMS confirmation and your teacher is notified.',
      fn: 'First name', ln: 'Last name', ph: 'Phone', phs: '05XX XXX XX XX — the SMS goes here', lv: 'Your current level', lvp: 'Select level',
      tp: 'Topic you want to ask about', tps: 'Optional', tpph: 'e.g. Present perfect, relative clauses…', next: 'Choose etüt times',
      e2: 'Weekly etüt schedule', h2: 'Select the etüts you want to attend.', lg1: 'Available', lg2: 'Selected', lg3: 'Not your level / full', lg4: 'Cancelled',
      back: 'Back', submit: 'Complete registration', h3: 'You\'re registered!', remind: 'Please be in the classroom 5 minutes before the etüt starts. Have a great lesson.',
      again: 'New registration', ok: 'OK',
      v_name: 'Letters only (at least 2).', v_phone: 'Enter an 11-digit number starting with 05.', v_level: 'Select your level.',
      sel: n => n ? `${n} selected` : 'Nothing selected yet',
      desc: (lvl, allowed, d) => `Your level is <b>${lvl}</b>. You can join: <b>${allowed.join(', ')}</b>. The earliest you can book is <b>${d === 1 ? 'tomorrow' : d + ' days ahead'}</b>; each day you pick is booked for its next date.`,
      cancelT: 'This etüt is cancelled', cancelB: 'This etüt has been cancelled by the Educational Coordinator.',
      lockT: 'Not available', lockB: 'This etüt is not open to your level.', fullT: 'Etüt is full', fullB: 'This etüt has reached its capacity.',
      wkday: 'Weekday classroom', wkend: 'Weekend classroom', sending: 'Saving…',
      done: (name, mode) => `Dear ${name}, your etüt registration is complete.${mode === 'log' ? '' : ' A confirmation SMS has been sent to your phone.'}`,
      netErr: 'Connection problem, please try again.', teacher: 'Teacher',
    },
  };

  let lang = localStorage.getItem('et_lang') || 'tr';
  let cfg = null, student = null, selected = new Set(), activeDay = 1;
  const t = k => I18N[lang][k];

  function applyLang() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(el => { const v = t(el.dataset.i18n); if (typeof v === 'string') el.textContent = v; });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => el.placeholder = t(el.dataset.i18nPh));
    document.querySelectorAll('.lang button').forEach(b => b.classList.toggle('on', b.dataset.lang === lang));
    if (cfg && student) renderSchedule();
  }
  document.querySelectorAll('.lang button').forEach(b => b.onclick = () => { lang = b.dataset.lang; localStorage.setItem('et_lang', lang); applyLang(); });

  /* ---- step 1: validation ---- */
  const nameRe = /^[A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû' -]{2,60}$/;
  ['first', 'last'].forEach(id => $('#' + id).addEventListener('input', e => {
    e.target.value = e.target.value.replace(/[^A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû' -]/g, ''); // no digits / symbols
  }));
  $('#phone').addEventListener('input', e => {
    let d = e.target.value.replace(/\D/g, '').slice(0, 11);
    if (d.length && d[0] !== '0') d = '0' + d; if (d.length > 1 && d[1] !== '5') d = '05' + d.slice(2);
    e.target.value = d.replace(/^(\d{4})(\d{0,3})(\d{0,2})(\d{0,2}).*/, (m, a, b, c, e2) => [a, b, c, e2].filter(Boolean).join(' '));
  });
  $('#phone').addEventListener('keydown', e => { if (e.key.length === 1 && !/\d/.test(e.key)) e.preventDefault(); });

  function showStep(n) {
    ['p1', 'p2', 'p3'].forEach((id, i) => $('#' + id).classList.toggle('hidden', i !== n - 1));
    ['st1', 'st2', 'st3'].forEach((id, i) => { const el = $('#' + id); el.classList.toggle('on', i === n - 1); el.classList.toggle('done', i < n - 1); });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $('#form').addEventListener('submit', async e => {
    e.preventDefault();
    const first = $('#first').value.trim(), last = $('#last').value.trim(), phone = $('#phone').value.replace(/\s/g, ''), level = $('#level').value;
    let ok = true;
    const set = (id, bad, msg) => { $('#e_' + id).textContent = bad ? msg : ''; $('#' + id).classList.toggle('bad', bad); if (bad) ok = false; };
    set('first', !nameRe.test(first), t('v_name')); set('last', !nameRe.test(last), t('v_name'));
    set('phone', !/^05\d{9}$/.test(phone), t('v_phone')); set('level', !level, t('v_level'));
    if (!ok) return;
    student = { first_name: first, last_name: last, phone, level, topic: $('#topic').value.trim() };
    $('#toStep2').disabled = true;
    try { cfg = await (await fetch('/api/config')).json(); } catch { toast(t('netErr'), true); $('#toStep2').disabled = false; return; }
    $('#toStep2').disabled = false;
    selected.clear(); renderSchedule(); showStep(2);
  });
  $('#back1').onclick = () => showStep(1);
  $('#again').onclick = () => location.reload();

  /* ---- step 2: schedule ---- */
  function allowedLevels() {
    const i = LEVELS.indexOf(student.level), a = [student.level];
    if (cfg.level_rule === 'all') return LEVELS;
    if ((cfg.level_rule === 'own_next' || cfg.level_rule === 'own_adjacent') && LEVELS[i + 1]) a.push(LEVELS[i + 1]);
    if (cfg.level_rule === 'own_adjacent' && LEVELS[i - 1]) a.unshift(LEVELS[i - 1]);
    return a;
  }
  const slotAllowed = s => { const a = allowedLevels(); return s.level.split(/[-\/,\s]+/).some(l => a.includes(l)); };
  const fmtDate = iso => { const [y, m, d] = iso.split('-'); return `${d}.${m}`; };

  function renderSchedule() {
    const allowed = allowedLevels();
    $('#p2desc').innerHTML = t('desc')(student.level, allowed, cfg.min_days_ahead);
    $('#classroom').innerHTML = `<span class="pill">${t('wkday')}: <b>${esc(cfg.classroom_weekday)}</b></span><span class="pill">${t('wkend')}: <b>${esc(cfg.classroom_weekend)}</b></span>`;
    const sched = $('#sched'); sched.innerHTML = '';
    const tabs = $('#daytabs'); tabs.innerHTML = '';
    for (let d = 1; d <= 7; d++) {
      const col = document.createElement('div');
      col.className = 'daycol' + (d >= 6 ? ' weekend' : '') + (d === activeDay ? ' show' : '');
      col.dataset.day = d;
      const slots = cfg.slots.filter(s => s.day === d);
      const date = slots[0]?.next_date;
      col.innerHTML = `<div class="dayhead d${d}">${DAYS[lang][d]}<small>${date ? fmtDate(date) : ''}</small></div>`;
      for (const s of slots) col.appendChild(tile(s));
      sched.appendChild(col);
      const tb = document.createElement('button'); tb.type = 'button'; tb.className = d === activeDay ? 'on' : '';
      tb.innerHTML = `${DAYS[lang][d].slice(0, 3)}${slots.some(s => selected.has(s.id)) ? '<span class="dot"></span>' : ''}`;
      tb.onclick = () => { activeDay = d; renderSchedule(); };
      tabs.appendChild(tb);
    }
    $('#selCount').textContent = t('sel')(selected.size);
    $('#submit').disabled = selected.size === 0;
  }
  function tile(s) {
    const b = document.createElement('button'); b.type = 'button';
    const ok = slotAllowed(s);
    b.className = 'tile' + (s.cancelled ? ' cancel' : !ok ? ' lock' : s.full ? ' full' : '') + (selected.has(s.id) ? ' on' : '');
    b.setAttribute('aria-pressed', selected.has(s.id));
    b.innerHTML = `<span class="time">${s.start_time}–${s.end_time}</span><span class="lvl">${esc(s.level)}</span>` +
      `<span class="meta">${s.teacher_name ? esc(s.teacher_name) : (s.classroom ? esc(s.classroom) : '&nbsp;')}</span>`;
    b.onclick = () => {
      if (s.cancelled) return modal(t('cancelT'), s.cancel_note ? esc(s.cancel_note) : t('cancelB'));
      if (!ok) return modal(t('lockT'), t('lockB'));
      if (s.full) return modal(t('fullT'), t('fullB'));
      selected.has(s.id) ? selected.delete(s.id) : selected.add(s.id);
      renderSchedule();
    };
    return b;
  }

  $('#submit').onclick = async () => {
    const btn = $('#submit'); btn.disabled = true; const old = btn.innerHTML; btn.textContent = t('sending');
    try {
      const res = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...student, slot_ids: [...selected] }) });
      const data = await res.json();
      if (!res.ok) { toast(data.error || t('netErr'), true); cfg = await (await fetch('/api/config')).json(); renderSchedule(); btn.innerHTML = old; btn.disabled = false; return; }
      $('#doneNote').textContent = t('done')(`${student.first_name} ${student.last_name}`, data.sms_mode);
      $('#summary').innerHTML = data.summary.map(s => `<div class="row"><span class="lv">${esc(s.level)}</span><span class="dt">${lang === 'tr' ? s.day_tr : s.day_en} · ${fmtDate(s.date)} · ${s.start_time}–${s.end_time}<small>${esc(s.classroom)}${s.teacher_name ? ' · ' + t('teacher') + ': ' + esc(s.teacher_name) : ''}</small></span></div>`).join('');
      showStep(3);
    } catch { toast(t('netErr'), true); btn.innerHTML = old; btn.disabled = false; }
  };

  /* ---- ui utils ---- */
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  let tt; function toast(msg, bad) { const el = $('#toast'); el.textContent = msg; el.className = 'toast show' + (bad ? ' bad' : ''); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('show'), 3500); }
  function modal(title, body) { $('#mTitle').textContent = title; $('#mBody').innerHTML = body; $('#modalBg').classList.add('show'); }
  $('#mClose').onclick = () => $('#modalBg').classList.remove('show');
  $('#modalBg').onclick = e => { if (e.target === e.currentTarget) $('#modalBg').classList.remove('show'); };

  applyLang();
})();
