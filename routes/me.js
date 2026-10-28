import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

router.post('/patients', requireAuth, async (req, res) => {
  const code = (req.body?.join_code || '').trim().toUpperCase();
  const patient = await pool.query('SELECT id FROM patients WHERE join_code = $1', [code]);
  if (patient.rows.length === 0) {
    return res.status(400).json({ message: 'קוד ההצטרפות לא נמצא' });
  }
  await pool.query(
    `INSERT INTO user_patients (user_id, patient_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [req.user.id, patient.rows[0].id]
  );
  const patients = await pool.query(
    `SELECT p.id, p.full_name FROM patients p
       JOIN user_patients up ON up.patient_id = p.id
      WHERE up.user_id = $1
      ORDER BY p.full_name`,
    [req.user.id]
  );
  res.json(patients.rows);
});

// Every user edits only their own profile: the id comes from the token, never from the request.
router.put('/', requireAuth, async (req, res) => {
  const { full_name, email, phone } = req.body ?? {};
  if (!full_name?.trim() || !email?.trim() || !phone?.trim()) {
    return res.status(400).json({ message: 'חסרים פרטים בטופס' });
  }

  const taken = await pool.query('SELECT id FROM users WHERE email = $1 AND id <> $2', [
    email.trim().toLowerCase(),
    req.user.id,
  ]);
  if (taken.rows.length > 0) {
    return res.status(409).json({ message: 'המייל הזה כבר רשום' });
  }

  const result = await pool.query(
    `UPDATE users SET full_name = $1, email = $2, phone = $3 WHERE id = $4
     RETURNING id, full_name, email, phone, role, monthly_quota, points`,
    [full_name.trim(), email.trim().toLowerCase(), phone.trim(), req.user.id]
  );
  res.json(result.rows[0]);
});

export default router;