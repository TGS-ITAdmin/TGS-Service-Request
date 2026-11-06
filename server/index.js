import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import authRouter from './routes/auth.js'
import ticketsRouter from './routes/tickets.js'
import usersRouter from './routes/users.js'
import departmentsRouter from './routes/departments.js'
import { sentEmails } from './email.js'
import { requireAuth, requireAdmin } from './auth.js'
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
app.get('/api/emails', requireAuth, requireAdmin, (req, res) => res.json(sentEmails))

// Serve the built React SPA (npm run build → dist/)
const distDir = join(__dirname, '../dist')
app.use(express.static(distDir))
app.get('*', (req, res) => res.sendFile(join(distDir, 'index.html')))

// Any error thrown in an async route lands here instead of crashing the server
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  const status = err.status || err.statusCode || 500
  if (status === 413) return res.status(413).json({ error: 'File is too large (10 MB maximum)' })
  if (status < 500) return res.status(status).json({ error: err.message || 'Bad request' })
  console.error('Unhandled route error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

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
