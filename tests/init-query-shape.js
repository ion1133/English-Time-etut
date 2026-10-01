'use strict';
// Non-database regression: exercise the real startup/legacy backfill JavaScript
// with a fake pg client that rejects malformed query arguments.  This catches
// valid-JS SQL quoting errors (e.g. a string subtraction becoming NaN) that
// `node --check` and a text-only audit cannot detect.  It does NOT validate
// PostgreSQL SQL syntax, migration correctness, or data preservation.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const originalLoad = Module._load;
const originalEnv = { DATABASE_URL: process.env.DATABASE_URL, BRANCH_CODE: process.env.BRANCH_CODE,
  NODE_ENV: process.env.NODE_ENV, KIZILAY_ADOPTION_APPROVED: process.env.KIZILAY_ADOPTION_APPROVED };

async function runScenario(migrated) {
  const state = {
    branchIdentity: migrated,
    owner: migrated ? 'kizilay' : null,
    migrations: new Set(migrated ? [1, 2, 3, 4] : [1, 2]),
    settings: { branch_name: 'Kızılay', admin_password_hash: 'existing-hash',
      admin_password_salt: 'existing-salt', admin_password: '', initial_schedule_seeded: 'true' },
    backfillReached: false, lockReleased: false, queries: 0, auditParams: null,
  };
  async function fakeQuery(sql, values) {
    assert.equal(typeof sql, 'string', `pg query SQL must be a string, got ${String(sql)}`);
    assert.ok(sql.trim(), 'SQL must not be empty');
    assert.ok(values === undefined || Array.isArray(values), 'pg query parameters must be an array');
    state.queries++;
    if (/pg_advisory_unlock/.test(sql)) state.lockReleased = true;
    if (/INSERT INTO system_logs\(/.test(sql)) state.auditParams=values;
    if (/SELECT to_regclass\('public.settings'\)/.test(sql)) return {rows:[{settings_table:'settings'}]};
    if (/SELECT to_regclass\('public.branch_identity'\)/.test(sql)) return {rows:[{table_name:state.branchIdentity ? 'branch_identity' : null}]};
    if (/SELECT version FROM schema_migrations/.test(sql)) return {rows:state.migrations.has(values[0]) ? [{version:values[0]}] : []};
    if (/INSERT INTO schema_migrations/.test(sql)) {state.migrations.add(values[0]);return {rows:[],rowCount:1};}
    if (/SELECT branch_code FROM branch_identity/.test(sql)) return {rows:state.owner ? [{branch_code:state.owner}] : []};
    if (/SELECT value FROM settings WHERE key='branch_name'/.test(sql)) return {rows:[{value:'Kızılay'}]};
    if (/CREATE TABLE IF NOT EXISTS branch_identity/.test(sql)) state.branchIdentity=true;
    if (/INSERT INTO branch_identity/.test(sql)) state.owner=values[0];
    if (/INSERT INTO etut_categories\(/.test(sql)) return {rows:[{id:values[3]==='general'?1:values[3]==='junior'?2:3}]};
    if (/SELECT id FROM etut_categories WHERE system_key='general'/.test(sql)) return {rows:[{id:1}]};
    if (/SELECT key, value FROM settings/.test(sql)) return {rows:Object.entries(state.settings).map(([key,value])=>({key,value}))};
    if (/INSERT INTO settings\(key,value\)/.test(sql)) {state.settings[values[0]]=values[1];return {rows:[],rowCount:1};}
    if (/INSERT INTO settings \(key, value\)/.test(sql)) {
      if (!(values[0] in state.settings)) state.settings[values[0]]=values[1];
      return {rows:[],rowCount:1};
    }
    if (/SELECT DISTINCT first_name,last_name,phone,level/.test(sql)) return {rows:[]};
    if (/UPDATE booking_slots SET category_id=/.test(sql)) {
      assert.match(sql, /string_to_array\(level,'-'\)/);
      assert.deepEqual(values, [1, 'General English']);
      state.backfillReached=true;
    }
    return {rows:[],rowCount:0};
  }
  class FakePool {
    async query(...args) {return fakeQuery(...args);}
    async connect() {return {query:fakeQuery,release(){}};}
    async end() {}
  }
  process.env.DATABASE_URL='postgres://not-a-real-server:pass@localhost:5432/staging_mock';
  process.env.NODE_ENV='production';process.env.BRANCH_CODE='kizilay';process.env.KIZILAY_ADOPTION_APPROVED='YES';
  const dbPath=path.resolve(__dirname,'../db.js');delete require.cache[dbPath];
  Module._load=function(request,parent,isMain){if(request==='pg'&&parent?.filename===dbPath)return {Pool:FakePool};return originalLoad.apply(this,arguments);};
  let db;
  try {db=require(dbPath);}finally{Module._load=originalLoad;}
  try {
    await db.init();
    await db.logSystem({severity:'ERROR',message:'mock audit with absent optional IDs'});
    assert.equal(state.auditParams[7],null,'missing log HTTP status should be NULL');
    assert.equal(state.auditParams[9],null,'missing log user ID should be NULL');
  }finally {await db.close();delete require.cache[dbPath];}
  assert.equal(state.backfillReached,true,'legacy General English booking backfill was not exercised');
  assert.equal(state.lockReleased,true,'startup advisory lock was not released');
  assert.ok(state.queries>25,'the startup path was not meaningfully exercised');
  assert.ok(state.migrations.has(4),'migrations 3/4 were not exercised/recognized');
  console.log(`PASS  ${migrated?'already-migrated':'legacy adoption'} startup query argument shapes (${state.queries} calls)`);
}
async function runLockFailureScenario() {
  let released=0,unlockAttempted=false;
  class PoolWithFailedLock {
    async connect(){return {async query(sql){if(/pg_advisory_lock/.test(sql))throw new Error('simulated lock outage');if(/pg_advisory_unlock/.test(sql))unlockAttempted=true;},release(){released++;}};}
    async end(){}
  }
  const dbPath=path.resolve(__dirname,'../db.js');delete require.cache[dbPath];
  process.env.DATABASE_URL='postgres://fake:fake@localhost/staging_mock';
  Module._load=function(request,parent,isMain){if(request==='pg'&&parent?.filename===dbPath)return {Pool:PoolWithFailedLock};return originalLoad.apply(this,arguments);};
  let db;try{db=require(dbPath);}finally{Module._load=originalLoad;}
  try{await assert.rejects(db.init(),/simulated lock outage/);}
  finally{await db.close();delete require.cache[dbPath];}
  assert.equal(released,1,'advisory lock failure leaked a pooled connection');
  assert.equal(unlockAttempted,false,'must not unlock when no lock was obtained');
  console.log('PASS  failed startup advisory lock releases the pooled connection');
}
(async()=>{try {await runScenario(true);await runScenario(false);await runLockFailureScenario();}
catch(e){console.error('FAIL ',e.stack||e);process.exitCode=1;}
finally{for(const [k,v] of Object.entries(originalEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}Module._load=originalLoad;}})();
