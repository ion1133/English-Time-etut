(() => {
  const $ = s => document.querySelector(s);
  const DAYS = {
    tr:['','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'],
    en:['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
  };
  const I18N = {
    tr:{tag:'Language Schools & Overseas Education',mypanel:'Etütlerim',teacherlink:'Öğretmen misiniz?',s1:'Bilgileriniz',s2:'Etüt seçimi',s3:'Onay',e1:'Etüt kaydı',h1:'Anlamadığın konuyu etüt ile telafi et.',p1:'Bilgilerini gir, kursunu ve seviyeni seç. Kayıttan sonra etütlerini öğrenci panelinden takip edebilirsin.',fn:'Ad',ln:'Soyad',ph:'Telefon',phs:'05XX XXX XX XX',category:'Kategori / Kurs',categoryPlaceholder:'Kategori seç',lv:'Şu an okuduğun seviye',lvp:'Seviye seç',noLevel:'Seviye gerekmiyor',tp:'Sormak istediğin konu',tps:'İsteğe bağlı',tpph:'Örn: Present perfect, relative clauses…',next:'Etüt saatlerine geç',e2:'Haftalık etüt programı',h2:'Katılmak istediğin etütleri seç.',lg1:'Seçilebilir',lg2:'Seçildi',lg3:'Seviyene uygun değil / dolu',lg4:'İptal edildi',back:'Geri',submit:'Kaydı tamamla',h3:'Kaydın alındı!',remind:'Lütfen etüt saatinden 5 dakika önce sınıfta ol.',again:'Yeni kayıt',panelgo:'Etütlerimi görüntüle →',ok:'Tamam',v_name:'Geçerli bir ad gir (en az 2 karakter).',v_phone:'05 ile başlayan 11 haneli numara gir.',v_category:'Kategori seç.',v_level:'Seviyeni seç.',sel:n=>n?`${n} etüt seçildi`:'Henüz seçim yok',desc:(cat,lvl,a,d)=>`${cat}${lvl?` · <b>${lvl}</b>`:''}. Seçebileceğin seviyeler: <b>${a.length?a.join(', '):'Seviyesiz'}</b>. En erken <b>${d===1?'yarın':d+' gün sonra'}</b>ki etütlere kayıt olabilirsin.`,cancelT:'Bu etüt iptal edildi',cancelB:'Bu etüt Eğitim Koordinatörü tarafından iptal edilmiştir.',lockT:'Seçilemez',lockB:'Bu etüt seçtiğin kategori/seviyeye uygun değil.',fullT:'Etüt dolu',fullB:'Bu etüt için kontenjan dolmuştur.',wkday:'Hafta içi sınıf',wkend:'Hafta sonu sınıf',sending:'Kaydediliyor…',done:name=>`${name}, kaydın oluşturuldu. Etütlerini öğrenci panelinden canlı olarak takip edebilirsin.`,netErr:'Bağlantı hatası, tekrar dene.',teacher:'Öğretmen',capacity:(b,c)=>c>0?`${b}/${c} dolu`:`${b} kayıt`,changed:'Program veya kategori bilgisi değişti. Artık uygun olmayan seçimler kaldırıldı.'},
    en:{tag:'Language Schools & Overseas Education',mypanel:'My etüts',teacherlink:'Are you a teacher?',s1:'Your details',s2:'Pick etüts',s3:'Done',e1:'Etüt registration',h1:'Catch up on what you did not understand.',p1:'Enter your details, choose your course and level, then track everything from your student panel.',fn:'First name',ln:'Last name',ph:'Phone',phs:'05XX XXX XX XX',category:'Category / Course',categoryPlaceholder:'Select category',lv:'Your current level',lvp:'Select level',noLevel:'No level required',tp:'Topic you want to ask about',tps:'Optional',tpph:'e.g. Present perfect, relative clauses…',next:'Choose etüt times',e2:'Weekly etüt schedule',h2:'Select the etüts you want to attend.',lg1:'Available',lg2:'Selected',lg3:'Not your level / full',lg4:'Cancelled',back:'Back',submit:'Complete registration',h3:"You're registered!",remind:'Please be in the classroom 5 minutes before the etüt starts.',again:'New registration',panelgo:'View my etüts →',ok:'OK',v_name:'Enter a valid name (at least 2 characters).',v_phone:'Enter an 11-digit number starting with 05.',v_category:'Select a category.',v_level:'Select your level.',sel:n=>n?`${n} selected`:'Nothing selected yet',desc:(cat,lvl,a,d)=>`${cat}${lvl?` · <b>${lvl}</b>`:''}. Eligible levels: <b>${a.length?a.join(', '):'No level'}</b>. Earliest booking: <b>${d===1?'tomorrow':d+' days ahead'}</b>.`,cancelT:'This etüt is cancelled',cancelB:'This etüt has been cancelled by the Educational Coordinator.',lockT:'Not available',lockB:'This etüt is not available for the selected category/level.',fullT:'Etüt is full',fullB:'This etüt has reached capacity.',wkday:'Weekday classroom',wkend:'Weekend classroom',sending:'Saving…',done:name=>`${name}, your registration is complete. You can track live changes from your student panel.`,netErr:'Connection problem, please try again.',teacher:'Teacher',capacity:(b,c)=>c>0?`${b}/${c} filled`:`${b} booked`,changed:'The schedule or course information changed. Selections that are no longer available were removed.'}
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

  function activeCategories(){ return (cfg?.categories || []).filter(c=>c.active); }
  function selectedCategory(){ return activeCategories().find(c=>Number(c.id)===Number($('#category').value)); }
  function selectedLevel(){ const c=selectedCategory(); return c?.requires_level ? (c.levels||[]).find(l=>l.active&&Number(l.id)===Number($('#level').value)) : null; }
  function renderLevels(preserve=true){
    const el=$('#level'),c=selectedCategory(),previous=preserve?el.value:'';
    if(!c){el.disabled=true;el.required=true;el.innerHTML=`<option value="">${esc(t('lvp'))}</option>`;return;}
    if(!c.requires_level){el.disabled=true;el.required=false;el.innerHTML=`<option value="">${esc(t('noLevel'))}</option>`;return;}
    const levels=(c.levels||[]).filter(l=>l.active);
    el.disabled=false;el.required=true;el.innerHTML=`<option value="">${esc(t('lvp'))}</option>`+levels.map(l=>`<option value="${l.id}">${esc(lang==='tr'?l.label_tr:l.label_en)}</option>`).join('');
    if(levels.some(l=>String(l.id)===String(previous)))el.value=previous;
  }
  function renderCatalog(preserve=true){
    if(!cfg)return;const el=$('#category'),previous=preserve?el.value:'';
    const cats=activeCategories();
    el.innerHTML=`<option value="">${esc(t('categoryPlaceholder'))}</option>`+cats.map(c=>`<option value="${c.id}">${esc(lang==='tr'?c.name_tr:c.name_en)}</option>`).join('');
    if(cats.some(c=>String(c.id)===String(previous)))el.value=previous;
    renderLevels(preserve);
  }

  function applyLang(){
    document.documentElement.lang=lang;
    document.querySelectorAll('[data-i18n]').forEach(el=>{const v=t(el.dataset.i18n);if(typeof v==='string')el.textContent=v;});
    document.querySelectorAll('[data-i18n-ph]').forEach(el=>el.placeholder=t(el.dataset.i18nPh));
    document.querySelectorAll('.lang button').forEach(b=>b.classList.toggle('on',b.dataset.lang===lang));
    renderCatalog(true);
    if(cfg&&student)renderSchedule(false);
  }
  document.querySelectorAll('.lang button').forEach(b=>b.onclick=()=>{lang=b.dataset.lang;localStorage.setItem('et_lang',lang);applyLang();});
  $('#category').onchange=()=>{selected.clear();renderLevels(false);};

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
    window.scrollTo({top:0,behavior:'smooth'});schedulePoll();
  }

  function apiErrorText(data,fallback){ return data?.request_id ? `${data.error||fallback} (Ref: ${data.request_id})` : (data?.error||fallback); }
  async function fetchConfig(){
    const r=await fetch('/api/config',{cache:'no-store'});const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(apiErrorText(data,t('netErr')));return data;
  }

  $('#form').addEventListener('submit',async e=>{
    e.preventDefault();
    const first=$('#first').value.trim(),last=$('#last').value.trim(),phone=$('#phone').value.replace(/\s/g,''),categoryId=Number($('#category').value),levelId=Number($('#level').value)||null;
    let ok=true;
    const set=(id,bad,msg)=>{$('#e_'+id).textContent=bad?msg:'';$('#'+id).classList.toggle('bad',bad);if(bad)ok=false;};
    const cat=selectedCategory(),level=selectedLevel();
    set('first',!nameRe.test(first),t('v_name'));set('last',!nameRe.test(last),t('v_name'));set('phone',!/^05\d{9}$/.test(phone),t('v_phone'));
    set('category',!cat,t('v_category'));set('level',!!cat?.requires_level&&!level,t('v_level'));
    if(!ok)return;
    $('#toStep2').disabled=true;
    try{
      const previousCategory=categoryId,previousLevel=levelId;cfg=await fetchConfig();renderCatalog(false);$('#category').value=String(previousCategory);renderLevels(false);if(previousLevel)$('#level').value=String(previousLevel);
      const freshCat=selectedCategory(),freshLevel=selectedLevel();
      if(!freshCat||freshCat.requires_level&&!freshLevel)throw new Error(t('changed'));
      student={first_name:first,last_name:last,phone,category_id:Number(freshCat.id),level_id:freshLevel?Number(freshLevel.id):null,level:freshLevel?.code||'',topic:$('#topic').value.trim()};
    }catch(err){toast(err.message||t('netErr'),true);$('#toStep2').disabled=false;return;}
    $('#toStep2').disabled=false;selected.clear();renderSchedule(false);showStep(2);
  });
  $('#back1').onclick=()=>showStep(1);$('#again').onclick=()=>location.reload();

  function course(){return activeCategories().find(c=>Number(c.id)===Number(student?.category_id));}
  function primaryLevel(){const c=course();return c?.requires_level?(c.levels||[]).find(l=>Number(l.id)===Number(student?.level_id)):null;}
  function allowedLevelIds(){
    const c=course();if(!c?.requires_level)return new Set();
    const levels=(c.levels||[]).filter(l=>l.active).sort((a,b)=>Number(a.sort_order)-Number(b.sort_order)||Number(a.id)-Number(b.id));
    const i=levels.findIndex(l=>Number(l.id)===Number(student.level_id));if(i<0)return new Set();
    if(cfg.level_rule==='all')return new Set(levels.map(l=>Number(l.id)));
    const out=new Set([Number(levels[i].id)]);
    if((cfg.level_rule==='own_next'||cfg.level_rule==='own_adjacent')&&levels[i+1])out.add(Number(levels[i+1].id));
    if(cfg.level_rule==='own_adjacent'&&levels[i-1])out.add(Number(levels[i-1].id));
    return out;
  }
  const slotAllowed=s=>{
    const c=course();if(!c||Number(s.category_id)!==Number(c.id))return false;if(!c.requires_level)return true;
    const allowed=allowedLevelIds();return (s.level_ids||[]).some(id=>allowed.has(Number(id)));
  };
  const available=s=>slotAllowed(s)&&!s.cancelled&&!s.full;

  function pruneSelections(notify=true){
    if(!cfg||!student)return false;const valid=new Set(cfg.slots.filter(available).map(s=>Number(s.id)));let changed=false;
    for(const id of [...selected])if(!valid.has(Number(id))){selected.delete(id);changed=true;}if(changed&&notify)toast(t('changed'),true);return changed;
  }

  function renderSchedule(notifyPrune=true){
    pruneSelections(notifyPrune);const c=course(),level=primaryLevel(),allowed=allowedLevelIds();
    const allowedLabels=c?.requires_level?(c.levels||[]).filter(l=>allowed.has(Number(l.id))).map(l=>l.code):[];
    $('#p2desc').innerHTML=t('desc')(esc(lang==='tr'?c?.name_tr||'':c?.name_en||''),esc(level?.code||''),allowedLabels.map(esc),cfg.min_days_ahead);
    $('#classroom').innerHTML=`<div class="room"><span class="room-label">${t('wkday')}</span><span class="room-name">${esc(cfg.classroom_weekday)}</span></div><div class="room"><span class="room-label">${t('wkend')}</span><span class="room-name">${esc(cfg.classroom_weekend)}</span></div>`;
    const sched=$('#sched'),tabs=$('#daytabs');sched.innerHTML='';tabs.innerHTML='';
    for(let d=1;d<=7;d++){
      const col=document.createElement('div');col.className='daycol'+(d>=6?' weekend':'')+(d===activeDay?' show':'');
      const slots=cfg.slots.filter(s=>Number(s.category_id)===Number(student.category_id)&&Number(s.day)===d),date=slots[0]?.next_date;
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
    b.onclick=()=>{if(s.cancelled)return modal(t('cancelT'),esc(s.cancel_note||t('cancelB')));if(!ok)return modal(t('lockT'),t('lockB'));if(s.full)return modal(t('fullT'),t('fullB'));selected.has(id)?selected.delete(id):selected.add(id);renderSchedule(false);};return b;
  }

  $('#submit').onclick=async()=>{
    const btn=$('#submit'),old=btn.innerHTML;btn.disabled=true;btn.textContent=t('sending');
    try{
      const r=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...student,slot_ids:[...selected]})});
      const data=await r.json().catch(()=>({}));
      if(!r.ok){toast(apiErrorText(data,t('netErr')),true);cfg=await fetchConfig();renderSchedule(true);btn.innerHTML=old;btn.disabled=false;return;}
      $('#doneNote').textContent=t('done')(`${student.first_name} ${student.last_name}`);
      $('#summary').innerHTML=(data.summary||[]).map(s=>`<div class="row"><span class="lv">${esc(s.level)}</span><span class="dt">${lang==='tr'?s.day_tr:s.day_en} · ${fmtDate(s.date)} · ${s.start_time}–${s.end_time}<small>${esc([s.classroom,s.teacher_name?`${t('teacher')}: ${s.teacher_name}`:''].filter(Boolean).join(' · '))}</small></span></div>`).join('');showStep(3);
    }catch(err){toast(err.message||t('netErr'),true);btn.innerHTML=old;btn.disabled=false;}
  };

  async function pollConfig(){
    if(currentStep!==2||pollBusy||!student||!cfg)return;pollBusy=true;
    try{const latest=await fetchConfig();if(Number(latest.revision)!==Number(cfg.revision)){cfg=latest;renderSchedule(true);}}
    catch{}finally{pollBusy=false;schedulePoll();}
  }
  function schedulePoll(){clearTimeout(pollTimer);if(currentStep===2)pollTimer=setTimeout(pollConfig,18000);}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&currentStep===2){clearTimeout(pollTimer);pollTimer=setTimeout(pollConfig,250);}});

  let tt;function toast(msg,bad=false){const el=$('#toast');el.textContent=msg;el.className='toast show'+(bad?' bad':'');clearTimeout(tt);tt=setTimeout(()=>el.classList.remove('show'),4200);}
  function modal(title,body){$('#mTitle').textContent=title;$('#mBody').innerHTML=body;$('#modalBg').classList.add('show');}
  $('#mClose').onclick=()=>$('#modalBg').classList.remove('show');$('#modalBg').onclick=e=>{if(e.target===e.currentTarget)$('#modalBg').classList.remove('show');};

  applyLang();
  fetchConfig().then(data=>{cfg=data;renderCatalog(false);}).catch(err=>toast(err.message||t('netErr'),true));
})();
