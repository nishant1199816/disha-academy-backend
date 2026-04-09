require('dotenv').config()

const express   = require('express')
const cors      = require('cors')
const helmet    = require('helmet')
const rateLimit = require('express-rate-limit')
const routes    = require('./routes')
const migrate   = require('./db/migrate')

const app  = express()
const PORT = process.env.PORT || 5000

// ── Trust Railway proxy ──────────────────────────────────────────
app.set('trust proxy', 1)

// ── Security ─────────────────────────────────────────────────────
app.use(helmet())

// ── CORS ─────────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  process.env.FRONTEND_URL,
  'https://disha-academy.vercel.app',
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) return callback(null, true)
    return callback(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true,
}))

// ── Rate limiting ────────────────────────────────────────────────
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
}))

app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
}))

// ── Body parsers ─────────────────────────────────────────────────
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

// ── Routes ───────────────────────────────────────────────────────
app.use('/api', routes)

// ── Health check ─────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: '✅ Online',
    service: 'Disha Academy API',
  })
})

app.get('/health', (req, res) => {
  res.json({ status: 'OK' })
})

// ── 404 ──────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found.`,
  })
})

// ── Global error handler ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message)

  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error.'
      : err.message,
  })
})

// ── Handle unhandled errors ──────────────────────────────────────
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err)
})

// ── START SERVER ─────────────────────────────────────────────────
async function startServer() {
  try {
    // 🔥 DB ko optional bana diya (crash nahi hoga)
    try {
      await migrate()
      console.log('✅ Database connected')
    } catch (err) {
      console.error('⚠️ DB Error:', err.message)
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`)
    })

  } catch (err) {
    console.error('❌ Startup Error:', err)
    process.exit(1)
  }
}

startServer()

module.exports = app