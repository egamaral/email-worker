require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const SSL_CERT_PATH = process.env.SSL_CERT_PATH || 'certs/ca-cert.pem'
const DB_HOST = process.env.DB_HOST || 'localhost'
const DB_USER = process.env.DB_USER || 'root'
const DB_PASS = process.env.DB_PASS || ''
const DB_NAME = process.env.DB_NAME || 'whatsapp'
const DB_CONNECT_TIMEOUT = parseInt(process.env.DB_CONNECT_TIMEOUT, 10) || 10000; // ms
const DB_MAX_RETRIES = parseInt(process.env.DB_MAX_RETRIES, 10) || 3;
const DB_RETRY_DELAY_MS = parseInt(process.env.DB_RETRY_DELAY_MS, 10) || 2000; // ms

// Carrega certificado SSL com tratamento de erro
let ssl;
if (!SSL_CERT_PATH) {
    console.error('SSL_CERT_PATH não definido');
    process.exit(1);
}
try {
    const certPath = path.resolve(__dirname, '..', SSL_CERT_PATH);
    ssl = { ca: fs.readFileSync(certPath) };
} catch (error) {
    console.error(`Erro ao ler certificado SSL: ${error.message}`);
    process.exit(1);
}

async function connectToDatabase() {
    const config = {
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASS,
        database: DB_NAME,
        connectTimeout: DB_CONNECT_TIMEOUT
    };
    // Se o certificado SSL foi carregado com sucesso, adiciona à configuração
    if (ssl) config.ssl = ssl;
    let attempt = 0;
    while (true) {
        try {
            return await mysql.createConnection(config);
        } catch (error) {
            attempt++;
            if (attempt > DB_MAX_RETRIES) {
                console.error('Número máximo de tentativas de conexão atingido. Abortando.');
                throw error;
            }
            console.error(`Tentativa ${attempt}/${DB_MAX_RETRIES} de conexão falhou: ${error.message}`);
            console.log(`Aguardando ${DB_RETRY_DELAY_MS}ms antes de nova tentativa...`);
            await new Promise(res => setTimeout(res, DB_RETRY_DELAY_MS));
        }
    }
}
module.exports = connectToDatabase;
