(() => {
  const $=s=>document.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const DAYS=['','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'];
  let D=null,week=null,selected=new Map(),activeDay=1,mineFilter='upcoming',profileDirty=false;
  let pollTimer=null,pollBusy=false,syncState=null,lastNotificationId=0;

  const fmtDate=s=>{const [y,m,d]=String(s).slice(0,10).split('-');return`${d}.${m}.${y}`;};
  const short=s=>fmtDate(s).slice(0,5);
  const fmtTs=s=>ETCommon.formatDateTime(s);
  const addDays=(s,n)=>{const [y,m,d]=s.split('-').map(Number),x=new Date(Date.UTC(y,m-1,d));x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
  const errorText=(d,f='İşlem başarısız.')=>d?.request_id?`${d.error||f} (Ref: ${d.request_id})`:(d?.error||f);

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
  function showLogin(){
    $('#login').classList.remove('hidden');$('#panel').classList.add('hidden');$('#logout').classList.add('hidden');$('#notifBtn').classList.add('hidden');stopPolling();
  }
  function showPanel(){
    $('#login').classList.add('hidden');$('#panel').classList.remove('hidden');$('#logout').classList.remove('hidden');$('#notifBtn').classList.remove('hidden');
  }

  async function start(){
    const me=await api('/api/student/me');if(!me.student)return showLogin();showPanel();await load(false);startPolling();
  }
  $('#loginBtn').onclick=async()=>{try{await api('/api/student/login','POST',{first_name:$('#lFirst').value.trim(),last_name:$('#lLast').value.trim(),phone:$('#lPhone').value,level:$('#lLevel').value});$('#loginErr').textContent='';showPanel();await load(false);startPolling();}catch(e){$('#loginErr').textContent=e.message==='login'?'Giriş gerekli':e.message;}};
  $('#logout').onclick=async()=>{await fetch('/api/student/logout',{method:'POST'});location.reload();};

  $('#tabs').querySelectorAll('button').forEach(b=>b.onclick=()=>goTab(b.dataset.tab));
  document.querySelectorAll('[data-go]').forEach(a=>a.onclick=e=>{e.preventDefault();goTab(a.dataset.go);});
  function goTab(name){$('#tabs').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x.dataset.tab===name));document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('hidden',t.id!=='tab-'+name));}

  function currentMaxNotificationId(){return Math.max(0,...((D?.notifications)||[]).map(n=>Number(n.id)||0));}
  function alertNewImportant(oldMax){
    const important=(D?.notifications||[]).filter(n=>Number(n.id)>oldMax&&!n.read&&['cancellation','schedule','account','security'].includes(String(n.kind||'')));
    if(important.length){const n=important[0];toast(`${n.title}: ${n.body}`,n.kind==='cancellation'||n.kind==='security');}
  }
  function pruneSelections(notify=false){
    if(!D?.week?.slots)return;
    const valid=new Set(D.week.slots.filter(s=>s.bookable).map(s=>`${s.id}|${s.date}`));let changed=false;
    for(const key of [...selected.keys()])if(!valid.has(key)){selected.delete(key);changed=true;}
    if(changed&&notify)toast('Program değişti. Artık uygun olmayan seçimler kaldırıldı.',true);
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
    try{
      const next=await api('/api/student/sync-state');
      const changed=!syncState||['schedule_revision','booking_revision','account_revision','notification_revision'].some(k=>Number(next[k]||0)!==Number(syncState[k]||0));
      if(changed)await load(true,{selectionNotice:Number(next.schedule_revision||0)!==Number(syncState?.schedule_revision||0)});else syncState=next;
    }catch(e){if(e.message!=='login'){} }
    finally{pollBusy=false;pollTimer=setTimeout(pollOnce,15000);}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&$('#panel')&&!$('#panel').classList.contains('hidden')){clearTimeout(pollTimer);pollTimer=setTimeout(pollOnce,250);}});

  function render(){
    $('#hello').textContent=`Merhaba, ${D.student.first_name}`;$('#levelOrb').textContent=D.student.level;
    renderStats();renderHome();renderSchedule();renderMine();renderNotifications();
    if(!profileDirty){$('#pFirst').value=D.student.first_name;$('#pLast').value=D.student.last_name;$('#pPhone').value=D.student.phone;$('#pLevel').value=D.student.level;}
    const pr=D.phone_request;if(pr){$('#phoneReq').classList.remove('hidden');$('#phoneReq').textContent=`${pr.new_phone} için onay bekleniyor.`;}else $('#phoneReq').classList.add('hidden');
  }
  function renderStats(){
    const up=D.bookings.filter(x=>x.state==='upcoming'),done=D.bookings.filter(x=>x.state==='completed'),cx=D.bookings.filter(x=>x.state.startsWith('cancelled'));
    $('#stats').innerHTML=[[up.length,'Yaklaşan etüt'],[done.length,'Tamamlanan'],[cx.length,'İptal edilen'],[D.notifications.filter(n=>!n.read).length,'Okunmamış bildirim']].map(([v,l])=>`<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
  }
  function bookingCard(b,compact=false){
    const cap=Number(b.capacity||0),pct=cap?Math.min(100,Math.round((b.booked||0)/cap*100)):0;
    const status=b.state==='upcoming'?'Yaklaşan':b.state==='completed'?'Tamamlandı':b.state==='cancelled_by_admin'?'Koordinatör iptal etti':'İptal edildi';
    return `<article class="booking-card ${b.state}"><div class="booking-main"><div class="date-chip"><b>${short(b.slot_date)}</b><span>${DAYS[b.day]?.slice(0,3)}</span></div><div><div class="inline"><span class="tag y">${esc(b.level)}</span><span class="tag">${esc(status)}</span></div><h3>${esc(b.start_time)}–${esc(b.end_time)}</h3><p>${esc(b.classroom||'Sınıf belirtilmedi')}${b.teacher_name?' · '+esc(b.teacher_name):''}</p>${b.occurrence_cancel_note?`<p class="danger-text">${esc(b.occurrence_cancel_note)}</p>`:''}</div></div>${cap?`<div class="capacity-viz"><div><span>Kontenjan</span><b>${b.booked}/${cap}</b></div><div class="progress"><i style="width:${pct}%"></i></div></div>`:''}${!compact&&b.state==='upcoming'?`<button class="btn danger sm" data-cancel="${b.id}">Kaydımı iptal et</button>`:''}</article>`;
  }
  function renderHome(){
    const up=D.bookings.filter(x=>x.state==='upcoming').sort((a,b)=>(a.slot_date+a.start_time).localeCompare(b.slot_date+b.start_time)).slice(0,3);
    $('#nextBookings').innerHTML=up.length?up.map(b=>bookingCard(b,true)).join(''):'<div class="empty">Yaklaşan etütün yok. Yeni bir etüt seçebilirsin.</div>';
    $('#homeNotifs').innerHTML=notifHtml(D.notifications.slice(0,5));bindNotificationButtons($('#homeNotifs'));
  }

  function renderSchedule(){
    $('#weekLabel').textContent=`${fmtDate(D.week.week_start)} – ${fmtDate(D.week.week_end)}`;
    const el=$('#sSchedule'),tabs=$('#sDayTabs');el.innerHTML='';tabs.innerHTML='';
    for(let d=1;d<=7;d++){
      const date=addDays(D.week.week_start,d-1),items=D.week.slots.filter(s=>s.date===date),col=document.createElement('div');
      col.className='daycol'+(d>=6?' weekend':'')+(d===activeDay?' show':'');col.innerHTML=`<div class="dayhead d${d}">${DAYS[d]}<small>${short(date)}</small></div>`;
      items.forEach(s=>col.appendChild(slotTile(s)));el.appendChild(col);
      const tb=document.createElement('button');tb.type='button';tb.className=d===activeDay?'on':'';tb.innerHTML=`${DAYS[d].slice(0,3)}${items.some(s=>selected.has(`${s.id}|${s.date}`))?'<span class="dot"></span>':''}`;tb.onclick=()=>{activeDay=d;renderSchedule();};tabs.appendChild(tb);
    }
    $('#selectedCount').textContent=`${selected.size} seçildi`;$('#bookBtn').disabled=!selected.size;
  }
  function slotTile(s){
    const key=`${s.id}|${s.date}`,b=document.createElement('button');b.type='button';
    const cls=s.cancelled?' cancel':s.mine_status==='active'?' mine':s.full?' full':!s.allowed?' lock':s.ended?' lock':'';b.className='tile'+cls+(selected.has(key)?' on':'');
    const cap=s.capacity>0?`${s.booked}/${s.capacity}`:`${s.booked}`;
    b.innerHTML=`<span class="time">${s.start_time}–${s.end_time}</span><span class="lvl">${esc(s.level)}</span><span class="meta">${esc(s.classroom||'')}</span><span class="capacity-mini">${s.mine_status==='active'?'Zaten kayıtlı':s.mine_status==='cancelled_previous'?'Daha önce iptal ettin · tekrar seçilebilir':s.cancelled?'İptal':s.ended?'Tamamlandı':s.full?'Dolu':`Kontenjan ${cap}`}</span>`;
    b.onclick=()=>{if(!s.bookable){toast(s.mine_status==='active'?'Bu etüte zaten kayıtlısın.':s.cancelled?'Bu etüt iptal edildi.':s.full?'Etüt dolu.':!s.allowed?'Bu etüt seviyene uygun değil.':'Bu tarih kayıt için kapalı.',true);return;}selected.has(key)?selected.delete(key):selected.set(key,{slot_id:s.id,date:s.date});renderSchedule();};
    return b;
  }
  $('#prevWeek').onclick=()=>{week=addDays(week,-7);selected.clear();load();};$('#nextWeek').onclick=()=>{week=addDays(week,7);selected.clear();load();};$('#thisWeek').onclick=()=>{week=null;selected.clear();load();};
  $('#bookBtn').onclick=async()=>{try{const out=await api('/api/student/book','POST',{selections:[...selected.values()],topic:$('#bookTopic').value.trim()});selected.clear();$('#bookTopic').value='';toast(`${out.summary.length} etüt kaydedildi.`);await load();goTab('mine');}catch(e){toast(e.message,true);await load(true,{selectionNotice:true});}};

  function renderMine(){
    const rows=D.bookings.filter(b=>mineFilter==='cancelled'?b.state.startsWith('cancelled'):b.state===mineFilter);
    $('#mineList').innerHTML=rows.length?rows.map(b=>bookingCard(b)).join(''):'<div class="card empty">Bu kategoride kayıt yok.</div>';
    $('#mineList').querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>confirmCancel(Number(b.dataset.cancel)));
  }
  $('#mineFilter').querySelectorAll('button').forEach(b=>b.onclick=()=>{mineFilter=b.dataset.f;$('#mineFilter').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));renderMine();});

  let cancelId=null;
  function confirmCancel(id){cancelId=id;const b=D.bookings.find(x=>Number(x.id)===id);$('#confirmTitle').textContent='Etüt kaydını iptal et';$('#confirmBody').textContent=`${fmtDate(b.slot_date)} ${b.start_time} ${b.level} kaydın iptal edilecek ve kontenjan hemen boşalacak.`;$('#confirmBg').classList.add('show');}
  $('#confirmNo').onclick=()=>$('#confirmBg').classList.remove('show');
  $('#confirmYes').onclick=async()=>{try{await api('/api/student/bookings/'+cancelId+'/cancel','POST');$('#confirmBg').classList.remove('show');toast('Etüt kaydın iptal edildi.');await load();}catch(e){toast(e.message,true);}};

  function notifHtml(items){return items.length?items.map(n=>`<button class="notice ${n.read?'':'unread'}" data-n="${n.id}"><span class="notice-dot"></span><span><b>${esc(n.title)}</b><em>${esc(n.body)}</em><small>${fmtTs(n.created_at)}</small></span></button>`).join(''):'<div class="empty">Yeni bildirim yok.</div>';}
  function bindNotificationButtons(root){root.querySelectorAll('[data-n]').forEach(b=>b.onclick=async()=>{try{await api('/api/student/notifications/'+b.dataset.n+'/read','POST');const n=D.notifications.find(x=>String(x.id)===String(b.dataset.n));if(n)n.read=true;renderNotifications();renderStats();}catch(e){toast(e.message,true);}});}
  function renderNotifications(){
    const unread=D.notifications.filter(n=>!n.read).length;$('#notifBadge').textContent=unread;$('#notifBadge').classList.toggle('hidden',!unread);
    $('#notifList').innerHTML=notifHtml(D.notifications)+(D.notifications.length>=60?'<button class="btn ghost sm" id="moreNotifs">Daha eski bildirimleri yükle</button>':'');bindNotificationButtons($('#notifList'));
    const more=$('#moreNotifs');if(more)more.onclick=loadOlderNotifications;
  }
  async function loadOlderNotifications(){
    try{const before=Math.min(...D.notifications.map(n=>Number(n.id)));const out=await api(`/api/student/notifications?limit=40&before_id=${before}`);if(out.items?.length){D.notifications.push(...out.items);renderNotifications();}else toast('Daha eski bildirim yok.');}catch(e){toast(e.message,true);}
  }
  $('#notifBtn').onclick=()=>$('#drawerBg').classList.add('show');$('#drawerClose').onclick=()=>$('#drawerBg').classList.remove('show');$('#drawerBg').onclick=e=>{if(e.target===e.currentTarget)e.currentTarget.classList.remove('show');};

  ['pFirst','pLast'].forEach(id=>$('#'+id).addEventListener('input',()=>profileDirty=true));
  $('#saveProfile').onclick=async()=>{try{await api('/api/student/profile','PUT',{first_name:$('#pFirst').value,last_name:$('#pLast').value});profileDirty=false;toast('Profil güncellendi.');await load();}catch(e){toast(e.message,true);}};
  $('#requestPhone').onclick=async()=>{try{await api('/api/student/phone-change','POST',{phone:$('#newPhone').value});$('#newPhone').value='';toast('Telefon değişikliği yönetici onayına gönderildi.');await load();}catch(e){toast(e.message,true);}};

  start().catch(e=>{showLogin();if(e.message!=='login')toast(e.message,true);});
})();
