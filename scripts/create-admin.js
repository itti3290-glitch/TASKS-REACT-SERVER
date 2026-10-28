import bcrypt from 'bcryptjs';
import pool from '../db.js';

const [email, password, fullName = 'Admin'] = process.argv.slice(2);

if (!email || !password) {
  console.log('Usage: node --env-file=.env --use-system-ca scripts/create-admin.js EMAIL PASSWORD');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 10);
await pool.query(
  `INSERT INTO users (full_name, email, phone, password_hash, role, monthly_quota)
   VALUES ($1, $2, '-', $3, 'admin', 0)
   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin'`,
  [fullName, email.toLowerCase(), hash]
);
console.log(`Admin ready: ${email}`);
await pool.end();