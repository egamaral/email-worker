// Projeto: Email Worker Autônomo em Node.js
// Roda internamente no servidor, sem acesso externo.
// Agenda configurável a cada X minutos (via INTERVAL_MINUTES).
// Melhores práticas: async/await, transações, pool de conexões, templates SendGrid.

require('dotenv').config();
const mysql = require('mysql2/promise');
const cron = require('node-cron');
const sgMail = require('@sendgrid/mail');

// Configura SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Pool de conexões ao MySQL (reutilizável)
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
});

/**
 * Processa os e-mails pendentes na tabela email_queue.
 * Para cada e-mail:
 *  - Usa transação (BEGIN/COMMIT/ROLLBACK)
 *  - Envia via template do SendGrid
 *  - Marca status como 'sent' ou 'error'
 */
async function processPendingEmails() {
    let conn;
    try {
        conn = await pool.getConnection();
        const [pendentes] = await conn.execute(
            "SELECT id, to_addr, template_id, dynamic_data FROM email_queue WHERE status = 'pending' FOR UPDATE"
        );

        for (const email of pendentes) {
            try {
                await conn.beginTransaction();

                const msg = {
                    to: email.to_addr,
                    from: process.env.EMAIL_SENDER,
                    templateId: email.template_id,
                    dynamicTemplateData: JSON.parse(email.dynamic_data)
                };
                await sgMail.send(msg);

                await conn.execute(
                    "UPDATE email_queue SET status = 'sent', sent_at = NOW() WHERE id = ?",
                    [email.id]
                );
                await conn.commit();
            } catch (err) {
                await conn.rollback();
                console.error(`Erro ao enviar e-mail ID ${email.id}:`, err.message);
                await conn.execute(
                    "UPDATE email_queue SET status = 'error', error_msg = ? WHERE id = ?",
                    [err.message, email.id]
                );
            }
        }
    } catch (err) {
        console.error('Falha geral no processamento de e-mails:', err.message);
    } finally {
        if (conn) await conn.release();
    }
}

// Intervalo de execução em minutos (padrão: 1)
const interval = parseInt(process.env.INTERVAL_MINUTES, 10) || 1;
const cronExpression = `*/${interval} * * * *`;

console.log(`Email worker configurado para rodar a cada ${interval} minuto(s).`);

// Agendamento interno
cron.schedule(cronExpression, () => {
    console.log('Job de e-mails pendentes iniciado em', new Date().toISOString());
    processPendingEmails();
});

console.log('Email worker rodando internamente.');
