(() => {
  const $=s=>document.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const DAYS={tr:['','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'],en:['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']};
  const I18N={
    en:{pageTitle:'Teacher Panel · English Time',sub:'Teacher Panel · Read Only',logout:'Log out',notificationsAria:'Notifications',themeAria:'Theme',loginEyebrow:'Teacher login',loginTitle:'Access your schedule',loginNote:'Use the username and password provided by the administrator.',username:'Username',password:'Password',studentPage:'Student page',loginBtn:'Log in',panelEyebrow:'Teacher Panel',heroNote:'You can view all etüts. Etüts assigned to you have a yellow outline.',today:'Today',upcoming:'Upcoming',past:'Past',weekly:'Weekly Schedule',scheduleHelp:'Click an etüt to view its student list and details.',thisWeek:'This week',legendAssigned:'Assigned to you',legendFull:'Full etüt',legendStudents:'Contains students',legendCancelled:'Cancelled · click to view log',notifications:'Notifications',updates:'Updates',activeStudents:'Active students',cancelledStudents:'Cancelled students',hello:n=>`Hello, ${n}`,statsTodayEtuts:"Today's etüts",statsTodayStudents:"Today's students",statsUpcoming:'Upcoming etüts',statsWeekStudents:'Students this week',titleToday:"Today's etüts",titleUpcoming:'Upcoming etüts',titlePast:'Past etüts',titleWeekly:'Weekly schedule',noSlots:'No etüts in this view.',unassigned:'Teacher not assigned',students:(b,c)=>c>0?`${b}/${c} students`:`${b} students`,teacher:'Teacher',classroom:'Classroom',capacity:'Capacity',status:'Status',unlimited:'unlimited',cancelled:'Cancelled',completed:'Completed',active:'Active',noStudents:'No registered students.',studentCancelled:'Cancelled by student',adminCancelled:'Cancelled by administrator',adminRemoved:'Removed by administrator',cancelledGeneric:'Cancelled',cancellationLog:'Cancellation log',noCancellationNote:'This etüt was cancelled by the administrator.',noNotifications:'No new notifications.',loadOlder:'Load older notifications',noOlder:'No older notifications.',loginRequired:'Login required',actionFailed:'Action failed.'},
    tr:{pageTitle:'Öğretmen Paneli · English Time',sub:'Öğretmen Paneli · Salt Okunur',logout:'Çıkış',notificationsAria:'Bildirimler',themeAria:'Tema',loginEyebrow:'Öğretmen girişi',loginTitle:'Programına eriş',loginNote:'Yönetici tarafından verilen kullanıcı adı ve şifreyi kullan.',username:'Kullanıcı adı',password:'Şifre',studentPage:'Öğrenci sayfası',loginBtn:'Giriş yap',panelEyebrow:'Öğretmen Paneli',heroNote:'Tüm etütleri görebilirsin. Sana atanmış etütler sarı çerçeveyle işaretlenir.',today:'Bugün',upcoming:'Yaklaşan',past:'Geçmiş',weekly:'Haftalık Program',scheduleHelp:'Bir etüte tıklayarak öğrenci listesini ve detayları görüntüle.',thisWeek:'Bu hafta',legendAssigned:'Sana atanmış',legendFull:'Dolu etüt',legendStudents:'Öğrenci içeriyor',legendCancelled:'İptal · logu görmek için tıkla',notifications:'Bildirimler',updates:'Güncellemeler',activeStudents:'Aktif öğrenciler',cancelledStudents:'İptal eden öğrenciler',hello:n=>`Merhaba, ${n}`,statsTodayEtuts:'Bugünkü etütlerin',statsTodayStudents:'Bugünkü öğrencilerin',statsUpcoming:'Yaklaşan etütlerin',statsWeekStudents:'Bu hafta öğrenci',titleToday:'Bugünkü etütler',titleUpcoming:'Yaklaşan etütler',titlePast:'Geçmiş etütler',titleWeekly:'Haftalık program',noSlots:'Bu görünümde etüt yok.',unassigned:'Öğretmen atanmamış',students:(b,c)=>c>0?`${b}/${c} öğrenci`:`${b} öğrenci`,teacher:'Öğretmen',classroom:'Sınıf',capacity:'Kontenjan',status:'Durum',unlimited:'sınırsız',cancelled:'İptal',completed:'Tamamlandı',active:'Aktif',noStudents:'Kayıtlı öğrenci yok.',studentCancelled:'Öğrenci iptal etti',adminCancelled:'Yönetici tarafından iptal edildi',adminRemoved:'Yönetici tarafından kaldırıldı',cancelledGeneric:'İptal edildi',cancellationLog:'İptal kaydı',noCancellationNote:'Bu etüt yönetici tarafından iptal edildi.',noNotifications:'Yeni bildirim yok.',loadOlder:'Daha eski bildirimleri yükle',noOlder:'Daha eski bildirim yok.',loginRequired:'Giriş gerekli',actionFailed:'İşlem başarısız.'}
  };
  let lang=localStorage.getItem('et_teacher_lang')||'en';
  let D=null,week=null,activeDay=1,view='today',syncState=null,lastNotificationId=0,pollTimer=null,pollBusy=false,currentSlot=null;
  const t=k=>I18N[lang][k];
  const addDays=(s,n)=>{const [y,m,d]=s.split('-').map(Number),x=new Date(Date.UTC(y,m-1,d));x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
  const fmt=s=>{const[y,m,d]=String(s).slice(0,10).split('-');return`${d}.${m}.${y}`;};
  const fmtTs=s=>{try{return new Intl.DateTimeFormat(lang==='tr'?'tr-TR':'en-GB',{timeZone:'Europe/Istanbul',dateStyle:'short',timeStyle:'short'}).format(new Date(s));}catch{return String(s||'');}};
  const todayTR=()=>{const p=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()),o=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${o.year}-${o.month}-${o.day}`;};
  const errorText=(d,f)=>d?.request_id?`${d.error||f||t('actionFailed')} (Ref: ${d.request_id})`:(d?.error||f||t('actionFailed'));

  function applyLang(){
    document.documentElement.lang=lang;document.title=t('pageTitle');
    document.querySelectorAll('[data-i18n]').forEach(el=>{const v=t(el.dataset.i18n);if(typeof v==='string')el.textContent=v;});
    document.querySelectorAll('[data-i18n-aria]').forEach(el=>{const v=t(el.dataset.i18nAria);if(typeof v==='string')el.setAttribute('aria-label',v);});
    document.querySelectorAll('#teacherLang button').forEach(b=>b.classList.toggle('on',b.dataset.lang===lang));
    if(D)render();
    if(currentSlot&&$('#slotBg').classList.contains('show'))renderSlotModal(currentSlot);
  }
  document.querySelectorAll('#teacherLang button').forEach(b=>b.onclick=()=>{lang=b.dataset.lang;localStorage.setItem('et_teacher_lang',lang);applyLang();});

  async function api(url,method='GET',body){
    const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:method==='GET'?'no-store':'default'});
    const d=await r.json().catch(()=>({}));
    if(r.status===401&&url!=='/api/teacher/login'){showLogin();throw Object.assign(new Error('login'),{status:401,data:d});}
    if(!r.ok)throw Object.assign(new Error(errorText(d)),{status:r.status,data:d});return d;
  }
  let tt;const toast=(m,b=false)=>{const e=$('#toast');e.textContent=m;e.className='toast show'+(b?' bad':'');clearTimeout(tt);tt=setTimeout(()=>e.classList.remove('show'),4500);};
  function setTheme(v){document.documentElement.dataset.theme=v;localStorage.setItem('et_theme',v);}setTheme(localStorage.getItem('et_theme')||'dark');$('#themeBtn').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
  function stopPolling(){clearTimeout(pollTimer);pollTimer=null;pollBusy=false;}
  function showLogin(){$('#login').classList.remove('hidden');$('#panel').classList.add('hidden');$('#logout').classList.add('hidden');$('#notifBtn').classList.add('hidden');stopPolling();}
  function showPanel(){$('#login').classList.add('hidden');$('#panel').classList.remove('hidden');$('#logout').classList.remove('hidden');$('#notifBtn').classList.remove('hidden');}

  async function start(){const me=await api('/api/teacher/me');if(!me.teacher)return showLogin();showPanel();await load();startPolling();}
  $('#loginBtn').onclick=async()=>{try{await api('/api/teacher/login','POST',{username:$('#username').value.trim(),password:$('#password').value});$('#loginErr').textContent='';showPanel();await load();startPolling();}catch(e){$('#loginErr').textContent=e.message==='login'?t('loginRequired'):e.message;}};
  $('#password').onkeydown=e=>{if(e.key==='Enter')$('#loginBtn').click();};
  $('#logout').onclick=async()=>{await fetch('/api/teacher/logout',{method:'POST'});location.reload();};

  function maxNotif(){return Math.max(0,...((D?.notifications)||[]).map(n=>Number(n.id)||0));}
  function alertImportant(oldMax){const n=(D?.notifications||[]).find(x=>Number(x.id)>oldMax&&!x.read&&['cancellation','schedule','account','security'].includes(String(x.kind||'')));if(n)toast(`${n.title}: ${n.body}`,n.kind==='cancellation'||n.kind==='security');}
  async function load(silent=false){
    try{const old=lastNotificationId||maxNotif();D=await api('/api/teacher/dashboard'+(week?'?week='+encodeURIComponent(week):''));week=D.week.week_start;render();alertImportant(old);lastNotificationId=maxNotif();syncState=await api('/api/teacher/sync-state');}
    catch(e){if(e.message!=='login'&&!silent)toast(e.message,true);}
  }
  function startPolling(){stopPolling();pollTimer=setTimeout(pollOnce,15000);}
  async function pollOnce(){
    if(document.hidden){pollTimer=setTimeout(pollOnce,15000);return;}if(pollBusy){pollTimer=setTimeout(pollOnce,3000);return;}pollBusy=true;
    try{const next=await api('/api/teacher/sync-state');const changed=!syncState||['schedule_revision','booking_revision','account_revision','notification_revision'].some(k=>Number(next[k]||0)!==Number(syncState[k]||0));if(changed)await load(true);else syncState=next;}catch{}finally{pollBusy=false;pollTimer=setTimeout(pollOnce,15000);}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('#panel').classList.contains('hidden')){clearTimeout(pollTimer);pollTimer=setTimeout(pollOnce,250);}});

  $('#teacherView').querySelectorAll('button').forEach(b=>b.onclick=()=>{view=b.dataset.view;$('#teacherView').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));renderSchedule();});
  function render(){
    $('#hello').textContent=t('hello')(D.teacher.name);
    $('#stats').innerHTML=[[D.stats.today_etuts,t('statsTodayEtuts')],[D.stats.today_students,t('statsTodayStudents')],[D.stats.upcoming_etuts,t('statsUpcoming')],[D.stats.week_students,t('statsWeekStudents')]].map(([v,l])=>`<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
    $('#weekLabel').textContent=`${fmt(D.week.week_start)} – ${fmt(D.week.week_end)}`;renderSchedule();renderNotifications();
  }

  function viewSlots(){
    const today=todayTR(),all=D.week.slots||[];
    if(view==='today')return all.filter(s=>s.date===today);
    if(view==='upcoming')return all.filter(s=>!s.ended&&!s.cancelled&&(s.date>today||(s.date===today&&!s.ended)));
    if(view==='past')return all.filter(s=>s.ended||s.date<today);
    return all;
  }
  function renderSchedule(){
    const titles={today:t('titleToday'),upcoming:t('titleUpcoming'),past:t('titlePast'),weekly:t('titleWeekly')};$('#teacherViewTitle').textContent=titles[view];
    const source=viewSlots(),el=$('#schedule'),tabs=$('#dayTabs');el.innerHTML='';tabs.innerHTML='';
    let days=[];for(let d=1;d<=7;d++){const date=addDays(D.week.week_start,d-1),items=source.filter(s=>s.date===date);if(view==='weekly'||items.length)days.push({d,date,items});}
    if(!days.length){el.innerHTML=`<div class="empty" style="grid-column:1/-1">${esc(t('noSlots'))}</div>`;return;}
    if(!days.some(x=>x.d===activeDay))activeDay=days[0].d;
    for(const {d,date,items} of days){
      const col=document.createElement('div');col.className='daycol'+(d>=6?' weekend':'')+(d===activeDay?' show':'');col.innerHTML=`<div class="dayhead d${d}">${DAYS[lang][d]}<small>${fmt(date).slice(0,5)}</small></div>`;items.forEach(s=>col.appendChild(tile(s)));el.appendChild(col);
      const tb=document.createElement('button');tb.type='button';tb.className=d===activeDay?'on':'';tb.innerHTML=`${DAYS[lang][d].slice(0,3)}${items.some(s=>s.own)?'<span class="dot"></span>':''}`;tb.onclick=()=>{activeDay=d;renderSchedule();};tabs.appendChild(tb);
    }
  }
  function tile(s){
    const hasStudents=Number(s.booked||0)>0,b=document.createElement('button');b.type='button';b.className='tile teacher-tile'+(s.own?' own':'')+(s.full?' full-slot':'')+(hasStudents?' has-students':'')+(s.cancelled?' cancel':'')+(s.ended?' ended':'');
    b.innerHTML=`${hasStudents?`<span class="student-pill" title="${esc(t('legendStudents'))}">👥 ${Number(s.booked||0)}</span>`:''}${s.new_count?`<span class="new-pill">NEW ${s.new_count}</span>`:''}<span class="time">${s.start_time}–${s.end_time}</span><span class="lvl">${esc(s.level)}</span><span class="meta">${esc(s.teacher_name||t('unassigned'))}</span><span class="capacity-mini">${esc(t('students')(Number(s.booked||0),Number(s.capacity||0)))} · ${esc(s.classroom||'')}</span>`;b.onclick=()=>openSlot(s);return b;
  }
  function renderSlotModal(s){
    $('#slotDate').textContent=`${DAYS[lang][s.day]} · ${fmt(s.date)}`;$('#slotTitle').textContent=`${s.start_time}–${s.end_time} · ${s.level}`;
    $('#slotMeta').innerHTML=[[t('teacher'),s.teacher_name||'—'],[t('classroom'),s.classroom||'—'],[t('capacity'),s.capacity>0?`${s.booked}/${s.capacity}`:`${s.booked} / ${t('unlimited')}`],[t('status'),s.cancelled?t('cancelled'):s.ended?t('completed'):t('active')]].map(([a,b])=>`<div class="mini-stat"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('');
    const log=$('#cancelLog');if(s.cancelled){log.classList.remove('hidden');log.innerHTML=`<div class="cancel-log-title"><span>⊘</span><b>${esc(t('cancellationLog'))}</b></div><p>${esc(s.cancel_note||t('noCancellationNote'))}</p>`;}else{log.classList.add('hidden');log.innerHTML='';}
    $('#studentList').innerHTML=(s.students||[]).length?s.students.map(x=>`<div class="student-row"><div><b>${esc(x.first_name)} ${esc(x.last_name)}</b><small>${esc(x.level)}${x.topic?' · '+esc(x.topic):''}</small></div></div>`).join(''):`<div class="empty">${esc(t('noStudents'))}</div>`;
    $('#cancelledList').innerHTML=(s.cancelled_students||[]).length?s.cancelled_students.map(x=>{const why=x.status==='cancelled_by_student'?t('studentCancelled'):x.status==='cancelled_by_admin'?t('adminCancelled'):x.status==='deleted_by_admin'?t('adminRemoved'):t('cancelledGeneric');return`<div class="student-row cancelled-row"><div><b>${esc(x.first_name)} ${esc(x.last_name)}</b><small>${esc(x.level)} · ${esc(why)}</small></div></div>`;}).join(''):'';
    $('#cancelledWrap').classList.toggle('hidden',!(s.cancelled_students||[]).length);
  }
  async function openSlot(s){
    currentSlot=s;if(s.new_count){try{await api('/api/teacher/slots/'+s.id+'/read','POST',{date:s.date});s.new_count=0;renderSchedule();}catch{}}
    renderSlotModal(s);$('#slotBg').classList.add('show');
  }
  $('#slotClose').onclick=()=>{$('#slotBg').classList.remove('show');currentSlot=null;};$('#slotBg').onclick=e=>{if(e.target===e.currentTarget){e.currentTarget.classList.remove('show');currentSlot=null;}};
  $('#prevWeek').onclick=()=>{week=addDays(week,-7);load();};$('#nextWeek').onclick=()=>{week=addDays(week,7);load();};$('#thisWeek').onclick=()=>{week=null;load();};

  function notifHtml(items){return items.length?items.map(n=>`<button class="notice ${n.read?'':'unread'}" data-n="${n.id}"><span class="notice-dot"></span><span><b>${esc(n.title)}</b><em>${esc(n.body)}</em><small>${fmtTs(n.created_at)}</small></span></button>`).join(''):`<div class="empty">${esc(t('noNotifications'))}</div>`;}
  function renderNotifications(){
    const u=D.notifications.filter(n=>!n.read).length;$('#notifBadge').textContent=u;$('#notifBadge').classList.toggle('hidden',!u);
    $('#notifList').innerHTML=notifHtml(D.notifications)+(D.notifications.length>=60?`<button class="btn ghost sm" id="moreNotifs">${esc(t('loadOlder'))}</button>`:'');
    $('#notifList').querySelectorAll('[data-n]').forEach(b=>b.onclick=async()=>{try{await api('/api/teacher/notifications/'+b.dataset.n+'/read','POST');const n=D.notifications.find(x=>String(x.id)===String(b.dataset.n));if(n)n.read=true;renderNotifications();}catch(e){toast(e.message,true);}});
    const more=$('#moreNotifs');if(more)more.onclick=loadOlderNotifications;
  }
  async function loadOlderNotifications(){try{const before=Math.min(...D.notifications.map(n=>Number(n.id)));const out=await api(`/api/teacher/notifications?limit=40&before_id=${before}`);if(out.items?.length){D.notifications.push(...out.items);renderNotifications();}else toast(t('noOlder'));}catch(e){toast(e.message,true);}}
  $('#notifBtn').onclick=()=>$('#drawerBg').classList.add('show');$('#drawerClose').onclick=()=>$('#drawerBg').classList.remove('show');$('#drawerBg').onclick=e=>{if(e.target===e.currentTarget)e.currentTarget.classList.remove('show');};

  applyLang();
  start().catch(e=>{showLogin();if(e.message!=='login')toast(e.message,true);});
})();
