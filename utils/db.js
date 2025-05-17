const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const ssl = {
  ca: fs.readFileSync(path.resolve(__dirname, '..', process.env.SSL_CERT_PATH))
};

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'whatsapp',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl
});

module.exports = pool;