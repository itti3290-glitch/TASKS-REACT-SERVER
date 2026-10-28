import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { createToken, requireAuth } from '../auth.js';

const router = Router();

const USER_FIELDS = 'id, full_name, email, phone, role, monthly_quota, points';

router.post('/register', async (req, res) => {
  const { full_name, email, phone, password, monthly_quota = 4 } = req.body ?? {};

  if (!full_name || !email || !phone || !password) {
    return res.status(400).json({ message: 'חסרים פרטים בטופס' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'הסיסמה צריכה להיות לפחות 6 תווים' });
  }
  const quota = Number(monthly_quota);
  if (!Number.isInteger(quota) || quota < 0 || quota > 20) {
    return res.status(400).json({ message: 'המכסה צריכה להיות בין 0 ל-20' });
  }

  const taken = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (taken.rows.length > 0) {
    return res.status(409).json({ message: 'המייל הזה כבר רשום' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `INSERT INTO users (full_name, email, phone, password_hash, monthly_quota)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${USER_FIELDS}`,
    [full_name, email.toLowerCase(), phone, passwordHash, quota]
  );
  const user = result.rows[0];

  // A new volunteer starts with no patients. The admin adds them to patient teams.
  res.status(201).json({ token: createToken(user), user });
});

router.post('/login', async (req, res) => {
  const { email = '', password = '' } = req.body ?? {};
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const found = result.rows[0];

  if (!found || !(await bcrypt.compare(password, found.password_hash))) {
    return res.status(401).json({ message: 'אימייל או סיסמה שגויים' });
  }

  const { password_hash, ...user } = found;
  res.json({ token: createToken(user), user });
});

router.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT ${USER_FIELDS},
       (SELECT COUNT(*)::int FROM task_signups s
          JOIN tasks t ON t.id = s.task_id
         WHERE s.user_id = users.id
           AND date_trunc('month', t.starts_at) = date_trunc('month', now())) AS this_month_count
       FROM users WHERE id = $1`,
    [req.user.id]
  );
  const patients = await pool.query(
    `SELECT p.id, p.full_name FROM patients p
       JOIN user_patients up ON up.patient_id = p.id
      WHERE up.user_id = $1
      ORDER BY p.full_name`,
    [req.user.id]
  );
  res.json({ ...result.rows[0], patients: patients.rows });
});

export default router;