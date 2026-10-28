import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const params = [];
  let patientFilter = '';
  if (req.query.patient) {
    params.push(req.query.patient);
    patientFilter = 'AND u.id IN (SELECT user_id FROM user_patients WHERE patient_id = $1)';
  }
  const result = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.monthly_quota, u.points,
            (SELECT COUNT(*)::int FROM task_signups s
               JOIN tasks t ON t.id = s.task_id
              WHERE s.user_id = u.id
                AND date_trunc('month', t.starts_at) = date_trunc('month', now())) AS this_month_count,
            COALESCE(
              (SELECT json_agg(json_build_object('id', p.id, 'full_name', p.full_name) ORDER BY p.full_name)
                 FROM patients p JOIN user_patients up ON up.patient_id = p.id
                WHERE up.user_id = u.id), '[]') AS patients
       FROM users u
      WHERE u.role = 'volunteer' ${patientFilter}
      ORDER BY u.full_name`,
    params
  );
  res.json(result.rows);
});

// The admin creates a volunteer account (the volunteer can then log in with this email and password).
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { full_name, email, phone, password } = req.body ?? {};
  if (!full_name || !email || !phone || !password) {
    return res.status(400).json({ message: 'חסרים פרטים בטופס' });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: 'הסיסמה צריכה להיות לפחות 6 תווים' });
  }
  const taken = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (taken.rows.length > 0) {
    return res.status(409).json({ message: 'המייל הזה כבר רשום' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    `INSERT INTO users (full_name, email, phone, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, full_name, email, phone, role, monthly_quota, points`,
    [full_name, email.toLowerCase(), phone, passwordHash]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const quota = Number(req.body?.monthly_quota);
  if (!Number.isInteger(quota) || quota < 0 || quota > 20) {
    return res.status(400).json({ message: 'המכסה צריכה להיות בין 0 ל-20' });
  }
  const result = await pool.query(
    `UPDATE users SET monthly_quota = $1 WHERE id = $2
     RETURNING id, full_name, email, phone, role, monthly_quota, points`,
    [quota, req.params.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ message: 'המתנדב לא נמצא' });
  }
  res.json(result.rows[0]);
});

// Only volunteers can be deleted here, so an admin account can never be removed by mistake.
// Their signups and team memberships are deleted with them (ON DELETE CASCADE).
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const result = await pool.query("DELETE FROM users WHERE id = $1 AND role = 'volunteer'", [req.params.id]);
  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'המתנדב לא נמצא' });
  }
  res.json({ message: 'המתנדב נמחק' });
});

export default router;