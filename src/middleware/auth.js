const jwt  = require('jsonwebtoken')
const pool = require('../db/pool')

// ── Verify JWT token ───────────────────────────────────────────────
const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' })
    }

    const token = header.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Fetch fresh user from DB
    const result = await pool.query(
      'SELECT id, name, email, phone, role, is_active FROM users WHERE id = $1',
      [decoded.id]
    )

    if (!result.rows.length) {
      return res.status(401).json({ success: false, message: 'User not found.' })
    }

    const user = result.rows[0]
    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Account is deactivated.' })
    }

    req.user = user
    next()
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expired. Please login again.' })
    }
    return res.status(401).json({ success: false, message: 'Invalid token.' })
  }
}

// ── Admin only ────────────────────────────────────────────────────
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required.' })
  }
  next()
}

// ── Check course enrollment ───────────────────────────────────────
const requireEnrollment = async (req, res, next) => {
  try {
    const courseId = req.params.courseId || req.body.courseId
    if (!courseId) return res.status(400).json({ success: false, message: 'Course ID required.' })

    // Admins bypass enrollment check
    if (req.user.role === 'admin') return next()

    const result = await pool.query(`
      SELECT id FROM enrollments
      WHERE user_id = $1 AND course_id = $2 AND is_active = true
        AND (expires_at IS NULL OR expires_at > NOW())
    `, [req.user.id, courseId])

    if (!result.rows.length) {
      return res.status(403).json({ success: false, message: 'Please purchase this course to access content.' })
    }

    next()
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' })
  }
}

module.exports = { protect, adminOnly, requireEnrollment }
