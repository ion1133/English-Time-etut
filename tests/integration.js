'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const LEGACY_SQL = fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-schema.sql'), 'utf8');
const DB_URL = String(process.env.ETUT_TEST_DATABASE_URL || '').trim();
const DESTRUCTIVE = process.env.ETUT_TEST_DESTRUCTIVE === 'YES';
const ADMIN_PASSWORD = 'Etut-Test-Admin#2026';
const NEW_ADMIN_PASSWORD = 'Etut-Test-Admin#2026-New';
const SESSION_SECRET = crypto.randomBytes(48).toString('hex');
const PORT = Number(process.env.ETUT_TEST_PORT || 31876);
const BASE = `http://127.0.0.1:${PORT}`;

if (!DB_URL) {
  console.error('ETUT_TEST_DATABASE_URL is required.');
  process.exit(2);
}
if (!DESTRUCTIVE) {
  console.error('Refusing to run destructive tests. Set ETUT_TEST_DESTRUCTIVE=YES only for a disposable PostgreSQL database.');
  process.exit(2);
}

let parsed;
try { parsed = new URL(DB_URL); } catch { console.error('ETUT_TEST_DATABASE_URL is not a valid PostgreSQL URL.'); process.exit(2); }
if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) { console.error('Test URL must be PostgreSQL.'); process.exit(2); }
console.log(`TEST DATABASE: ${parsed.hostname}:${parsed.port || 5432}/${parsed.pathname.replace(/^\//,'')} (credentials hidden)`);
console.log('WARNING: the test suite DROPS AND RECREATES the public schema several times.');

const pool = new Pool({ connectionString: DB_URL, ssl: /sslmode=require|neon\.tech|supabase\.|render\.com|amazonaws\.com/i.test(DB_URL) ? { rejectUnauthorized:false } : false, max:20 });
const tests = [];
let passed = 0, failed = 0;
const failures = [];
function test(name, fn) { tests.push({name, fn}); }
async function runTest(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (e) { failed++; failures.push({name, error:e}); console.error(`FAIL  ${name}\n      ${e?.stack || e}`); }
}

async function q(text, params=[]) { return pool.query(text, params); }
async function resetSchema() {
  await q('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;');
}
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }
function istanbulDate(offsetDays=0) {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=t=>parts.find(x=>x.type===t)?.value;
  const d=new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+offsetDays); return d.toISOString().slice(0,10);
}
function dow(date) { const n=new Date(`${date}T00:00:00Z`).getUTCDay(); return n===0?7:n; }
function alpha(n) { let s=''; do { s=String.fromCharCode(97+(n%26))+s; n=Math.floor(n/26)-1; } while(n>=0); return s; }
function phone(n) { return `05${String(100000000+n).padStart(9,'0')}`; }

let appProc = null;
let appLog = '';
async function startServer(port=PORT, extraEnv={}) {
  if (appProc) throw new Error('server already running');
  appLog='';
  appProc=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,DATABASE_URL:DB_URL,NODE_ENV:'test',PORT:String(port),SESSION_SECRET,ADMIN_PASSWORD,ETUT_ENABLE_TEST_ROUTES:'1',...extraEnv},stdio:['ignore','pipe','pipe']});
  appProc.stdout.on('data',d=>{appLog+=d.toString();}); appProc.stderr.on('data',d=>{appLog+=d.toString();});
  const base=`http://127.0.0.1:${port}`;
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){
    if(appProc.exitCode!==null) throw new Error(`server exited early (${appProc.exitCode})\n${appLog}`);
    try { const r=await fetch(`${base}/readyz`); if(r.status===200) return; } catch {}
    await sleep(250);
  }
  throw new Error(`server did not become ready\n${appLog}`);
}
async function stopServer() {
  if(!appProc) return;
  const p=appProc; appProc=null;
  if(p.exitCode===null) p.kill('SIGTERM');
  await Promise.race([new Promise(r=>p.once('exit',r)),sleep(12000).then(()=>{if(p.exitCode===null)p.kill('SIGKILL');})]);
}

class Jar { constructor(cookie=''){this.cookie=cookie;} clone(){return new Jar(this.cookie);} }
async function api(method, urlPath, {jar=null, body=undefined, origin=BASE, headers={}}={}) {
  const h={Accept:'application/json',...headers};
  if(body!==undefined) h['Content-Type']='application/json';
  if(origin!==null && ['POST','PUT','PATCH','DELETE'].includes(method)) h.Origin=origin;
  if(jar?.cookie) h.Cookie=jar.cookie;
  const r=await fetch(`${BASE}${urlPath}`,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
  const sc=r.headers.get('set-cookie'); if(jar&&sc){const first=sc.split(';')[0];if(first.includes('=')) jar.cookie=first;}
  const text=await r.text(); let data; try{data=text?JSON.parse(text):null;}catch{data=text;}
  return {status:r.status,data,headers:r.headers,text};
}
async function adminLogin(password=ADMIN_PASSWORD) { const jar=new Jar(); const r=await api('POST','/api/admin/login',{jar,body:{password}}); assert.equal(r.status,200,JSON.stringify(r.data)); return jar; }
async function createTeacher(adminJar, suffix='main') {
  const r=await api('POST','/api/admin/teachers',{jar:adminJar,body:{name:`Teacher ${suffix.replace(/[^A-Za-z]/g,'')||'Main'}`,username:`teacher.${suffix}`.toLowerCase(),phone:'05000000099',note:'test',active:true}});
  assert.equal(r.status,200,JSON.stringify(r.data)); assert.ok(r.data.temporary_password); return {teacher:r.data.teacher,password:r.data.temporary_password};
}
async function createSlot(adminJar,{day=dow(istanbulDate(2)),start='08:00',end='08:30',level='A1',teacher_id=null,classroom='TEST ROOM',capacity=0}={}) {
  const r=await api('POST','/api/admin/slots',{jar:adminJar,body:{day,start_time:start,end_time:end,level,teacher_id,classroom,capacity}});
  assert.equal(r.status,200,JSON.stringify(r.data)); return r.data;
}
async function publicBook(slotIds, n, first=`Student${alpha(n)}`, last='Tester', p=phone(n), level='A1') {
  return api('POST','/api/bookings',{body:{first_name:first.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g,''),last_name:last,phone:p,level,topic:'Automated test',slot_ids:slotIds}});
}

async function freshMigrationPhase() {
  console.log('\n=== PHASE 1: FRESH DATABASE / MIGRATIONS ===');
  await resetSchema(); await startServer();
  await runTest('fresh DB initializes and /readyz is healthy', async()=>{const r=await fetch(`${BASE}/readyz`);assert.equal(r.status,200);});
  await runTest('schema_migrations exists and versions are recorded', async()=>{const {rows}=await q('SELECT version,name FROM schema_migrations ORDER BY version');assert.ok(rows.length>=2);assert.deepEqual(rows.slice(0,2).map(x=>Number(x.version)),[1,2]);});
  await runTest('Admin bootstrap is hashed and plaintext is blank', async()=>{const {rows}=await q("SELECT key,value FROM settings WHERE key IN ('admin_password','admin_password_hash','admin_password_salt')");const s=Object.fromEntries(rows.map(x=>[x.key,x.value]));assert.equal(s.admin_password,'');assert.ok(s.admin_password_hash.length>50);assert.ok(s.admin_password_salt.length>=16);});
  await runTest('known historical fallback Admin password cannot authenticate', async()=>{const r=await api('POST','/api/admin/login',{body:{password:'EnglishTime2026!'}});assert.equal(r.status,401);});
  await runTest('fresh install seeds recurring schedule once', async()=>{const {rows:[x]}=await q('SELECT COUNT(*)::int n FROM slots');assert.ok(x.n>0);});
  const {rows:migs1}=await q('SELECT version,applied_at FROM schema_migrations ORDER BY version');
  await stopServer(); await startServer();
  await runTest('second startup is migration-idempotent', async()=>{const {rows}=await q('SELECT version,applied_at FROM schema_migrations ORDER BY version');assert.equal(rows.length,migs1.length);for(let i=0;i<rows.length;i++)assert.equal(new Date(rows[i].applied_at).getTime(),new Date(migs1[i].applied_at).getTime());});
  await stopServer();
  await q('DELETE FROM slots');
  await startServer();
  await runTest('empty schedule after initial seed does not reseed on restart', async()=>{const {rows:[x]}=await q('SELECT COUNT(*)::int n FROM slots');assert.equal(x.n,0);});
  await stopServer();
}

async function legacyMigrationPhase() {
  console.log('\n=== PHASE 2: LEGACY UPGRADE ===');
  await resetSchema(); await q(LEGACY_SQL); await startServer();
  await runTest('legacy schema upgrades without losing representative records', async()=>{
    const [t,s,sl,b,bs,c,n]=await Promise.all(['teachers','students','slots','bookings','booking_slots','slot_cancellations','panel_notifications'].map(table=>q(`SELECT COUNT(*)::int n FROM ${table}`)));
    for(const r of [t,s,sl,b,bs,c,n]) assert.ok(r.rows[0].n>=1);
  });
  await runTest('legacy plaintext Admin password migrates to scrypt and clears plaintext', async()=>{const {rows}=await q("SELECT key,value FROM settings WHERE key IN ('admin_password','admin_password_hash','admin_password_salt')");const st=Object.fromEntries(rows.map(x=>[x.key,x.value]));assert.equal(st.admin_password,'');assert.ok(st.admin_password_hash);assert.ok(st.admin_password_salt);});
  await runTest('legacy slot gains soft-delete fields and remains active', async()=>{const {rows:[x]}=await q('SELECT active,deleted_at FROM slots WHERE id=1');assert.equal(x.active,true);assert.equal(x.deleted_at,null);});
  await runTest('legacy cancelled booking and dated cancellation are preserved', async()=>{const {rows:[bs]}=await q('SELECT status,cancel_note FROM booking_slots WHERE id=1');assert.equal(bs.status,'cancelled_by_student');const {rows:[cx]}=await q('SELECT note FROM slot_cancellations WHERE slot_id=1');assert.equal(cx.note,'Legacy dated cancellation');});
  await runTest('legacy FK hard-delete cascade is replaced by history-preserving restriction', async()=>{await assert.rejects(()=>q('DELETE FROM slots WHERE id=1'),e=>e.code==='23503');});
  await stopServer();
}

async function mainApiPhase() {
  console.log('\n=== PHASE 3: API / CONCURRENCY / SECURITY ===');
  await resetSchema(); await startServer();
  let admin=await adminLogin();
  await runTest('security headers are present and X-Powered-By is absent', async()=>{const r=await fetch(`${BASE}/`);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.equal(r.headers.get('x-frame-options'),'DENY');assert.ok(r.headers.get('content-security-policy'));assert.equal(r.headers.get('x-powered-by'),null);});
  await runTest('unknown API route returns JSON 404', async()=>{const r=await api('GET','/api/definitely-not-real');assert.equal(r.status,404);assert.equal(typeof r.data,'object');});
  await runTest('foreign Origin mutation is rejected', async()=>{const r=await api('POST','/api/admin/announcements',{jar:admin,origin:'https://evil.example',body:{audience:'students',body:'x'}});assert.equal(r.status,403);});
  await runTest('invalid announcement audience is rejected', async()=>{const r=await api('POST','/api/admin/announcements',{jar:admin,body:{audience:'typo-everyone',body:'x'}});assert.equal(r.status,400);});
  await runTest('invalid semantic occurrence date returns 400 instead of DB 500', async()=>{const {rows:[s]}=await q('SELECT id FROM slots WHERE active=true LIMIT 1');const r=await api('POST',`/api/admin/slots/${s.id}/cancel`,{jar:admin,body:{date:'2026-02-31',cancelled:true}});assert.equal(r.status,400);});
  await runTest('invalid numeric route ID is handled cleanly', async()=>{const r=await api('POST','/api/admin/teachers/not-a-number/unlock',{jar:admin,body:{}});assert.equal(r.status,400);});
  let settings=await api('PUT','/api/admin/settings',{jar:admin,body:{min_days_ahead:'0',max_weeks_ahead:'8',level_rule:'all'}}); assert.equal(settings.status,200,JSON.stringify(settings.data));

  const teacherInfo=await createTeacher(admin,'main');
  // Keep the main API fixtures at least two Istanbul calendar days ahead so a test run crossing midnight cannot turn a future fixture into an already-ended session.
  const futureDate=istanbulDate(2), day=dow(futureDate);

  const capSlot=await createSlot(admin,{day,start:'08:00',end:'08:30',classroom:'TEST CAPACITY',capacity:1});
  const raceResults=await Promise.all(Array.from({length:20},(_,i)=>publicBook([capSlot.id],100+i,`Race${alpha(i)}`,'Capacity',phone(100+i))));
  await runTest('20 concurrent last-seat attempts never exceed capacity', async()=>{const ok=raceResults.filter(x=>x.status===200);assert.equal(ok.length,1,`successes=${ok.length}, statuses=${raceResults.map(x=>x.status)}`);const {rows:[c]}=await q(`SELECT COUNT(*)::int n FROM booking_slots WHERE slot_id=$1 AND status='active'`,[capSlot.id]);assert.equal(c.n,1);});
  const winnerIndex=raceResults.findIndex(x=>x.status===200), winnerPhone=phone(100+winnerIndex), winnerFirst=`Race${alpha(winnerIndex)}`;

  // Restart resets only in-memory abuse counters; DB state remains intact.
  await stopServer(); await startServer(); admin=await adminLogin();

  const slotA=await createSlot(admin,{day,start:'09:00',end:'09:30',classroom:'TEST MULTI A',capacity:0});
  const slotB=await createSlot(admin,{day,start:'09:40',end:'10:10',classroom:'TEST MULTI B',capacity:0});
  const [ab,ba]=await Promise.all([publicBook([slotA.id,slotB.id],300,'Orderalpha','Tester',phone(300)),publicBook([slotB.id,slotA.id],301,'Orderbeta','Tester',phone(301))]);
  await runTest('opposite-order multi-slot bookings complete without deadlock', async()=>{assert.equal(ab.status,200,JSON.stringify(ab.data));assert.equal(ba.status,200,JSON.stringify(ba.data));});

  const dupA=await createSlot(admin,{day,start:'10:20',end:'10:40',classroom:'TEST DUP A',capacity:0});
  const dupB=await createSlot(admin,{day,start:'10:50',end:'11:10',classroom:'TEST DUP B',capacity:0});
  const samePhone=phone(320);
  const [d1,d2]=await Promise.all([publicBook([dupA.id],320,'Duplicate','Student',samePhone),publicBook([dupB.id],320,'Duplicate','Student',samePhone)]);
  await runTest('concurrent public requests do not create duplicate Student profiles', async()=>{assert.equal(d1.status,200);assert.equal(d2.status,200);const {rows:[x]}=await q(`SELECT COUNT(*)::int n FROM students WHERE phone=$1 AND LOWER(first_name)='duplicate' AND LOWER(last_name)='student'`,[samePhone]);assert.equal(x.n,1);});

  await runTest('public invalid phone is rejected', async()=>{const r=await api('POST','/api/bookings',{body:{first_name:'Valid',last_name:'Name',phone:'123',level:'A1',slot_ids:[slotA.id]}});assert.equal(r.status,400);});
  await runTest('public Unicode names are accepted', async()=>{const unique=phone(330);const r=await api('POST','/api/bookings',{body:{first_name:'Çağrı',last_name:'Şahin',phone:unique,level:'A1',slot_ids:[slotA.id]}});assert.equal(r.status,200,JSON.stringify(r.data));});
  await runTest('public identity mismatch does not reveal saved CEFR level', async()=>{const r=await api('POST','/api/bookings',{body:{first_name:'Çağrı',last_name:'Şahin',phone:phone(330),level:'C2',slot_ids:[slotB.id]}});assert.equal(r.status,409);assert.ok(!JSON.stringify(r.data).includes('A1'));});
  await runTest('invalid public name characters are rejected', async()=>{const r=await api('POST','/api/bookings',{body:{first_name:'Name123',last_name:'Tester',phone:phone(331),level:'A1',slot_ids:[slotA.id]}});assert.equal(r.status,400);});
  const levelSlot=await createSlot(admin,{day,start:'10:12',end:'10:18',classroom:'TEST CEFR ALL',capacity:0});
  await runTest('public booking accepts Student CEFR A1 through C2 when rule permits', async()=>{for(let i=0;i<6;i++){const level=['A1','A2','B1','B2','C1','C2'][i];const r=await publicBook([levelSlot.id],340+i,`Level${alpha(i)}`,'Tester',phone(340+i),level);assert.equal(r.status,200,`${level}: ${JSON.stringify(r.data)}`);}});
  await api('PUT','/api/admin/settings',{jar:admin,body:{level_rule:'own'}});
  const ineligibleSlot=await createSlot(admin,{day,start:'10:19',end:'10:25',level:'B2',classroom:'TEST INELIGIBLE',capacity:0});
  await runTest('ineligible CEFR booking is rejected server-side', async()=>{const r=await publicBook([ineligibleSlot.id],350,'Ineligible','Tester',phone(350),'A1');assert.equal(r.status,400);});
  await api('PUT','/api/admin/settings',{jar:admin,body:{level_rule:'all'}});
  const cancelledSlot=await createSlot(admin,{day,start:'10:26',end:'10:32',classroom:'TEST CANCELLED PUBLIC',capacity:0});
  let cx=await api('POST',`/api/admin/slots/${cancelledSlot.id}/cancel`,{jar:admin,body:{date:futureDate,cancelled:true,note:'test'}});assert.equal(cx.status,200);
  await runTest('public booking rejects a dated-cancelled occurrence', async()=>{const r=await publicBook([cancelledSlot.id],351,'Cancelled','Tester',phone(351),'A1');assert.equal(r.status,409);});
  const today=istanbulDate(0);
  const startedSlot=await createSlot(admin,{day:dow(today),start:'00:00',end:'00:01',classroom:'TEST STARTED',capacity:0});
  await runTest('public booking rejects an already-started occurrence', async()=>{const r=await publicBook([startedSlot.id],352,'Started','Tester',phone(352),'A1');assert.equal(r.status,409);});

  // Reset only in-memory abuse counters before the rest of the suite. Signed sessions remain valid.
  await stopServer(); await startServer();

  // Student cancellation / rebooking using the capacity winner.
  const studentJar=new Jar(); let lr=await api('POST','/api/student/login',{jar:studentJar,body:{first_name:winnerFirst,last_name:'Capacity',phone:winnerPhone,level:'A1'}}); assert.equal(lr.status,200,JSON.stringify(lr.data));
  await runTest('Student login failure is generic and does not disclose saved level', async()=>{const r=await api('POST','/api/student/login',{body:{first_name:winnerFirst,last_name:'Capacity',phone:winnerPhone,level:'C2'}});assert.equal(r.status,401);assert.ok(!JSON.stringify(r.data).includes('A1'));});
  let dash=await api('GET',`/api/student/dashboard?week=${futureDate}`,{jar:studentJar}); assert.equal(dash.status,200);
  const activeWinner=dash.data.bookings.find(x=>Number(x.slot_id)===Number(capSlot.id)&&x.status==='active'); assert.ok(activeWinner);
  await runTest('duplicate active Student booking is rejected', async()=>{const r=await api('POST','/api/student/book',{jar:studentJar,body:{selections:[{slot_id:capSlot.id,date:futureDate}]}});assert.equal(r.status,409);});
  await runTest('invalid semantic Student selection date returns 400', async()=>{const r=await api('POST','/api/student/book',{jar:studentJar,body:{selections:[{slot_id:slotA.id,date:'2026-02-31'}]}});assert.equal(r.status,400);});
  const boundarySlot=await createSlot(admin,{day:dow(istanbulDate(56)),start:'20:10',end:'20:30',classroom:'TEST HORIZON',capacity:0});
  await runTest('exact configured max booking horizon is accepted and farther date is rejected', async()=>{const exact=istanbulDate(56),far=istanbulDate(63);let r=await api('POST','/api/student/book',{jar:studentJar,body:{selections:[{slot_id:boundarySlot.id,date:exact}]}});assert.equal(r.status,200,JSON.stringify(r.data));r=await api('POST','/api/student/book',{jar:studentJar,body:{selections:[{slot_id:boundarySlot.id,date:far}]}});assert.equal(r.status,400);});
  let cancel=await api('POST',`/api/student/bookings/${activeWinner.id}/cancel`,{jar:studentJar,body:{}}); assert.equal(cancel.status,200,JSON.stringify(cancel.data));
  await runTest('Student cancellation immediately frees capacity and preserves cancelled history', async()=>{const {rows:[c]}=await q(`SELECT COUNT(*)::int n FROM booking_slots WHERE slot_id=$1 AND status='active'`,[capSlot.id]);assert.equal(c.n,0);const {rows:[row]}=await q('SELECT status FROM booking_slots WHERE id=$1',[activeWinner.id]);assert.equal(row.status,'cancelled_by_student');});
  let rebook=await api('POST','/api/student/book',{jar:studentJar,body:{selections:[{slot_id:capSlot.id,date:futureDate}],topic:'again'}}); assert.equal(rebook.status,200,JSON.stringify(rebook.data));
  await runTest('Student can rebook after cancellation', async()=>{const {rows:[c]}=await q(`SELECT COUNT(*)::int n FROM booking_slots WHERE slot_id=$1 AND student_id=(SELECT id FROM students WHERE phone=$2 AND LOWER(first_name)=LOWER($3)) AND status='active'`,[capSlot.id,winnerPhone,winnerFirst]);assert.equal(c.n,1);});
  const disabledPhone=phone(360);const disabledSlot=await createSlot(admin,{day,start:'11:11',end:'11:16',classroom:'TEST DISABLED STUDENT',capacity:0});let disabledBook=await publicBook([disabledSlot.id],360,'Disabled','Student',disabledPhone);assert.equal(disabledBook.status,200);const {rows:[disabledRow]}=await q('SELECT id FROM students WHERE phone=$1',[disabledPhone]);let ds=await api('PUT',`/api/admin/students/${disabledRow.id}`,{jar:admin,body:{active:false}});assert.equal(ds.status,200);
  await runTest('disabled Student is denied login', async()=>{const r=await api('POST','/api/student/login',{body:{first_name:'Disabled',last_name:'Student',phone:disabledPhone,level:'A1'}});assert.equal(r.status,403);});

  const overlap1=await createSlot(admin,{day,start:'11:20',end:'12:00',classroom:'TEST OVERLAP STUDENT 1',capacity:0});
  const overlap2=await createSlot(admin,{day,start:'11:40',end:'12:20',classroom:'TEST OVERLAP STUDENT 2',capacity:0});
  let ob1=await api('POST','/api/student/book',{jar:studentJar,body:{selections:[{slot_id:overlap1.id,date:futureDate}]}}); assert.equal(ob1.status,200);
  await runTest('Student overlap is rejected server-side', async()=>{const r=await api('POST','/api/student/book',{jar:studentJar,body:{selections:[{slot_id:overlap2.id,date:futureDate}]}});assert.equal(r.status,409);});

  // Teacher permission / lockout / session lifecycle.
  const teacherJar=new Jar(); let tl=await api('POST','/api/teacher/login',{jar:teacherJar,body:{username:teacherInfo.teacher.username,password:teacherInfo.password}}); assert.equal(tl.status,200);
  await runTest('Teacher has read-only access and cannot call Admin schedule mutation', async()=>{const r=await api('PUT',`/api/admin/slots/${slotA.id}`,{jar:teacherJar,body:{classroom:'NO'}});assert.equal(r.status,401);});
  for(let i=0;i<5;i++) await api('POST','/api/teacher/login',{body:{username:teacherInfo.teacher.username,password:'wrong-password'}});
  await runTest('Teacher failed-login lockout activates after five failures', async()=>{const r=await api('POST','/api/teacher/login',{body:{username:teacherInfo.teacher.username,password:teacherInfo.password}});assert.equal(r.status,423);});
  let unl=await api('POST',`/api/admin/teachers/${teacherInfo.teacher.id}/unlock`,{jar:admin,body:{}}); assert.equal(unl.status,200);
  let tnew=new Jar(); tl=await api('POST','/api/teacher/login',{jar:tnew,body:{username:teacherInfo.teacher.username,password:teacherInfo.password}}); assert.equal(tl.status,200);
  const oldTeacherCookie=tnew.clone();
  let reset=await api('POST',`/api/admin/teachers/${teacherInfo.teacher.id}/reset-password`,{jar:admin,body:{}}); assert.equal(reset.status,200);
  await runTest('Teacher password reset invalidates old session', async()=>{const r=await api('GET',`/api/teacher/dashboard?week=${futureDate}`,{jar:oldTeacherCookie});assert.equal(r.status,401);});
  let teacherAfterReset=new Jar(); tl=await api('POST','/api/teacher/login',{jar:teacherAfterReset,body:{username:teacherInfo.teacher.username,password:reset.data.temporary_password}}); assert.equal(tl.status,200);
  const preUsernameCookie=teacherAfterReset.clone();
  const newUsername='teacher.renamed';
  let tu=await api('PUT',`/api/admin/teachers/${teacherInfo.teacher.id}`,{jar:admin,body:{name:'Teacher Main',username:newUsername,phone:'05000000099',note:'test',active:true}}); assert.equal(tu.status,200,JSON.stringify(tu.data));
  await runTest('Teacher username change invalidates existing session', async()=>{const r=await api('GET',`/api/teacher/dashboard?week=${futureDate}`,{jar:preUsernameCookie});assert.equal(r.status,401);});
  teacherAfterReset=new Jar(); tl=await api('POST','/api/teacher/login',{jar:teacherAfterReset,body:{username:newUsername,password:reset.data.temporary_password}}); assert.equal(tl.status,200);

  const teacherSlot=await createSlot(admin,{day,start:'12:30',end:'13:00',teacher_id:teacherInfo.teacher.id,classroom:'TEST TEACHER OWN',capacity:3});
  let teacherStudent=await publicBook([teacherSlot.id],400,'Teacherstudent','Tester',phone(400)); assert.equal(teacherStudent.status,200,JSON.stringify(teacherStudent.data));
  await runTest('Teacher dashboard sees all etüts, own highlight/NEW state and never Student phone', async()=>{const r=await api('GET',`/api/teacher/dashboard?week=${futureDate}`,{jar:teacherAfterReset});assert.equal(r.status,200);const raw=JSON.stringify(r.data);assert.ok(raw.includes('Teacherstudent'));assert.ok(!raw.includes(phone(400)));const own=r.data.week.slots.find(x=>Number(x.id)===Number(teacherSlot.id));assert.ok(own?.own);assert.ok(Number(own.new_count)>=1);assert.ok(r.data.week.slots.some(x=>!x.own));});

  await runTest('Teacher overlap is rejected server-side', async()=>{const r=await api('POST','/api/admin/slots',{jar:admin,body:{day,start_time:'12:40',end_time:'13:10',level:'A1',teacher_id:teacherInfo.teacher.id,classroom:'TEST TEACHER OTHER ROOM',capacity:2}});assert.equal(r.status,409);});
  await runTest('Classroom overlap is rejected server-side', async()=>{const r=await api('POST','/api/admin/slots',{jar:admin,body:{day,start_time:'12:40',end_time:'13:10',level:'A1',teacher_id:null,classroom:'TEST TEACHER OWN',capacity:2}});assert.equal(r.status,409);});
  await runTest('malformed teacher_id is rejected before PostgreSQL cast', async()=>{const r=await api('POST','/api/admin/slots',{jar:admin,body:{day,start_time:'13:05',end_time:'13:15',level:'A1',teacher_id:'not-an-id',classroom:'TEST BAD TEACHER ID',capacity:2}});assert.equal(r.status,400);});
  const secondTeacher=await createTeacher(admin,'second');const secondJar=new Jar();let stl=await api('POST','/api/teacher/login',{jar:secondJar,body:{username:secondTeacher.teacher.username,password:secondTeacher.password}});assert.equal(stl.status,200);
  await runTest('Teacher reassignment moves own-highlight from old Teacher to new Teacher', async()=>{const u=await api('PUT',`/api/admin/slots/${teacherSlot.id}`,{jar:admin,body:{teacher_id:secondTeacher.teacher.id}});assert.equal(u.status,200,JSON.stringify(u.data));const old=await api('GET',`/api/teacher/dashboard?week=${futureDate}`,{jar:teacherAfterReset});const neu=await api('GET',`/api/teacher/dashboard?week=${futureDate}`,{jar:secondJar});assert.equal(old.status,200);assert.equal(neu.status,200);assert.equal(!!old.data.week.slots.find(x=>Number(x.id)===Number(teacherSlot.id))?.own,false);assert.equal(!!neu.data.week.slots.find(x=>Number(x.id)===Number(teacherSlot.id))?.own,true);});
  await runTest('Teacher cannot mark another Teacher direct notification as read', async()=>{const {rows:[n]}=await q(`INSERT INTO panel_notifications(target_type,target_id,title,body,kind) VALUES('teacher',$1,'Scoped','Only first','info') RETURNING id`,[teacherInfo.teacher.id]);const r=await api('POST',`/api/teacher/notifications/${n.id}/read`,{jar:secondJar,body:{}});assert.equal(r.status,200);const {rows:[c]}=await q(`SELECT COUNT(*)::int n FROM notification_reads WHERE notification_id=$1 AND viewer_type='teacher' AND viewer_id=$2`,[n.id,secondTeacher.teacher.id]);assert.equal(c.n,0);});
  await runTest('Teacher notification pagination uses deterministic before_id', async()=>{for(let i=0;i<3;i++)await q(`INSERT INTO panel_notifications(target_type,target_id,title,body,kind) VALUES('teacher',$1,$2,'x','info')`,[secondTeacher.teacher.id,`Page ${i}`]);const a=await api('GET','/api/teacher/notifications?limit=1',{jar:secondJar});assert.equal(a.status,200);assert.equal(a.data.items.length,1);const b=await api('GET',`/api/teacher/notifications?limit=1&before_id=${a.data.next_before}`,{jar:secondJar});assert.equal(b.status,200);assert.equal(b.data.items.length,1);assert.ok(Number(b.data.items[0].id)<Number(a.data.items[0].id));});
  const oldBroadcast=await api('POST','/api/admin/announcements',{jar:admin,body:{audience:'teachers',title:'Before account',body:'Historical broadcast'}});assert.equal(oldBroadcast.status,200);await sleep(20);const newAccountTeacher=await createTeacher(admin,'newaccount');const newAccountJar=new Jar();stl=await api('POST','/api/teacher/login',{jar:newAccountJar,body:{username:newAccountTeacher.teacher.username,password:newAccountTeacher.password}});assert.equal(stl.status,200);
  await runTest('new Teacher account does not see broadcasts from before account creation', async()=>{const r=await api('GET','/api/teacher/notifications?limit=100',{jar:newAccountJar});assert.equal(r.status,200);assert.ok(!r.data.items.some(x=>x.title==='Before account'));});

  // BUG-044 and schedule propagation with a booked occurrence.
  const schedSlot=await createSlot(admin,{day,start:'14:00',end:'14:30',classroom:'TEST SCHEDULE OLD',capacity:3});
  let sr=await publicBook([schedSlot.id],410,'Schedules','Tester',phone(410)); assert.equal(sr.status,200);
  await runTest('BUG-044: Admin can edit a booked recurring slot against PostgreSQL', async()=>{const r=await api('PUT',`/api/admin/slots/${schedSlot.id}`,{jar:admin,body:{start_time:'14:05',end_time:'14:35',classroom:'TEST SCHEDULE NEW'}});assert.equal(r.status,200,JSON.stringify(r.data));const {rows:[bs]}=await q(`SELECT start_time,end_time,classroom FROM booking_slots WHERE slot_id=$1 AND status='active'`,[schedSlot.id]);assert.equal(bs.start_time,'14:05');assert.equal(bs.end_time,'14:35');assert.equal(bs.classroom,'TEST SCHEDULE NEW');const {rows:[stu]}=await q('SELECT id FROM students WHERE phone=$1',[phone(410)]);const {rows:[n]}=await q(`SELECT COUNT(*)::int n FROM panel_notifications WHERE target_type='student' AND target_id=$1 AND kind='schedule'`,[stu.id]);assert.ok(n.n>=1);});
  await runTest('capacity reduction never ejects booked Student and preserves occurrence capacity snapshot', async()=>{const r=await api('PUT',`/api/admin/slots/${schedSlot.id}`,{jar:admin,body:{capacity:1}});assert.equal(r.status,200);const {rows:[x]}=await q(`SELECT so.capacity,(SELECT COUNT(*)::int FROM booking_slots bs WHERE bs.slot_id=$1 AND bs.status='active') active FROM slot_occurrences so WHERE so.slot_id=$1 ORDER BY slot_date LIMIT 1`,[schedSlot.id]);assert.equal(x.active,1);assert.equal(Number(x.capacity),3);});
  await runTest('level change with active bookings requires explicit confirmation', async()=>{const no=await api('PUT',`/api/admin/slots/${schedSlot.id}`,{jar:admin,body:{level:'B1'}});assert.equal(no.status,409);assert.equal(no.data.code,'LEVEL_CONFIRM');const yes=await api('PUT',`/api/admin/slots/${schedSlot.id}`,{jar:admin,body:{level:'B1',confirm_level_change:true}});assert.equal(yes.status,200);const {rows:[c]}=await q(`SELECT COUNT(*)::int n FROM booking_slots WHERE slot_id=$1 AND status='active'`,[schedSlot.id]);assert.equal(c.n,1);});
  await runTest('dated cancel/restore preserves original booking row', async()=>{let c=await api('POST',`/api/admin/slots/${schedSlot.id}/cancel`,{jar:admin,body:{date:futureDate,cancelled:true,note:'test cancel'}});assert.equal(c.status,200);let x=await q('SELECT 1 FROM slot_cancellations WHERE slot_id=$1 AND slot_date=$2',[schedSlot.id,futureDate]);assert.equal(x.rowCount,1);let b=await q(`SELECT status FROM booking_slots WHERE slot_id=$1 LIMIT 1`,[schedSlot.id]);assert.equal(b.rows[0].status,'active');c=await api('POST',`/api/admin/slots/${schedSlot.id}/cancel`,{jar:admin,body:{date:futureDate,cancelled:false}});assert.equal(c.status,200);x=await q('SELECT 1 FROM slot_cancellations WHERE slot_id=$1 AND slot_date=$2',[schedSlot.id,futureDate]);assert.equal(x.rowCount,0);});

  // Cancellation vs booking serialization on an occurrence with existing state.
  const raceSlot=await createSlot(admin,{day,start:'15:00',end:'15:30',classroom:'TEST CANCEL RACE',capacity:5});
  let seed=await publicBook([raceSlot.id],420,'Seedrace','Tester',phone(420)); assert.equal(seed.status,200);
  const [newBooking,cancelRace]=await Promise.all([publicBook([raceSlot.id],421,'Secondrace','Tester',phone(421)),api('POST',`/api/admin/slots/${raceSlot.id}/cancel`,{jar:admin,body:{date:futureDate,cancelled:true,note:'race'}})]);
  await runTest('booking vs Admin cancellation serializes coherently', async()=>{assert.equal(cancelRace.status,200);assert.ok([200,409].includes(newBooking.status),`booking status ${newBooking.status}`);const {rows:[cx]}=await q('SELECT id FROM slot_cancellations WHERE slot_id=$1 AND slot_date=$2',[raceSlot.id,futureDate]);assert.ok(cx);if(newBooking.status===200){const {rows:[s]}=await q('SELECT id FROM students WHERE phone=$1',[phone(421)]);const {rows:[n]}=await q(`SELECT COUNT(*)::int n FROM panel_notifications WHERE target_type='student' AND target_id=$1 AND kind='cancellation'`,[s.id]);assert.ok(n.n>=1);}});
  const editRaceSlot=await createSlot(admin,{day,start:'15:35',end:'15:55',classroom:'TEST EDIT RACE OLD',capacity:5});let ers=await publicBook([editRaceSlot.id],425,'Editseed','Tester',phone(425));assert.equal(ers.status,200);
  const [editRaceBook,editRaceAdmin]=await Promise.all([publicBook([editRaceSlot.id],426,'Editsecond','Tester',phone(426)),api('PUT',`/api/admin/slots/${editRaceSlot.id}`,{jar:admin,body:{classroom:'TEST EDIT RACE NEW'}})]);
  await runTest('booking vs recurring schedule change serializes without stale snapshot', async()=>{assert.equal(editRaceAdmin.status,200);assert.equal(editRaceBook.status,200);const {rows}=await q(`SELECT DISTINCT classroom FROM booking_slots WHERE slot_id=$1 AND status='active'`,[editRaceSlot.id]);assert.deepEqual(rows.map(x=>x.classroom),['TEST EDIT RACE NEW']);});

  // Cancelled rows move when a future occurrence is edited.
  const moveSlot=await createSlot(admin,{day,start:'16:00',end:'16:30',classroom:'TEST MOVE CANCELLED',capacity:2});
  let mv=await publicBook([moveSlot.id],430,'Movecancel','Tester',phone(430)); assert.equal(mv.status,200);
  const moveStudentJar=new Jar(); lr=await api('POST','/api/student/login',{jar:moveStudentJar,body:{first_name:'Movecancel',last_name:'Tester',phone:phone(430),level:'A1'}});assert.equal(lr.status,200);
  dash=await api('GET',`/api/student/dashboard?week=${futureDate}`,{jar:moveStudentJar});const mvbs=dash.data.bookings.find(x=>Number(x.slot_id)===Number(moveSlot.id));assert.ok(mvbs);cancel=await api('POST',`/api/student/bookings/${mvbs.id}/cancel`,{jar:moveStudentJar,body:{}});assert.equal(cancel.status,200);
  await runTest('cancelled booking snapshots update with future schedule edit while retaining status', async()=>{const r=await api('PUT',`/api/admin/slots/${moveSlot.id}`,{jar:admin,body:{start_time:'16:05',end_time:'16:35',classroom:'TEST MOVE UPDATED'}});assert.equal(r.status,200);const {rows:[x]}=await q('SELECT status,start_time,end_time,classroom FROM booking_slots WHERE id=$1',[mvbs.id]);assert.equal(x.status,'cancelled_by_student');assert.equal(x.start_time,'16:05');assert.equal(x.classroom,'TEST MOVE UPDATED');});

  // Slot archive is soft and retains booking history.
  const archiveSlot=await createSlot(admin,{day,start:'17:00',end:'17:30',classroom:'TEST ARCHIVE',capacity:2});
  let ar=await publicBook([archiveSlot.id],440,'Archive','Tester',phone(440));assert.equal(ar.status,200);
  await runTest('archiving a booked slot requires confirmation then preserves history', async()=>{let r=await api('DELETE',`/api/admin/slots/${archiveSlot.id}`,{jar:admin});assert.equal(r.status,409);r=await api('DELETE',`/api/admin/slots/${archiveSlot.id}?confirm=1`,{jar:admin});assert.equal(r.status,200);const {rows:[s]}=await q('SELECT active,deleted_at FROM slots WHERE id=$1',[archiveSlot.id]);assert.equal(s.active,false);assert.ok(s.deleted_at);const {rows:[b]}=await q('SELECT status FROM booking_slots WHERE slot_id=$1 LIMIT 1',[archiveSlot.id]);assert.equal(b.status,'cancelled_by_admin');});

  // Phone change/profile race and session invalidation.
  const oldStudentCookie=studentJar.clone();
  let pr=await api('POST','/api/student/phone-change',{jar:studentJar,body:{phone:phone(500)}});assert.equal(pr.status,200);
  const {rows:[request]}=await q(`SELECT id FROM phone_change_requests WHERE student_id=(SELECT id FROM students WHERE phone=$1 AND LOWER(first_name)=LOWER($2)) AND status='pending'`,[winnerPhone,winnerFirst]);assert.ok(request);
  const [profileRace,approveRace]=await Promise.all([api('PUT','/api/student/profile',{jar:studentJar,body:{first_name:'Concurrent',last_name:'Student'}}),api('POST',`/api/admin/phone-requests/${request.id}/resolve`,{jar:admin,body:{approve:true}})]);
  await runTest('profile edit vs phone approval keeps identity_key invariant', async()=>{assert.equal(profileRace.status,200,JSON.stringify(profileRace.data));assert.equal(approveRace.status,200,JSON.stringify(approveRace.data));const {rows:[s]}=await q('SELECT * FROM students WHERE phone=$1',[phone(500)]);assert.ok(s);const expected=`${phone(500)}|${String(s.first_name).trim().toLocaleLowerCase('tr-TR')}|${String(s.last_name).trim().toLocaleLowerCase('tr-TR')}`;assert.equal(s.identity_key,expected);});
  await runTest('approved phone change invalidates old Student session and old phone', async()=>{let r=await api('GET','/api/student/dashboard',{jar:oldStudentCookie});assert.equal(r.status,401);r=await api('POST','/api/student/login',{body:{first_name:'Concurrent',last_name:'Student',phone:winnerPhone,level:'A1'}});assert.equal(r.status,401);const j=new Jar();r=await api('POST','/api/student/login',{jar:j,body:{first_name:'Concurrent',last_name:'Student',phone:phone(500),level:'A1'}});assert.equal(r.status,200);});

  // Siblings: same phone, distinct names.
  const sibSlot1=await createSlot(admin,{day,start:'18:00',end:'18:20',classroom:'TEST SIB 1',capacity:0});
  const sibSlot2=await createSlot(admin,{day,start:'18:30',end:'18:50',classroom:'TEST SIB 2',capacity:0});
  const familyPhone=phone(510); let sa=await publicBook([sibSlot1.id],510,'Siblingone','Family',familyPhone), sb=await publicBook([sibSlot2.id],511,'Siblingtwo','Family',familyPhone);
  await runTest('siblings sharing one phone remain distinct profiles', async()=>{assert.equal(sa.status,200);assert.equal(sb.status,200);const {rows:[x]}=await q('SELECT COUNT(*)::int n FROM students WHERE phone=$1',[familyPhone]);assert.equal(x.n,2);});

  // Inactive teacher cannot be assigned and deactivation clears future snapshots.
  const inactiveInfo=await createTeacher(admin,'inactive');
  const inactiveSlot=await createSlot(admin,{day,start:'19:00',end:'19:20',teacher_id:inactiveInfo.teacher.id,classroom:'TEST INACTIVE PROP',capacity:2});
  let ib=await publicBook([inactiveSlot.id],520,'Inactivebook','Tester',phone(520));assert.equal(ib.status,200);
  let deact=await api('PUT',`/api/admin/teachers/${inactiveInfo.teacher.id}`,{jar:admin,body:{name:'Teacher Inactive',username:inactiveInfo.teacher.username,phone:'',note:'',active:false}});assert.equal(deact.status,200);
  await runTest('deactivating Teacher removes future assignments from recurring and materialized snapshots', async()=>{const {rows:[sl]}=await q('SELECT teacher_id FROM slots WHERE id=$1',[inactiveSlot.id]);assert.equal(sl.teacher_id,null);const {rows:[o]}=await q('SELECT teacher_id,teacher_name FROM slot_occurrences WHERE slot_id=$1 ORDER BY slot_date LIMIT 1',[inactiveSlot.id]);assert.equal(o.teacher_id,null);assert.equal(o.teacher_name,'');const {rows:[b]}=await q('SELECT teacher_id,teacher_name FROM booking_slots WHERE slot_id=$1 LIMIT 1',[inactiveSlot.id]);assert.equal(b.teacher_id,null);assert.equal(b.teacher_name,'');});
  await runTest('inactive Teacher assignment is rejected through API', async()=>{const r=await api('POST','/api/admin/slots',{jar:admin,body:{day,start_time:'19:30',end_time:'19:50',level:'A1',teacher_id:inactiveInfo.teacher.id,classroom:'TEST INACTIVE REJECT',capacity:2}});assert.equal(r.status,400);});
  await runTest('inactive Teacher is denied login', async()=>{const r=await api('POST','/api/teacher/login',{body:{username:inactiveInfo.teacher.username,password:inactiveInfo.password}});assert.equal(r.status,401);});

  // Structured system logging / request IDs / redaction.
  let boom=await api('GET','/api/__test/error');
  await runTest('unexpected 500 returns safe request_id and never stack trace', async()=>{assert.equal(boom.status,500);assert.ok(boom.data.request_id);assert.ok(!('stack' in boom.data));assert.ok(!JSON.stringify(boom.data).includes('Intentional integration-test exception'));});
  await sleep(100);
  await runTest('Admin can search the same request_id and see diagnostic stack', async()=>{const r=await api('GET',`/api/admin/logs?request_id=${encodeURIComponent(boom.data.request_id)}`,{jar:admin});assert.equal(r.status,200);assert.ok(r.data.items.length>=1);const row=r.data.items.find(x=>x.request_id===boom.data.request_id);assert.ok(row);const d=await api('GET',`/api/admin/logs/${row.id}`,{jar:admin});assert.equal(d.status,200);assert.ok(String(d.data.stack_trace||'').includes('Intentional integration-test exception'));const rr=await api('PATCH',`/api/admin/logs/${row.id}/resolve`,{jar:admin,body:{resolved:true}});assert.equal(rr.status,200);assert.equal(rr.data.resolved,true);});
  await runTest('client error logging redacts secret-looking strings', async()=>{const secret='DoNotStoreThisSecret987';const r=await api('POST','/api/client-errors',{body:{page:'/student',message:`password=${secret}`,stack:`DATABASE_URL=postgresql://u:${secret}@host/db`}});assert.equal(r.status,202);const {rows:[x]}=await q(`SELECT message,stack_trace,metadata::text FROM system_logs WHERE request_id=$1`,[r.data.request_id]);const raw=JSON.stringify(x);assert.ok(!raw.includes(secret),raw);assert.ok(raw.includes('[redacted]'));});
  await runTest('log filters/pagination return bounded result sets', async()=>{const r=await api('GET','/api/admin/logs?severity=ERROR&limit=1&page=1',{jar:admin});assert.equal(r.status,200);assert.ok(Array.isArray(r.data.items));assert.ok(r.data.items.length<=1);});

  // Admin password session version.
  const staleAdmin=admin.clone();
  let ap=await api('PUT','/api/admin/settings',{jar:admin,body:{admin_password:NEW_ADMIN_PASSWORD}});assert.equal(ap.status,200);
  await runTest('Admin password change invalidates old Admin session while refreshing current one', async()=>{let r=await api('GET','/api/admin/overview',{jar:staleAdmin});assert.equal(r.status,401);r=await api('GET','/api/admin/overview',{jar:admin});assert.equal(r.status,200);r=await api('POST','/api/admin/login',{body:{password:ADMIN_PASSWORD}});assert.equal(r.status,401);const j=new Jar();r=await api('POST','/api/admin/login',{jar:j,body:{password:NEW_ADMIN_PASSWORD}});assert.equal(r.status,200);});

  await runTest('readiness and liveness are healthy with database available', async()=>{const h=await fetch(`${BASE}/healthz`),r=await fetch(`${BASE}/readyz`);assert.equal(h.status,200);assert.equal(r.status,200);});

  // Abuse controls last because they intentionally poison in-memory buckets for this process.
  await runTest('Student login has per-IP rate limiting', async()=>{let last;for(let i=0;i<31;i++) last=await api('POST','/api/student/login',{body:{first_name:'Nobody',last_name:'Person',phone:'05999999999',level:'A1'}});assert.equal(last.status,429);});
  await runTest('Admin login brute-force protection activates', async()=>{let last;for(let i=0;i<9;i++) last=await api('POST','/api/admin/login',{body:{password:'wrong-admin-password'}});assert.equal(last.status,429);});

  await stopServer();
}

async function operationalFailurePhase() {
  console.log('\n=== PHASE 4: FAILURE / SHUTDOWN SEMANTICS ===');
  const badPort=PORT+1, badBase=`http://127.0.0.1:${badPort}`;
  let log='';
  const p=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,DATABASE_URL:'postgresql://postgres:invalid@127.0.0.1:9/postgres',NODE_ENV:'test',PORT:String(badPort),SESSION_SECRET,ADMIN_PASSWORD,ETUT_ENABLE_TEST_ROUTES:'0'},stdio:['ignore','pipe','pipe']});
  p.stdout.on('data',d=>log+=d);p.stderr.on('data',d=>log+=d);
  let health=null; const deadline=Date.now()+12000;
  while(Date.now()<deadline){try{health=await fetch(`${badBase}/healthz`);break;}catch{} await sleep(100);}
  await runTest('/healthz remains process-liveness while /readyz is non-2xx without DB', async()=>{assert.ok(health);assert.equal(health.status,200);const r=await fetch(`${badBase}/readyz`);assert.equal(r.status,503);});
  await sleep(300);
  await runTest('DB-unavailable startup emits console diagnostics even when DB logging is impossible', async()=>{assert.match(String(log),/DB init failed|database|ECONNREFUSED/i);});
  p.kill('SIGTERM'); const exit=await Promise.race([new Promise(r=>p.once('exit',(code,signal)=>r({code,signal}))),sleep(12000).then(()=>({timeout:true}))]);
  await runTest('SIGTERM triggers bounded graceful shutdown', async()=>{assert.ok(!exit.timeout,`process did not exit; log=${log}`);});

  // A gated test-only route throws outside Express to verify the uncaughtException strategy exits instead of continuing corrupted state.
  const crashPort=badPort+1, crashBase=`http://127.0.0.1:${crashPort}`;let crashLog='';const crash=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,DATABASE_URL:DB_URL,NODE_ENV:'test',PORT:String(crashPort),SESSION_SECRET,ADMIN_PASSWORD:NEW_ADMIN_PASSWORD,ETUT_ENABLE_TEST_ROUTES:'1'},stdio:['ignore','pipe','pipe']});crash.stdout.on('data',d=>crashLog+=d);crash.stderr.on('data',d=>crashLog+=d);const readyDeadline=Date.now()+30000;while(Date.now()<readyDeadline){try{const r=await fetch(`${crashBase}/readyz`);if(r.status===200)break;}catch{}await sleep(100);}
  const trigger=await fetch(`${crashBase}/api/__test/uncaught`,{method:'POST',headers:{Origin:crashBase,'Content-Type':'application/json'},body:'{}'});assert.equal(trigger.status,202);const crashExit=await Promise.race([new Promise(r=>crash.once('exit',(code,signal)=>r({code,signal}))),sleep(12000).then(()=>({timeout:true}))]);
  await runTest('uncaughtException strategy logs and exits instead of silently continuing', async()=>{assert.ok(!crashExit.timeout,`crash process did not exit; ${crashLog}`);assert.match(crashLog,/Uncaught exception|Intentional uncaught integration-test exception/);});
}

(async()=>{
  const started=Date.now();
  try {
    await freshMigrationPhase();
    await legacyMigrationPhase();
    await mainApiPhase();
    await operationalFailurePhase();
  } catch (fatal) {
    failed++; failures.push({name:'FATAL TEST HARNESS ERROR',error:fatal}); console.error('\nFATAL:',fatal.stack||fatal);
  } finally {
    try{await stopServer();}catch{} try{await pool.end();}catch{}
  }
  console.log('\n========================================');
  console.log(`RESULT: ${passed} passed, ${failed} failed, ${passed+failed} total`);
  console.log(`DURATION: ${((Date.now()-started)/1000).toFixed(1)}s`);
  if(failures.length){console.log('\nFAILED TESTS:');for(const f of failures)console.log(`- ${f.name}: ${f.error?.message||f.error}`);}
  process.exit(failed?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
