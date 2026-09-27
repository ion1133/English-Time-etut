'use strict';
/*
  Extended three-branch integration tests. DESTRUCTIVE: ONLY a named disposable
  PostgreSQL test DB. This script NEVER tests or modifies a production branch.
  Unlike unit tests, requires a real PostgreSQL server and launched Express app.
*/
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {Pool}=require('pg');
const raw=String(process.env.ETUT_TEST_DATABASE_URL||'');
if(process.env.ETUT_TEST_DESTRUCTIVE!=='YES')throw Error('Explicit ETUT_TEST_DESTRUCTIVE=YES is required for a disposable test database.');
let uri;try{uri=new URL(raw);}catch{throw Error('ETUT_TEST_DATABASE_URL is required.');}
const dbname=decodeURIComponent(uri.pathname.slice(1));
if(!/^postgres(?:ql)?:$/.test(uri.protocol)||!/(?:test|disposable|scratch)/i.test(dbname)||/prod|kizilay|kecioren|pursaklar/i.test(dbname))throw Error('Test database name must clearly identify a disposable test database; branch databases forbidden.');
const pool=new Pool({connectionString:raw,max:25,ssl:/sslmode=require|neon\.tech|supabase\./i.test(raw)?{rejectUnauthorized:false}:false});
const ROOT=path.join(__dirname,'..');
const BASE='http://127.0.0.1:'+(process.env.ETUT_UPGRADE_TEST_PORT||31879);
const ADMIN='Upgrade-Fake-Only#2026';
const SECRET=crypto.randomBytes(40).toString('hex');
const legacyFixture=fs.readFileSync(path.join(__dirname,'fixtures','legacy-schema.sql'),'utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const q=(sql,p)=>pool.query(sql,p);
let proc,logs='',npass=0;
function futureDate(days){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const x=Object.fromEntries(parts.map(x=>[x.type,x.value]));const d=new Date(`${x.year}-${x.month}-${x.day}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function addDays(date,n){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function weekday(date){const d=new Date(date+'T00:00:00Z').getUTCDay();return d||7;}
const day=futureDate(2),nextWeek=addDays(day,7),weekdayNo=weekday(day);
const phone=n=>'05'+String(123456789+n).padStart(9,'0');
function fail(msg){throw Error(msg+(logs?'\nPROCESS LOG TAIL: '+logs.slice(-1100):''));}
async function reset(){await q('DROP SCHEMA IF EXISTS public CASCADE;CREATE SCHEMA public;GRANT ALL ON SCHEMA public TO public;');}
async function start(branch,adopt=false){
  if(proc)throw Error('Already started');logs='';
  proc=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,NODE_ENV:'test',BRANCH_CODE:branch,BRANCH_NAME:{kizilay:'Kızılay',kecioren:'Keçiören',pursaklar:'Pursaklar'}[branch],
    KIZILAY_ADOPTION_APPROVED:adopt?'YES':'NO',DATABASE_URL:raw,PORT:BASE.split(':').at(-1),SESSION_SECRET:SECRET,ADMIN_PASSWORD:ADMIN,
    PUBLIC_BASE_URL:`https://${branch}.ankara-englishtimeetut.com`,SEED_DEFAULT_SCHEDULE:'false',ETUT_ENABLE_TEST_ROUTES:'0'},stdio:['ignore','pipe','pipe']});
  proc.stdout.on('data',d=>logs+=String(d));proc.stderr.on('data',d=>logs+=String(d));
  const until=Date.now()+40000;
  while(Date.now()<until){if(proc.exitCode!==null)fail('App terminated unexpectedly.');
    try{const res=await fetch(BASE+'/readyz');if(res.status===200)return;}catch{}await sleep(200);
  }
  fail('App did not become ready.');
}
async function startExpectBlocked(branch){
  if(proc)throw Error('Already started');logs='';
  proc=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,NODE_ENV:'test',BRANCH_CODE:branch,BRANCH_NAME:branch,PORT:BASE.split(':').at(-1),DATABASE_URL:raw,SESSION_SECRET:SECRET,ADMIN_PASSWORD:ADMIN,SEED_DEFAULT_SCHEDULE:'false',KIZILAY_ADOPTION_APPROVED:'NO'},stdio:['ignore','pipe','pipe']});
  proc.stdout.on('data',d=>logs+=String(d));proc.stderr.on('data',d=>logs+=String(d));
  let health;for(let i=0;i<35;i++){try{health=await fetch(BASE+'/readyz');break;}catch{}await sleep(100);}
  assert.ok(health,'Server did not expose readiness endpoint.');await sleep(500);
  const r=await fetch(BASE+'/readyz');assert.equal(r.status,503,'Mismatched app cannot serve branch data');
  assert.match(logs,/MISMATCH|NOT ADOPTED|legacy/i);
}
async function stop(){if(!proc)return;const p=proc;proc=null;if(p.exitCode===null)p.kill('SIGTERM');await Promise.race([new Promise(r=>p.once('exit',r)),sleep(8000).then(()=>{if(p.exitCode===null)p.kill('SIGKILL');})]);}
async function api(method,route,body,jar){const headers={};if(body!==undefined)headers['Content-Type']='application/json';if(jar?.cookie)headers.Cookie=jar.cookie;
  const response=await fetch(BASE+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});if(jar&&response.headers.get('set-cookie'))jar.cookie=response.headers.get('set-cookie').split(';')[0];let data;try{data=await response.json();}catch{data={};}return {status:response.status,data};}
async function loginAdmin(){const jar={cookie:''};const r=await api('POST','/api/admin/login',{password:ADMIN},jar);assert.equal(r.status,200,JSON.stringify(r.data));return jar;}
async function slot(admin,level,hour,room,opts={}){const payload={day:weekdayNo,start_time:hour,end_time:(()=>{const [h,m]=hour.split(':').map(Number),end=h*60+m+25;return `${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`;})(),level,capacity:opts.capacity??0,classroom:room,...opts};
  const r=await api('POST','/api/admin/slots',payload,admin);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
async function studentPublic(slotId,n){return api('POST','/api/bookings',{first_name:'Upgradeperson',last_name:'Synthetic',phone:phone(n),level:'A1',slot_ids:[slotId],topic:'isolated integration test'});}
async function studentLogin(n,level='A1'){const jar={cookie:''};const r=await api('POST','/api/student/login',{first_name:'Upgradeperson',last_name:'Synthetic',phone:phone(n),level},jar);assert.equal(r.status,200,JSON.stringify(r.data));return jar;}
async function test(name,fn){await fn();npass++;console.log('PASS ',name);}
async function main(){
  await reset();await start('kecioren');
  await test('Keçiören fresh DB has correct immutable identity and zero real data',async()=>{
    const r=await q('SELECT branch_code FROM branch_identity');assert.deepEqual(r.rows.map(x=>x.branch_code),['kecioren']);
    const {rows:[setting]}=await q("SELECT value FROM settings WHERE key='branch_name'");assert.equal(setting.value,'Keçiören');
    for(const t of ['students','teachers','bookings','booking_slots','slots']){const {rows:[x]}=await q(`SELECT COUNT(*)::int n FROM ${t}`);assert.equal(x.n,0,t);}
  });
  await test('All three predefined categories / 17 levels exist and are isolated',async()=>{
    const {rows:[c]}=await q('SELECT COUNT(*)::int n FROM etut_categories');const {rows:[l]}=await q('SELECT COUNT(*)::int n FROM category_levels');assert.equal(c.n,3);assert.equal(l.n,17);
    const {rows:[teen]}=await q("SELECT COUNT(*)::int n FROM category_levels l JOIN etut_categories c ON c.id=l.category_id WHERE c.system_key='teenage' AND l.code='Teenage 5'");assert.equal(teen.n,1);
  });
  await test('Unauthorized branch admin endpoints denied',async()=>{
    let r=await api('GET','/api/admin/categories');assert.equal(r.status,401);r=await api('POST','/api/admin/categories',{slug:'wrong',name_tr:'Wrong',name_en:'Wrong',levels:['A1']});assert.equal(r.status,401);
  });
  const admin=await loginAdmin();
  await test('Branch base URL uses configured public HTTPS hostname',async()=>{
    const r=await api('GET','/api/admin/overview',undefined,admin);assert.equal(r.status,200);assert.equal(r.data.site_url,'https://kecioren.ankara-englishtimeetut.com');
  });
  await test('Admin independently sets per-branch quota',async()=>{
    const r=await api('PUT','/api/admin/settings',{max_weekly_etuts:'3',level_rule:'own'},admin);assert.equal(r.status,200,JSON.stringify(r.data));
    const {rows:[setting]}=await q("SELECT value FROM settings WHERE key='max_weekly_etuts'");assert.equal(setting.value,'3');
  });
  const slots=[];for(let i=0;i<20;i++){
    const mins=7*60+i*35;const time=`${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`;
    slots.push(await slot(admin,'A1',time,'UNIQUE-TEST-'+i));
  }
  const person=4781;
  await test('Public signup creates one student with one initial General English booking',async()=>{
    const r=await studentPublic(slots[0].id,person);assert.equal(r.status,200,JSON.stringify(r.data));
    const {rows:[e]}=await q("SELECT COUNT(*)::int n FROM student_category_enrollments e JOIN etut_categories c ON c.id=e.category_id WHERE c.system_key='general'");assert.equal(e.n,1);
  });
  const student=await studentLogin(person);
  await test('20 simultaneous same-identity bookings cannot breach cap 3',async()=>{
    const requests=slots.slice(1).map(s=>api('POST','/api/student/book',{selections:[{slot_id:s.id,date:day}]},student));
    const results=await Promise.all(requests);const success=results.filter(r=>r.status===200);
    const {rows:[x]}=await q("SELECT COUNT(*)::int n FROM booking_slots WHERE status='active'");
    assert.equal(x.n,3,JSON.stringify(results));assert.equal(success.length,2,JSON.stringify(results));
    assert.ok(results.filter(r=>r.status===409).length>=17);
  });
  await test('A new Istanbul week has an independent quota',async()=>{
    const r=await api('POST','/api/student/book',{selections:[{slot_id:slots[6].id,date:nextWeek}]},student);
    assert.equal(r.status,200,JSON.stringify(r.data));
  });
  await test('Admin occurrence occupancy uses exact occurrence date and secure roster',async()=>{
    const r=await api('GET',`/api/admin/slots/${slots[0].id}/occurrence?date=${day}`,undefined,admin);assert.equal(r.status,200,JSON.stringify(r.data));
    assert.equal(r.data.booked,1);assert.equal(r.data.roster.length,1);assert.ok(!JSON.stringify(r.data.roster).includes(phone(person)));
  });
  const create=await api('POST','/api/admin/categories',{slug:'german-language',name_tr:'Almanca',name_en:'German',requires_level:true,levels:['A1','A2']},admin);
  assert.equal(create.status,201,JSON.stringify(create.data));const german=create.data;
  const {rows:levels}=await q('SELECT id,code FROM category_levels WHERE category_id=$1 ORDER BY sort_order',[german.id]);
  const germanOne=await slot(admin,'A1','19:20','GERMAN-A1',{category_id:german.id,level_ids:[levels[0].id]});
  const germanTwo=await slot(admin,'A2','20:05','GERMAN-A2',{category_id:german.id,level_ids:[levels[1].id]});
  await test('Student cannot access un-enrolled category (even if similar level code)',async()=>{
    const r=await api('POST','/api/student/book',{selections:[{slot_id:germanOne.id,date:day}]},student);assert.equal(r.status,400,JSON.stringify(r.data));
  });
  const {rows:[dbStudent]}=await q('SELECT id FROM students WHERE phone=$1',[phone(person)]);
  await test('Admin category enrollment and per-student override are branch-local',async()=>{
    let r=await api('PUT',`/api/admin/students/${dbStudent.id}/enrollments/${german.id}`,{level_id:levels[0].id,active:true},admin);assert.equal(r.status,200,JSON.stringify(r.data));
    r=await api('PUT',`/api/admin/students/${dbStudent.id}/weekly-limit`,{max_weekly_etuts:0},admin);assert.equal(r.status,200,JSON.stringify(r.data));
    r=await api('POST','/api/student/book',{selections:[{slot_id:germanOne.id,date:day}]},student);assert.equal(r.status,200,JSON.stringify(r.data));
  });
  await test('Additional level is denied before explicit permission when global rule is own-only',async()=>{
    const r=await api('POST','/api/student/book',{selections:[{slot_id:germanTwo.id,date:day}]},student);assert.equal(r.status,400,JSON.stringify(r.data));
  });
  await test('Explicit category-level permission opens otherwise restricted level',async()=>{
    let r=await api('PUT',`/api/admin/students/${dbStudent.id}/level-grants/${levels[1].id}`,{active:true},admin);assert.equal(r.status,200,JSON.stringify(r.data));
    r=await api('POST','/api/student/book',{selections:[{slot_id:germanTwo.id,date:day}]},student);assert.equal(r.status,200,JSON.stringify(r.data));
  });
  await test('Student submits one pending per-category level request; duplicates rejected',async()=>{
    const {rows:[general]}=await q("SELECT id FROM etut_categories WHERE system_key='general'");
    const {rows:[a2]}=await q("SELECT id FROM category_levels WHERE category_id=$1 AND code='A2'",[general.id]);
    let r=await api('POST','/api/student/level-requests',{category_id:general.id,requested_level_id:a2.id,reason:'Synthetic integration'},student);assert.equal(r.status,201,JSON.stringify(r.data));
    r=await api('POST','/api/student/level-requests',{category_id:general.id,requested_level_id:a2.id},student);assert.equal(r.status,409,JSON.stringify(r.data));
    const inbox=await api('GET','/api/admin/level-requests',undefined,admin);assert.equal(inbox.status,200);assert.ok(inbox.data.items.length);
    const request=inbox.data.items[0];r=await api('POST',`/api/admin/level-requests/${request.id}/resolve`,{approve:true},admin);assert.equal(r.status,200,JSON.stringify(r.data));
  });
  await test('Approved General English level updates legacy login without rewriting booked snapshot',async()=>{
    const {rows:[x]}=await q('SELECT level FROM students WHERE id=$1',[dbStudent.id]);assert.equal(x.level,'A2');
    const r=await api('POST','/api/student/login',{first_name:'Upgradeperson',last_name:'Synthetic',phone:phone(person),level:'A1'});assert.equal(r.status,401);
    const newLogin=await studentLogin(person,'A2');const learning=await api('GET','/api/student/learning',undefined,newLogin);assert.equal(learning.status,200);
    const {rows:snapshots}=await q("SELECT DISTINCT level FROM booking_slots WHERE student_id=$1 AND status='active'",[dbStudent.id]);assert.ok(snapshots.some(s=>s.level==='A1'));
  });
  const {rows:[kecCount]}=await q("SELECT COUNT(*)::int n FROM students");assert.equal(kecCount.n,1);
  await stop();
  await test('Pursaklar code against existing Keçiören database fails CLOSED before migrations',async()=>{
    await startExpectBlocked('pursaklar');const {rows:own}=await q('SELECT branch_code FROM branch_identity');assert.equal(own[0].branch_code,'kecioren');await stop();
  });
  await reset();await start('pursaklar');
  await test('Fresh Pursaklar has zero copied people, bookings and slots',async()=>{
    const {rows:owner}=await q('SELECT branch_code FROM branch_identity');assert.equal(owner[0].branch_code,'pursaklar');
    const {rows:[cnt]}=await q('SELECT (SELECT COUNT(*) FROM slots)::int slots,(SELECT COUNT(*) FROM students)::int students,(SELECT COUNT(*) FROM bookings)::int bookings');assert.deepEqual([cnt.slots,cnt.students,cnt.bookings],[0,0,0]);
  });
  await stop();await reset();await q(legacyFixture);
  await test('Legacy Kızılay remains unmodified without explicit restored-copy adoption authorization',async()=>{
    const {rows:[before]}=await q('SELECT COUNT(*)::int n FROM students');await startExpectBlocked('kizilay');
    const {rows:[after]}=await q('SELECT COUNT(*)::int n FROM students');assert.equal(after.n,before.n);
    const {rows:[identity]}=await q("SELECT to_regclass('public.branch_identity')::text name");assert.equal(identity.name,null);
    await stop();
  });
  await start('kizilay',true);
  await test('Explicit fixture-only Kızılay adoption preserves legacy staff/students/cancelled rows',async()=>{
    const {rows:[owner]}=await q('SELECT branch_code FROM branch_identity');assert.equal(owner.branch_code,'kizilay');
    for(const table of ['teachers','students','bookings','booking_slots','slot_cancellations']){
      const {rows:[row]}=await q(`SELECT COUNT(*)::int n FROM ${table}`);assert.ok(row.n>=1,table);
    }
    const {rows:[slot]}=await q('SELECT status FROM booking_slots WHERE id=1');assert.equal(slot.status,'cancelled_by_student');
  });
  console.log(`RESULT: ${npass} extended PostgreSQL integration checks passed (on disposable DB only).`);
}
(async()=>{try{await main();}catch(e){console.error('FAIL:',e?.stack||e);process.exitCode=1;}finally{await stop();await pool.end();}})();
