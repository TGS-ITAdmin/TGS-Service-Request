import pg from 'pg'
import bcrypt from 'bcryptjs'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL not set — falling back to local Postgres defaults. Set DATABASE_URL for Railway.')
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/helpdesk',
  ssl: process.env.PGSSL === 'false' ? false : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false),
})

// query() mirrors the old better-sqlite3 call shape closely enough to keep route
// files readable: pass a Postgres-style $1,$2... query and a params array.
export async function query(text, params = []) {
  const res = await pool.query(text, params)
  return res
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'requestor',
  dept TEXT,
  color TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  verify_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  dept_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  PRIMARY KEY (dept_id, name)
);
CREATE TABLE IF NOT EXISTS routing (
  dept_id TEXT NOT NULL,
  category TEXT NOT NULL,
  user_id TEXT,
  PRIMARY KEY (dept_id, category)
);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  num INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  dept TEXT,
  category TEXT,
  assignee TEXT,
  requestor_id TEXT REFERENCES users(id),
  req_name TEXT,
  req_email TEXT,
  due_date TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_id TEXT,
  sender_name TEXT,
  sender_type TEXT,
  body TEXT NOT NULL,
  internal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor TEXT,
  action TEXT,
  field TEXT,
  "from" TEXT,
  "to" TEXT,
  ts TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS ratings (
  ticket_id TEXT PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  agent_id TEXT,
  requestor_id TEXT,
  stars INTEGER NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (k TEXT PRIMARY KEY, v INTEGER);
CREATE TABLE IF NOT EXISTS subtasks (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  assignee TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  done_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS subtasks_ticket_idx ON subtasks(ticket_id);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  uploaded_by TEXT,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_ticket_idx ON attachments(ticket_id);

-- ---------- Projects ----------
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#3b82f6',
  privacy TEXT NOT NULL DEFAULT 'members',
  archived BOOLEAN NOT NULL DEFAULT false,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sections_project_idx ON sections(project_id);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee TEXT,
  due_date TEXT,
  priority TEXT,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  recurrence JSONB,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
-- A project item is a task OR a form ticket placed in a project (multi-homing: the same one can be in many projects)
CREATE TABLE IF NOT EXISTS project_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES sections(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  ticket_id TEXT REFERENCES tickets(id) ON DELETE CASCADE,
  position DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((task_id IS NOT NULL)::int + (ticket_id IS NOT NULL)::int = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_items_task_uq ON project_items(project_id, task_id) WHERE task_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS project_items_ticket_uq ON project_items(project_id, ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_items_task_idx ON project_items(task_id);
CREATE INDEX IF NOT EXISTS project_items_ticket_idx ON project_items(ticket_id);
CREATE TABLE IF NOT EXISTS task_deps (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocked_by TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, blocked_by),
  CHECK (task_id <> blocked_by)
);
CREATE TABLE IF NOT EXISTS task_subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  assignee TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  done_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS task_subtasks_idx ON task_subtasks(task_id);
CREATE TABLE IF NOT EXISTS task_messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  sender_id TEXT,
  sender_name TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS task_messages_idx ON task_messages(task_id);
CREATE TABLE IF NOT EXISTS task_audit (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor TEXT,
  action TEXT,
  field TEXT,
  "from" TEXT,
  "to" TEXT,
  ts TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS task_audit_idx ON task_audit(task_id);
CREATE TABLE IF NOT EXISTS task_attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  uploaded_by TEXT,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS task_attachments_idx ON task_attachments(task_id);
CREATE TABLE IF NOT EXISTS custom_fields (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]',
  position DOUBLE PRECISION NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS custom_fields_project_idx ON custom_fields(project_id);
CREATE TABLE IF NOT EXISTS custom_values (
  field_id TEXT NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES project_items(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  PRIMARY KEY (field_id, item_id)
);
`

export async function initDb() {
  await pool.query(SCHEMA)
  // Migrations for databases created before user management existed
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false')
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ')
  // Role model is Owner / Admin / Manager / Requestor. Convert anything left over from the old model.
  await pool.query("UPDATE users SET role = 'manager' WHERE role = 'agent'")
  await pool.query("UPDATE messages SET sender_type = 'staff' WHERE sender_type = 'agent'")
  // Someone must be Owner: if there isn't one, the earliest-created Admin becomes it.
  await pool.query(`UPDATE users SET role = 'owner'
    WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at, id LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'owner')`)

  const { rows: [{ c }] } = await pool.query('SELECT COUNT(*)::int c FROM users')
  if (c > 0) return

  console.log('🌱 Seeding initial data...')
  const hash = p => bcrypt.hashSync(p, 10)
  const insUser = 'INSERT INTO users (id,name,email,password_hash,role,dept,color,verified) VALUES ($1,$2,$3,$4,$5,$6,$7,true)'
  await pool.query(insUser, ['u-admin', 'Admin User',   'admin@company.com', hash('Admin@123'),  'owner',   null,       '#1e3a8a'])
  await pool.query(insUser, ['u1',      'Alice Chen',   'alice@company.com', hash('Staff@123'),  'manager', 'dept-it',  '#3b82f6'])
  await pool.query(insUser, ['u2',      'Bob Martinez', 'bob@company.com',   hash('Staff@123'),  'manager',   'dept-it',  '#06b6d4'])
  await pool.query(insUser, ['u3',      'Carol Smith',  'carol@company.com', hash('Staff@123'),  'manager', 'dept-hr',  '#10b981'])
  await pool.query(insUser, ['u4',      'David Lee',    'david@company.com', hash('Staff@123'),  'manager',   'dept-fin', '#f59e0b'])
  await pool.query(insUser, ['u5',      'Eva Brown',    'eva@company.com',   hash('Staff@123'),  'manager', 'dept-ops', '#8b5cf6'])
  await pool.query(insUser, ['u6',      'Frank Davis',  'frank@company.com', hash('Staff@123'),  'manager',   'dept-it',  '#ef4444'])

  const insDept = 'INSERT INTO departments (id,name,color) VALUES ($1,$2,$3)'
  await pool.query(insDept, ['dept-it','IT Support','#3b82f6'])
  await pool.query(insDept, ['dept-hr','Human Resources','#10b981'])
  await pool.query(insDept, ['dept-fin','Finance','#f59e0b'])
  await pool.query(insDept, ['dept-ops','Operations','#8b5cf6'])
  await pool.query(insDept, ['dept-fac','Facilities','#ef4444'])

  const CATS = {
    'dept-it':  ['Hardware Issue','Software / App','Network / VPN','Account Access','Security','New Equipment','Other'],
    'dept-hr':  ['Onboarding','Benefits','Payroll','Policy Question','Leave Request','Performance','Other'],
    'dept-fin': ['Expense Report','Invoice / Payment','Budget Request','Reimbursement','Audit / Compliance','Purchase Order','Other'],
    'dept-ops': ['Process Issue','Vendor / Supplier','Compliance','Reporting','Project Request','Other'],
    'dept-fac': ['Maintenance','Equipment Repair','Space Request','Safety Concern','Cleaning','Utilities','Other'],
  }
  for (const [d, cats] of Object.entries(CATS)) {
    for (const cName of cats) await pool.query('INSERT INTO categories (dept_id,name) VALUES ($1,$2)', [d, cName])
  }

  const insRoute = 'INSERT INTO routing (dept_id,category,user_id) VALUES ($1,$2,$3)'
  await pool.query(insRoute, ['dept-it','_default','u1'])
  await pool.query(insRoute, ['dept-it','Hardware Issue','u2']); await pool.query(insRoute, ['dept-it','Network / VPN','u2'])
  await pool.query(insRoute, ['dept-it','Account Access','u6']); await pool.query(insRoute, ['dept-it','New Equipment','u6'])
  await pool.query(insRoute, ['dept-hr','_default','u3'])
  await pool.query(insRoute, ['dept-fin','_default','u4'])
  await pool.query(insRoute, ['dept-ops','_default','u5'])
  await pool.query(insRoute, ['dept-fac','_default',null])

  // Seeded demo accounts use well-known passwords, so make people replace them on first login
  await pool.query('UPDATE users SET must_change_password = true')

  await pool.query('INSERT INTO counters (k,v) VALUES ($1,$2)', ['ticket', 1000])
  console.log('✅ Seed complete (default passwords: Admin@123 / Staff@123 — change these before real use)')
}

export async function nextTicketNum() {
  const { rows: [{ v }] } = await pool.query("UPDATE counters SET v = v + 1 WHERE k = 'ticket' RETURNING v")
  return v
}

export default pool
