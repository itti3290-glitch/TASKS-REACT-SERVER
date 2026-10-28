import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'Asia/Jerusalem'");
});

export default pool;