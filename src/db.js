const { Pool } = require("pg");

// Render Postgres SSL ister → ssl: { rejectUnauthorized: false }
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = {
  query: (text, params) => pool.query(text, params)
};
