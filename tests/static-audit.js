'use strict';
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const server=read('server.js'),db=read('db.js'),css=read('public/styles.css'),index=read('public/index.html'),student=read('public/student.html'),teacherJs=read('public/teacher.js'),studentJs=read('public/student.js'),appJs=read('public/app.js');
const checks=[];function ok(name,fn){try{fn();checks.push([name,true]);console.log('PASS ',name)}catch(e){checks.push([name,false]);console.error('FAIL ',name,'-',e.message)}}
ok('unsafe historical Admin password is rejection-only, never a fallback',()=>{assert.match(db,/KNOWN_UNSAFE_ADMIN_PASSWORD/);assert.doesNotMatch(db,/ADMIN_PASSWORD\s*\|\|\s*['\"]EnglishTime2026!/)});
ok('recurring slot removal is soft archive in production route',()=>{assert.match(server,/UPDATE slots SET active=false,deleted_at=NOW\(\)/);assert.doesNotMatch(server,/admin\.delete\('\/slots\/.*DELETE FROM slots/s)});
ok('BUG-044 lock targets slots row only',()=>{assert.match(server,/LEFT JOIN teachers[\s\S]{0,180}FOR UPDATE OF s/)});
ok('occurrence locks are deterministically sorted',()=>{assert.match(server,/sort\(\(a,b\) => a\.date\.localeCompare\(b\.date\) \|\| a\.slot_id - b\.slot_id\)/)});
ok('authenticated Student booking locks by Student id',()=>{assert.match(server,/SELECT \* FROM students WHERE id=\$1 FOR UPDATE[\s\S]{0,120}authenticatedStudentId/)});
ok('phone approval increments Student session_version',()=>{assert.match(server,/phone-requests[\s\S]*session_version=session_version\+1/)});
ok('Admin password changes increment admin_session_version',()=>{assert.match(server,/admin_session_version[\s\S]*admin_password/)});
ok('Teacher username changes can invalidate sessions',()=>{assert.match(server,/username\.toLowerCase\(\)[\s\S]*session_version=session_version\+\$8/)});
ok('mobile public links stay present',()=>{assert.match(index,/Etütlerim/);assert.match(index,/Öğretmen misiniz/);assert.match(css,/critical-links \.toplink\{display:flex!important/)});
ok('mobile Student New Etüt remains present',()=>{assert.match(student,/\+ Yeni Etüt/);assert.match(student,/critical-links single/)});
ok('student-facing selection tiles hide Teacher names',()=>{assert.match(appJs,/const place=s\.classroom\|\|''/);assert.match(studentJs,/class=\"meta\">\$\{esc\(s\.classroom\|\|''\)\}<\/span>/)});
ok('frontend polling avoids setInterval overlap pattern',()=>{for(const f of ['public/student.js','public/teacher.js','public/admin.js'])assert.doesNotMatch(read(f),/setInterval\s*\(/)});
ok('Teacher frontend has no phone field rendering',()=>{assert.doesNotMatch(teacherJs,/student\.phone|s\.phone|phone_number|telefon/i)});
ok('unknown API paths have JSON 404 before page fallback',()=>{assert.ok(server.indexOf("app.use('/api'")<server.indexOf("app.get('*'"));assert.match(server,/API yolu bulunamadı/)});
ok('structured system logs redact sensitive keys and secret-like text',()=>{assert.match(db,/sanitizeForLog/);assert.match(db,/redactText/);assert.match(db,/\[redacted\]/)});
ok('versioned migrations and startup serialization exist',()=>{assert.match(db,/CREATE TABLE IF NOT EXISTS schema_migrations/);assert.match(db,/pg_advisory_lock/);assert.match(db,/pg_advisory_unlock/)});
ok('no set of legacy Admin/Student hard result truncation limits remains',()=>{assert.doesNotMatch(server,/LIMIT\s+(300|600)\b/)});
ok('readyz stays 503 until database initialization and migrations finish',()=>{const start=server.indexOf("app.get('/readyz'");const end=server.indexOf("/* Unknown API paths",start);const block=server.slice(start,end);assert.match(block,/if\(!dbReady\)/);assert.match(block,/status\(503\)/);assert.match(block,/status\(200\)/);assert.ok(block.indexOf('if(!dbReady)')<block.indexOf("db.q('SELECT 1')"));});

ok('PostgreSQL DATE conversion preserves local calendar date across positive time zones',()=>{assert.match(server,/value\.getFullYear\(\)[\s\S]{0,180}value\.getDate\(\)/);const block=server.slice(server.indexOf('function dateISO'),server.indexOf('const fmtTR'));assert.doesNotMatch(block,/if \(value instanceof Date\) return iso\(value\)/)});
ok('Admin log endpoint honors requested small page limits',()=>{const start=server.indexOf("admin.get('/logs'");const end=server.indexOf("admin.get('/logs/:id'",start);const block=server.slice(start,end);assert.match(block,/Math\.max\(1,Number\(req\.query\.limit\)/)});
ok('Admin overview casts TEXT end_time before time comparison',()=>{assert.match(server,/bs\.end_time::time > \$2::time/)});

const failed=checks.filter(x=>!x[1]);console.log(`RESULT: ${checks.length-failed.length}/${checks.length} static checks passed`);process.exit(failed.length?1:0);
