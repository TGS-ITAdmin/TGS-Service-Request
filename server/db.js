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
`

export async function initDb() {
  await pool.query(SCHEMA)

  const { rows: [{ c }] } = await pool.query('SELECT COUNT(*)::int c FROM users')
  if (c > 0) return

  console.log('🌱 Seeding initial data...')
  const hash = p => bcrypt.hashSync(p, 10)
  const insUser = 'INSERT INTO users (id,name,email,password_hash,role,dept,color,verified) VALUES ($1,$2,$3,$4,$5,$6,$7,true)'
  await pool.query(insUser, ['u-admin', 'Admin User',   'admin@company.com', hash('Admin@123'),  'admin',   null,       '#1e3a8a'])
  await pool.query(insUser, ['u1',      'Alice Chen',   'alice@company.com', hash('Staff@123'),  'manager', 'dept-it',  '#3b82f6'])
  await pool.query(insUser, ['u2',      'Bob Martinez', 'bob@company.com',   hash('Staff@123'),  'agent',   'dept-it',  '#06b6d4'])
  await pool.query(insUser, ['u3',      'Carol Smith',  'carol@company.com', hash('Staff@123'),  'manager', 'dept-hr',  '#10b981'])
  await pool.query(insUser, ['u4',      'David Lee',    'david@company.com', hash('Staff@123'),  'agent',   'dept-fin', '#f59e0b'])
  await pool.query(insUser, ['u5',      'Eva Brown',    'eva@company.com',   hash('Staff@123'),  'manager', 'dept-ops', '#8b5cf6'])
  await pool.query(insUser, ['u6',      'Frank Davis',  'frank@company.com', hash('Staff@123'),  'agent',   'dept-it',  '#ef4444'])

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

  await pool.query('INSERT INTO counters (k,v) VALUES ($1,$2)', ['ticket', 1000])
  console.log('✅ Seed complete (default passwords: Admin@123 / Staff@123 — change these before real use)')
}

export async function nextTicketNum() {
  const { rows: [{ v }] } = await pool.query("UPDATE counters SET v = v + 1 WHERE k = 'ticket' RETURNING v")
  return v
}

export default pool
