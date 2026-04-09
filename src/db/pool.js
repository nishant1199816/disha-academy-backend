const { Pool } = require('pg')
require('dotenv').config()

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL missing in environment variables")
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false } // Railway fix
    : false,

  max: 10, // max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})

// ── Events ─────────────────────────────────────────
pool.on('connect', () => {
  console.log('✅ PostgreSQL connected')
})

pool.on('error', (err) => {
  console.error('❌ PostgreSQL error:', err.message)
})

module.exports = pool