'use strict';
// Isolated additive features; existing auth middleware is inherited from
// each router. No new framework, process or service.
const rules=require('./upgrade-rules');
function registerAdmin(admin,{db,wrap,httpError,positiveIntParam,requireISODate,dateISO,lockScheduleConfig,audit,notify}){
  const id = x=>{const v=positiveIntParam(x);if(!v)throw httpError(400,'Geçersiz numara.');return v;};
  admin.get('/categories',wrap(async(req,res)=>res.json({categories:await rules.categories(db.pool)})));
  admin.post('/categories',wrap(async(req,res)=>{
    const slug=String(req.body.slug||'').trim().toLowerCase();
    const tr=String(req.body.name_tr||'').trim(),en=String(req.body.name_en||'').trim();
    const requires=req.body.requires_level!==false;
    const entries=Array.isArray(req.body.levels)?req.body.levels:[];
    if(!/^[a-z][a-z0-9-]{2,40}$/.test(slug)||!tr||tr.length>90||!en||en.length>90)throw httpError(400,'Kategori adı veya kodu geçersiz.');
    if(requires&&(!entries.length||entries.length>30))throw httpError(400,'Bu kategori için 1–30 seviye gerekiyor.');
    if(!requires&&entries.length)throw httpError(400,'Seviyesiz kategoriye seviye eklenemez.');
    const codes=entries.map(l=>String(l).trim());
    if(codes.some(x=>x.length<1||x.length>45)||new Set(codes.map(s=>s.toLocaleLowerCase('tr-TR'))).size!==codes.length)throw httpError(400,'Tekrarlı veya geçersiz seviyeler.');
    try{
      const out=await db.tx(async client=>{
        await lockScheduleConfig(client);
        const {rows:[category]}=await client.query(`INSERT INTO etut_categories(slug,name_tr,name_en,requires_level) VALUES($1,$2,$3,$4) RETURNING *`,[slug,tr,en,requires]);
        for(let i=0;i<codes.length;i++)await client.query('INSERT INTO category_levels(category_id,code,label_tr,label_en,sort_order) VALUES($1,$2,$2,$2,$3)',[category.id,codes[i],i+1]);
        await audit(client,'admin',0,'category_created','category',category.id,{slug,level_count:codes.length});
        await db.bumpRevisions(client,['schedule','account']);return category;
      });res.status(201).json(out);
    }catch(e){if(e.code==='23505')throw httpError(409,'Bu kategori kodu mevcut.');throw e;}
  }));
  admin.patch('/categories/:id',wrap(async(req,res)=>{
    const categoryId=id(req.params.id),tr=req.body.name_tr===undefined?undefined:String(req.body.name_tr||'').trim(),en=req.body.name_en===undefined?undefined:String(req.body.name_en||'').trim();
    if((tr!==undefined&&(!tr||tr.length>90))||(en!==undefined&&(!en||en.length>90)))throw httpError(400,'Kategori adı geçersiz.');
    const row=await db.tx(async client=>{
      await lockScheduleConfig(client);
      const {rows:[current]}=await client.query('SELECT * FROM etut_categories WHERE id=$1 FOR UPDATE',[categoryId]);
      if(!current)throw httpError(404,'Kategori yok.');
      if(req.body.active===false&&current.system_key)throw httpError(400,'Yerleşik kategoriler arşivlenemez.');
      const {rows:[updated]}=await client.query(`UPDATE etut_categories SET name_tr=$2,name_en=$3,active=$4,updated_at=NOW() WHERE id=$1 RETURNING *`,[categoryId,tr??current.name_tr,en??current.name_en,req.body.active===undefined?current.active:!!req.body.active]);
      await audit(client,'admin',0,'category_updated','category',categoryId,{active:updated.active});await db.bumpRevisions(client,['schedule','account']);return updated;
    });res.json(row);
  }));
  admin.post('/categories/:id/levels',wrap(async(req,res)=>{
    const categoryId=id(req.params.id),code=String(req.body.code||'').trim();
    if(!code||code.length>45)throw httpError(400,'Seviye kodu geçersiz.');
    try{const out=await db.tx(async client=>{
      await lockScheduleConfig(client);
      const {rows:[cat]}=await client.query('SELECT * FROM etut_categories WHERE id=$1 FOR UPDATE',[categoryId]);
      if(!cat||!cat.active||!cat.requires_level)throw httpError(400,'Seviye bu kategoriye eklenemez.');
      const {rows:[count]}=await client.query('SELECT COUNT(*)::int n,COALESCE(MAX(sort_order),0)::int max FROM category_levels WHERE category_id=$1',[categoryId]);
      if(count.n>=30)throw httpError(400,'Maksimum 30 seviye.');
      const {rows:[r]}=await client.query('INSERT INTO category_levels(category_id,code,label_tr,label_en,sort_order) VALUES($1,$2,$2,$2,$3) RETURNING *',[categoryId,code,count.max+1]);
      await audit(client,'admin',0,'category_level_created','category_level',r.id,{category_id:categoryId});await db.bumpRevisions(client,['schedule','account']);return r;
    });res.status(201).json(out);}catch(e){if(e.code==='23505')throw httpError(409,'Seviye bu kategoride zaten mevcut.');throw e;}
  }));
  admin.get('/students/:id/learning',wrap(async(req,res)=>{
    const studentId=id(req.params.id);
    const {rows:enrollments}=await db.q(`SELECT e.category_id,e.primary_level_id,e.active,c.name_tr,c.name_en,c.requires_level,
       l.code AS primary_level_code FROM student_category_enrollments e JOIN etut_categories c ON c.id=e.category_id
       LEFT JOIN category_levels l ON l.id=e.primary_level_id WHERE e.student_id=$1 ORDER BY e.category_id`,[studentId]);
    const {rows:grants}=await db.q('SELECT category_id,level_id,revoked_at FROM student_level_permissions WHERE student_id=$1',[studentId]);
    const {rows:[limit]}=await db.q('SELECT max_weekly_etuts FROM student_booking_limits WHERE student_id=$1',[studentId]);
    res.json({enrollments,grants,max_weekly_etuts:limit?limit.max_weekly_etuts:null});
  }));
  admin.put('/students/:id/enrollments/:category',wrap(async(req,res)=>{
    const studentId=id(req.params.id),categoryId=id(req.params.category);
    const levelId=req.body.level_id===null?null:id(req.body.level_id);
    await db.tx(async client=>{
      await lockScheduleConfig(client);
      const {rows:[student]}=await client.query('SELECT * FROM students WHERE id=$1 FOR UPDATE',[studentId]);
      const {rows:[category]}=await client.query('SELECT * FROM etut_categories WHERE id=$1 AND active=true',[categoryId]);
      if(!student||!category)throw httpError(404,'Öğrenci/kategori bulunamadı.');
      if(category.requires_level&&!levelId||!category.requires_level&&levelId)throw httpError(400,'Seviye seçimini kontrol edin.');
      if(levelId){const {rowCount}=await client.query('SELECT 1 FROM category_levels WHERE id=$1 AND category_id=$2 AND active=true',[levelId,categoryId]);if(!rowCount)throw httpError(400,'Bu kategori için geçersiz seviye.');}
      const {rows:[old]}=await client.query('SELECT * FROM student_category_enrollments WHERE student_id=$1 AND category_id=$2 FOR UPDATE',[studentId,categoryId]);
      if(old){await client.query(`UPDATE student_category_enrollments SET primary_level_id=$3,active=$4,updated_at=NOW() WHERE student_id=$1 AND category_id=$2`,[studentId,categoryId,levelId,req.body.active!==false]);}
      else{await client.query('INSERT INTO student_category_enrollments(student_id,category_id,primary_level_id,active) VALUES($1,$2,$3,$4)',[studentId,categoryId,levelId,req.body.active!==false]);}
      if(!old||Number(old.primary_level_id)!==Number(levelId)||req.body.active===false)await client.query(`UPDATE level_change_requests SET status='superseded',resolved_at=NOW(),resolved_by='admin' WHERE student_id=$1 AND category_id=$2 AND status='pending'`,[studentId,categoryId]);
      if(category.system_key==='general'&&levelId){const {rows:[l]}=await client.query('SELECT code FROM category_levels WHERE id=$1',[levelId]);await client.query('UPDATE students SET level=$1,updated_at=NOW() WHERE id=$2',[l.code,studentId]);}
      await notify(client,'student',studentId,'Kurs/seviye erişiminiz güncellendi','Güncel kategori ve seviye izinlerinizi profilinizde görüntüleyebilirsiniz.','account');
      await audit(client,'admin',0,'student_enrollment_updated','student',studentId,{category_id:categoryId,level_id:levelId,active:req.body.active!==false});await db.bumpRevisions(client,['account','booking','notification']);
    });res.json({ok:true});
  }));
  admin.put('/students/:id/level-grants/:level',wrap(async(req,res)=>{
    const studentId=id(req.params.id),levelId=id(req.params.level),active=req.body.active!==false;
    await db.tx(async client=>{
      const {rows:[s]}=await client.query('SELECT id FROM students WHERE id=$1 FOR UPDATE',[studentId]);
      if(!s)throw httpError(404,'Öğrenci yok.');
      const {rows:[l]}=await client.query(`SELECT l.id,l.category_id FROM category_levels l JOIN student_category_enrollments e
        ON e.category_id=l.category_id AND e.student_id=$1 AND e.active=true JOIN etut_categories c ON c.id=l.category_id
        WHERE l.id=$2 AND l.active=true AND c.active=true`,[studentId,levelId]);
      if(!l)throw httpError(400,'Önce ilgili kategoriye kayıt yapılmalı.');
      await client.query(`INSERT INTO student_level_permissions(student_id,category_id,level_id,revoked_at) VALUES($1,$2,$3,$4)
        ON CONFLICT(student_id,category_id,level_id) DO UPDATE SET revoked_at=EXCLUDED.revoked_at,granted_at=CASE WHEN EXCLUDED.revoked_at IS NULL THEN NOW() ELSE student_level_permissions.granted_at END`,[studentId,l.category_id,levelId,active?null:new Date()]);
      await notify(client,'student',studentId,'Ek seviye izniniz güncellendi','Profilinizden izin verilen seviyeleri görüntüleyebilirsiniz.','account');
      await audit(client,'admin',0,active?'extra_level_granted':'extra_level_revoked','student',studentId,{category_id:l.category_id,level_id:levelId});await db.bumpRevisions(client,['account','schedule','notification']);
    });res.json({ok:true});
  }));
  admin.put('/students/:id/weekly-limit',wrap(async(req,res)=>{
    const studentId=id(req.params.id),raw=req.body.max_weekly_etuts;
    if(raw!==null&&(!Number.isInteger(Number(raw))||Number(raw)<0||Number(raw)>100))throw httpError(400,'Sınır 0–100 olmalı.');
    await db.tx(async client=>{
      const {rowCount}=await client.query('SELECT id FROM students WHERE id=$1 FOR UPDATE',[studentId]);if(!rowCount)throw httpError(404,'Öğrenci bulunamadı.');
      if(raw===null)await client.query('DELETE FROM student_booking_limits WHERE student_id=$1',[studentId]);
      else await client.query(`INSERT INTO student_booking_limits(student_id,max_weekly_etuts) VALUES($1,$2)
          ON CONFLICT(student_id) DO UPDATE SET max_weekly_etuts=EXCLUDED.max_weekly_etuts,updated_at=NOW()`,[studentId,Number(raw)]);
      await audit(client,'admin',0,'weekly_override_changed','student',studentId,{limit:raw});await db.bumpRevisions(client,['account','booking']);
    });res.json({ok:true});
  }));
  admin.get('/slots/:id/occurrence',wrap(async(req,res)=>{
    const slotId=id(req.params.id),date=requireISODate(req.query.date);
    const {rows:[slot]}=await db.q('SELECT * FROM slots WHERE id=$1',[slotId]);if(!slot)throw httpError(404,'Etüt bulunamadı.');
    const {rows:[occ]}=await db.q('SELECT * FROM slot_occurrences WHERE slot_id=$1 AND slot_date=$2',[slotId,date]);
    const {rows:roster}=await db.q(`SELECT bs.id,bs.student_id,COALESCE(s.first_name,b.first_name) first_name,COALESCE(s.last_name,b.last_name) last_name,
       bs.level,bs.status FROM booking_slots bs JOIN bookings b ON b.id=bs.booking_id LEFT JOIN students s ON s.id=bs.student_id
       WHERE bs.slot_id=$1 AND bs.slot_date=$2 AND b.status<>'deleted_by_admin' ORDER BY bs.status,b.first_name,b.last_name LIMIT 250`,[slotId,date]);
    const {rows:[cx]}=await db.q('SELECT note FROM slot_cancellations WHERE slot_id=$1 AND slot_date=$2',[slotId,date]);
    const {rows:[counts]}=await db.q(`SELECT COUNT(*) FILTER(WHERE bs.status='active')::int booked,COUNT(*)::int total
      FROM booking_slots bs JOIN bookings b ON b.id=bs.booking_id
      WHERE bs.slot_id=$1 AND bs.slot_date=$2 AND b.status<>'deleted_by_admin'`,[slotId,date]);
    const booked=counts.booked;
    res.json({slot_id:slotId,date,booked,roster_truncated:counts.total>roster.length,capacity:occ?.capacity??slot.capacity,unlimited:!(Number(occ?.capacity??slot.capacity)>0),cancelled:!!slot.cancelled||!!cx,roster});
  }));
  admin.get('/level-requests',wrap(async(req,res)=>{
    const {rows}=await db.q(`SELECT r.*,s.first_name,s.last_name,c.name_tr AS category_name,old.code AS from_code,next.code AS requested_code
       FROM level_change_requests r JOIN students s ON s.id=r.student_id JOIN etut_categories c ON c.id=r.category_id
       JOIN category_levels old ON old.id=r.from_level_id JOIN category_levels next ON next.id=r.requested_level_id
       WHERE r.status='pending' ORDER BY r.requested_at,r.id LIMIT 200`);
    res.json({items:rows});
  }));
  admin.post('/level-requests/:id/resolve',wrap(async(req,res)=>{
    const requestId=id(req.params.id),approve=req.body.approve===true;
    await db.tx(async client=>{
      const {rows:[peek]}=await client.query('SELECT * FROM level_change_requests WHERE id=$1',[requestId]);
      if(!peek||peek.status!=='pending')throw httpError(409,'İstek artık beklemiyor.');
      const {rows:[student]}=await client.query('SELECT * FROM students WHERE id=$1 FOR UPDATE',[peek.student_id]);
      if(!student)throw httpError(404,'Öğrenci bulunamadı.');
      const {rows:[request]}=await client.query(`SELECT * FROM level_change_requests WHERE id=$1 AND status='pending' FOR UPDATE`,[requestId]);
      if(!request)throw httpError(409,'İstek zaten çözüldü.');
      const {rows:[enrollment]}=await client.query(`SELECT * FROM student_category_enrollments WHERE student_id=$1 AND category_id=$2 FOR UPDATE`,[student.id,request.category_id]);
      if(!enrollment||!enrollment.active||Number(enrollment.primary_level_id)!==Number(request.from_level_id))throw httpError(409,'Öğrencinin seviyesi değişmiş; bu istek elle gözden geçirilmeli.');
      if(approve){
        const {rows:[level]}=await client.query('SELECT id,code FROM category_levels WHERE id=$1 AND category_id=$2 AND active=true',[request.requested_level_id,request.category_id]);
        if(!level)throw httpError(409,'Talep edilen seviye artık mevcut değil.');
        await client.query('UPDATE student_category_enrollments SET primary_level_id=$1,updated_at=NOW() WHERE student_id=$2 AND category_id=$3',[level.id,student.id,request.category_id]);
        const {rows:[category]}=await client.query('SELECT system_key FROM etut_categories WHERE id=$1',[request.category_id]);
        if(category?.system_key==='general')await client.query('UPDATE students SET level=$1,updated_at=NOW() WHERE id=$2',[level.code,student.id]);
      }
      await client.query(`UPDATE level_change_requests SET status=$1,resolved_at=NOW(),resolved_by='admin',resolution_note=$2 WHERE id=$3`,[approve?'approved':'rejected',String(req.body.note||'').trim().slice(0,300),request.id]);
      await notify(client,'student',student.id,approve?'Seviye değişikliği onaylandı':'Seviye değişikliği reddedildi',approve?'Yeni seviyeniz profilinizde güncellendi. Yeni seviyenizle yeniden giriş yapabilirsiniz.':'Mevcut seviyeniz değişmedi.','account');
      await audit(client,'admin',0,approve?'level_request_approved':'level_request_rejected','level_request',request.id,{category_id:request.category_id});await db.bumpRevisions(client,['account','booking','notification']);
    });res.json({ok:true});
  }));
}
function registerStudent(student,{db,wrap,httpError,positiveIntParam,notify,audit}){
  const id=x=>{const v=positiveIntParam(x);if(!v)throw httpError(400,'Geçersiz numara.');return v;};
  student.get('/learning',wrap(async(req,res)=>{
    const {rows:enrollments}=await db.q(`SELECT e.category_id,e.primary_level_id,c.name_tr,c.name_en,c.requires_level,l.code AS level_code
      FROM student_category_enrollments e JOIN etut_categories c ON c.id=e.category_id AND c.active=true
      LEFT JOIN category_levels l ON l.id=e.primary_level_id WHERE e.student_id=$1 AND e.active=true ORDER BY c.id`,[req.student.id]);
    const {rows:grants}=await db.q(`SELECT p.category_id,p.level_id,l.code FROM student_level_permissions p JOIN category_levels l ON l.id=p.level_id
      WHERE p.student_id=$1 AND p.revoked_at IS NULL AND l.active=true`,[req.student.id]);
    const {rows:requests}=await db.q(`SELECT id,category_id,from_level_id,requested_level_id,reason,status,requested_at,resolved_at FROM level_change_requests
      WHERE student_id=$1 ORDER BY requested_at DESC LIMIT 30`,[req.student.id]);
    res.json({enrollments,grants,requests,categories:await rules.categories(db.pool)});
  }));
  student.post('/level-requests',wrap(async(req,res)=>{
    const categoryId=id(req.body.category_id),newId=id(req.body.requested_level_id),reason=String(req.body.reason||'').trim();
    if(reason.length>500)throw httpError(400,'Açıklama maksimum 500 karakter.');
    try{
      const out=await db.tx(async client=>{
        const {rows:[s]}=await client.query('SELECT id FROM students WHERE id=$1 AND active=true FOR UPDATE',[req.student.id]);if(!s)throw httpError(401,'Oturum geçersiz.');
        const {rows:[enrollment]}=await client.query(`SELECT e.* FROM student_category_enrollments e JOIN etut_categories c ON c.id=e.category_id
          WHERE e.student_id=$1 AND e.category_id=$2 AND e.active=true AND c.active=true AND c.requires_level=true FOR UPDATE OF e`,[s.id,categoryId]);
        if(!enrollment)throw httpError(400,'Bu kategoriye kayıtlı değilsiniz.');
        if(Number(enrollment.primary_level_id)===newId)throw httpError(400,'Mevcut seviyeniz zaten bu.');
        const {rowCount}=await client.query('SELECT id FROM category_levels WHERE id=$1 AND category_id=$2 AND active=true',[newId,categoryId]);
        if(!rowCount)throw httpError(400,'Bu kategori için geçersiz seviye.');
        const {rows:[r]}=await client.query(`INSERT INTO level_change_requests(student_id,category_id,from_level_id,requested_level_id,reason)
           VALUES($1,$2,$3,$4,$5) RETURNING id`,[s.id,categoryId,enrollment.primary_level_id,newId,reason]);
        await notify(client,'admin',0,'Yeni seviye değişikliği talebi',`Öğrenci #${s.id} bir seviye değişikliği istedi.`,'account');
        await audit(client,'student',s.id,'level_change_requested','level_request',r.id,{category_id:categoryId});await db.bumpRevisions(client,['account','notification']);return r;
      });res.status(201).json({ok:true,id:out.id});
    }catch(e){if(e.code==='23505')throw httpError(409,'Bu kategori için zaten bekleyen bir talebiniz var.');throw e;}
  }));
}
module.exports={registerAdmin,registerStudent};
