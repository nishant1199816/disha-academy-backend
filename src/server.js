require('dotenv').config()
const express   = require('express')
const cors      = require('cors')
const helmet    = require('helmet')
const rateLimit = require('express-rate-limit')
const routes    = require('./routes')

const app  = express()
const PORT = process.env.PORT || 5000

app.set('trust proxy', 1)
app.use(helmet())

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (origin.includes('vercel.app') || origin.includes('localhost')) return callback(null, true)
    if (process.env.FRONTEND_URL && origin === process.env.FRONTEND_URL) return callback(null, true)
    callback(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }))
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }))

app.use('/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    if (Buffer.isBuffer(req.body)) { req.rawBody = req.body; req.body = JSON.parse(req.body.toString()) }
    next()
  }
)
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

app.use('/api', routes)

app.get('/',       (req, res) => res.json({ status: '✅ Online', service: 'Disha Academy API' }))
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }))

app.use((req, res) => res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found.` }))
app.use((err, req, res, next) => {
  console.error('Error:', err.message)
  res.status(500).json({ success: false, message: process.env.NODE_ENV === 'production' ? 'Server error.' : err.message })
})

async function startServer() {
  // Auto-run migrations if tables don't exist
  try {
    const pool = require('./db/pool')
    const check = await pool.query(`SELECT to_regclass('public.users') as t`)
    if (!check.rows[0].t) {
      console.log('🔧 Running DB migrations...')
      const { execSync } = require('child_process')
      execSync('node src/db/migrate.js', { stdio: 'inherit' })
      execSync('node src/db/seed.js', { stdio: 'inherit' })
      console.log('✅ DB setup complete!')
    } else {
      console.log('✅ DB tables already exist')
    }
  } catch (err) {
    console.error('⚠️  DB check failed:', err.message)
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🎓 Disha Academy API — Port ${PORT} — ${process.env.NODE_ENV}\n`)
  })
}

startServer()
module.exports = app
