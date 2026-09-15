(() => {
  const $ = s => document.querySelector(s);
  const LEVELS = ['A1','A2','B1','B2','C1','C2'];
  const DAYS = {
    tr:['','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'],
    en:['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
  };
  const I18N = {
    tr:{tag:'Language Schools & Overseas Education',mypanel:'Etütlerim',teacherlink:'Öğretmen misiniz?',s1:'Bilgileriniz',s2:'Etüt seçimi',s3:'Onay',e1:'Etüt kaydı',h1:'Anlamadığın konuyu etüt ile telafi et.',p1:'Bilgilerini gir, sana uygun saati seç. Kayıttan sonra etütlerini öğrenci panelinden takip edebilirsin.',fn:'Ad',ln:'Soyad',ph:'Telefon',phs:'05XX XXX XX XX',lv:'Şu an okuduğun seviye',lvp:'Seviye seç',tp:'Sormak istediğin konu',tps:'İsteğe bağlı',tpph:'Örn: Present perfect, relative clauses…',next:'Etüt saatlerine geç',e2:'Haftalık etüt programı',h2:'Katılmak istediğin etütleri seç.',lg1:'Seçilebilir',lg2:'Seçildi',lg3:'Seviyene uygun değil / dolu',lg4:'İptal edildi',back:'Geri',submit:'Kaydı tamamla',h3:'Kaydın alındı!',remind:'Lütfen etüt saatinden 5 dakika önce sınıfta ol.',again:'Yeni kayıt',panelgo:'Etütlerimi görüntüle →',ok:'Tamam',v_name:'Geçerli bir ad gir (en az 2 karakter).',v_phone:'05 ile başlayan 11 haneli numara gir.',v_level:'Seviyeni seç.',sel:n=>n?`${n} etüt seçildi`:'Henüz seçim yok',desc:(lvl,a,d)=>`Seviyen <b>${lvl}</b>. Seçebileceğin etütler: <b>${a.join(', ')}</b>. En erken <b>${d===1?'yarın':d+' gün sonra'}</b>ki etütlere kayıt olabilirsin.`,cancelT:'Bu etüt iptal edildi',cancelB:'Bu etüt Eğitim Koordinatörü tarafından iptal edilmiştir.',lockT:'Seçilemez',lockB:'Bu etüt senin seviyene uygun değil.',fullT:'Etüt dolu',fullB:'Bu etüt için kontenjan dolmuştur.',wkday:'Hafta içi sınıf',wkend:'Hafta sonu sınıf',sending:'Kaydediliyor…',done:name=>`${name}, kaydın oluşturuldu. Etütlerini öğrenci panelinden canlı olarak takip edebilirsin.`,netErr:'Bağlantı hatası, tekrar dene.',teacher:'Öğretmen',capacity:(b,c)=>c>0?`${b}/${c} dolu`:`${b} kayıt`,changed:'Program değişti. Artık uygun olmayan seçimler kaldırıldı.'},
    en:{tag:'Language Schools & Overseas Education',mypanel:'My etüts',teacherlink:'Are you a teacher?',s1:'Your details',s2:'Pick etüts',s3:'Done',e1:'Etüt registration',h1:'Catch up on what you did not understand.',p1:'Enter your details, choose a suitable time, then track everything from your student panel.',fn:'First name',ln:'Last name',ph:'Phone',phs:'05XX XXX XX XX',lv:'Your current level',lvp:'Select level',tp:'Topic you want to ask about',tps:'Optional',tpph:'e.g. Present perfect, relative clauses…',next:'Choose etüt times',e2:'Weekly etüt schedule',h2:'Select the etüts you want to attend.',lg1:'Available',lg2:'Selected',lg3:'Not your level / full',lg4:'Cancelled',back:'Back',submit:'Complete registration',h3:"You're registered!",remind:'Please be in the classroom 5 minutes before the etüt starts.',again:'New registration',panelgo:'View my etüts →',ok:'OK',v_name:'Enter a valid name (at least 2 characters).',v_phone:'Enter an 11-digit number starting with 05.',v_level:'Select your level.',sel:n=>n?`${n} selected`:'Nothing selected yet',desc:(lvl,a,d)=>`Your level is <b>${lvl}</b>. You can join: <b>${a.join(', ')}</b>. Earliest booking: <b>${d===1?'tomorrow':d+' days ahead'}</b>.`,cancelT:'This etüt is cancelled',cancelB:'This etüt has been cancelled by the Educational Coordinator.',lockT:'Not available',lockB:'This etüt is not open to your level.',fullT:'Etüt is full',fullB:'This etüt has reached capacity.',wkday:'Weekday classroom',wkend:'Weekend classroom',sending:'Saving…',done:name=>`${name}, your registration is complete. You can track live changes from your student panel.`,netErr:'Connection problem, please try again.',teacher:'Teacher',capacity:(b,c)=>c>0?`${b}/${c} filled`:`${b} booked`,changed:'The schedule changed. Selections that are no longer available were removed.'}
  };

  let lang = localStorage.getItem('et_lang') || 'tr';
  let cfg = null, student = null, selected = new Set(), activeDay = 1, currentStep = 1;
  let pollTimer = null, pollBusy = false;
  const t = k => I18N[lang][k];
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDate = s => { const [y,m,d] = String(s).slice(0,10).split('-'); return `${d}.${m}`; };
  const nameRe = /^[\p{L}\p{M}' -]{2,60}$/u;

  const setTheme = theme => { document.documentElement.dataset.theme=theme; localStorage.setItem('et_theme',theme); };
  setTheme(localStorage.getItem('et_theme') || 'light');
  $('#themeBtn').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');

  function applyLang(){
    document.documentElement.lang=lang;
    document.querySelectorAll('[data-i18n]').forEach(el=>{const v=t(el.dataset.i18n);if(typeof v==='string')el.textContent=v;});
    document.querySelectorAll('[data-i18n-ph]').forEach(el=>el.placeholder=t(el.dataset.i18nPh));
    document.querySelectorAll('.lang button').forEach(b=>b.classList.toggle('on',b.dataset.lang===lang));
    if(cfg&&student)renderSchedule(false);
  }
  document.querySelectorAll('.lang button').forEach(b=>b.onclick=()=>{lang=b.dataset.lang;localStorage.setItem('et_lang',lang);applyLang();});

  $('#phone').addEventListener('input',e=>{
    let d=e.target.value.replace(/\D/g,'').slice(0,11);
    if(d.length&&d[0]!=='0')d='0'+d;
    if(d.length>1&&d[1]!=='5')d='05'+d.slice(2);
    e.target.value=d.replace(/^(\d{4})(\d{0,3})(\d{0,2})(\d{0,2}).*/,(m,a,b,c,z)=>[a,b,c,z].filter(Boolean).join(' '));
  });

  function showStep(n){
    currentStep=n;
    ['p1','p2','p3'].forEach((id,i)=>$('#'+id).classList.toggle('hidden',i!==n-1));
    ['st1','st2','st3'].forEach((id,i)=>{const el=$('#'+id);el.classList.toggle('on',i===n-1);el.classList.toggle('done',i<n-1);});
    window.scrollTo({top:0,behavior:'smooth'});
    schedulePoll();
  }

  function apiErrorText(data,fallback){ return data?.request_id ? `${data.error||fallback} (Ref: ${data.request_id})` : (data?.error||fallback); }
  async function fetchConfig(){
    const r=await fetch('/api/config',{cache:'no-store'});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(apiErrorText(data,t('netErr')));
    return data;
  }

  $('#form').addEventListener('submit',async e=>{
    e.preventDefault();
    const first=$('#first').value.trim(),last=$('#last').value.trim(),phone=$('#phone').value.replace(/\s/g,''),level=$('#level').value;
    let ok=true;
    const set=(id,bad,msg)=>{$('#e_'+id).textContent=bad?msg:'';$('#'+id).classList.toggle('bad',bad);if(bad)ok=false;};
    set('first',!nameRe.test(first),t('v_name'));set('last',!nameRe.test(last),t('v_name'));set('phone',!/^05\d{9}$/.test(phone),t('v_phone'));set('level',!level,t('v_level'));
    if(!ok)return;
    student={first_name:first,last_name:last,phone,level,topic:$('#topic').value.trim()};
    $('#toStep2').disabled=true;
    try{cfg=await fetchConfig();}
    catch(err){toast(err.message||t('netErr'),true);$('#toStep2').disabled=false;return;}
    $('#toStep2').disabled=false;selected.clear();renderSchedule(false);showStep(2);
  });
  $('#back1').onclick=()=>showStep(1);
  $('#again').onclick=()=>location.reload();

  function allowedLevels(){
    const i=LEVELS.indexOf(student.level),a=[student.level];
    if(cfg.level_rule==='all')return LEVELS;
    if((cfg.level_rule==='own_next'||cfg.level_rule==='own_adjacent')&&LEVELS[i+1])a.push(LEVELS[i+1]);
    if(cfg.level_rule==='own_adjacent'&&LEVELS[i-1])a.unshift(LEVELS[i-1]);
    return a;
  }
  const slotAllowed=s=>String(s.level||'').split(/[-/,\s]+/).some(l=>allowedLevels().includes(l));
  const available=s=>slotAllowed(s)&&!s.cancelled&&!s.full;

  function pruneSelections(notify=true){
    if(!cfg||!student)return false;
    const valid=new Set(cfg.slots.filter(available).map(s=>Number(s.id)));
    let changed=false;
    for(const id of [...selected])if(!valid.has(Number(id))){selected.delete(id);changed=true;}
    if(changed&&notify)toast(t('changed'),true);
    return changed;
  }

  function renderSchedule(notifyPrune=true){
    pruneSelections(notifyPrune);
    const allowed=allowedLevels();
    $('#p2desc').innerHTML=t('desc')(student.level,allowed,cfg.min_days_ahead);
    $('#classroom').innerHTML=`<div class="room"><span class="room-label">${t('wkday')}</span><span class="room-name">${esc(cfg.classroom_weekday)}</span></div><div class="room"><span class="room-label">${t('wkend')}</span><span class="room-name">${esc(cfg.classroom_weekend)}</span></div>`;
    const sched=$('#sched'),tabs=$('#daytabs');sched.innerHTML='';tabs.innerHTML='';
    for(let d=1;d<=7;d++){
      const col=document.createElement('div');col.className='daycol'+(d>=6?' weekend':'')+(d===activeDay?' show':'');
      const slots=cfg.slots.filter(s=>Number(s.day)===d),date=slots[0]?.next_date;
      col.innerHTML=`<div class="dayhead d${d}">${DAYS[lang][d]}<small>${date?fmtDate(date):''}</small></div>`;
      slots.forEach(s=>col.appendChild(tile(s)));sched.appendChild(col);
      const tb=document.createElement('button');tb.type='button';tb.className=d===activeDay?'on':'';tb.innerHTML=`${DAYS[lang][d].slice(0,3)}${slots.some(s=>selected.has(Number(s.id)))?'<span class="dot"></span>':''}`;tb.onclick=()=>{activeDay=d;renderSchedule(false);};tabs.appendChild(tb);
    }
    $('#selCount').textContent=t('sel')(selected.size);$('#submit').disabled=!selected.size;
  }

  function tile(s){
    const b=document.createElement('button'),ok=slotAllowed(s),id=Number(s.id);b.type='button';
    b.className='tile'+(s.cancelled?' cancel':!ok?' lock':s.full?' full':'')+(selected.has(id)?' on':'');b.setAttribute('aria-pressed',selected.has(id));
    const place=s.classroom||'';
    b.innerHTML=`<span class="time">${s.start_time}–${s.end_time}</span><span class="lvl">${esc(s.level)}</span><span class="meta">${esc(place)}</span><span class="capacity-mini">${esc(t('capacity')(s.booked||0,s.capacity||0))}</span>`;
    b.onclick=()=>{if(s.cancelled)return modal(t('cancelT'),esc(s.cancel_note||t('cancelB')));if(!ok)return modal(t('lockT'),t('lockB'));if(s.full)return modal(t('fullT'),t('fullB'));selected.has(id)?selected.delete(id):selected.add(id);renderSchedule(false);};
    return b;
  }

  $('#submit').onclick=async()=>{
    const btn=$('#submit'),old=btn.innerHTML;btn.disabled=true;btn.textContent=t('sending');
    try{
      const r=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...student,slot_ids:[...selected]})});
      const data=await r.json().catch(()=>({}));
      if(!r.ok){toast(apiErrorText(data,t('netErr')),true);cfg=await fetchConfig();renderSchedule(true);btn.innerHTML=old;btn.disabled=false;return;}
      $('#doneNote').textContent=t('done')(`${student.first_name} ${student.last_name}`);
      $('#summary').innerHTML=(data.summary||[]).map(s=>`<div class="row"><span class="lv">${esc(s.level)}</span><span class="dt">${lang==='tr'?s.day_tr:s.day_en} · ${fmtDate(s.date)} · ${s.start_time}–${s.end_time}<small>${esc([s.classroom,s.teacher_name?`${t('teacher')}: ${s.teacher_name}`:''].filter(Boolean).join(' · '))}</small></span></div>`).join('');
      showStep(3);
    }catch(err){toast(err.message||t('netErr'),true);btn.innerHTML=old;btn.disabled=false;}
  };

  async function pollConfig(){
    if(currentStep!==2||pollBusy||!student||!cfg)return;
    pollBusy=true;
    try{const latest=await fetchConfig();if(Number(latest.revision)!==Number(cfg.revision)){cfg=latest;renderSchedule(true);}}
    catch{}
    finally{pollBusy=false;schedulePoll();}
  }
  function schedulePoll(){clearTimeout(pollTimer);if(currentStep===2)pollTimer=setTimeout(pollConfig,18000);}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&currentStep===2){clearTimeout(pollTimer);pollTimer=setTimeout(pollConfig,250);}});

  let tt;
  function toast(msg,bad=false){const el=$('#toast');el.textContent=msg;el.className='toast show'+(bad?' bad':'');clearTimeout(tt);tt=setTimeout(()=>el.classList.remove('show'),4200);}
  function modal(title,body){$('#mTitle').textContent=title;$('#mBody').innerHTML=body;$('#modalBg').classList.add('show');}
  $('#mClose').onclick=()=>$('#modalBg').classList.remove('show');
  $('#modalBg').onclick=e=>{if(e.target===e.currentTarget)$('#modalBg').classList.remove('show');};
  applyLang();
})();
