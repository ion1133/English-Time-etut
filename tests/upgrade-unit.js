'use strict';
// Executable, database-independent checks for the upgraded policy engine.
// These do NOT replace live PostgreSQL integration/concurrency tests.
const assert=require('node:assert/strict');
const rules=require('../upgrade-rules');
let passed=0;
async function check(name,fn){try{await fn();passed++;console.log('PASS ',name);}catch(e){console.error('FAIL ',name,e);process.exitCode=1;}}
function mockStudentDb({enrollments=[],levels=[],grants=[],mapping=[]}) {
  return {async query(sql,params) {
    if(sql.includes('FROM student_category_enrollments e'))return {rows:enrollments};
    if(sql.includes('FROM category_levels WHERE'))return {rows:levels};
    if(sql.includes('FROM student_level_permissions WHERE'))return {rows:grants};
    if(sql.includes('FROM slot_level_eligibility WHERE'))return {rows:mapping.filter(x=>x.slot_id===params[0]&&x.category_id===params[1])};
    throw Error('Unexpected query: '+sql);
  }};
}
const sample={
 enrollments:[
  {category_id:1,primary_level_id:2,requires_level:true,category_active:true,sort_order:2},
  {category_id:2,primary_level_id:6,requires_level:true,category_active:true,sort_order:2},
  {category_id:3,primary_level_id:null,requires_level:false,category_active:true,sort_order:null}],
 levels:[{id:1,category_id:1,sort_order:1},{id:2,category_id:1,sort_order:2},{id:3,category_id:1,sort_order:3},{id:4,category_id:1,sort_order:4},
 {id:5,category_id:2,sort_order:1},{id:6,category_id:2,sort_order:2},{id:7,category_id:2,sort_order:3}],
 mapping:[{slot_id:101,category_id:1,level_id:3},{slot_id:102,category_id:1,level_id:1},{slot_id:201,category_id:2,level_id:7},{slot_id:301,category_id:3,level_id:null}]
};
function fakeQuota({override=null,used={},expectNoCount=false}={}){
  return {calls:[],async query(sql,p){this.calls.push({sql,p});
    if(sql.includes('FROM student_booking_limits'))return {rows:override===null?[]:[{max_weekly_etuts:override}]};
    if(sql.includes('COUNT(*)::int used')){
      if(expectNoCount)throw Error('Count query should not run under unlimited policy');
      return {rows:[{used:used[p[1]]||0}]};
    }
    throw Error('Unexpected SQL: '+sql);
  }};
}
(async()=>{
 await check('Istanbul Monday 2026-09-21',()=>assert.equal(rules.mondayOf('2026-09-21'),'2026-09-21'));
 await check('Istanbul Sunday rolls into preceding Monday',()=>assert.equal(rules.mondayOf('2026-09-27'),'2026-09-21'));
 await check('Next Monday begins distinct allowance',()=>assert.equal(rules.mondayOf('2026-09-28'),'2026-09-28'));
 await check('Leap-day valid Monday grouping',()=>assert.equal(rules.mondayOf('2024-02-29'),'2024-02-26'));
 await check('Invalid Feb date refused',()=>assert.throws(()=>rules.mondayOf('2026-02-30'),/Invalid/));
 await check('Invalid date format refused',()=>assert.throws(()=>rules.mondayOf('2026/02/27'),/Invalid/));
 await check('Year boundary 2027 Jan 1 resolves 2026 Dec 28',()=>assert.equal(rules.mondayOf('2027-01-01'),'2026-12-28'));
 await check('Next-week Sunday is same week',()=>assert.equal(rules.plusDays('2026-09-21',6),'2026-09-27'));
 await check('Cross-year date arithmetic',()=>assert.equal(rules.plusDays('2026-12-28',6),'2027-01-03'));
 await check('Grouped multi-week selections',()=>assert.deepEqual([...rules.groupByWeek([{date:'2026-09-21'},{date:'2026-09-27'},{date:'2026-09-28'}])],[['2026-09-21',2],['2026-09-28',1]]));
 await check('Empty migrated policy is unrestricted',()=>assert.equal(rules.policyLimit(''),null));
 await check('Zero denotes explicitly unrestricted',()=>assert.equal(rules.policyLimit('0'),null));
 await check('Positive quota parsed exactly',()=>assert.equal(rules.policyLimit('3'),3));
 await check('Invalid negative quota refused',()=>assert.throws(()=>rules.policyLimit('-1'),/Invalid/));
 await check('Oversize quota refused',()=>assert.throws(()=>rules.policyLimit('101'),/Invalid/));
 await check('Non-numeric quota refused',()=>assert.throws(()=>rules.policyLimit('junk'),/Invalid/));
 await check('Primary plus next level is category-scoped',async()=>{
   const data=await rules.getStudentRules(mockStudentDb(sample),9,'own_next');
   assert.deepEqual([...data.get(1).allowed].sort(),[2,3]); assert.deepEqual([...data.get(2).allowed].sort(),[6,7]);
 });
 await check('Own-only access does not grant next level',async()=>{
   const data=await rules.getStudentRules(mockStudentDb(sample),9,'own');
   assert.deepEqual([...data.get(1).allowed],[2]);
 });
 await check('Adjacent policy includes immediately previous level',async()=>{
   const data=await rules.getStudentRules(mockStudentDb(sample),9,'own_adjacent');
   assert.deepEqual([...data.get(1).allowed].sort(),[1,2,3]);
 });
 await check('All-level policy limited to current course',async()=>{
   const data=await rules.getStudentRules(mockStudentDb(sample),9,'all');
   assert.deepEqual([...data.get(1).allowed].sort(),[1,2,3,4]);
   assert.equal(data.get(2).allowed.has(1),false);
 });
 await check('Extra permission is category-scoped',async()=>{
   const data=await rules.getStudentRules(mockStudentDb({...sample,grants:[{category_id:1,level_id:4},{category_id:2,level_id:1}]}),9,'own');
   assert.equal(data.get(1).allowed.has(4),true);assert.equal(data.get(2).allowed.has(1),false);
 });
 await check('Archived levels cannot be granted',async()=>{
   const data=await rules.getStudentRules(mockStudentDb({...sample,grants:[{category_id:1,level_id:999}]}),9,'own');
   assert.equal(data.get(1).allowed.has(999),false);
 });
 await check('Unlevelled enrolled activity allowed',async()=>{
   const db=mockStudentDb(sample),data=await rules.getStudentRules(db,9,'own');
   assert.equal(await rules.allowedSlot(db,data,3,301),true);
 });
 await check('Unenrolled activity denied regardless of slot',async()=>{
   const db=mockStudentDb(sample),data=await rules.getStudentRules(db,9,'own');
   assert.equal(await rules.allowedSlot(db,data,77,301),false);
 });
 await check('Slot permission requires a matching granted level',async()=>{
   const db=mockStudentDb(sample),data=await rules.getStudentRules(db,9,'own_next');
   assert.equal(await rules.allowedSlot(db,data,1,101),true);assert.equal(await rules.allowedSlot(db,data,1,102),false);
 });
 await check('Weekly quota accepts exactly remaining allowance',async()=>{
   const db=fakeQuota({used:{'2026-09-21':1}});
   await rules.enforceWeeklyQuota(db,9,{max_weekly_etuts:'3'},[{date:'2026-09-22'},{date:'2026-09-26'}],r=>Object.assign(new Error('cap'),r));
 });
 await check('Weekly quota rejects over-cap entire batch',async()=>{
   const db=fakeQuota({used:{'2026-09-21':2}});
   await assert.rejects(rules.enforceWeeklyQuota(db,9,{max_weekly_etuts:'3'},[{date:'2026-09-22'},{date:'2026-09-27'}],r=>Object.assign(new Error('cap'),r)),e=>e.week_start==='2026-09-21'&&e.booked===2&&e.requested===2&&e.limit===3);
 });
 await check('Mixed week checks each week separately',async()=>{
   const db=fakeQuota({used:{'2026-09-21':2,'2026-09-28':0}});
   await rules.enforceWeeklyQuota(db,9,{max_weekly_etuts:'3'},[{date:'2026-09-27'},{date:'2026-09-28'}],r=>Object.assign(new Error('cap'),r));
   assert.equal(db.calls.filter(x=>x.sql.includes('COUNT(*)::int used')).length,2);
 });
 await check('Per-student override replaces branch-wide cap',async()=>{
   const db=fakeQuota({override:1,used:{'2026-09-21':1}});
   await assert.rejects(rules.enforceWeeklyQuota(db,9,{max_weekly_etuts:'3'},[{date:'2026-09-23'}],r=>Object.assign(new Error('cap'),r)),e=>e.limit===1);
 });
 await check('Student override zero means unlimited',async()=>{
   const db=fakeQuota({override:0,expectNoCount:true});
   await rules.enforceWeeklyQuota(db,9,{max_weekly_etuts:'2'},[{date:'2026-09-21'}],r=>Object.assign(new Error('cap'),r));
 });
 await check('Migrated Kızılay stays unlimited without Admin setting',async()=>{
   const db=fakeQuota({expectNoCount:true});
   await rules.enforceWeeklyQuota(db,9,{max_weekly_etuts:''},[{date:'2026-09-21'}],r=>Object.assign(new Error('cap'),r));
 });
 await check('Quota SQL excludes dated admin-cancelled occurrences',async()=>{
   const db=fakeQuota(); await rules.weeklyUsage(db,9,'2026-09-21','2026-09-27');
   const sql=db.calls[0].sql;assert.match(sql,/NOT EXISTS \(SELECT 1 FROM slot_cancellations/);assert.match(sql,/bs.status='active'/);
 });
 await check('Allowed set excludes archived categories',async()=>{
   const db=mockStudentDb({...sample,enrollments:[{...sample.enrollments[0],category_active:false}]});
   const data=await rules.getStudentRules(db,9,'all');assert.equal(data.size,0);
 });
 console.log(`Upgrade policy tests: ${passed} passed${process.exitCode?', some failed':''}`);
})();
