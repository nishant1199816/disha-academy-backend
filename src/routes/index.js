const express  = require('express')
const router   = express.Router()
const { protect, adminOnly, requireEnrollment } = require('../middleware/auth')

const authCtrl    = require('../controllers/authController')
const courseCtrl  = require('../controllers/courseController')
const paymentCtrl = require('../controllers/paymentController')

// ── AUTH ──────────────────────────────────────────────────────────
router.post('/auth/register',        authCtrl.register)
router.post('/auth/login',           authCtrl.login)
router.get ('/auth/me',              protect, authCtrl.getMe)
router.put ('/auth/change-password', protect, authCtrl.changePassword)

// ── COURSES (public) ──────────────────────────────────────────────
router.get('/courses',     courseCtrl.getAllCourses)
router.get('/courses/:id', courseCtrl.getCourse)

// ── COURSE CONTENT (enrolled only) ───────────────────────────────
router.get('/courses/:courseId/live-classes', protect, requireEnrollment, courseCtrl.getLiveClasses)
router.get('/courses/:courseId/materials',    protect, requireEnrollment, courseCtrl.getMaterials)

// ── STUDENT DASHBOARD ─────────────────────────────────────────────
router.get('/dashboard', protect, courseCtrl.getStudentDashboard)

// ── PAYMENTS ──────────────────────────────────────────────────────
router.post('/payments/create-order', protect, paymentCtrl.createOrder)
router.post('/payments/verify',       protect, paymentCtrl.verifyPayment)
router.get ('/payments/my-history',   protect, paymentCtrl.getMyHistory)
router.post('/payments/webhook',             paymentCtrl.webhook)

// ── ADMIN ─────────────────────────────────────────────────────────
router.get('/admin/dashboard', protect, adminOnly, courseCtrl.getAdminDashboard)
router.get('/admin/payments',  protect, adminOnly, paymentCtrl.getAllPayments)

// ── SETUP (ek baar run karo seed ke liye) ─────────────────────────
router.get('/setup', async (req, res) => {
  const secret = req.query.secret
  if (secret !== process.env.SETUP_SECRET) {
    return res.status(403).json({ success: false, message: 'Invalid secret key' })
  }
  try {
    const pool = require('../db/pool')

    // Check karo courses hain ya nahi
    const check = await pool.query('SELECT COUNT(*) FROM courses')
    if (parseInt(check.rows[0].count) > 0) {
      return res.json({ success: true, message: `Already seeded! ${check.rows[0].count} courses exist.` })
    }

    // Seed courses
    const courses = [
      { title: 'SSC CGL — Complete Batch 2025',       slug: 'ssc-cgl-2025',           exam: 'SSC CGL',           price: 4999, dur: '6 months', lec: 200 },
      { title: 'SSC CHSL — Full Course 2025',         slug: 'ssc-chsl-2025',          exam: 'SSC CHSL',          price: 3999, dur: '4 months', lec: 150 },
      { title: 'Delhi Police Constable Batch',        slug: 'delhi-police-2025',      exam: 'Delhi Police',      price: 3499, dur: '4 months', lec: 160 },
      { title: 'UP Police Constable Batch',           slug: 'up-police-2025',         exam: 'UP Police',         price: 2999, dur: '3 months', lec: 120 },
      { title: 'Haryana Police Constable Batch',      slug: 'haryana-police-2025',    exam: 'Haryana Police',    price: 2999, dur: '3 months', lec: 110 },
      { title: 'Chandigarh Police Constable Batch',   slug: 'chandigarh-police-2025', exam: 'Chandigarh Police', price: 2499, dur: '3 months', lec: 100 },
      { title: 'Railway RRB NTPC + Group D Batch',    slug: 'railway-rrb-2025',       exam: 'Railway',           price: 3999, dur: '5 months', lec: 180 },
      { title: 'DSSSB — DASS Grade II / ASO Batch',   slug: 'dsssb-2025',             exam: 'DSSSB',             price: 4499, dur: '5 months', lec: 160 },
    ]

    for (const c of courses) {
      await pool.query(`
        INSERT INTO courses (title, slug, exam_type, price, duration, lectures, description)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (slug) DO UPDATE SET title=$1, price=$4
      `, [c.title, c.slug, c.exam, c.price, c.dur, c.lec,
          `${c.exam} ki complete preparation — Maths, Reasoning, English, GS sab covered.`])
    }

    // Seed admin user
    const bcrypt = require('bcryptjs')
    const adminHash = await bcrypt.hash('admin123', 12)
    await pool.query(`
      INSERT INTO users (name, email, phone, password, role)
      VALUES ('Admin User', 'admin@disha.com', '9354888970', $1, 'admin')
      ON CONFLICT (email) DO NOTHING
    `, [adminHash])

    // Seed demo student
    const studentHash = await bcrypt.hash('student123', 12)
    await pool.query(`
      INSERT INTO users (name, email, phone, password, role)
      VALUES ('Rahul Sharma', 'student@disha.com', '9876543210', $1, 'student')
      ON CONFLICT (email) DO NOTHING
    `, [studentHash])

    // Seed live classes for SSC CGL
    const cglRes = await pool.query(`SELECT id FROM courses WHERE slug='ssc-cgl-2025'`)
    if (cglRes.rows.length) {
      const cid = cglRes.rows[0].id
      const classes = [
        { title: 'Number System & Simplification', subject: 'Mathematics', mins: 30 },
        { title: 'Syllogism & Puzzles',             subject: 'Reasoning',   mins: 90 },
        { title: 'Error Detection & Para Jumbles',  subject: 'English',     mins: 210 },
      ]
      for (const cls of classes) {
        const t = new Date()
        t.setMinutes(t.getMinutes() + cls.mins)
        await pool.query(`
          INSERT INTO live_classes (course_id, title, subject, teacher_name, scheduled_at, status)
          VALUES ($1,$2,$3,'Disha Faculty',$4,'scheduled')
        `, [cid, cls.title, cls.subject, t])
      }
    }

    res.json({
      success: true,
      message: '✅ Database seeded successfully!',
      data: {
        courses:  8,
        admin:    'admin@disha.com / admin123',
        student:  'student@disha.com / student123',
      }
    })
  } catch (err) {
    console.error('Setup error:', err)
    res.status(500).json({ success: false, message: err.message })
  }
})


// ── STUDENT: Get recorded lectures ───────────────────────────────
router.get('/live-classes/recordings', protect, async (req, res) => {
  try {
    const pool = require('../db/pool')
    // Get all ended classes with recordings for enrolled courses
    const result = await pool.query(`
      SELECT lc.id, lc.title, lc.subject, lc.teacher_name,
             lc.scheduled_at, lc.recording_url, c.title AS course_title
      FROM live_classes lc
      JOIN courses c ON c.id = lc.course_id
      JOIN enrollments e ON e.course_id = c.id
      WHERE e.user_id = $1
        AND e.is_active = true
        AND lc.status = 'ended'
        AND lc.recording_url IS NOT NULL
      ORDER BY lc.scheduled_at DESC
    `, [req.user.id])
    res.json({ success: true, classes: result.rows })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── ADMIN: Add recording URL to ended class ───────────────────────
router.post('/admin/live-classes/:id/recording', protect, adminOnly, async (req, res) => {
  try {
    const pool = require('../db/pool')
    const { recording_url } = req.body
    if (!recording_url) return res.status(400).json({ success: false, message: 'Recording URL required' })
    await pool.query(
      'UPDATE live_classes SET recording_url = $1 WHERE id = $2',
      [recording_url, req.params.id]
    )
    res.json({ success: true, message: 'Recording added!' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router

// ── ADMIN COURSE MANAGEMENT ───────────────────────────────────────
router.post('/admin/courses', protect, adminOnly, async (req, res) => {
  try {
    const pool = require('../db/pool')
    const { title, slug, exam_type, price, duration, lectures, description } = req.body
    if (!title || !exam_type || !price) return res.status(400).json({ success: false, message: 'Title, exam_type, price required' })
    const result = await pool.query(`
      INSERT INTO courses (title, slug, exam_type, price, duration, lectures, description)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [title, slug, exam_type, parseInt(price), duration, parseInt(lectures)||0, description])
    res.json({ success: true, course: result.rows[0] })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

router.delete('/admin/courses/:id', protect, adminOnly, async (req, res) => {
  try {
    const pool = require('../db/pool')
    await pool.query('UPDATE courses SET is_active=false WHERE id=$1', [req.params.id])
    res.json({ success: true, message: 'Course deleted' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

router.delete('/admin/students/:id', protect, adminOnly, async (req, res) => {
  try {
    const pool = require('../db/pool')
    await pool.query('UPDATE users SET is_active=false WHERE id=$1 AND role=\'student\'', [req.params.id])
    res.json({ success: true, message: 'Student deleted' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── ADMIN LIVE CLASS MANAGEMENT ───────────────────────────────────
router.get('/admin/live-classes', protect, adminOnly, async (req, res) => {
  try {
    const pool = require('../db/pool')
    const result = await pool.query(`
      SELECT lc.*, c.title AS course_title
      FROM live_classes lc
      LEFT JOIN courses c ON c.id = lc.course_id
      ORDER BY lc.scheduled_at DESC
      LIMIT 50
    `)
    res.json({ success: true, classes: result.rows })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

router.post('/admin/live-classes', protect, adminOnly, async (req, res) => {
  try {
    const pool = require('../db/pool')
    const { course_id, title, subject, teacher_name, scheduled_at, duration_min } = req.body
    if (!course_id || !title || !subject || !scheduled_at) {
      return res.status(400).json({ success: false, message: 'Required fields missing' })
    }
    const result = await pool.query(`
      INSERT INTO live_classes (course_id, title, subject, teacher_name, scheduled_at, duration_min, status)
      VALUES ($1,$2,$3,$4,$5,$6,'scheduled') RETURNING *
    `, [course_id, title, subject, teacher_name || 'Disha Faculty', scheduled_at, duration_min || 90])
    res.json({ success: true, class: result.rows[0] })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

router.post('/admin/live-classes/:id/start', protect, adminOnly, async (req, res) => {
  try {
    const pool = require('../db/pool')
    await pool.query(`UPDATE live_classes SET status='live' WHERE id=$1`, [req.params.id])
    res.json({ success: true, message: 'Class is now LIVE!' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

router.post('/admin/live-classes/:id/end', protect, adminOnly, async (req, res) => {
  try {
    const pool = require('../db/pool')
    await pool.query(`UPDATE live_classes SET status='ended' WHERE id=$1`, [req.params.id])
    res.json({ success: true, message: 'Class ended.' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

router.delete('/admin/live-classes/:id', protect, adminOnly, async (req, res) => {
  try {
    const pool = require('../db/pool')
    await pool.query(`DELETE FROM live_classes WHERE id=$1`, [req.params.id])
    res.json({ success: true, message: 'Class deleted.' })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})
