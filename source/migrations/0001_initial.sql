PRAGMA foreign_keys = ON;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK(json_valid(value)),
  revision INTEGER NOT NULL DEFAULT 1,
  draft TEXT CHECK(draft IS NULL OR json_valid(draft)),
  updated_at INTEGER NOT NULL,
  actor TEXT NOT NULL
);
CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE conversations (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'auto' CHECK(mode IN ('auto','pending_human','human')),
  step TEXT NOT NULL DEFAULT 'home',
  data TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(data)),
  revision INTEGER NOT NULL DEFAULT 0,
  mode_revision INTEGER NOT NULL DEFAULT 0,
  last_event_timestamp INTEGER NOT NULL DEFAULT 0,
  actor TEXT,
  changed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX conversations_mode ON conversations(mode, changed_at);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  office_id TEXT NOT NULL,
  pool TEXT NOT NULL CHECK(pool IN ('general','admin')),
  starts_at INTEGER NOT NULL,
  local_date TEXT NOT NULL,
  local_time TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 99),
  rule_active INTEGER NOT NULL DEFAULT 1 CHECK(rule_active IN (0,1)),
  manual_closed INTEGER NOT NULL DEFAULT 0 CHECK(manual_closed IN (0,1)),
  source TEXT NOT NULL DEFAULT 'weekly' CHECK(source IN ('weekly','extra')),
  address TEXT NOT NULL,
  arrival TEXT NOT NULL,
  interviewer TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  config_revision INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  UNIQUE(office_id,pool,starts_at)
);
CREATE INDEX sessions_date ON sessions(local_date,office_id,pool);
CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  job_id TEXT NOT NULL CHECK(job_id IN ('housing_advisor','management_trainee','admin')),
  apply_city TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '未知',
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled')),
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL,
  retention_due TEXT NOT NULL,
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('line','admin')),
  actor TEXT NOT NULL
);
CREATE INDEX bookings_session ON bookings(session_id,status);
CREATE INDEX bookings_candidate ON bookings(candidate_id,status);
CREATE INDEX bookings_retention ON bookings(retention_due);
CREATE INDEX bookings_phone ON bookings(phone);
CREATE TABLE booking_events (
  id INTEGER PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  before_snapshot TEXT,
  after_snapshot TEXT NOT NULL,
  actor TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE operations (
  key TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  booking_id TEXT REFERENCES bookings(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE action_tokens (
  token TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  revision INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX tokens_expiry ON action_tokens(expires_at);
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  candidate_id TEXT REFERENCES candidates(id) ON DELETE CASCADE,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('received','ready','done')),
  response TEXT CHECK(response IS NULL OR json_valid(response)),
  response_mode_revision INTEGER,
  ack_human INTEGER NOT NULL DEFAULT 0,
  delivery_status TEXT NOT NULL DEFAULT 'none',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX webhook_expiry ON webhook_events(expires_at);
CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  detail TEXT NOT NULL CHECK(json_valid(detail)),
  at INTEGER NOT NULL
);
CREATE TABLE locks (key TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE transaction_guards (
  value INTEGER NOT NULL CONSTRAINT stale_revision CHECK(value=1)
);

-- These triggers run inside the writing transaction, never as a separate count-then-insert.
CREATE TRIGGER booking_insert_guard BEFORE INSERT ON bookings BEGIN
  SELECT CASE WHEN NEW.status <> 'confirmed' THEN RAISE(ABORT,'INVALID_STATUS') END;
  SELECT CASE WHEN NEW.actor_kind='line' AND NOT EXISTS(
    SELECT 1 FROM conversations WHERE candidate_id=NEW.candidate_id AND mode='auto'
  ) THEN RAISE(ABORT,'HUMAN_HANDOFF') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id AND rule_active=1 AND manual_closed=0)
    THEN RAISE(ABORT,'SESSION_CLOSED') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id AND starts_at>NEW.checked_at+3600)
    THEN RAISE(ABORT,'CUTOFF_PASSED') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id
    AND local_date BETWEEN date(NEW.checked_at,'unixepoch','+8 hours') AND date(NEW.checked_at,'unixepoch','+8 hours','+13 days'))
    THEN RAISE(ABORT,'OUTSIDE_WINDOW') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id
    AND pool = CASE WHEN NEW.job_id='admin' THEN 'admin' ELSE 'general' END
    AND (NEW.job_id<>'admin' OR office_id='taichung')) THEN RAISE(ABORT,'INVALID_JOB_POOL') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM bookings b JOIN sessions s ON s.id=b.session_id
    WHERE b.candidate_id=NEW.candidate_id AND b.status='confirmed' AND s.starts_at>NEW.checked_at)
    THEN RAISE(ABORT,'ACTIVE_BOOKING_EXISTS') END;
  SELECT CASE WHEN (SELECT count(*) FROM bookings WHERE session_id=NEW.session_id AND status='confirmed')
    >= (SELECT capacity FROM sessions WHERE id=NEW.session_id) THEN RAISE(ABORT,'SLOT_FULL') END;
END;
CREATE TRIGGER booking_update_guard BEFORE UPDATE ON bookings BEGIN
  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.candidate_id<>OLD.candidate_id OR NEW.created_at<>OLD.created_at
    THEN RAISE(ABORT,'IMMUTABLE_IDENTITY') END;
  SELECT CASE WHEN OLD.status<>'confirmed' THEN RAISE(ABORT,'ALREADY_CANCELLED') END;
  SELECT CASE WHEN NEW.revision<>OLD.revision+1 THEN RAISE(ABORT,'STALE_REVISION') END;
  SELECT CASE WHEN NEW.actor_kind='line' AND NOT EXISTS(
    SELECT 1 FROM conversations WHERE candidate_id=NEW.candidate_id AND mode='auto'
  ) THEN RAISE(ABORT,'HUMAN_HANDOFF') END;
  SELECT CASE WHEN (SELECT starts_at FROM sessions WHERE id=OLD.session_id)<=NEW.checked_at
    THEN RAISE(ABORT,'INTERVIEW_STARTED') END;
  SELECT CASE WHEN NEW.status='confirmed' AND NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id AND rule_active=1 AND manual_closed=0)
    THEN RAISE(ABORT,'SESSION_CLOSED') END;
  SELECT CASE WHEN NEW.status='confirmed' AND NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id AND starts_at>NEW.checked_at+3600)
    THEN RAISE(ABORT,'CUTOFF_PASSED') END;
  SELECT CASE WHEN NEW.status='confirmed' AND NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id
    AND local_date BETWEEN date(NEW.checked_at,'unixepoch','+8 hours') AND date(NEW.checked_at,'unixepoch','+8 hours','+13 days'))
    THEN RAISE(ABORT,'OUTSIDE_WINDOW') END;
  SELECT CASE WHEN NEW.status='confirmed' AND NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id
    AND pool = CASE WHEN NEW.job_id='admin' THEN 'admin' ELSE 'general' END
    AND (NEW.job_id<>'admin' OR office_id='taichung')) THEN RAISE(ABORT,'INVALID_JOB_POOL') END;
  SELECT CASE WHEN NEW.status='confirmed' AND (SELECT count(*) FROM bookings WHERE session_id=NEW.session_id AND status='confirmed' AND id<>OLD.id)
    >= (SELECT capacity FROM sessions WHERE id=NEW.session_id) THEN RAISE(ABORT,'SLOT_FULL') END;
END;
CREATE TRIGGER booking_insert_audit AFTER INSERT ON bookings BEGIN
  INSERT INTO booking_events(booking_id,type,after_snapshot,actor,at)
    VALUES(NEW.id,'created',NEW.snapshot,NEW.actor,NEW.checked_at);
END;
CREATE TRIGGER booking_update_audit AFTER UPDATE ON bookings BEGIN
  INSERT INTO booking_events(booking_id,type,before_snapshot,after_snapshot,actor,at)
    VALUES(NEW.id, CASE WHEN NEW.status='cancelled' THEN 'cancelled' ELSE 'rescheduled' END ,OLD.snapshot,NEW.snapshot,NEW.actor,NEW.checked_at);
END;
