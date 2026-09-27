(() => {
  const $=s=>document.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const DAYS={tr:['','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'],en:['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']};
  const I18N={
    tr:{pageTitle:'Öğrenci Paneli · English Time',sub:'Öğrenci Paneli',newEtut:'+ Yeni Etüt',logout:'Çıkış',notificationsAria:'Bildirimler',themeAria:'Tema',loginEyebrow:'Öğrenci girişi',loginTitle:'Etütlerime eriş',loginNote:'İlk etüt kaydında kullandığın bilgilerle giriş yap. Şifre gerekmez.',firstName:'Ad',lastName:'Soyad',phone:'Telefon',level:'Seviye',select:'Seç',firstRegistration:'İlk kaydımı oluştur',loginBtn:'Giriş yap',panelEyebrow:'Öğrenci Paneli',heroNote:'Program değişiklikleri bu ekrana otomatik olarak yansır.',overview:'Genel Bakış',takeEtut:'Etüt Al',myEtuts:'Etütlerim',profile:'Profil',upcomingEtuts:'Yaklaşan etütler',nextSchedule:'Bir sonraki programın',viewAll:'Tümünü gör',recentNotifications:'Son bildirimler',weeklySchedule:'Haftalık program',scheduleNote:'Seviyene uygun, boş etütleri seçebilirsin.',thisWeek:'Bu hafta',legendRecommended:'Seviyen için önerilen',legendSelected:'Seçildi',topicPlaceholder:'Sormak istediğin konu (isteğe bağlı)',saveSelected:'Seçilenleri kaydet',mineNote:'Yaklaşan, tamamlanan ve iptal edilen kayıtların.',upcoming:'Yaklaşan',completed:'Tamamlanan',cancelled:'İptal',yourDetails:'Bilgilerin',saveName:'Ad-soyadı kaydet',phoneChange:'Telefon değişikliği',adminApproval:'Yönetici onayı gerekir',phoneNote:'Yeni numara onaylanana kadar mevcut numaran geçerli kalır.',newPhone:'Yeni telefon',sendApproval:'Onaya gönder',notifications:'Bildirimler',updates:'Güncellemeler',confirm:'Onay',giveUp:'Vazgeç',approve:'Onayla',hello:n=>`Merhaba, ${n}`,statUpcoming:'Yaklaşan etüt',statCompleted:'Tamamlanan',statCancelled:'İptal edilen',statUnread:'Okunmamış bildirim',statusUpcoming:'Yaklaşan',statusCompleted:'Tamamlandı',statusAdminCancelled:'Koordinatör iptal etti',statusCancelled:'İptal edildi',noClassroom:'Sınıf belirtilmedi',capacity:'Kontenjan',cancelBooking:'Kaydımı iptal et',noUpcoming:'Yaklaşan etütün yok. Yeni bir etüt seçebilirsin.',selectedCount:n=>`${n} seçildi`,alreadyBooked:'Zaten kayıtlı',cancelledBefore:'Daha önce iptal ettin · tekrar seçilebilir',slotCancelled:'İptal',slotCompleted:'Tamamlandı',slotFull:'Dolu',slotCapacity:n=>`Kontenjan ${n}`,alreadyBookedToast:'Bu etüte zaten kayıtlısın.',cancelledToast:'Bu etüt iptal edildi.',fullToast:'Etüt dolu.',levelToast:'Bu etüt seviyene uygun değil.',dateClosedToast:'Bu tarih kayıt için kapalı.',saved:n=>`${n} etüt kaydedildi.`,emptyCategory:'Bu kategoride kayıt yok.',cancelTitle:'Etüt kaydını iptal et',cancelBody:(d,time,level)=>`${d} ${time} ${level} kaydın iptal edilecek ve kontenjan hemen boşalacak.`,cancelledDone:'Etüt kaydın iptal edildi.',noNotifications:'Yeni bildirim yok.',loadOlder:'Daha eski bildirimleri yükle',noOlder:'Daha eski bildirim yok.',profileSaved:'Profil güncellendi.',phoneSent:'Telefon değişikliği yönetici onayına gönderildi.',phonePending:p=>`${p} için onay bekleniyor.`,scheduleChanged:'Program değişti. Artık uygun olmayan seçimler kaldırıldı.',loginRequired:'Giriş gerekli',actionFailed:'İşlem başarısız.',recommendedTitle:'Seviyen için önerilen etüt'},
    en:{pageTitle:'Student Panel · English Time',sub:'Student Panel',newEtut:'+ New Etüt',logout:'Log out',notificationsAria:'Notifications',themeAria:'Theme',loginEyebrow:'Student login',loginTitle:'Access my etüts',loginNote:'Log in with the details you used for your first etüt registration. No password is required.',firstName:'First name',lastName:'Last name',phone:'Phone',level:'Level',select:'Select',firstRegistration:'Create my first registration',loginBtn:'Log in',panelEyebrow:'Student Panel',heroNote:'Schedule changes are reflected here automatically.',overview:'Overview',takeEtut:'Book Etüt',myEtuts:'My Etüts',profile:'Profile',upcomingEtuts:'Upcoming etüts',nextSchedule:'Your next schedule',viewAll:'View all',recentNotifications:'Recent notifications',weeklySchedule:'Weekly schedule',scheduleNote:'Choose available etüts that match your level.',thisWeek:'This week',legendRecommended:'Recommended for your level',legendSelected:'Selected',topicPlaceholder:'Topic you want to ask about (optional)',saveSelected:'Save selected',mineNote:'Your upcoming, completed and cancelled registrations.',upcoming:'Upcoming',completed:'Completed',cancelled:'Cancelled',yourDetails:'Your details',saveName:'Save name',phoneChange:'Phone change',adminApproval:'Administrator approval required',phoneNote:'Your current number remains valid until the new number is approved.',newPhone:'New phone',sendApproval:'Send for approval',notifications:'Notifications',updates:'Updates',confirm:'Confirm',giveUp:'Back',approve:'Confirm',hello:n=>`Hello, ${n}`,statUpcoming:'Upcoming etüts',statCompleted:'Completed',statCancelled:'Cancelled',statUnread:'Unread notifications',statusUpcoming:'Upcoming',statusCompleted:'Completed',statusAdminCancelled:'Cancelled by coordinator',statusCancelled:'Cancelled',noClassroom:'Classroom not specified',capacity:'Capacity',cancelBooking:'Cancel my booking',noUpcoming:'You have no upcoming etüts. You can choose a new one.',selectedCount:n=>`${n} selected`,alreadyBooked:'Already booked',cancelledBefore:'Previously cancelled · can be selected again',slotCancelled:'Cancelled',slotCompleted:'Completed',slotFull:'Full',slotCapacity:n=>`Capacity ${n}`,alreadyBookedToast:'You are already registered for this etüt.',cancelledToast:'This etüt has been cancelled.',fullToast:'This etüt is full.',levelToast:'This etüt is not available for your level.',dateClosedToast:'This date is closed for booking.',saved:n=>`${n} etüt(s) saved.`,emptyCategory:'No registrations in this category.',cancelTitle:'Cancel etüt booking',cancelBody:(d,time,level)=>`${d} ${time} ${level} will be cancelled and the seat will become available immediately.`,cancelledDone:'Your etüt booking was cancelled.',noNotifications:'No new notifications.',loadOlder:'Load older notifications',noOlder:'No older notifications.',profileSaved:'Profile updated.',phoneSent:'Phone change sent for administrator approval.',phonePending:p=>`${p} is awaiting approval.`,scheduleChanged:'The schedule changed. Selections that are no longer available were removed.',loginRequired:'Login required',actionFailed:'Action failed.',recommendedTitle:'Recommended for your level'}
  };
  let lang=localStorage.getItem('et_student_lang')||'tr';
  let D=null,week=null,selected=new Map(),activeDay=1,mineFilter='upcoming',profileDirty=false;
  let pollTimer=null,pollBusy=false,syncState=null,lastNotificationId=0;
  const t=k=>I18N[lang][k];

  const fmtDate=s=>{const [y,m,d]=String(s).slice(0,10).split('-');return`${d}.${m}.${y}`;};
  const short=s=>fmtDate(s).slice(0,5);
  const fmtTs=s=>{try{return new Intl.DateTimeFormat(lang==='tr'?'tr-TR':'en-GB',{timeZone:'Europe/Istanbul',dateStyle:'short',timeStyle:'short'}).format(new Date(s));}catch{return String(s||'');}};
  const addDays=(s,n)=>{const [y,m,d]=s.split('-').map(Number),x=new Date(Date.UTC(y,m-1,d));x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
  const errorText=(d,f)=>d?.request_id?`${d.error||f||t('actionFailed')} (Ref: ${d.request_id})`:(d?.error||f||t('actionFailed'));

  function applyLang(){
    document.documentElement.lang=lang;document.title=t('pageTitle');
    document.querySelectorAll('[data-i18n]').forEach(el=>{const v=t(el.dataset.i18n);if(typeof v==='string')el.textContent=v;});
    document.querySelectorAll('[data-i18n-ph]').forEach(el=>{const v=t(el.dataset.i18nPh);if(typeof v==='string')el.placeholder=v;});
    document.querySelectorAll('[data-i18n-aria]').forEach(el=>{const v=t(el.dataset.i18nAria);if(typeof v==='string')el.setAttribute('aria-label',v);});
    document.querySelectorAll('#studentLang button').forEach(b=>b.classList.toggle('on',b.dataset.lang===lang));
    if(D)render();
  }
  document.querySelectorAll('#studentLang button').forEach(b=>b.onclick=()=>{lang=b.dataset.lang;localStorage.setItem('et_student_lang',lang);applyLang();});

  async function api(url,method='GET',body){
    const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:method==='GET'?'no-store':'default'});
    const d=await r.json().catch(()=>({}));
    if(r.status===401&&url!=='/api/student/login'){showLogin();throw Object.assign(new Error('login'),{status:401,data:d});}
    if(!r.ok)throw Object.assign(new Error(errorText(d)),{status:r.status,data:d});
    return d;
  }

  let tt;
  function toast(m,bad=false){const e=$('#toast');e.textContent=m;e.className='toast show'+(bad?' bad':'');clearTimeout(tt);tt=setTimeout(()=>e.classList.remove('show'),4500);}
  function setTheme(v){document.documentElement.dataset.theme=v;localStorage.setItem('et_theme',v);}
  setTheme(localStorage.getItem('et_theme')||'light');
  $('#themeBtn').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');

  function stopPolling(){clearTimeout(pollTimer);pollTimer=null;pollBusy=false;}
  function showLogin(){$('#login').classList.remove('hidden');$('#panel').classList.add('hidden');$('#logout').classList.add('hidden');$('#notifBtn').classList.add('hidden');stopPolling();}
  function showPanel(){$('#login').classList.add('hidden');$('#panel').classList.remove('hidden');$('#logout').classList.remove('hidden');$('#notifBtn').classList.remove('hidden');}

  async function start(){const me=await api('/api/student/me');if(!me.student)return showLogin();showPanel();await load(false);startPolling();}
  $('#loginBtn').onclick=async()=>{try{await api('/api/student/login','POST',{first_name:$('#lFirst').value.trim(),last_name:$('#lLast').value.trim(),phone:$('#lPhone').value,level:$('#lLevel').value});$('#loginErr').textContent='';showPanel();await load(false);startPolling();}catch(e){$('#loginErr').textContent=e.message==='login'?t('loginRequired'):e.message;}};
  $('#logout').onclick=async()=>{await fetch('/api/student/logout',{method:'POST'});location.reload();};

  $('#tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>goTab(b.dataset.tab));
  document.querySelectorAll('[data-go]').forEach(a=>a.onclick=e=>{e.preventDefault();goTab(a.dataset.go);});
  function goTab(name){$('#tabs').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.tab===name));document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('hidden',t.id!=='tab-'+name));}

  function currentMaxNotificationId(){return Math.max(0,...((D?.notifications)||[]).map(n=>Number(n.id)||0));}
  function alertNewImportant(oldMax){const important=(D?.notifications||[]).filter(n=>Number(n.id)>oldMax&&!n.read&&['cancellation','schedule','account','security'].includes(String(n.kind||'')));if(important.length){const n=important[0];toast(`${n.title}: ${n.body}`,n.kind==='cancellation'||n.kind==='security');}}
  function pruneSelections(notify=false){
    if(!D?.week?.slots)return;
    const valid=new Set(D.week.slots.filter(s=>s.bookable).map(s=>`${s.id}|${s.date}`));let changed=false;
    for(const key of [...selected.keys()])if(!valid.has(key)){selected.delete(key);changed=true;}
    if(changed&&notify)toast(t('scheduleChanged'),true);
  }

  async function load(silent=false,{selectionNotice=false}={}){
    try{
      const oldMax=lastNotificationId||currentMaxNotificationId();
      D=await api('/api/student/dashboard'+(week?'?week='+encodeURIComponent(week):''));week=D.week.week_start;
      pruneSelections(selectionNotice);render();
      alertNewImportant(oldMax);lastNotificationId=currentMaxNotificationId();
      syncState=await api('/api/student/sync-state');
    }catch(e){if(e.message!=='login'&&!silent)toast(e.message,true);}
  }

  function startPolling(){stopPolling();pollTimer=setTimeout(pollOnce,15000);}
  async function pollOnce(){
    if(document.hidden){pollTimer=setTimeout(pollOnce,15000);return;}
    if(pollBusy){pollTimer=setTimeout(pollOnce,3000);return;}
    pollBusy=true;
    try{const next=await api('/api/student/sync-state');const changed=!syncState||['schedule_revision','booking_revision','account_revision','notification_revision'].some(k=>Number(next[k]||0)!==Number(syncState[k]||0));if(changed)await load(true,{selectionNotice:Number(next.schedule_revision||0)!==Number(syncState?.schedule_revision||0)});else syncState=next;}catch(e){if(e.message!=='login'){} }
    finally{pollBusy=false;pollTimer=setTimeout(pollOnce,15000);}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&$('#panel')&&!$('#panel').classList.contains('hidden')){clearTimeout(pollTimer);pollTimer=setTimeout(pollOnce,250);}});

  function render(){
    $('#hello').textContent=t('hello')(D.student.first_name);$('#levelOrb').textContent=D.student.level;
    renderStats();renderHome();renderSchedule();renderMine();renderNotifications();
    if(!profileDirty){$('#pFirst').value=D.student.first_name;$('#pLast').value=D.student.last_name;$('#pPhone').value=D.student.phone;$('#pLevel').value=D.student.level;}
    const pr=D.phone_request;if(pr){$('#phoneReq').classList.remove('hidden');$('#phoneReq').textContent=t('phonePending')(pr.new_phone);}else $('#phoneReq').classList.add('hidden');
  }
  function renderStats(){
    const up=D.bookings.filter(x=>x.state==='upcoming'),done=D.bookings.filter(x=>x.state==='completed'),cx=D.bookings.filter(x=>x.state.startsWith('cancelled'));
    $('#stats').innerHTML=[[up.length,t('statUpcoming')],[done.length,t('statCompleted')],[cx.length,t('statCancelled')],[D.notifications.filter(n=>!n.read).length,t('statUnread')]].map(([v,l])=>`<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  }
  function bookingCard(b,compact=false){
    const cap=Number(b.capacity||0),pct=cap?Math.min(100,Math.round((b.booked||0)/cap*100)):0;
    const status=b.state==='upcoming'?t('statusUpcoming'):b.state==='completed'?t('statusCompleted'):b.state==='cancelled_by_admin'?t('statusAdminCancelled'):t('statusCancelled');
    return `<article class="booking-card ${b.state}"><div class="booking-main"><div class="date-chip"><b>${short(b.slot_date)}</b><span>${DAYS[lang][b.day]?.slice(0,3)}</span></div><div><div class="inline"><span class="tag y">${esc(b.level)}</span><span class="tag">${esc(status)}</span></div><h3>${esc(b.start_time)}–${esc(b.end_time)}</h3><p>${esc(b.classroom||t('noClassroom'))}${b.teacher_name?' · '+esc(b.teacher_name):''}</p>${b.occurrence_cancel_note?`<p class="danger-text">${esc(b.occurrence_cancel_note)}</p>`:''}</div></div>${cap?`<div class="capacity-viz"><div><span>${esc(t('capacity'))}</span><b>${b.booked}/${cap}</b></div><div class="progress"><i style="width:${pct}%"></i></div></div>`:''}${!compact&&b.state==='upcoming'?`<button class="btn danger sm" data-cancel="${b.id}">${esc(t('cancelBooking'))}</button>`:''}</article>`;
  }
  function renderHome(){
    const up=D.bookings.filter(x=>x.state==='upcoming').sort((a,b)=>(a.slot_date+a.start_time).localeCompare(b.slot_date+b.start_time)).slice(0,3);
    $('#nextBookings').innerHTML=up.length?up.map(b=>bookingCard(b,true)).join(''):`<div class="empty">${esc(t('noUpcoming'))}</div>`;
    $('#homeNotifs').innerHTML=notifHtml(D.notifications.slice(0,5));bindNotificationButtons($('#homeNotifs'));
  }

  function isRecommended(s){
    if(!s.bookable||!D?.student?.level)return false;
    return String(s.level||'').toUpperCase().split(/[-/,\s]+/).filter(Boolean).includes(String(D.student.level).toUpperCase());
  }
  function renderSchedule(){
    $('#weekLabel').textContent=`${fmtDate(D.week.week_start)} – ${fmtDate(D.week.week_end)}`;
    const el=$('#sSchedule'),tabs=$('#sDayTabs');el.innerHTML='';tabs.innerHTML='';
    for(let d=1;d<=7;d++){
      const date=addDays(D.week.week_start,d-1),items=D.week.slots.filter(s=>s.date===date),col=document.createElement('div');
      col.className='daycol'+(d>=6?' weekend':'')+(d===activeDay?' show':'');col.innerHTML=`<div class="dayhead d${d}">${DAYS[lang][d]}<small>${short(date)}</small></div>`;
      items.forEach(s=>col.appendChild(slotTile(s)));el.appendChild(col);
      const tb=document.createElement('button');tb.type='button';tb.className=d===activeDay?'on':'';tb.innerHTML=`${DAYS[lang][d].slice(0,3)}${items.some(s=>selected.has(`${s.id}|${s.date}`))?'<span class="dot"></span>':''}`;tb.onclick=()=>{activeDay=d;renderSchedule();};tabs.appendChild(tb);
    }
    $('#selectedCount').textContent=t('selectedCount')(selected.size);$('#bookBtn').disabled=!selected.size;
  }
  function slotTile(s){
    const key=`${s.id}|${s.date}`,b=document.createElement('button');b.type='button';
    const rec=isRecommended(s),cls=s.cancelled?' cancel':s.mine_status==='active'?' mine':s.full?' full':!s.allowed?' lock':s.ended?' lock':'';b.className='tile'+cls+(rec?' recommended':'')+(selected.has(key)?' on':'');
    const cap=s.capacity>0?`${s.booked}/${s.capacity}`:`${s.booked}`;
    b.innerHTML=`${rec?`<span class="recommended-pill" title="${esc(t('recommendedTitle'))}">★</span>`:''}<span class="time">${s.start_time}–${s.end_time}</span><span class="lvl">${esc(s.level)}</span><span class="meta">${esc(s.classroom||'')}</span><span class="capacity-mini">${s.mine_status==='active'?esc(t('alreadyBooked')):s.mine_status==='cancelled_previous'?esc(t('cancelledBefore')):s.cancelled?esc(t('slotCancelled')):s.ended?esc(t('slotCompleted')):s.full?esc(t('slotFull')):esc(t('slotCapacity')(cap))}</span>`;
    b.onclick=()=>{if(!s.bookable){toast(s.mine_status==='active'?t('alreadyBookedToast'):s.cancelled?t('cancelledToast'):s.full?t('fullToast'):!s.allowed?t('levelToast'):t('dateClosedToast'),true);return;}selected.has(key)?selected.delete(key):selected.set(key,{slot_id:s.id,date:s.date});renderSchedule();};
    return b;
  }
  $('#prevWeek').onclick=()=>{week=addDays(week,-7);selected.clear();load();};$('#nextWeek').onclick=()=>{week=addDays(week,7);selected.clear();load();};$('#thisWeek').onclick=()=>{week=null;selected.clear();load();};
  $('#bookBtn').onclick=async()=>{try{const out=await api('/api/student/book','POST',{selections:[...selected.values()],topic:$('#bookTopic').value.trim()});selected.clear();$('#bookTopic').value='';toast(t('saved')(out.summary.length));await load();goTab('mine');}catch(e){toast(e.message,true);await load(true,{selectionNotice:true});}};

  function renderMine(){
    const rows=D.bookings.filter(b=>mineFilter==='cancelled'?b.state.startsWith('cancelled'):b.state===mineFilter);
    $('#mineList').innerHTML=rows.length?rows.map(b=>bookingCard(b)).join(''):`<div class="card empty">${esc(t('emptyCategory'))}</div>`;
    $('#mineList').querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>confirmCancel(Number(b.dataset.cancel)));
  }
  $('#mineFilter').querySelectorAll('button').forEach(b=>b.onclick=()=>{mineFilter=b.dataset.f;$('#mineFilter').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));renderMine();});

  let cancelId=null;
  function confirmCancel(id){cancelId=id;const b=D.bookings.find(x=>Number(x.id)===id);$('#confirmTitle').textContent=t('cancelTitle');$('#confirmBody').textContent=t('cancelBody')(fmtDate(b.slot_date),b.start_time,b.level);$('#confirmBg').classList.add('show');}
  $('#confirmNo').onclick=()=>$('#confirmBg').classList.remove('show');
  $('#confirmYes').onclick=async()=>{try{await api('/api/student/bookings/'+cancelId+'/cancel','POST');$('#confirmBg').classList.remove('show');toast(t('cancelledDone'));await load();}catch(e){toast(e.message,true);}};

  function notifHtml(items){return items.length?items.map(n=>`<button class="notice ${n.read?'':'unread'}" data-n="${n.id}"><span class="notice-dot"></span><span><b>${esc(n.title)}</b><em>${esc(n.body)}</em><small>${fmtTs(n.created_at)}</small></span></button>`).join(''):`<div class="empty">${esc(t('noNotifications'))}</div>`;}
  function bindNotificationButtons(root){root.querySelectorAll('[data-n]').forEach(b=>b.onclick=async()=>{try{await api('/api/student/notifications/'+b.dataset.n+'/read','POST');const n=D.notifications.find(x=>String(x.id)===String(b.dataset.n));if(n)n.read=true;renderNotifications();renderStats();}catch(e){toast(e.message,true);}});}
  function renderNotifications(){
    const unread=D.notifications.filter(n=>!n.read).length;$('#notifBadge').textContent=unread;$('#notifBadge').classList.toggle('hidden',!unread);
    $('#notifList').innerHTML=notifHtml(D.notifications)+(D.notifications.length>=60?`<button class="btn ghost sm" id="moreNotifs">${esc(t('loadOlder'))}</button>`:'');bindNotificationButtons($('#notifList'));
    const more=$('#moreNotifs');if(more)more.onclick=loadOlderNotifications;
  }
  async function loadOlderNotifications(){try{const before=Math.min(...D.notifications.map(n=>Number(n.id)));const out=await api(`/api/student/notifications?limit=40&before_id=${before}`);if(out.items?.length){D.notifications.push(...out.items);renderNotifications();}else toast(t('noOlder'));}catch(e){toast(e.message,true);}}
  $('#notifBtn').onclick=()=>$('#drawerBg').classList.add('show');$('#drawerClose').onclick=()=>$('#drawerBg').classList.remove('show');$('#drawerBg').onclick=e=>{if(e.target===e.currentTarget)e.currentTarget.classList.remove('show');};

  ['pFirst','pLast'].forEach(id=>$('#'+id).addEventListener('input',()=>profileDirty=true));
  $('#saveProfile').onclick=async()=>{try{await api('/api/student/profile','PUT',{first_name:$('#pFirst').value,last_name:$('#pLast').value});profileDirty=false;toast(t('profileSaved'));await load();}catch(e){toast(e.message,true);}};
  $('#requestPhone').onclick=async()=>{try{await api('/api/student/phone-change','POST',{phone:$('#newPhone').value});$('#newPhone').value='';toast(t('phoneSent'));await load();}catch(e){toast(e.message,true);}};

  applyLang();
  start().catch(e=>{showLogin();if(e.message!=='login')toast(e.message,true);});
})();
