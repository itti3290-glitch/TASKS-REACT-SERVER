import { Router } from 'express';
import pool from '../db.js';
import { requireAuth } from '../auth.js';
import { clashMessage, findClash, DEFAULT_DURATION, MIN_GAP_MINUTES } from '../schedule.js';
import { TASK_SELECT } from './tasks.js';

const router = Router();

// Open replacement requests that this user can take: the task belongs to one of
// the user's patients, has not started, the user is not signed up to it, and it
// does not clash with the user's other tasks.
router.get('/', requireAuth, async (req, res) => {
  const requests = await pool.query(
    `SELECT r.id AS request_id, r.task_id, u.full_name AS requester_name
       FROM replacement_requests r
       JOIN tasks t ON t.id = r.task_id
       JOIN users u ON u.id = r.requester_id
      WHERE r.status = 'open'
        AND r.requester_id <> $1
        AND t.starts_at > now()
        AND t.patient_id IN (SELECT patient_id FROM user_patients WHERE user_id = $1)
        AND NOT EXISTS (SELECT 1 FROM task_signups x WHERE x.task_id = t.id AND x.user_id = $1)
        AND NOT EXISTS (
          SELECT 1 FROM task_signups ms
            JOIN tasks mt ON mt.id = ms.task_id
           WHERE ms.user_id = $1
             AND mt.starts_at < t.starts_at + make_interval(mins => COALESCE(t.duration_minutes, ${DEFAULT_DURATION}) + ${MIN_GAP_MINUTES})
             AND t.starts_at < mt.starts_at + make_interval(mins => COALESCE(mt.duration_minutes, ${DEFAULT_DURATION}) + ${MIN_GAP_MINUTES})
        )
      ORDER BY t.starts_at`,
    [req.user.id]
  );
  if (requests.rows.length === 0) return res.json([]);

  const tasks = await pool.query(
    `${TASK_SELECT}
      WHERE t.id = ANY($2)
      GROUP BY t.id, p.id`,
    [req.user.id, requests.rows.map((r) => r.task_id)]
  );

  res.json(
    requests.rows.map((r) => ({
      request_id: r.request_id,
      requester_name: r.requester_name,
      task: tasks.rows.find((t) => t.id === r.task_id),
    }))
  );
});

// Take over a task: the requester is removed from it and this user is added,
// all in one transaction so the task never has a missing or extra volunteer.
router.post('/:id/accept', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const found = await client.query(
      `SELECT r.*, t.starts_at, t.duration_minutes, t.patient_id
         FROM replacement_requests r
         JOIN tasks t ON t.id = r.task_id
        WHERE r.id = $1
        FOR UPDATE OF r`,
      [req.params.id]
    );
    const request = found.rows[0];

    let error = null;
    if (!request) error = 'הבקשה לא נמצאה';
    else if (request.status !== 'open') error = 'מישהו אחר כבר החליף במשימה הזו';
    else if (request.requester_id === req.user.id) error = 'זו הבקשה שלך';
    else if (new Date(request.starts_at) < new Date()) error = 'המשימה כבר התחילה';

    if (!error) {
      const member = await client.query(
        'SELECT 1 FROM user_patients WHERE user_id = $1 AND patient_id = $2',
        [req.user.id, request.patient_id]
      );
      const already = await client.query(
        'SELECT 1 FROM task_signups WHERE task_id = $1 AND user_id = $2',
        [request.task_id, req.user.id]
      );
      if (member.rows.length === 0) error = 'המשימה לא שייכת לצוות שלך';
      else if (already.rows.length > 0) error = 'כבר נרשמת למשימה הזו';
      else {
        const clash = await findClash(client, req.user.id, request.starts_at, request.duration_minutes);
        if (clash) error = clashMessage(clash);
      }
    }

    if (error) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: error });
    }

    await client.query('DELETE FROM task_signups WHERE task_id = $1 AND user_id = $2', [
      request.task_id,
      request.requester_id,
    ]);
    await client.query('INSERT INTO task_signups (task_id, user_id) VALUES ($1, $2)', [
      request.task_id,
      req.user.id,
    ]);
    await client.query(`UPDATE replacement_requests SET status = 'taken', taken_by = $1 WHERE id = $2`, [
      req.user.id,
      request.id,
    ]);

    await client.query('COMMIT');
    res.json({ message: 'החלפת במשימה, תודה!' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export default router;
