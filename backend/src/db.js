import mysql from 'mysql2/promise';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

export const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  connectionLimit: 10,
  timezone: 'Z',
  decimalNumbers: true,
});
