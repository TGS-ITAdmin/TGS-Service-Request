import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import authRouter from './routes/auth.js'
import ticketsRouter from './routes/tickets.js'
import usersRouter from './routes/users.js'
import departmentsRouter from './routes/departments.js'
import { sentEmails } from './email.js'
import { requireAuth } from './auth.js'
import { initDb } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean)
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {}))
app.use(express.json())

app.get('/api/health', (req, res) => res.json({ ok: true }))

app.use('/api/auth', authRouter)
app.use('/api/tickets', ticketsRouter)
app.use('/api/users', usersRouter)
app.use('/api/departments', departmentsRouter)

// Sent-email log (testing aid — Ethereal preview links)
app.get('/api/emails', requireAuth, (req, res) => res.json(sentEmails))

// Serve the built React SPA (npm run build → dist/)
const distDir = join(__dirname, '../dist')
app.use(express.static(distDir))
app.get('*', (req, res) => res.sendFile(join(distDir, 'index.html')))

async function start() {
  try {
    await initDb()
  } catch (err) {
    console.error('❌ Failed to initialize database:', err.message)
    process.exit(1)
  }
  app.listen(PORT, () => console.log(`🎫 HelpDesk running on http://localhost:${PORT}`))
}

start()
