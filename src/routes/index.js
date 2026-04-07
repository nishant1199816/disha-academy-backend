const express  = require('express')
const router   = express.Router()
const { protect, adminOnly, requireEnrollment } = require('../middleware/auth')

const authCtrl    = require('../controllers/authController')
const courseCtrl  = require('../controllers/courseController')
const paymentCtrl = require('../controllers/paymentController')

// ══════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════
router.post('/auth/register',         authCtrl.register)
router.post('/auth/login',            authCtrl.login)
router.get ('/auth/me',               protect, authCtrl.getMe)
router.put ('/auth/change-password',  protect, authCtrl.changePassword)

// ══════════════════════════════════════════
//  COURSES (public)
// ══════════════════════════════════════════
router.get('/courses',      courseCtrl.getAllCourses)
router.get('/courses/:id',  courseCtrl.getCourse)

// ══════════════════════════════════════════
//  COURSE CONTENT (enrolled students only)
// ══════════════════════════════════════════
router.get('/courses/:courseId/live-classes',
  protect, requireEnrollment, courseCtrl.getLiveClasses)

router.get('/courses/:courseId/materials',
  protect, requireEnrollment, courseCtrl.getMaterials)

// ══════════════════════════════════════════
//  STUDENT DASHBOARD
// ══════════════════════════════════════════
router.get('/dashboard', protect, courseCtrl.getStudentDashboard)

// ══════════════════════════════════════════
//  PAYMENTS
// ══════════════════════════════════════════
router.post('/payments/create-order', protect, paymentCtrl.createOrder)
router.post('/payments/verify',       protect, paymentCtrl.verifyPayment)
router.get ('/payments/my-history',   protect, paymentCtrl.getMyHistory)

// Razorpay webhook — NO auth middleware, raw body needed
router.post('/payments/webhook', paymentCtrl.webhook)

// ══════════════════════════════════════════
//  ADMIN ROUTES
// ══════════════════════════════════════════
router.get('/admin/dashboard',  protect, adminOnly, courseCtrl.getAdminDashboard)
router.get('/admin/payments',   protect, adminOnly, paymentCtrl.getAllPayments)

module.exports = router
