const { Pool } = require("pg");

const connectionString = process.env.NEON_DB_URL;
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function init() {
  // Ensure connection and table exist
  await pool.query("select 1;");
  await pool.query(`
    create table if not exists processed_files (
      id text primary key,
      filename text not null,
      filetype text not null,
      size numeric,
      uploaded_at timestamptz not null default now(),
      summary_json jsonb,
      raw_json jsonb
    );
  `);
}

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = {
  init,
  query,
};
