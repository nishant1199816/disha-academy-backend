const pool = require('../db/pool')

// ── SEED COURSES (TEMP ROUTE FOR TESTING) ─────────────────────────────
exports.seedCourses = async (req, res) => {
  try {
    await pool.query(`
      INSERT INTO courses (id, title, price, is_active)
      VALUES 
      (gen_random_uuid(), 'SSC CGL Batch', 4999, true),
      (gen_random_uuid(), 'SSC CHSL Batch', 3999, true)
    `)

    res.send("Courses Added Successfully")
  } catch (err) {
    console.error("Seed Error:", err)
    res.status(500).send("Error inserting courses")
  }
}

// ── GET /api/courses ───────────────────────────────────────────────
exports.getAllCourses = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*,
             COUNT(DISTINCT e.user_id) AS enrolled_count
      FROM   courses c
      LEFT JOIN enrollments e 
        ON e.course_id = c.id 
       AND e.is_active = true
      WHERE  c.is_active = true
      GROUP BY c.id
      ORDER BY c.created_at ASC
    `)

    res.json({
      success: true,
      courses: result.rows
    })

  } catch (err) {
    console.error("Get Courses Error:", err)
    res.status(500).json({
      success: false,
      message: 'Server error.'
    })
  }
}

// ── GET /api/courses/:id ───────────────────────────────────────────
exports.getCourse = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM courses 
       WHERE id = $1 AND is_active = true`,
      [req.params.id]
    )

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: 'Course not found.'
      })
    }

    res.json({
      success: true,
      course: result.rows[0]
    })

  } catch (err) {
    console.error("Get Course Error:", err)
    res.status(500).json({
      success: false,
      message: 'Server error.'
    })
  }
}

// ── GET /api/courses/:courseId/live-classes ────────────────────────
exports.getLiveClasses = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM live_classes
      WHERE course_id = $1
      ORDER BY scheduled_at ASC
    `, [req.params.courseId])

    res.json({
      success: true,
      classes: result.rows
    })

  } catch (err) {
    console.error("Live Classes Error:", err)
    res.status(500).json({
      success: false,
      message: 'Server error.'
    })
  }
}

// ── GET /api/courses/:courseId/materials ──────────────────────────
exports.getMaterials = async (req, res) => {
  try {
    const { subject, type } = req.query

    let query = `
      SELECT * FROM materials 
      WHERE course_id = $1 
      AND is_active = true
    `

    const params = [req.params.courseId]

    if (subject) {
      query += ` AND subject = $${params.length + 1}`
      params.push(subject)
    }

    if (type) {
      query += ` AND type = $${params.length + 1}`
      params.push(type)
    }

    query += ` ORDER BY created_at DESC`

    const result = await pool.query(query, params)

    res.json({
      success: true,
      materials: result.rows
    })

  } catch (err) {
    console.error("Materials Error:", err)
    res.status(500).json({
      success: false,
      message: 'Server error.'
    })
  }
}

// ── GET /api/dashboard ────────────────────────────────────────────
exports.getStudentDashboard = async (req, res) => {
  try {
    const userId = req.user.id

    const courses = await pool.query(`
      SELECT c.id, c.title, c.exam_type, c.lectures,
             e.enrolled_at, e.expires_at,
             COUNT(DISTINCT a.id) AS attended
      FROM enrollments e
      JOIN courses c ON c.id = e.course_id
      LEFT JOIN live_classes lc ON lc.course_id = c.id
      LEFT JOIN attendance a 
        ON a.live_class_id = lc.id 
       AND a.user_id = $1
      WHERE e.user_id = $1 
        AND e.is_active = true
      GROUP BY c.id, e.enrolled_at, e.expires_at
    `, [userId])

    const upcoming = await pool.query(`
      SELECT lc.id, lc.title, lc.subject, lc.teacher_name,
             lc.scheduled_at, lc.status, lc.stream_url,
             c.title AS course_title
      FROM live_classes lc
      JOIN courses c ON c.id = lc.course_id
      JOIN enrollments e 
        ON e.course_id = c.id 
       AND e.user_id = $1 
       AND e.is_active = true
      WHERE lc.status IN ('scheduled','live')
      ORDER BY lc.scheduled_at ASC
      LIMIT 5
    `, [userId])

    const stats = await pool.query(`
      SELECT
        COUNT(DISTINCT e.course_id)  AS courses_enrolled,
        COUNT(DISTINCT a.id)         AS classes_attended,
        COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'open') AS open_doubts
      FROM enrollments e
      LEFT JOIN live_classes lc ON lc.course_id = e.course_id
      LEFT JOIN attendance a 
        ON a.live_class_id = lc.id 
       AND a.user_id = $1
      LEFT JOIN doubts d ON d.user_id = $1
      WHERE e.user_id = $1 
        AND e.is_active = true
    `, [userId])

    res.json({
      success: true,
      courses: courses.rows,
      upcoming_classes: upcoming.rows,
      stats: stats.rows[0]
    })

  } catch (err) {
    console.error("Dashboard Error:", err)
    res.status(500).json({
      success: false,
      message: 'Server error.'
    })
  }
}

// ── ADMIN DASHBOARD ───────────────────────────────────────────────
exports.getAdminDashboard = async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'student') AS total_students,
        (SELECT COUNT(*) FROM enrollments WHERE is_active = true) AS total_enrollments,
        (SELECT COALESCE(SUM(amount),0) FROM payments WHERE status = 'captured') AS total_revenue,
        (SELECT COUNT(*) FROM payments WHERE status = 'captured'
           AND created_at >= date_trunc('month', NOW())) AS monthly_payments,
        (SELECT COALESCE(SUM(amount),0) FROM payments WHERE status = 'captured'
           AND created_at >= date_trunc('month', NOW())) AS monthly_revenue
    `)

    const recentStudents = await pool.query(`
      SELECT u.id, u.name, u.email, u.phone, u.created_at,
             COUNT(e.id) AS courses_enrolled
      FROM users u
      LEFT JOIN enrollments e 
        ON e.user_id = u.id 
       AND e.is_active = true
      WHERE u.role = 'student'
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT 10
    `)

    const recentPayments = await pool.query(`
      SELECT p.id, p.amount, p.status, p.payment_method, p.created_at,
             u.name AS student_name, u.email,
             c.title AS course_title, c.exam_type
      FROM payments p
      JOIN users u ON u.id = p.user_id
      JOIN courses c ON c.id = p.course_id
      ORDER BY p.created_at DESC
      LIMIT 10
    `)

    res.json({
      success: true,
      stats: stats.rows[0],
      recent_students: recentStudents.rows,
      recent_payments: recentPayments.rows
    })

  } catch (err) {
    console.error("Admin Dashboard Error:", err)
    res.status(500).json({
      success: false,
      message: 'Server error.'
    })
  }
}