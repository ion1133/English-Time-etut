-- Representative schema/data from the original supplied build, before the hardened migrations.
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
CREATE TABLE teachers (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  username TEXT, password_hash TEXT NOT NULL DEFAULT '', password_salt TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE, session_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX teachers_username_unique ON teachers (LOWER(username)) WHERE username IS NOT NULL;
CREATE TABLE slots (
  id SERIAL PRIMARY KEY, day INT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, level TEXT NOT NULL,
  teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL, classroom TEXT NOT NULL DEFAULT '', capacity INT NOT NULL DEFAULT 0,
  cancelled BOOLEAN NOT NULL DEFAULT FALSE, cancel_note TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE students (
  id SERIAL PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT NOT NULL, level TEXT NOT NULL,
  identity_key TEXT NOT NULL UNIQUE, active BOOLEAN NOT NULL DEFAULT TRUE, session_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX students_phone_idx ON students(phone);
CREATE TABLE bookings (
  id SERIAL PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT NOT NULL, level TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  student_id INT REFERENCES students(id) ON DELETE SET NULL, status TEXT NOT NULL DEFAULT 'active', deleted_at TIMESTAMPTZ
);
CREATE TABLE booking_slots (
  id SERIAL PRIMARY KEY, booking_id INT REFERENCES bookings(id) ON DELETE CASCADE, slot_id INT REFERENCES slots(id) ON DELETE SET NULL,
  slot_date DATE NOT NULL, day INT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, level TEXT NOT NULL,
  teacher_name TEXT NOT NULL DEFAULT '', student_id INT REFERENCES students(id) ON DELETE SET NULL,
  teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL, classroom TEXT NOT NULL DEFAULT '', capacity_snapshot INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', cancelled_at TIMESTAMPTZ, cancel_note TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX booking_slots_occurrence_idx ON booking_slots(slot_id,slot_date,status);
CREATE INDEX booking_slots_student_idx ON booking_slots(student_id,slot_date);
CREATE TABLE slot_occurrences (
  id SERIAL PRIMARY KEY, slot_id INT NOT NULL REFERENCES slots(id) ON DELETE CASCADE, slot_date DATE NOT NULL, day INT NOT NULL,
  start_time TEXT NOT NULL, end_time TEXT NOT NULL, level TEXT NOT NULL, teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL,
  teacher_name TEXT NOT NULL DEFAULT '', classroom TEXT NOT NULL DEFAULT '', capacity INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(slot_id,slot_date)
);
CREATE TABLE slot_cancellations (
  id SERIAL PRIMARY KEY, slot_id INT REFERENCES slots(id) ON DELETE CASCADE, slot_date DATE NOT NULL,
  note TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(slot_id,slot_date)
);
CREATE TABLE teacher_notifications (
  id SERIAL PRIMARY KEY, slot_id INT REFERENCES slots(id) ON DELETE CASCADE, slot_date DATE NOT NULL,
  kind TEXT NOT NULL DEFAULT 'booking', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(slot_id,slot_date,kind)
);
CREATE TABLE panel_notifications (
  id BIGSERIAL PRIMARY KEY, target_type TEXT NOT NULL, target_id INT, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'info', slot_id INT, slot_date DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX panel_notifications_target_idx ON panel_notifications(target_type,target_id,created_at DESC);
CREATE TABLE notification_reads (
  notification_id BIGINT REFERENCES panel_notifications(id) ON DELETE CASCADE, viewer_type TEXT NOT NULL, viewer_id INT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(notification_id,viewer_type,viewer_id)
);
CREATE TABLE phone_change_requests (
  id BIGSERIAL PRIMARY KEY, student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE, old_phone TEXT NOT NULL,
  new_phone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX phone_change_requests_one_pending ON phone_change_requests(student_id) WHERE status='pending';
CREATE TABLE auth_lockouts (
  actor_type TEXT NOT NULL, actor_key TEXT NOT NULL, failed_count INT NOT NULL DEFAULT 0, locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(actor_type,actor_key)
);
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY, actor_type TEXT NOT NULL, actor_id INT, action TEXT NOT NULL, entity_type TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '', detail JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE messages (
  id SERIAL PRIMARY KEY, channel TEXT NOT NULL, recipient TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO settings(key,value) VALUES
 ('coordinator_name','Legacy Coordinator'),('classroom_weekday','Legacy Weekday'),('classroom_weekend','Legacy Weekend'),
 ('level_rule','own_next'),('min_days_ahead','1'),('branch_name','Kizilay'),('admin_password','LegacyAdmin#123'),
 ('admin_password_hash',''),('admin_password_salt',''),('panel_change_message','Legacy change'),('data_revision','7');
INSERT INTO teachers(id,name,phone,note,username,active) VALUES(1,'Legacy Teacher','05000000011','legacy','legacy.teacher',true);
SELECT setval(pg_get_serial_sequence('teachers','id'),1,true);
INSERT INTO students(id,first_name,last_name,phone,level,identity_key,active) VALUES(1,'Legacy','Student','05000000001','A1','05000000001|legacy|student',true);
SELECT setval(pg_get_serial_sequence('students','id'),1,true);
INSERT INTO slots(id,day,start_time,end_time,level,teacher_id,classroom,capacity) VALUES(1,1,'10:00','10:40','A1',1,'Legacy Room',3);
SELECT setval(pg_get_serial_sequence('slots','id'),1,true);
INSERT INTO bookings(id,first_name,last_name,phone,level,topic,student_id,status) VALUES(1,'Legacy','Student','05000000001','A1','Legacy topic',1,'active');
SELECT setval(pg_get_serial_sequence('bookings','id'),1,true);
INSERT INTO booking_slots(id,booking_id,slot_id,slot_date,day,start_time,end_time,level,teacher_name,student_id,teacher_id,classroom,capacity_snapshot,status,cancelled_at,cancel_note)
VALUES(1,1,1,CURRENT_DATE + 14,1,'10:00','10:40','A1','Legacy Teacher',1,1,'Legacy Room',3,'cancelled_by_student',NOW(),'Legacy cancellation');
SELECT setval(pg_get_serial_sequence('booking_slots','id'),1,true);
INSERT INTO slot_occurrences(slot_id,slot_date,day,start_time,end_time,level,teacher_id,teacher_name,classroom,capacity)
VALUES(1,CURRENT_DATE + 14,1,'10:00','10:40','A1',1,'Legacy Teacher','Legacy Room',3);
INSERT INTO slot_cancellations(slot_id,slot_date,note) VALUES(1,CURRENT_DATE + 21,'Legacy dated cancellation');
INSERT INTO panel_notifications(target_type,target_id,title,body,kind) VALUES('student',1,'Legacy notice','Preserve me','info');
