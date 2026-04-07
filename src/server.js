require('dotenv').config()
const express   = require('express')
const cors      = require('cors')
const helmet    = require('helmet')
const rateLimit = require('express-rate-limit')
const routes    = require('./routes')

const app  = express()
const PORT = process.env.PORT || 5000

// ── Trust Railway proxy ──────────────────────────────────────────
app.set('trust proxy', 1)

// ── Security ─────────────────────────────────────────────────────
app.use(helmet())

// ── CORS — allow Vercel frontend ─────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  process.env.FRONTEND_URL,
  'https://disha-academy.vercel.app',
].filter(Boolean)

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) return callback(null, true)
    callback(new Error(`CORS blocked: ${origin}`))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// ── Rate limiting ────────────────────────────────────────────────
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
}))

app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many login attempts. Please wait 15 minutes.' },
}))

// ── Body parsers ─────────────────────────────────────────────────
// Razorpay webhook — raw body
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

// ── Health check (Railway uses this) ─────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status:    '✅ Online',
    service:   'Disha Academy API',
    version:   '1.0.0',
    timestamp: new Date().toISOString(),
  })
})

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() })
})

// ── 404 ──────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found.` })
})

// ── Global error handler ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err.message)
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error.'
      : err.message,
  })
})

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔══════════════════════════════════════╗')
  console.log(`║   🎓 Disha Academy API               ║`)
  console.log(`║   Port    : ${PORT}                     ║`)
  console.log(`║   Env     : ${process.env.NODE_ENV || 'development'}              ║`)
  console.log(`║   Frontend: ${process.env.FRONTEND_URL || 'localhost:3000'}`)
  console.log('╚══════════════════════════════════════╝\n')
})

module.exports = app
const migrate = require('./db/migrate')

async function startServer() {
  try {
    await migrate() // 🔥 ye sabse important hai
    console.log("DB Ready ✅")

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
    })
  } catch (err) {
    console.error("Startup error ❌", err)
  }
}

startServer()