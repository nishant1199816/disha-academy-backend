require('dotenv').config()
const pool  = require('./pool')
const bcrypt = require('bcryptjs')

async function seed() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    console.log('🌱 Seeding database...')

    // ── Admin user ─────────────────────────────────────────────────
    const adminHash = await bcrypt.hash('admin123', 12)
    await client.query(`
      INSERT INTO users (name, email, phone, password, role)
      VALUES ('Admin User', 'admin@disha.com', '9354888970', $1, 'admin')
      ON CONFLICT (email) DO NOTHING
    `, [adminHash])
    console.log('  ✓ Admin user: admin@disha.com / admin123')

    // ── Demo student ───────────────────────────────────────────────
    const studentHash = await bcrypt.hash('student123', 12)
    await client.query(`
      INSERT INTO users (name, email, phone, password, role)
      VALUES ('Rahul Sharma', 'student@disha.com', '9876543210', $1, 'student')
      ON CONFLICT (email) DO NOTHING
    `, [studentHash])
    console.log('  ✓ Student: student@disha.com / student123')

    // ── All 8 courses ──────────────────────────────────────────────
    const courses = [
      { title: 'SSC CGL — Complete Batch 2025',         slug: 'ssc-cgl-2025',          exam: 'SSC CGL',           price: 4999, dur: '6 months', lec: 200 },
      { title: 'SSC CHSL — Full Course 2025',           slug: 'ssc-chsl-2025',         exam: 'SSC CHSL',          price: 3999, dur: '4 months', lec: 150 },
      { title: 'Delhi Police Constable Batch',          slug: 'delhi-police-2025',     exam: 'Delhi Police',      price: 3499, dur: '4 months', lec: 160 },
      { title: 'UP Police Constable Batch',             slug: 'up-police-2025',        exam: 'UP Police',         price: 2999, dur: '3 months', lec: 120 },
      { title: 'Haryana Police Constable Batch',        slug: 'haryana-police-2025',   exam: 'Haryana Police',    price: 2999, dur: '3 months', lec: 110 },
      { title: 'Chandigarh Police Constable Batch',     slug: 'chandigarh-police-2025',exam: 'Chandigarh Police', price: 2499, dur: '3 months', lec: 100 },
      { title: 'Railway RRB NTPC + Group D Batch',      slug: 'railway-rrb-2025',      exam: 'Railway',           price: 3999, dur: '5 months', lec: 180 },
      { title: 'DSSSB — DASS Grade II / ASO Batch',     slug: 'dsssb-2025',            exam: 'DSSSB',             price: 4499, dur: '5 months', lec: 160 },
    ]

    for (const c of courses) {
      await client.query(`
        INSERT INTO courses (title, slug, exam_type, price, duration, lectures, description)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (slug) DO UPDATE SET title=$1, price=$4
      `, [c.title, c.slug, c.exam, c.price, c.dur, c.lec,
          `${c.exam} ki complete preparation — Maths, Reasoning, English, GS sab covered.`])
    }
    console.log('  ✓ 8 courses seeded')

    // ── Demo live classes ──────────────────────────────────────────
    const cglRes = await client.query(`SELECT id FROM courses WHERE slug='ssc-cgl-2025'`)
    if (cglRes.rows.length) {
      const cid = cglRes.rows[0].id
      const classes = [
        { title: 'Number System & Simplification', subject: 'Mathematics', teacher: 'Disha Faculty', mins: 30 },
        { title: 'Syllogism & Puzzles',             subject: 'Reasoning',   teacher: 'Disha Faculty', mins: 90 },
        { title: 'Error Detection & Para Jumbles',  subject: 'English',     teacher: 'Disha Faculty', mins: 210 },
      ]
      for (const cls of classes) {
        const t = new Date(); t.setMinutes(t.getMinutes() + cls.mins)
        await client.query(`
          INSERT INTO live_classes (course_id, title, subject, teacher_name, scheduled_at, status)
          VALUES ($1, $2, $3, $4, $5, 'scheduled')
        `, [cid, cls.title, cls.subject, cls.teacher, t])
      }
      console.log('  ✓ 3 demo live classes')
    }

    await client.query('COMMIT')
    console.log('\n✅ Seeding complete!\n')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('❌ Seed failed:', err.message)
    process.exit(1)
  } finally {
    client.release()
    pool.end()
  }
}

seed()
