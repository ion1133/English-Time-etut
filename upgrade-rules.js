'use strict';
// Domain-level upgrade policy. The caller must hold the locked student row
// and schedule-config lock when checking a proposed booking transaction.
const validWeekDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
function mondayOf(date) {
  if (!validWeekDate(date)) throw new Error('Invalid week date');
  const [y,m,d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y,m-1,d));
  if (dt.getUTCFullYear()!==y || dt.getUTCMonth()!==m-1 || dt.getUTCDate()!==d) throw new Error('Invalid week date');
  const delta = ((dt.getUTCDay()+6)%7);
  dt.setUTCDate(dt.getUTCDate()-delta);
  return dt.toISOString().slice(0,10);
}
const plusDays = (date, days) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); };
function policyLimit(value) {
  if (value === '' || value === undefined || value === null) return null;
  const n=Number(value);
  if(!Number.isInteger(n)||n<0||n>100) throw new Error('Invalid weekly limit stored in database');
  return n === 0 ? null : n;
}
function groupByWeek(items) {
  const out=new Map();
  for (const r of items) { const week=mondayOf(r.date); out.set(week,(out.get(week)||0)+1); }
  return out;
}
async function getStudentRules(client, studentId, rule) {
  const {rows:enrollments}=await client.query(`SELECT e.category_id,e.primary_level_id,c.requires_level,c.active AS category_active,
      l.sort_order FROM student_category_enrollments e JOIN etut_categories c ON c.id=e.category_id
      LEFT JOIN category_levels l ON l.id=e.primary_level_id WHERE e.student_id=$1 AND e.active=true`,[studentId]);
  const {rows:allLevels}=await client.query(`SELECT id,category_id,sort_order FROM category_levels WHERE active=true ORDER BY category_id,sort_order,id`);
  const {rows:grants}=await client.query(`SELECT category_id,level_id FROM student_level_permissions WHERE student_id=$1 AND revoked_at IS NULL`,[studentId]);
  const out=new Map();
  for(const e of enrollments){
    if(!e.category_active)continue;
    const categoryLevels=allLevels.filter(l=>Number(l.category_id)===Number(e.category_id));
    const own=categoryLevels.find(l=>Number(l.id)===Number(e.primary_level_id));
    const allowed=new Set();
    if(!e.requires_level){} // Enrollment itself authorizes an unleveled activity.
    else if(rule==='all') categoryLevels.forEach(l=>allowed.add(Number(l.id)));
    else if(own){
      allowed.add(Number(own.id));
      if(rule==='own_next'||rule==='own_adjacent'){
        const next=categoryLevels.find(l=>Number(l.sort_order)>Number(own.sort_order));
        if(next)allowed.add(Number(next.id));
      }
      if(rule==='own_adjacent'){
        const before=categoryLevels.filter(l=>Number(l.sort_order)<Number(own.sort_order)).at(-1);
        if(before)allowed.add(Number(before.id));
      }
    }
    for(const g of grants){if(Number(g.category_id)===Number(e.category_id)&&categoryLevels.some(l=>Number(l.id)===Number(g.level_id)))allowed.add(Number(g.level_id));}
    out.set(Number(e.category_id),{allowed,requires_level:e.requires_level,primary_level_id:e.primary_level_id});
  }
  return out;
}
async function allowedSlot(client, rules, categoryId, slotId) {
  const r=rules.get(Number(categoryId));
  if(!r)return false;
  if(!r.requires_level)return true;
  const {rows:levels}=await client.query(`SELECT level_id FROM slot_level_eligibility WHERE slot_id=$1 AND category_id=$2`,[slotId,categoryId]);
  return levels.length>0 && levels.some(l=>r.allowed.has(Number(l.level_id)));
}
// A cancelled dated occurrence excludes its reservations temporarily. If
// restored and the student exceeds the cap, old bookings stay but new fail.
async function weeklyUsage(client, studentId, start, end) {
  const {rows:[r]}=await client.query(`SELECT COUNT(*)::int used FROM booking_slots bs
     JOIN bookings b ON b.id=bs.booking_id
     LEFT JOIN slots s ON s.id=bs.slot_id
     WHERE bs.student_id=$1 AND bs.status='active' AND b.status<>'deleted_by_admin'
       AND bs.slot_date BETWEEN $2::date AND $3::date
       AND COALESCE(s.cancelled,false)=false
       AND NOT EXISTS (SELECT 1 FROM slot_cancellations sc WHERE sc.slot_id=bs.slot_id AND sc.slot_date=bs.slot_date)`,[studentId,start,end]);
  return r?.used||0;
}
async function studentWeeklyLimit(client, studentId, settings) {
  const {rows:[override]}=await client.query('SELECT max_weekly_etuts FROM student_booking_limits WHERE student_id=$1',[studentId]);
  return policyLimit(override ? override.max_weekly_etuts : settings.max_weekly_etuts);
}
async function enforceWeeklyQuota(client, studentId, settings, selections, fail) {
  const limit=await studentWeeklyLimit(client,studentId,settings);
  if(limit===null)return;
  for(const [week,requested] of groupByWeek(selections)){
    const used=await weeklyUsage(client,studentId,week,plusDays(week,6));
    if(used+requested>limit)throw fail({week_start:week,limit,booked:used,requested});
  }
}
async function categories(client) {
  const {rows:cats}=await client.query('SELECT id,slug,name_tr,name_en,requires_level,active,system_key FROM etut_categories ORDER BY id');
  const {rows:levels}=await client.query('SELECT id,category_id,code,label_tr,label_en,sort_order,active FROM category_levels ORDER BY sort_order,id');
  return cats.map(c=>({...c,levels:levels.filter(l=>Number(l.category_id)===Number(c.id))}));
}
module.exports={mondayOf,plusDays,policyLimit,groupByWeek,getStudentRules,allowedSlot,weeklyUsage,studentWeeklyLimit,enforceWeeklyQuota,categories};
