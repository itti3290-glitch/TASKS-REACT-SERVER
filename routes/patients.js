import { Router } from 'express';
import crypto from 'node:crypto';
import pool from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  if (req.user.role === 'admin') {
    const result = await pool.query(
      `SELECT p.*, 'P-' || (1000 + p.id) AS patient_code,
              COALESCE(
                (SELECT json_agg(json_build_object('id', u.id, 'full_name', u.full_name) ORDER BY u.full_name)
                   FROM user_patients up JOIN users u ON u.id = up.user_id
                  WHERE up.patient_id = p.id), '[]') AS volunteers
         FROM patients p
        ORDER BY p.full_name`
    );
    return res.json(result.rows);
  }
  const result = await pool.query(
    `SELECT p.id, p.full_name, p.address, p.contact_phone, p.notes, 'P-' || (1000 + p.id) AS patient_code
       FROM patients p
       JOIN user_patients up ON up.patient_id = p.id
      WHERE up.user_id = $1
      ORDER BY p.full_name`,
    [req.user.id]
  );
  res.json(result.rows);
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { full_name, address, contact_phone, notes } = req.body ?? {};
  if (!full_name || !address || !contact_phone) {
    return res.status(400).json({ message: 'חסרים פרטים בטופס' });
  }
  const joinCode = crypto.randomBytes(3).toString('hex').toUpperCase();
  const result = await pool.query(
    `INSERT INTO patients (full_name, address, contact_phone, notes, join_code)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [full_name, address, contact_phone, notes || null, joinCode]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { full_name, address, contact_phone, notes } = req.body ?? {};
  const result = await pool.query(
    `UPDATE patients
        SET full_name = $1, address = $2, contact_phone = $3, notes = $4
      WHERE id = $5 RETURNING *`,
    [full_name, address, contact_phone, notes || null, req.params.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ message: 'המטופל לא נמצא' });
  }
  res.json(result.rows[0]);
});

// Deleting a patient also deletes their tasks, signups, replacement requests and team
// (the database does this itself through ON DELETE CASCADE).
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const result = await pool.query('DELETE FROM patients WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'המטופל לא נמצא' });
  }
  res.json({ message: 'המטופל נמחק' });
});

// The admin adds a volunteer to a patient's team, or removes them.
router.post('/:id/volunteers', requireAuth, requireAdmin, async (req, res) => {
  const userId = Number(req.body?.user_id);
  const volunteer = await pool.query("SELECT id FROM users WHERE id = $1 AND role = 'volunteer'", [userId]);
  if (volunteer.rows.length === 0) {
    return res.status(400).json({ message: 'המתנדב לא נמצא' });
  }
  const patient = await pool.query('SELECT id FROM patients WHERE id = $1', [req.params.id]);
  if (patient.rows.length === 0) {
    return res.status(404).json({ message: 'המטופל לא נמצא' });
  }
  await pool.query(
    'INSERT INTO user_patients (user_id, patient_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, req.params.id]
  );
  res.status(201).json({ message: 'המתנדב נוסף לצוות' });
});

router.delete('/:id/volunteers/:userId', requireAuth, requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM user_patients WHERE patient_id = $1 AND user_id = $2', [
    req.params.id,
    req.params.userId,
  ]);
  res.json({ message: 'המתנדב הוסר מהצוות' });
});

export default router;