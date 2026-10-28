export const MIN_GAP_MINUTES = 30;
export const DEFAULT_DURATION = 60;

// Finds one of the user's tasks that starts less than MIN_GAP_MINUTES
// before or after the given time range. Returns null when there is none.
export async function findClash(db, userId, startsAt, durationMinutes) {
  const result = await db.query(
    `SELECT t.title, t.starts_at FROM task_signups s
       JOIN tasks t ON t.id = s.task_id
      WHERE s.user_id = $1
        AND t.starts_at < $2::timestamptz + make_interval(mins => $3 + ${MIN_GAP_MINUTES})
        AND $2::timestamptz < t.starts_at + make_interval(mins => COALESCE(t.duration_minutes, ${DEFAULT_DURATION}) + ${MIN_GAP_MINUTES})
      LIMIT 1`,
    [userId, startsAt, durationMinutes ?? DEFAULT_DURATION]
  );
  return result.rows[0] ?? null;
}

export function clashMessage(other) {
  const time = new Date(other.starts_at).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jerusalem',
  });
  return `יש לך כבר משימה קרובה: "${other.title}" בשעה ${time}. צריך לפחות חצי שעה בין משימות`;
}
