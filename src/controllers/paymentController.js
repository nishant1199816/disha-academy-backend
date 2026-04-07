const crypto = require('crypto')
const pool   = require('../db/pool')

// ── Lazy Razorpay init (only when keys exist) ─────────────────────
const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error('Razorpay keys not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Railway environment variables.')
  }
  const Razorpay = require('razorpay')
  return new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  })
}

// ── POST /api/payments/create-order ───────────────────────────────
exports.createOrder = async (req, res) => {
  try {
    const { courseId } = req.body
    if (!courseId) return res.status(400).json({ success: false, message: 'Course ID required.' })

    const courseRes = await pool.query(
      'SELECT id, title, price FROM courses WHERE id = $1 AND is_active = true',
      [courseId]
    )
    if (!courseRes.rows.length) {
      return res.status(404).json({ success: false, message: 'Course not found.' })
    }
    const course = courseRes.rows[0]

    const enrolled = await pool.query(
      'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND is_active = true',
      [req.user.id, courseId]
    )
    if (enrolled.rows.length) {
      return res.status(400).json({ success: false, message: 'You are already enrolled in this course.' })
    }

    const baseAmount  = course.price
    const gst         = Math.round(baseAmount * 0.18)
    const total       = baseAmount + gst
    const amountPaise = total * 100

    const razorpay = getRazorpay()
    const order = await razorpay.orders.create({
      amount:   amountPaise,
      currency: 'INR',
      notes: {
        courseId:   course.id,
        courseName: course.title,
        userId:     req.user.id,
        userEmail:  req.user.email,
      },
    })

    await pool.query(`
      INSERT INTO payments (user_id, course_id, razorpay_order_id, amount, currency, status)
      VALUES ($1, $2, $3, $4, 'INR', 'pending')
    `, [req.user.id, courseId, order.id, total])

    res.json({
      success: true,
      order:   { id: order.id, amount: order.amount, currency: order.currency },
      course:  { id: course.id, title: course.title, baseAmount, gst, totalAmount: total },
      key:     process.env.RAZORPAY_KEY_ID,
      user:    { name: req.user.name, email: req.user.email, phone: req.user.phone || '' },
    })
  } catch (err) {
    console.error('Create order error:', err.message)
    res.status(500).json({ success: false, message: err.message })
  }
}

// ── POST /api/payments/verify ─────────────────────────────────────
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing payment details.' })
    }

    // Verify signature
    const body     = razorpay_order_id + '|' + razorpay_payment_id
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex')

    if (expected !== razorpay_signature) {
      await pool.query(`UPDATE payments SET status='failed' WHERE razorpay_order_id=$1`, [razorpay_order_id])
      return res.status(400).json({ success: false, message: 'Payment verification failed.' })
    }

    // Get payment method from Razorpay
    let paymentMethod = 'upi'
    try {
      const razorpay = getRazorpay()
      const pd = await razorpay.payments.fetch(razorpay_payment_id)
      paymentMethod = pd.method || 'upi'
    } catch {}

    const payResult = await pool.query(`
      UPDATE payments
      SET razorpay_payment_id=$1, razorpay_signature=$2,
          status='captured', payment_method=$3, verified_at=NOW()
      WHERE razorpay_order_id=$4
      RETURNING user_id, course_id
    `, [razorpay_payment_id, razorpay_signature, paymentMethod, razorpay_order_id])

    if (!payResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' })
    }

    const { user_id, course_id } = payResult.rows[0]

    // Calculate expiry
    const courseRes = await pool.query('SELECT duration FROM courses WHERE id=$1', [course_id])
    const months    = parseInt(courseRes.rows[0]?.duration) || 6
    const expiresAt = new Date()
    expiresAt.setMonth(expiresAt.getMonth() + months)

    // Unlock course access
    await pool.query(`
      INSERT INTO enrollments (user_id, course_id, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, course_id)
      DO UPDATE SET is_active=true, expires_at=$3, enrolled_at=NOW()
    `, [user_id, course_id, expiresAt])

    const enrollments = await pool.query(
      'SELECT course_id FROM enrollments WHERE user_id=$1 AND is_active=true',
      [user_id]
    )

    res.json({
      success:     true,
      message:     'Payment verified! Course access unlocked. 🎉',
      paymentId:   razorpay_payment_id,
      enrollments: enrollments.rows.map(r => r.course_id),
    })
  } catch (err) {
    console.error('Verify error:', err.message)
    res.status(500).json({ success: false, message: 'Payment verification error.' })
  }
}

// ── POST /api/payments/webhook ────────────────────────────────────
exports.webhook = async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature']
    const body      = req.rawBody || Buffer.from(JSON.stringify(req.body))

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || '')
      .update(body)
      .digest('hex')

    if (process.env.RAZORPAY_WEBHOOK_SECRET && expected !== signature) {
      return res.status(400).json({ success: false })
    }

    const { event, payload } = req.body

    if (event === 'payment.captured') {
      const payment = payload.payment.entity
      await pool.query(`
        UPDATE payments SET status='captured', payment_method=$1, verified_at=NOW()
        WHERE razorpay_order_id=$2 AND status='pending'
      `, [payment.method, payment.order_id])
    }

    if (event === 'payment.failed') {
      const payment = payload.payment.entity
      await pool.query(`UPDATE payments SET status='failed' WHERE razorpay_order_id=$1`, [payment.order_id])
    }

    res.json({ success: true })
  } catch (err) {
    console.error('Webhook error:', err.message)
    res.status(500).json({ success: false })
  }
}

// ── GET /api/payments/my-history ──────────────────────────────────
exports.getMyHistory = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.razorpay_payment_id, p.amount, p.status,
             p.payment_method, p.created_at,
             c.title AS course_title, c.exam_type
      FROM payments p
      JOIN courses c ON c.id = p.course_id
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC
    `, [req.user.id])
    res.json({ success: true, payments: result.rows })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' })
  }
}

// ── GET /api/admin/payments ───────────────────────────────────────
exports.getAllPayments = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query
    const offset = (page - 1) * limit
    const params = []
    let where = ''
    if (status) { where = `WHERE p.status = $1`; params.push(status) }

    const result = await pool.query(`
      SELECT p.*, u.name AS student_name, u.email AS student_email,
             c.title AS course_title
      FROM payments p
      JOIN users u ON u.id = p.user_id
      JOIN courses c ON c.id = p.course_id
      ${where}
      ORDER BY p.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset])

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM payments p ${where}`,
      params
    )

    res.json({
      success:  true,
      payments: result.rows,
      total:    parseInt(countRes.rows[0].count),
    })
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' })
  }
}
