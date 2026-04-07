const bcrypt = require('bcryptjs')
const jwt    = require('jsonwebtoken')
const pool   = require('../db/pool')

// Generate JWT
const signToken = (id, role) =>
  jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' })

// ── POST /api/auth/register ────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required.' })
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' })
    }

    // Check existing
    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
    if (exists.rows.length) {
      return res.status(409).json({ success: false, message: 'Email already registered. Please login.' })
    }

    // Hash password
    const hashed = await bcrypt.hash(password, 12)

    // Insert user
    const result = await pool.query(`
      INSERT INTO users (name, email, phone, password)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, phone, role, created_at
    `, [name.trim(), email.toLowerCase().trim(), phone || null, hashed])

    const user  = result.rows[0]
    const token = signToken(user.id, user.role)

    res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      token,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role },
    })
  } catch (err) {
    console.error('Register error:', err)
    res.status(500).json({ success: false, message: 'Server error. Please try again.' })
  }
}

// ── POST /api/auth/login ───────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' })
    }

    // Find user
    const result = await pool.query(
      'SELECT id, name, email, phone, password, role, is_active FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    )

    if (!result.rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' })
    }

    const user = result.rows[0]

    if (!user.is_active) {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated. Contact support.' })
    }

    // Check password
    const match = await bcrypt.compare(password, user.password)
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' })
    }

    // Get enrolled course IDs
    const enrollments = await pool.query(
      'SELECT course_id FROM enrollments WHERE user_id = $1 AND is_active = true',
      [user.id]
    )

    const token = signToken(user.id, user.role)

    res.json({
      success: true,
      message: 'Login successful!',
      token,
      user: {
        id:          user.id,
        name:        user.name,
        email:       user.email,
        phone:       user.phone,
        role:        user.role,
        enrollments: enrollments.rows.map(r => r.course_id),
      },
    })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ success: false, message: 'Server error. Please try again.' })
  }
}

// ── GET /api/auth/me ───────────────────────────────────────────────
exports.getMe = async (req, res) => {
  try {
    const enrollments = await pool.query(
      `SELECT e.course_id, c.title, c.exam_type, e.enrolled_at, e.expires_at
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       WHERE e.user_id = $1 AND e.is_active = true`,
      [req.user.id]
    )

    res.json({
      success: true,
      user: {
        ...req.user,
        enrollments: enrollments.rows,
      },
    })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' })
  }
}

// ── PUT /api/auth/change-password ─────────────────────────────────
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both passwords are required.' })
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' })
    }

    const result = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id])
    const match  = await bcrypt.compare(currentPassword, result.rows[0].password)
    if (!match) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' })
    }

    const hashed = await bcrypt.hash(newPassword, 12)
    await pool.query('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [hashed, req.user.id])

    res.json({ success: true, message: 'Password changed successfully.' })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' })
  }
}
