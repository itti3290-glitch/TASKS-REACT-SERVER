import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { clashMessage, findClash } from '../schedule.js';

const router = Router();

const CATEGORIES = ['doctor', 'care', 'visit', 'shopping', 'other'];

export const TASK_SELECT = `
  SELECT t.*, 'M-' || (1000 + t.id) AS code, p.full_name AS patient_name,
         'P-' || (1000 + p.id) AS patient_code,
         COUNT(s.user_id)::int AS signed_up_count,
         COALESCE(BOOL_OR(s.user_id = $1), false) AS is_mine,
         EXISTS (SELECT 1 FROM replacement_requests rr
                  WHERE rr.task_id = t.id AND rr.requester_id = $1 AND rr.status = 'open') AS replacement_requested,
         COALESCE(array_agg(u.full_name ORDER BY s.created_at) FILTER (WHERE u.id IS NOT NULL), '{}') AS volunteer_names
    FROM tasks t
    JOIN patients p ON p.id = t.patient_id
    LEFT JOIN task_signups s ON s.task_id = t.id
    LEFT JOIN users u ON u.id = s.user_id`;

function visibleTo(user) {
  return user.role === 'admin'
    ? 'TRUE'
    : 't.patient_id IN (SELECT patient_id FROM user_patients WHERE user_id = $1)';
}

function validateTask(body, isNew) {
  const { title, category, starts_at, volunteers_needed, description, patient_id } = body ?? {};
  if (!title || title.length > 40) return 'כותרת היא חובה, עד 40 תווים';
  if (!CATEGORIES.includes(category)) return 'סוג המשימה לא תקין';
  const start = new Date(starts_at);
  if (Number.isNaN(start.getTime())) return 'תאריך ושעה לא תקינים';
  if (isNew && start < new Date()) return 'אי אפשר להוסיף משימה בתאריך שעבר';
  const needed = Number(volunteers_needed);
  if (!Number.isInteger(needed) || needed < 1 || needed > 5) {
    return 'מספר המתנדבים צריך להיות בין 1 ל-5';
  }
  if (!description) return 'תיאור הוא חובה';
  if (!patient_id) return 'צריך לבחור מטופל';
  return null;
}

function taskValues(body) {
  const { title, category, starts_at, duration_minutes, volunteers_needed, location, description, patient_id } = body;
  return [title, category, starts_at, duration_minutes || null, Number(volunteers_needed), location || null, description, patient_id];
}

router.get('/', requireAuth, async (req, res) => {
  const { upcoming, past, mine, patient, month } = req.query;
  const params = [req.user.id];
  const conditions = [visibleTo(req.user)];

  if (upcoming === 'true') conditions.push('t.starts_at >= now()');
  if (past === 'true') conditions.push('t.starts_at < now()');
  if (mine === 'true') {
    conditions.push('EXISTS (SELECT 1 FROM task_signups x WHERE x.task_id = t.id AND x.user_id = $1)');
  }
  if (patient) {
    params.push(patient);
    conditions.push(`t.patient_id = $${params.length}`);
  }
  if (month) {
    params.push(`${month}-01`);
    const n = params.length;
    conditions.push(`t.starts_at >= $${n}::date AND t.starts_at < $${n}::date + interval '1 month'`);
  }

  const result = await pool.query(
    `${TASK_SELECT}
      WHERE ${conditions.join(' AND ')}
      GROUP BY t.id, p.id
      ORDER BY t.starts_at`,
    params
  );
  res.json(result.rows);
});

router.get('/:id', requireAuth, async (req, res) => {
  const result = await pool.query(
    `${TASK_SELECT}
      WHERE t.id = $2 AND ${visibleTo(req.user)}
      GROUP BY t.id, p.id`,
    [req.user.id, req.params.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ message: 'המשימה לא נמצאה' });
  }
  const volunteers = await pool.query(
    `SELECT u.id, u.full_name FROM task_signups s
       JOIN users u ON u.id = s.user_id
      WHERE s.task_id = $1
      ORDER BY s.created_at`,
    [req.params.id]
  );
  res.json({ ...result.rows[0], volunteers: volunteers.rows });
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const error = validateTask(req.body, true);
  if (error) return res.status(400).json({ message: error });

  const result = await pool.query(
    `INSERT INTO tasks (title, category, starts_at, duration_minutes, volunteers_needed, location, description, patient_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *, 'M-' || (1000 + id) AS code`,
    taskValues(req.body)
  );
  res.status(201).json(result.rows[0]);
});

router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const error = validateTask(req.body, false);
  if (error) return res.status(400).json({ message: error });

  const result = await pool.query(
    `UPDATE tasks
        SET title = $1, category = $2, starts_at = $3, duration_minutes = $4,
            volunteers_needed = $5, location = $6, description = $7, patient_id = $8
      WHERE id = $9
      RETURNING *, 'M-' || (1000 + id) AS code`,
    [...taskValues(req.body), req.params.id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ message: 'המשימה לא נמצאה' });
  }
  res.json(result.rows[0]);
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const result = await pool.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  if (result.rowCount === 0) {
    return res.status(404).json({ message: 'המשימה לא נמצאה' });
  }
  res.json({ message: 'המשימה נמחקה' });
});

router.post('/:id/signup', requireAuth, async (req, res) => {
  const result = await pool.query(
    `${TASK_SELECT}
      WHERE t.id = $2 AND ${visibleTo(req.user)}
      GROUP BY t.id, p.id`,
    [req.user.id, req.params.id]
  );
  const task = result.rows[0];

  if (!task) return res.status(404).json({ message: 'המשימה לא נמצאה' });
  if (new Date(task.starts_at) < new Date()) {
    return res.status(400).json({ message: 'המשימה כבר התחילה' });
  }
  if (task.is_mine) return res.status(400).json({ message: 'כבר נרשמת למשימה הזו' });
  if (task.signed_up_count >= task.volunteers_needed) {
    return res.status(400).json({ message: 'המשימה כבר מלאה' });
  }

  const clash = await findClash(pool, req.user.id, task.starts_at, task.duration_minutes);
  if (clash) return res.status(400).json({ message: clashMessage(clash) });

  await pool.query('INSERT INTO task_signups (task_id, user_id) VALUES ($1, $2)', [task.id, req.user.id]);
  res.status(201).json({ message: 'נרשמת למשימה!' });
});

router.post('/:id/replacement-request', requireAuth, async (req, res) => {
  const result = await pool.query(
    `${TASK_SELECT}
      WHERE t.id = $2 AND ${visibleTo(req.user)}
      GROUP BY t.id, p.id`,
    [req.user.id, req.params.id]
  );
  const task = result.rows[0];

  if (!task) return res.status(404).json({ message: 'המשימה לא נמצאה' });
  if (!task.is_mine) return res.status(400).json({ message: 'לא נרשמת למשימה הזו' });
  if (new Date(task.starts_at) < new Date()) {
    return res.status(400).json({ message: 'המשימה כבר התחילה' });
  }
  if (task.replacement_requested) {
    return res.status(400).json({ message: 'כבר שלחת בקשת החלפה למשימה הזו' });
  }

  await pool.query('INSERT INTO replacement_requests (task_id, requester_id) VALUES ($1, $2)', [
    task.id,
    req.user.id,
  ]);
  res.status(201).json({ message: 'הבקשה נשלחה לצוות' });
});

export default router;