require('dotenv').config()
const pool = require('./pool')

async function if (require.main === module) { migrate() }
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    console.log('🚀 Running migrations...')

    // ── Users ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        VARCHAR(100) NOT NULL,
        email       VARCHAR(150) UNIQUE NOT NULL,
        phone       VARCHAR(15),
        password    VARCHAR(255) NOT NULL,
        role        VARCHAR(20) DEFAULT 'student' CHECK (role IN ('student','admin','teacher')),
        is_active   BOOLEAN DEFAULT true,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `)
    console.log('  ✓ users table')

    // ── Courses ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS courses (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title       VARCHAR(200) NOT NULL,
        slug        VARCHAR(200) UNIQUE NOT NULL,
        exam_type   VARCHAR(50) NOT NULL,
        description TEXT,
        price       INTEGER NOT NULL,
        duration    VARCHAR(50),
        lectures    INTEGER DEFAULT 0,
        is_active   BOOLEAN DEFAULT true,
        thumbnail   VARCHAR(500),
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `)
    console.log('  ✓ courses table')

    // ── Enrollments ────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS enrollments (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        course_id     UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        enrolled_at   TIMESTAMPTZ DEFAULT NOW(),
        expires_at    TIMESTAMPTZ,
        is_active     BOOLEAN DEFAULT true,
        UNIQUE(user_id, course_id)
      );
    `)
    console.log('  ✓ enrollments table')

    // ── Payments ───────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        course_id             UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        razorpay_order_id     VARCHAR(100) UNIQUE NOT NULL,
        razorpay_payment_id   VARCHAR(100),
        razorpay_signature    VARCHAR(500),
        amount                INTEGER NOT NULL,
        currency              VARCHAR(10) DEFAULT 'INR',
        status                VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','captured','failed','refunded')),
        payment_method        VARCHAR(50),
        created_at            TIMESTAMPTZ DEFAULT NOW(),
        verified_at           TIMESTAMPTZ
      );
    `)
    console.log('  ✓ payments table')

    // ── Live Classes ───────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS live_classes (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        course_id     UUID REFERENCES courses(id) ON DELETE CASCADE,
        title         VARCHAR(200) NOT NULL,
        subject       VARCHAR(50),
        teacher_name  VARCHAR(100),
        scheduled_at  TIMESTAMPTZ NOT NULL,
        duration_min  INTEGER DEFAULT 90,
        stream_url    VARCHAR(500),
        recording_url VARCHAR(500),
        status        VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','ended','cancelled')),
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `)
    console.log('  ✓ live_classes table')

    // ── Study Material ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS materials (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        course_id   UUID REFERENCES courses(id) ON DELETE CASCADE,
        title       VARCHAR(200) NOT NULL,
        subject     VARCHAR(50),
        type        VARCHAR(30) CHECK (type IN ('pdf','notes','pyq','dpp','video')),
        file_url    VARCHAR(500),
        chapter     VARCHAR(100),
        is_active   BOOLEAN DEFAULT true,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `)
    console.log('  ✓ materials table')

    // ── Attendance ─────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
        live_class_id UUID REFERENCES live_classes(id) ON DELETE CASCADE,
        joined_at     TIMESTAMPTZ DEFAULT NOW(),
        duration_min  INTEGER DEFAULT 0,
        UNIQUE(user_id, live_class_id)
      );
    `)
    console.log('  ✓ attendance table')

    // ── Doubts ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS doubts (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
        course_id   UUID REFERENCES courses(id) ON DELETE CASCADE,
        subject     VARCHAR(50),
        question    TEXT NOT NULL,
        image_url   VARCHAR(500),
        answer      TEXT,
        status      VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        answered_at TIMESTAMPTZ
      );
    `)
    console.log('  ✓ doubts table')

    // ── Indexes ────────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_enrollments_user    ON enrollments(user_id);
      CREATE INDEX IF NOT EXISTS idx_enrollments_course  ON enrollments(course_id);
      CREATE INDEX IF NOT EXISTS idx_payments_user       ON payments(user_id);
      CREATE INDEX IF NOT EXISTS idx_payments_order      ON payments(razorpay_order_id);
      CREATE INDEX IF NOT EXISTS idx_live_classes_course ON live_classes(course_id);
      CREATE INDEX IF NOT EXISTS idx_materials_course    ON materials(course_id);
      CREATE INDEX IF NOT EXISTS idx_doubts_user         ON doubts(user_id);
    `)
    console.log('  ✓ indexes created')

    await client.query('COMMIT')
    console.log('\n✅ All migrations completed successfully!\n')

  } catch (err) {
    await client.query('ROLLBACK')
    console.error('❌ Migration failed:', err.message)

    // ❗ process.exit hata diya → server crash nahi hoga
    throw err

  } finally {
    client.release()
    // ❗ pool.end() hata diya → connection alive rahega
  }
}

module.exports = migrate