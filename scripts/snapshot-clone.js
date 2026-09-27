'use strict';
/*
  Read-only, safety-gated restored-clone snapshot comparator.
  Run only against a PRIVATE, verified restored copy of Kızılay data:
    ETUT_RESTORED_CLONE=YES DATABASE_URL=<clone-internal-url> ETUT_CLONE_DATABASE_NAME_CONFIRM=<db-name>
      node scripts/snapshot-clone.js before /private/etut-before.json
  [After the migration has run ONLY on clone, preferably twice]
      node scripts/snapshot-clone.js compare /private/etut-before.json
  Output stores counts and digests of existing rows, never raw names, phones or passwords.
  Do not place the JSON manifest in public repo or share credentials.
*/
const {Pool}=require('pg');
const fs=require('node:fs');
const crypto=require('node:crypto');
const args=process.argv.slice(2),mode=args[0],manifestPath=args[1];
if(!['before','compare'].includes(mode)||!manifestPath)throw Error('Usage: node scripts/snapshot-clone.js before|compare /private/manifest.json');
if(process.env.ETUT_RESTORED_CLONE!=='YES')throw Error('Requires ETUT_RESTORED_CLONE=YES with a disposable restored clone.');
let uri;try{uri=new URL(process.env.DATABASE_URL||'');}catch{throw Error('DATABASE_URL required for private restored clone.');}
const name=decodeURIComponent(uri.pathname.slice(1));
if(!/^postgres(?:ql)?:$/.test(uri.protocol)||!name||!['staging','clone','restored','disposable'].some(w=>name.toLowerCase().includes(w))||/production|prod(?!uce)/i.test(name)||process.env.ETUT_CLONE_DATABASE_NAME_CONFIRM!==name)throw Error('Database name must clearly identify a disposable restored staging clone and match ETUT_CLONE_DATABASE_NAME_CONFIRM exactly.');
const tables=['settings','teachers','slots','students','bookings','booking_slots','slot_occurrences','slot_cancellations','teacher_notifications','panel_notifications','notification_reads','phone_change_requests','auth_lockouts','audit_logs','messages','system_logs'];
// Never expose personal data in stdout or the final manifest. Cryptographic
// per-row digest lets the operator see whether an ORIGINAL row changed.
const digest=o=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,ssl:/sslmode=require|neon\.tech|supabase\./i.test(process.env.DATABASE_URL)?{rejectUnauthorized:false}:false});
const normalize=v=>{
  if(v instanceof Date)return v.toISOString();
  if(Buffer.isBuffer(v))return v.toString('hex');
  if(v&&typeof v==='object'&&!Array.isArray(v))return Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalize(v[k])]));
  if(Array.isArray(v))return v.map(normalize);
  return v;
};
async function capture(client,original=null){
  const result={created:new Date().toISOString(),tables:{}};
  for(const table of tables){
    const check=await client.query('SELECT to_regclass($1)::text table_name',[`public.${table}`]);
    if(!check.rows[0].table_name){if(original?.tables[table])throw Error('Original table disappeared: '+table);continue;}
    const columns=original?.tables?.[table]?.columns||(await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,[table])).rows.map(x=>x.column_name);
    const present=(await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,[table])).rows.map(x=>x.column_name);
    if(columns.some(x=>!present.includes(x)))throw Error('Original column disappeared from '+table);
    const {rows}=await client.query(`SELECT ${columns.map(c=>'"'+c.replace(/"/g,'""')+'"').join(',')} FROM "${table}"`);
    const preferred=['id','key','notification_id','actor_key'];const keyColumns=original?.tables?.[table]?.keys||preferred.filter(c=>columns.includes(c));
    // Hash sorted row digests; duplicates included in sorted array, so every
    // original row participates even in tables with composite primary keys.
    const hashes=rows.map(r=>digest(normalize(r))).sort();
    result.tables[table]={columns,keys:keyColumns,count:rows.length,sha256:digest(hashes),rowhashes:hashes};
  }
  return result;
}
async function run(){
  const client=await pool.connect();try{
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const {rows:[identity]}=await client.query("SELECT to_regclass('public.branch_identity')::text AS table_name");
    if(mode==='before' && identity.table_name)throw Error('Before snapshot must be taken BEFORE new migration against restored clone.');
    if(mode==='compare' && !identity.table_name)throw Error('After migration branch_identity sentinel is absent.');
    const original=mode==='compare'?JSON.parse(fs.readFileSync(manifestPath,'utf8')):null;
    if(original && original.manifest_version!==1)throw Error('Unrecognized baseline manifest version');
    if(original && original.db_name!==name)throw Error('Clone database name does not match baseline');
    const current=await capture(client,original?.snapshot);await client.query('COMMIT');
    if(mode==='before'){
      const data={manifest_version:1,db_name:name,snapshot:current};
      fs.writeFileSync(manifestPath,JSON.stringify(data,null,2),{encoding:'utf8',mode:0o600,flag:'wx'});
      console.log('Clone baseline snapshot written. Contains digests and counts, not readable PII.');return;
    }
    const {rows:[owner]}=await pool.query('SELECT branch_code FROM branch_identity');
    if(owner?.branch_code!=='kizilay')throw Error('Restored clone was not adopted as Kızılay.');
    const failures=[];
    for(const [table,before] of Object.entries(original.snapshot.tables)){
      const after=current.tables[table];
      if(!after){failures.push(`${table}: table missing`);continue;}
      // slot_occurrences may add previously absent dated records at startup.
      // Existing rows must remain, but a seeded old DB may gain historical rows.
      const additionAllowed=['settings','slot_occurrences','panel_notifications','system_logs','audit_logs'].includes(table);
      if((additionAllowed&&after.count<before.count)||(!additionAllowed&&after.count!==before.count))failures.push(`${table}: count ${before.count} -> ${after.count}`);
      const remaining=new Map();for(const h of after.rowhashes)remaining.set(h,(remaining.get(h)||0)+1);
      for(const h of before.rowhashes){const n=remaining.get(h)||0;if(!n)failures.push(`${table}: original row changed or removed`);else remaining.set(h,n-1);}
    }
    // Fresh migration inserts new branch settings and v3 migration ledger only;
    // all original settings must remain unchanged (including auth salt/hash).
    console.log(`Restored-copy data-preservation comparison: ${failures.length?'FAIL':'PASS'} (${Object.keys(original.snapshot.tables).length} legacy tables)`);
    for(const failure of [...new Set(failures)].slice(0,100))console.error('  ',failure);
    if(failures.length)process.exitCode=1;
  }finally{try{await client.query('ROLLBACK');}catch{}client.release();await pool.end();}
}
run().catch(e=>{console.error('CLONE SNAPSHOT ABORTED:',e.message);pool.end().catch(()=>{});process.exitCode=1;});
