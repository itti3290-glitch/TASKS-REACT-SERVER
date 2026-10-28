import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import pool from '../db.js';

// Fake demo data for the project review: two patients, one volunteer for each, and a few tasks.
// Safe to run again: anything that already exists is skipped. It never touches existing rows.
// The admin is not created here; use scripts/create-admin.js with your own password.
const DEMO_PASSWORD = 'Demo1234';

const patients = [
  { name: 'דוגמה: רחל כהן', address: 'רחוב הדוגמה 1, ירושלים', phone: '050-0000001', volunteer: { name: 'דנה מתנדבת', email: 'dana@demo.com' } },
  { name: 'דוגמה: יוסף לוי', address: 'רחוב הדוגמה 2, חיפה', phone: '050-0000002', volunteer: { name: 'אורי מתנדב', email: 'ori@demo.com' } },
];

// [title, category, days from today, hour, volunteers needed, description]
const tasks = [
  ['ביקור התעניינות', 'visit', 1, 10, 1, 'ביקור קצר ושיחה'],
  ['קניות תרופות', 'shopping', 2, 12, 1, 'איסוף תרופות מבית המרקחת'],
  ['תור לרופא משפחה', 'doctor', 3, 9, 2, 'ליווי לתור'],
  ['מקלחת והשכבה', 'care', 4, 18, 1, 'עזרה במקלחת ובהשכבה'],
];

const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

for (const demo of patients) {
  let patient = (await pool.query('SELECT id FROM patients WHERE full_name = $1', [demo.name])).rows[0];
  if (!patient) {
    patient = (
      await pool.query(
        `INSERT INTO patients (full_name, address, contact_phone, join_code)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [demo.name, demo.address, demo.phone, crypto.randomBytes(3).toString('hex').toUpperCase()]
      )
    ).rows[0];
  }

  await pool.query(
    `INSERT INTO users (full_name, email, phone, password_hash)
     VALUES ($1, $2, '050-0000000', $3) ON CONFLICT (email) DO NOTHING`,
    [demo.volunteer.name, demo.volunteer.email, hash]
  );
  const volunteer = (await pool.query('SELECT id FROM users WHERE email = $1', [demo.volunteer.email])).rows[0];
  await pool.query('INSERT INTO user_patients (user_id, patient_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    volunteer.id,
    patient.id,
  ]);

  for (const [title, category, days, hour, needed, description] of tasks) {
    const exists = await pool.query('SELECT 1 FROM tasks WHERE patient_id = $1 AND title = $2', [patient.id, title]);
    if (exists.rows.length > 0) continue;
    await pool.query(
      `INSERT INTO tasks (title, category, starts_at, volunteers_needed, description, patient_id)
       VALUES ($1, $2, date_trunc('day', now()) + make_interval(days => $3, hours => $4), $5, $6, $7)`,
      [title, category, days, hour, needed, description, patient.id]
    );
  }
}

console.log(`Demo data ready. Demo volunteers: dana@demo.com, ori@demo.com (password: ${DEMO_PASSWORD})`);
await pool.end();
