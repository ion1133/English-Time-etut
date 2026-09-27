(() => {
  const $=s=>document.querySelector(s);
  const DAYS=['','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDate=s=>{const[y,m,d]=String(s).slice(0,10).split('-');return`${d}.${m}.${y}`;};
  const fmtTs=s=>ETCommon.formatDateTime(s);
  const errorText=(d,f='Hata')=>d?.request_id?`${d.error||f} (Ref: ${d.request_id})`:(d?.error||f);

  let D=null,curSlot=null,curT=null,curStudent=null,settingsDirty=false;
  let syncState=null,pollTimer=null,pollBusy=false,activeTab='overview',qrUrl='';
  let studentData={items:[],page:1,pages:1,total:0},bookingData={items:[],page:1,pages:1,total:0},logData={items:[],page:1,pages:1,total:0,summary:{}};
  let studentSearch='',bookingSearch='',stHistoryPage=1,stHistoryPages=1;

  let tt;const toast=(m,b=false)=>{const e=$('#toast');e.textContent=m;e.className='toast show'+(b?' bad':'');clearTimeout(tt);tt=setTimeout(()=>e.classList.remove('show'),4500);};
  async function api(url,method='GET',body){
    const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:method==='GET'?'no-store':'default'});
    const d=await r.json().catch(()=>({}));
    if(r.status===401){showLogin();throw Object.assign(new Error('Giriş gerekli'),{status:401,data:d});}
    if(!r.ok)throw Object.assign(new Error(errorText(d)),{status:r.status,data:d});return d;
  }
  function setTheme(v){document.documentElement.dataset.theme=v;localStorage.setItem('et_theme',v);}setTheme(localStorage.getItem('et_theme')||'dark');$('#themeBtn').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
  function stopPolling(){clearTimeout(pollTimer);pollTimer=null;pollBusy=false;}
  function showLogin(){$('#login').classList.remove('hidden');$('#panel').classList.add('hidden');$('#logout').classList.add('hidden');stopPolling();}
  function showPanel(){$('#login').classList.add('hidden');$('#panel').classList.remove('hidden');$('#logout').classList.remove('hidden');}

  async function start(){const r=await fetch('/api/admin/me',{cache:'no-store'}),me=await r.json().catch(()=>({}));if(!me.admin)return showLogin();showPanel();await load(false);startPolling();}
  $('#loginBtn').onclick=async()=>{try{await api('/api/admin/login','POST',{password:$('#pw').value});$('#pwErr').textContent='';showPanel();await load(false);startPolling();}catch(e){$('#pwErr').textContent=e.message;}};
  $('#pw').onkeydown=e=>{if(e.key==='Enter')$('#loginBtn').click();};
  $('#logout').onclick=async()=>{await fetch('/api/admin/logout',{method:'POST'});location.reload();};

  $('#tabs').querySelectorAll('button').forEach(b=>b.onclick=async()=>{
    activeTab=b.dataset.tab;$('#tabs').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('hidden',t.id!=='tab-'+activeTab));
    if(activeTab==='logs')await loadLogs(1);
    if(activeTab==='students'&&!studentData.items.length)await loadStudents(1);
    if(activeTab==='bookings'&&!bookingData.items.length)await loadBookings(1);
  });

  async function load(silent=false){
    try{
      D=await api('/api/admin/overview');
      renderAll(settingsDirty);
      await Promise.all([loadStudents(studentData.page||1,true),loadBookings(bookingData.page||1,true)]);
      syncState=await api('/api/admin/sync-state');
    }catch(e){if(!silent&&e.status!==401)toast(e.message,true);}
  }
  function startPolling(){stopPolling();pollTimer=setTimeout(pollOnce,18000);}
  async function pollOnce(){
    if(document.hidden){pollTimer=setTimeout(pollOnce,18000);return;}if(pollBusy){pollTimer=setTimeout(pollOnce,3000);return;}pollBusy=true;
    try{
      const next=await api('/api/admin/sync-state');
      const changed=!syncState||['schedule_revision','booking_revision','account_revision','notification_revision'].some(k=>Number(next[k]||0)!==Number(syncState[k]||0));
      if(changed){
        const bookingChanged=!syncState||Number(next.booking_revision||0)!==Number(syncState.booking_revision||0);
        const accountChanged=!syncState||Number(next.account_revision||0)!==Number(syncState.account_revision||0);
        D=await api('/api/admin/overview');renderAll(settingsDirty);
        const jobs=[];if(bookingChanged)jobs.push(loadBookings(bookingData.page||1,true));if(accountChanged||bookingChanged)jobs.push(loadStudents(studentData.page||1,true));if(activeTab==='logs')jobs.push(loadLogs(logData.page||1,true));await Promise.all(jobs);syncState=next;
      }else syncState=next;
    }catch(e){if(e.status===401)return;}
    finally{pollBusy=false;pollTimer=setTimeout(pollOnce,18000);}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('#panel').classList.contains('hidden')){clearTimeout(pollTimer);pollTimer=setTimeout(pollOnce,250);}});

  function renderAll(skipSettings=false){renderOverview();renderSchedule();renderTeachers();renderStudents();renderBookings();renderNotifications();if(!skipSettings)fillSettings();}
  function renderOverview(){
    const up=[];for(const b of D.bookings||[])for(const s of b.slots||[])if(s.status==='active')up.push({...s,name:b.first_name+' '+b.last_name});up.sort((a,b)=>(String(a.date)+a.start).localeCompare(String(b.date)+b.start));
    const activeTeachers=(D.teachers||[]).filter(t=>t.active&&!t.deleted_at).length,pending=(D.phone_requests||[]).length,unresolved=D.log_summary?.unresolved_errors||0;
    $('#stats').innerHTML=[[D.total_bookings||0,'Toplam kayıt'],[D.upcoming_participations??up.length,'Yaklaşan katılım'],[activeTeachers,'Aktif öğretmen'],[D.total_students||0,'Öğrenci profili'],[pending,'Telefon onayı'],[unresolved,'Çözülmemiş hata']].map(([v,l])=>`<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
    $('#upcoming').innerHTML=up.length?`<table class="tbl">${up.slice(0,12).map(r=>`<tr><td>${fmtDate(r.date)} ${DAYS[r.day]}</td><td>${r.start}–${r.end}</td><td><span class="tag y">${esc(r.level)}</span></td><td>${esc(r.teacher||'—')}</td><td>${esc(r.name)}</td></tr>`).join('')}</table>`:'<div class="empty">Yaklaşan kayıt yok.</div>';
    const url=D.site_url;if(url!==qrUrl){qrUrl=url;$('#qrImg').src='/api/admin/qr.png?url='+encodeURIComponent(url);$('#qrDl').href=$('#qrImg').src;}$('#openSite').href=url;$('#siteUrl').textContent=url;
  }

  function renderSchedule(){
    const el=$('#aSched');el.innerHTML='';
    for(let d=1;d<=7;d++){
      const col=document.createElement('div');col.className='daycol show'+(d>=6?' weekend':'');col.innerHTML=`<div class="dayhead d${d}">${DAYS[d]}</div>`;
      (D.slots||[]).filter(x=>Number(x.day)===d).forEach(s=>{const b=document.createElement('button');b.type='button';b.className='tile'+(s.cancelled?' cancel':'');b.innerHTML=`<span class="edit">${s.cancelled?'İPTAL':'✎ '+s.booked}</span><span class="time">${s.start_time}–${s.end_time}</span><span class="lvl">${esc(s.level)}</span><span class="meta">${esc(s.teacher_name||'— öğretmen yok')}</span><span class="capacity-mini">${s.capacity>0?`${s.booked}/${s.capacity}`:`${s.booked} kayıt`} · ${esc(s.classroom||'')}</span>`;b.onclick=()=>openSlot(s);col.appendChild(b);});el.appendChild(col);
    }
  }
  function openSlot(s){
    curSlot=s;$('#slotTitle').textContent=s?'Etütü düzenle':'Yeni etüt';$('#sTeacher').innerHTML='<option value="">— seçilmedi —</option>'+(D.teachers||[]).filter(t=>t.active&&!t.deleted_at).map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');
    $('#sDay').value=s?.day||1;$('#sLevel').value=s?.level||'';$('#sStart').value=s?.start_time||'';$('#sEnd').value=s?.end_time||'';$('#sTeacher').value=s?.teacher_id||'';$('#sCap').value=s?.recurring_capacity??s?.capacity??0;$('#sRoom').value=s?.classroom||'';$('#sCancel').checked=!!s?.cancelled;$('#sCancelDate').value=s?.next_date||'';$('#sNote').value=s?.cancel_note||'';$('#sDelete').classList.toggle('hidden',!s);$('#slotBg').classList.add('show');
  }
  $('#addSlot').onclick=()=>openSlot(null);$('#sClose').onclick=()=>$('#slotBg').classList.remove('show');
  $('#sSave').onclick=async()=>{
    const body={day:Number($('#sDay').value),level:$('#sLevel').value.trim().toUpperCase(),start_time:$('#sStart').value,end_time:$('#sEnd').value,teacher_id:$('#sTeacher').value||null,capacity:Number($('#sCap').value||0),classroom:$('#sRoom').value.trim()};
    const date=$('#sCancelDate').value;if($('#sCancel').checked&&!date){toast('İptal için tarih seçin.',true);return;}if(date)body.occurrence={date,cancelled:$('#sCancel').checked,note:$('#sNote').value.trim()};
    try{
      if(curSlot){try{await api('/api/admin/slots/'+curSlot.id,'PUT',body);}catch(e){if(e.status===409&&e.data?.affected){if(!confirm(e.message+'\n\nMevcut öğrenciler etütte kalacak. Devam edilsin mi?'))return;await api('/api/admin/slots/'+curSlot.id,'PUT',{...body,confirm_level_change:true});}else throw e;}}
      else await api('/api/admin/slots','POST',body);
      $('#slotBg').classList.remove('show');toast('Program atomik olarak güncellendi.');await load();
    }catch(e){toast(e.message,true);}
  };
  $('#sDelete').onclick=async()=>{try{const impact=await api('/api/admin/slots/'+curSlot.id+'/delete-impact');const msg=impact.active_future_bookings?`Bu etüdün ${impact.active_future_bookings} aktif gelecek kaydı var. Bu kayıtlar iptal olarak korunacak. Programdan arşivlensin mi?`:'Bu etüt gelecek programdan arşivlensin mi?';if(!confirm(msg))return;await api('/api/admin/slots/'+curSlot.id+'?confirm=1','DELETE');$('#slotBg').classList.remove('show');toast('Etüt arşivlendi; geçmiş korunuyor.');await load();}catch(e){toast(e.message,true);}};

  function renderTeachers(){
    const rows=(D.teachers||[]).map(t=>{const n=(t.assignments||[]).length,status=t.deleted_at?'Arşiv':t.active?'Aktif':'Kapalı';return`<tr><td><b>${esc(t.name)}</b><br><small>@${esc(t.username||'—')}</small></td><td>${esc(t.phone||'—')}</td><td><span class="tag ${t.active&&!t.deleted_at?'g':'r'}">${status}</span></td><td>${n} etüt</td><td>${esc(t.note||'')}</td><td><button class="btn ghost sm" data-te="${t.id}">Yönet</button></td></tr>`;}).join('');
    $('#tTable').innerHTML=`<tr><th>Öğretmen / kullanıcı</th><th>Telefon</th><th>Erişim</th><th>Atama</th><th>Not</th><th></th></tr>${rows||'<tr><td colspan="6" class="empty">Öğretmen yok.</td></tr>'}`;$('#tTable').querySelectorAll('[data-te]').forEach(b=>b.onclick=()=>openTeacher(D.teachers.find(t=>String(t.id)===b.dataset.te)));
  }
  function openTeacher(t){
    curT=t;$('#tTitle').textContent=t?'Öğretmeni yönet':'Yeni öğretmen';$('#tName').value=t?.name||'';$('#tUsername').value=t?.username||'';$('#tPhone').value=t?.phone||'';$('#tNote').value=t?.note||'';$('#tActive').checked=t?.active??true;$('#tExtra').classList.toggle('hidden',!t);
    const list=t?.assignments||[];$('#tAssignments').classList.toggle('hidden',!t);$('#tAssignmentList').innerHTML=list.length?list.map(a=>`<div class="notice"><span class="notice-dot"></span><span><b>${DAYS[a.day]} · ${a.start_time}-${a.end_time} · ${esc(a.level)}</b><em>${esc(a.classroom||'Varsayılan sınıf')} · Kontenjan ${a.capacity||'∞'}</em></span></div>`).join(''):'<div class="empty">Atanmış haftalık etüt yok.</div>';$('#tBg').classList.add('show');
  }
  $('#addTeacher').onclick=()=>openTeacher(null);$('#tClose').onclick=()=>$('#tBg').classList.remove('show');
  function showSecret(v){$('#secretValue').textContent=v;$('#secretBg').classList.add('show');}$('#secretClose').onclick=()=>$('#secretBg').classList.remove('show');
  $('#tSave').onclick=async()=>{const body={name:$('#tName').value.trim(),username:$('#tUsername').value.trim(),phone:$('#tPhone').value.trim(),note:$('#tNote').value.trim(),active:$('#tActive').checked};try{if(curT){const r=await api('/api/admin/teachers/'+curT.id,'PUT',body);if(r.temporary_password)showSecret(r.temporary_password);}else{const r=await api('/api/admin/teachers','POST',body);showSecret(r.temporary_password);}$('#tBg').classList.remove('show');toast('Öğretmen kaydedildi.');await load();}catch(e){toast(e.message,true);}};
  $('#tReset').onclick=async()=>{if(!confirm('Mevcut şifre geçersiz olacak ve öğretmen tüm cihazlardan çıkacak. Yeni şifre üretilsin mi?'))return;try{const r=await api('/api/admin/teachers/'+curT.id+'/reset-password','POST');showSecret(r.temporary_password);await load();}catch(e){toast(e.message,true);}};
  $('#tUnlock').onclick=async()=>{try{await api('/api/admin/teachers/'+curT.id+'/unlock','POST');toast('Giriş kilidi kaldırıldı.');}catch(e){toast(e.message,true);}};
  $('#tLogoutAll').onclick=async()=>{if(!confirm('Öğretmenin tüm açık oturumları kapatılsın mı?'))return;try{await api('/api/admin/teachers/'+curT.id+'/logout-all','POST');toast('Tüm öğretmen oturumları kapatıldı.');await load();}catch(e){toast(e.message,true);}};
  $('#tArchive').onclick=async()=>{if(!curT||!confirm('Öğretmen erişimi kapatılacak ancak geçmiş etüt kayıtları korunacak. Devam edilsin mi?'))return;try{await api('/api/admin/teachers/'+curT.id,'DELETE');$('#tBg').classList.remove('show');toast('Öğretmen arşivlendi.');await load();}catch(e){toast(e.message,true);}};

  async function loadStudents(page=1,silent=false){
    try{const p=new URLSearchParams({page:String(page),limit:'50'});if(studentSearch)p.set('q',studentSearch);studentData=await api('/api/admin/students?'+p);renderStudents();}catch(e){if(!silent)toast(e.message,true);}
  }
  function renderStudents(){
    const rows=(studentData.items||[]).map(s=>`<tr><td><b>${esc(s.first_name)} ${esc(s.last_name)}</b></td><td>${esc(s.phone)}</td><td><span class="tag y">${esc(s.level)}</span></td><td>${s.active_bookings} aktif / ${s.total_slots} toplam</td><td><span class="tag ${s.active?'g':'r'}">${s.active?'Aktif':'Kapalı'}</span></td><td><button class="btn ghost sm" data-se="${s.id}">Düzenle</button></td></tr>`).join('');
    const pager=studentData.pages>1?`<tr><td colspan="6"><div class="pager"><span class="note">${studentData.total} öğrenci · Sayfa ${studentData.page}/${studentData.pages}</span><button class="btn ghost sm" data-sp="${studentData.page-1}" ${studentData.page<=1?'disabled':''}>←</button><button class="btn ghost sm" data-sp="${studentData.page+1}" ${studentData.page>=studentData.pages?'disabled':''}>→</button></div></td></tr>`:'';
    $('#sTable').innerHTML=`<tr><th>Öğrenci</th><th>Telefon</th><th>Seviye</th><th>Etütler</th><th>Erişim</th><th></th></tr>${rows||'<tr><td colspan="6" class="empty">Öğrenci bulunamadı.</td></tr>'}${pager}`;$('#sTable').querySelectorAll('[data-se]').forEach(b=>b.onclick=()=>openStudent(studentData.items.find(s=>String(s.id)===b.dataset.se)));$('#sTable').querySelectorAll('[data-sp]').forEach(b=>b.onclick=()=>loadStudents(Number(b.dataset.sp)));
    renderPhoneRequests();
  }
  function renderPhoneRequests(){
    $('#phoneRequests').innerHTML=(D?.phone_requests||[]).length?`<div class="card pending-box"><div class="eyebrow">Telefon değişikliği onayı</div>${D.phone_requests.map(r=>`<div class="request-row"><span><b>${esc(r.first_name)} ${esc(r.last_name)}</b><small>${esc(r.old_phone)} → ${esc(r.new_phone)}</small></span><div class="inline"><button class="btn ghost sm" data-pr="${r.id}" data-ok="0">Reddet</button><button class="btn primary sm" data-pr="${r.id}" data-ok="1">Onayla</button></div></div>`).join('')}</div>`:'';
    $('#phoneRequests').querySelectorAll('[data-pr]').forEach(b=>b.onclick=async()=>{try{await api('/api/admin/phone-requests/'+b.dataset.pr+'/resolve','POST',{approve:b.dataset.ok==='1'});toast('Telefon isteği işlendi.');await load();}catch(e){toast(e.message,true);}});
  }
  let sSearchTimer;$('#sSearch').oninput=()=>{clearTimeout(sSearchTimer);studentSearch=$('#sSearch').value.trim();sSearchTimer=setTimeout(()=>loadStudents(1),350);};
  async function openStudent(s){curStudent=s;$('#stFirst').value=s.first_name;$('#stLast').value=s.last_name;$('#stPhone').value=s.phone;$('#stLevel').value=s.level;$('#stActive').checked=s.active;stHistoryPage=1;$('#stHistory').innerHTML='<div class="empty">Yükleniyor…</div>';$('#studentBg').classList.add('show');await loadStudentHistory(1,false,true);}
  async function loadStudentHistory(page=1,silent=false,replace=false){
    if(!curStudent)return;try{const out=await api(`/api/admin/students/${curStudent.id}/bookings?page=${page}&limit=30`);stHistoryPage=out.page;stHistoryPages=out.pages;const html=out.items.length?out.items.map(x=>`<div class="notice"><span class="notice-dot"></span><span><b>${fmtDate(x.slot_date)} · ${esc(x.start_time)}-${esc(x.end_time)} · ${esc(x.level)}</b><em>${esc(x.teacher_name||'')}${x.topic?' · '+esc(x.topic):''}</em><small>${x.status==='active'?'Aktif':esc(x.status)}</small></span></div>`).join(''):'<div class="empty">Etüt geçmişi yok.</div>';if(replace)$('#stHistory').innerHTML=html;else $('#stHistory').insertAdjacentHTML('beforeend',html);$('#stHistoryMore').classList.toggle('hidden',stHistoryPage>=stHistoryPages);}
    catch(e){if(!silent)toast(e.message,true);}
  }
  $('#stHistoryMore').onclick=()=>loadStudentHistory(stHistoryPage+1);
  $('#stClose').onclick=()=>$('#studentBg').classList.remove('show');
  $('#stSave').onclick=async()=>{try{await api('/api/admin/students/'+curStudent.id,'PUT',{first_name:$('#stFirst').value,last_name:$('#stLast').value,phone:$('#stPhone').value,level:$('#stLevel').value,active:$('#stActive').checked});$('#studentBg').classList.remove('show');toast('Öğrenci güncellendi.');await load();}catch(e){toast(e.message,true);}};
  $('#stLogoutAll').onclick=async()=>{if(!confirm('Öğrencinin tüm cihazlardaki oturumları kapatılsın mı?'))return;try{await api('/api/admin/students/'+curStudent.id+'/logout-all','POST');toast('Öğrenci oturumları kapatıldı.');await load();}catch(e){toast(e.message,true);}};

  async function loadBookings(page=1,silent=false){try{const p=new URLSearchParams({page:String(page),limit:'50'});if(bookingSearch)p.set('q',bookingSearch);bookingData=await api('/api/admin/bookings?'+p);renderBookings();}catch(e){if(!silent)toast(e.message,true);}}
  function renderBookings(){
    const rows=(bookingData.items||[]).map(b=>`<tr><td>${fmtTs(b.created_at)}</td><td><b>${esc(b.first_name)} ${esc(b.last_name)}</b><br><small>${esc(b.phone)}</small></td><td><span class="tag y">${esc(b.level)}</span></td><td>${(b.slots||[]).map(s=>`<div class="booking-line ${s.status!=='active'?'muted-line':''}">${fmtDate(s.date)} ${DAYS[s.day]?.slice(0,3)} ${s.start}–${s.end} <span class="tag">${esc(s.level)}</span> ${esc(s.teacher||'')} ${s.status!=='active'?`<span class="tag r">${esc(s.status)}</span>`:''}</div>`).join('')}</td><td>${esc(b.topic)}</td><td><button class="btn danger sm" data-bd="${b.id}">Kaydı kaldır</button></td></tr>`).join('');
    const pager=bookingData.pages>1?`<tr><td colspan="6"><div class="pager"><span class="note">${bookingData.total} kayıt · Sayfa ${bookingData.page}/${bookingData.pages}</span><button class="btn ghost sm" data-bp="${bookingData.page-1}" ${bookingData.page<=1?'disabled':''}>←</button><button class="btn ghost sm" data-bp="${bookingData.page+1}" ${bookingData.page>=bookingData.pages?'disabled':''}>→</button></div></td></tr>`:'';
    $('#bTable').innerHTML=`<tr><th>Kayıt</th><th>Öğrenci</th><th>Seviye</th><th>Etütler</th><th>Konu</th><th></th></tr>${rows||'<tr><td colspan="6" class="empty">Kayıt yok.</td></tr>'}${pager}`;
    $('#bTable').querySelectorAll('[data-bd]').forEach(b=>b.onclick=async()=>{if(!confirm('Bu kayıt aktif etütlerden kaldırılacak ancak denetim geçmişi korunacak. Devam edilsin mi?'))return;try{await api('/api/admin/bookings/'+b.dataset.bd,'DELETE');toast('Kayıt kaldırıldı.');await load();}catch(e){toast(e.message,true);}});$('#bTable').querySelectorAll('[data-bp]').forEach(b=>b.onclick=()=>loadBookings(Number(b.dataset.bp)));
  }
  let bSearchTimer;$('#bSearch').oninput=()=>{clearTimeout(bSearchTimer);bookingSearch=$('#bSearch').value.trim();bSearchTimer=setTimeout(()=>loadBookings(1),350);};

  function notifHtml(items){return items.length?items.map(n=>`<button class="notice ${n.read?'':'unread'}" data-an="${n.id}"><span class="notice-dot"></span><span><b>${esc(n.title)}</b><em>${esc(n.body)}</em><small>${fmtTs(n.created_at)}</small></span></button>`).join(''):'<div class="empty">Bildirim yok.</div>';}
  function renderNotifications(){
    $('#adminNotifs').innerHTML=notifHtml(D.notifications)+(D.notifications.length>=50?'<button class="btn ghost sm" id="adminMoreNotifs">Daha eski bildirimleri yükle</button>':'');
    $('#adminNotifs').querySelectorAll('[data-an]').forEach(b=>b.onclick=async()=>{try{await api('/api/admin/notifications/'+b.dataset.an+'/read','POST');const n=D.notifications.find(x=>String(x.id)===String(b.dataset.an));if(n)n.read=true;renderNotifications();}catch(e){toast(e.message,true);}});const more=$('#adminMoreNotifs');if(more)more.onclick=loadOlderAdminNotifications;
    $('#auditTable').innerHTML=`<tr><th>Zaman</th><th>Aktör</th><th>İşlem</th><th>Nesne</th></tr>`+(D.audit||[]).map(a=>`<tr><td>${fmtTs(a.created_at)}</td><td>${esc(a.actor_type)}</td><td>${esc(a.action)}</td><td>${esc(a.entity_type)} ${esc(a.entity_id)}</td></tr>`).join('');
  }
  async function loadOlderAdminNotifications(){try{const before=Math.min(...D.notifications.map(n=>Number(n.id)));const out=await api(`/api/admin/notifications?limit=40&before_id=${before}`);if(out.items?.length){D.notifications.push(...out.items);renderNotifications();}else toast('Daha eski bildirim yok.');}catch(e){toast(e.message,true);}}
  $('#sendAnnouncement').onclick=async()=>{try{await api('/api/admin/announcements','POST',{audience:$('#annAudience').value,title:$('#annTitle').value,body:$('#annBody').value});$('#annBody').value='';toast('Duyuru panellere yayınlandı.');await load();}catch(e){toast(e.message,true);}};

  function fillSettings(){document.querySelectorAll('[data-s]').forEach(el=>el.value=D.settings[el.dataset.s]??'');settingsDirty=false;}
  document.querySelectorAll('[data-s],#newPw').forEach(el=>el.addEventListener('input',()=>settingsDirty=true));
  $('#saveSettings').onclick=async()=>{const body={};document.querySelectorAll('[data-s]').forEach(el=>body[el.dataset.s]=el.value);if($('#newPw').value)body.admin_password=$('#newPw').value;try{await api('/api/admin/settings','PUT',body);$('#newPw').value='';settingsDirty=false;toast('Ayarlar kaydedildi.');await load();}catch(e){toast(e.message,true);}};

  function logQuery(page=1){const p=new URLSearchParams({page:String(page),limit:'50'});if($('#logSeverity').value)p.set('severity',$('#logSeverity').value);if($('#logResolved').value)p.set('resolved',$('#logResolved').value);if($('#logRequest').value.trim())p.set('request_id',$('#logRequest').value.trim());if($('#logSearch').value.trim())p.set('q',$('#logSearch').value.trim());return p;}
  async function loadLogs(page=1,silent=false){try{logData=await api('/api/admin/logs?'+logQuery(page));renderLogs();}catch(e){if(!silent)toast(e.message,true);}}
  function renderLogs(){
    const s=logData.summary||{};$('#logStats').innerHTML=[[s.unresolved_errors||0,'Çözülmemiş hata'],[s.critical||0,'Kritik'],[s.warnings||0,'Uyarı'],[logData.total||0,'Filtre sonucu'],[logData.readiness?.database||'—','Veritabanı']].map(([v,l])=>`<div class="stat"><b>${esc(v)}</b><span>${l}</span></div>`).join('');
    $('#logTable').innerHTML=`<tr><th>Zaman</th><th>Seviye</th><th>Kaynak</th><th>Route / İşlem</th><th>Mesaj</th><th>Request ID</th><th>Durum</th></tr>`+(logData.items||[]).map(x=>`<tr class="${x.resolved?'':'log-row-unresolved'}" data-log="${x.id}"><td>${fmtTs(x.created_at)}</td><td><span class="log-severity ${esc(x.severity)}">${esc(x.severity)}</span></td><td>${esc(x.source)}<br><small>${esc(x.category)}</small></td><td>${esc(x.http_method||'')} ${esc(x.route||'')}<br><small>${esc(x.action||'')}</small></td><td>${esc(x.message)}</td><td><button class="btn ghost sm" data-copy="${esc(x.request_id||'')}">${esc(x.request_id||'—')}</button></td><td><span class="tag ${x.resolved?'g':'r'}">${x.resolved?'Çözüldü':'Açık'}</span></td></tr>`).join('');
    $('#logTable').querySelectorAll('[data-log]').forEach(r=>r.onclick=e=>{if(e.target.closest('[data-copy]'))return;openLog(Number(r.dataset.log));});$('#logTable').querySelectorAll('[data-copy]').forEach(b=>b.onclick=async e=>{e.stopPropagation();if(!b.dataset.copy)return;try{await navigator.clipboard.writeText(b.dataset.copy);toast('Request ID kopyalandı.');}catch{}});
    $('#logPager').innerHTML=`<span class="note">Sayfa ${logData.page||1}/${logData.pages||1}</span><button class="btn ghost sm" id="logPrev" ${(logData.page||1)<=1?'disabled':''}>← Önceki</button><button class="btn ghost sm" id="logNext" ${(logData.page||1)>=(logData.pages||1)?'disabled':''}>Sonraki →</button>`;$('#logPrev').onclick=()=>loadLogs(logData.page-1);$('#logNext').onclick=()=>loadLogs(logData.page+1);
  }
  $('#logFilterBtn').onclick=()=>loadLogs(1);$('#logSearch').onkeydown=e=>{if(e.key==='Enter')loadLogs(1);};$('#logRequest').onkeydown=e=>{if(e.key==='Enter')loadLogs(1);};
  function ensureLogModal(){if($('#logDetailBg'))return;document.body.insertAdjacentHTML('beforeend',`<div class="modal-bg" id="logDetailBg"><div class="modal wide"><div class="row-between"><div><div class="eyebrow">Sistem logu</div><h3 id="logDetailTitle">Log detayı</h3></div><button class="iconbtn" id="logDetailClose">×</button></div><div id="logDetailBody"></div><div class="actions"><button class="btn ghost" id="logResolveBtn">Durumu değiştir</button></div></div></div>`);$('#logDetailClose').onclick=()=>$('#logDetailBg').classList.remove('show');$('#logDetailBg').onclick=e=>{if(e.target===e.currentTarget)e.currentTarget.classList.remove('show');};}
  async function openLog(id){try{ensureLogModal();const x=await api('/api/admin/logs/'+id);$('#logDetailTitle').textContent=`${x.severity} · #${x.id}`;$('#logDetailBody').innerHTML=`<div class="slot-detail-grid"><div class="mini-stat"><span>Request ID</span><b>${esc(x.request_id||'—')}</b></div><div class="mini-stat"><span>Zaman</span><b>${fmtTs(x.created_at)}</b></div><div class="mini-stat"><span>Route</span><b>${esc((x.http_method||'')+' '+(x.route||''))}</b></div><div class="mini-stat"><span>Kullanıcı</span><b>${esc(x.user_role||'—')} ${x.user_id?('#'+x.user_id):''}</b></div></div><h4>Mesaj</h4><div class="log-detail">${esc(x.message||'')}</div>${x.stack_trace?`<h4>Stack trace</h4><div class="log-detail">${esc(x.stack_trace)}</div>`:''}<h4>Metadata</h4><div class="log-detail">${esc(JSON.stringify(x.metadata||{},null,2))}</div>`;const btn=$('#logResolveBtn');btn.textContent=x.resolved?'Yeniden aç':'Çözüldü olarak işaretle';btn.onclick=async()=>{try{await api('/api/admin/logs/'+id+'/resolve','PATCH',{resolved:!x.resolved});$('#logDetailBg').classList.remove('show');await loadLogs(logData.page);toast(x.resolved?'Log yeniden açıldı.':'Log çözüldü olarak işaretlendi.');}catch(e){toast(e.message,true);}};$('#logDetailBg').classList.add('show');}catch(e){toast(e.message,true);}}

  document.querySelectorAll('.modal-bg').forEach(m=>m.onclick=e=>{if(e.target===m)m.classList.remove('show');});
  start().catch(e=>{showLogin();toast(e.message,true);});
})();
