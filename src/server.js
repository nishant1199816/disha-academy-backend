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

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  process.env.FRONTEND_URL,
  'https://disha-academy.vercel.app',
  'https://disha-academy-git-main-nishant1199816s-projects.vercel.app',
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (allowedOrigins.some(o => origin.startsWith(o.replace('*', '')))) return callback(null, true)
    if (origin.includes('vercel.app')) return callback(null, true)
    callback(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  message: { success: false, message: 'Too many requests.' },
}))

app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  message: { success: false, message: 'Too many login attempts.' },
}))

// Razorpay webhook - raw body
app.use('/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => {
    if (Buffer.isBuffer(req.body)) {
      req.rawBody = req.body
      req.body = JSON.parse(req.body.toString())
    }
    next()
  }
)

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

app.use('/api', routes)

// Health check
app.get('/', (req, res) => {
  res.json({ status: '✅ Online', service: 'Disha Academy API', version: '1.0.0' })
})
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() })
})

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found.` })
})

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message)
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error.' : err.message,
  })
})

// Auto-run migrations on start
const pool = require('./db/pool')
async function initDB() {
  try {
    const res = await pool.query(`SELECT to_regclass('public.users') as exists`)
    if (!res.rows[0].exists) {
      console.log('🔧 Tables not found — running migrations...')
      const migrate = require('./db/migrate')
      console.log('✅ Migration done')
    } else {
      console.log('✅ Database tables exist')
    }
  } catch (err) {
    console.error('DB check error:', err.message)
  }
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🎓 Disha Academy API running on port ${PORT}`)
  console.log(`   ENV: ${process.env.NODE_ENV}`)
  console.log(`   Frontend: ${process.env.FRONTEND_URL}\n`)
  await initDB()
})

module.exports = app
