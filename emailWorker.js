// Projeto: Email Worker Autônomo em Node.js
// Roda internamente no servidor, sem acesso externo.
// Agenda configurável a cada X minutos (via INTERVAL_MINUTES).
// Melhores práticas: async/await, transações, pool de conexões, templates SendGrid.

require('dotenv').config();
const cron = require('node-cron');
const sgMail = require('@sendgrid/mail');
const connectToDatabase = require('./utils/db');

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const JOB_INTERVAL_MINUTES = process.env.JOB_INTERVAL_MINUTES || 1;
const EMAIL_SENDER = process.env.EMAIL_SENDER;
const EMAIL_NAME = process.env.EMAIL_NAME;
const EMAIL_SUBJECT = process.env.EMAIL_SUBJECT;

// Configura SendGrid
sgMail.setApiKey(SENDGRID_API_KEY);

// Função para processar e-mails pendentes
async function processPendingEmails() {
    let allSuccess = true;
    let connection;
    try {
        connection = await connectToDatabase();
        const [pendentes] = await connection.execute(`SELECT eq.id, uc.email AS contact_email, u.first_name AS firstName, eq.template_id, eq.url FROM email_queue AS eq JOIN user_contacts AS uc ON uc.user_id = eq.user_id JOIN users AS u ON u.user_id = eq.user_id WHERE eq.status = 'pending';`);
        console.log(`Encontrados ${pendentes.length} e-mails pendentes para envio.`);
        for (const email of pendentes) {
            try {
                await connection.beginTransaction();
                // Define o payload do e-mail
                const msg = {
                    to: email.contact_email,
                    from: {
                        email: EMAIL_SENDER,
                        name: EMAIL_NAME
                    },
                    subject: EMAIL_SUBJECT,
                    templateId: email.template_id,
                    dynamic_template_data: {
                        firstName: email.firstName,
                        currentYear: new Date().getFullYear(),
                        verificationLink: email.url
                    }
                };
                // Envia o e-mail via API SendGrid
                const response = await sgMail.send(msg);
                // Verifica o status da resposta
                const statusCode = response[0]?.statusCode;
                const messageId = response[0]?.headers['x-message-id'];
                if (statusCode !== 202) throw new Error(`Falha no envio do e-mail. Status Code: ${statusCode}`); 
                // Salva o registro no banco de dados
                await connection.execute(`INSERT INTO email_logs (email, template_id, message_id, template_name, event) VALUES (?, ?, ?, ?, ?)`, [email.contact_email, email.template_id, messageId, null, 'sent']);
                await connection.execute("UPDATE email_queue SET status = 'sent', sent_at = NOW() WHERE id = ?", [email.id]);
                await connection.commit();
            } catch (error) {
                await connection.rollback();
                console.error(`Erro ao enviar e-mail ID ${email.id}:`, error.message);
                connection.beginTransaction();
                await connection.execute("UPDATE email_queue SET status = 'error', error_msg = ? WHERE id = ?", [error.message, email.id]);
                connection.commit();
                allSuccess = false;
            }
        }
    } catch (error) {
        console.error('Falha geral no processamento de e-mails:', error.message);
        allSuccess = false;
    } finally {
        if (connection) await connection.end();
    }
    return allSuccess;
}

// Intervalo de execução em minutos (padrão: 1)
const interval = parseInt(JOB_INTERVAL_MINUTES, 10) || 1;
const cronExpression = `*/${interval} * * * *`;
console.log(`Email worker configurado para rodar a cada ${interval} minuto(s).`);
// Agendamento interno que só executa a próxima vez se a execução anterior for bem-sucedida
let job;
job = cron.schedule(cronExpression, async () => {
    console.log('Job de e-mails pendentes iniciado em', new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }));
    const success = await processPendingEmails();
    if (!success) {
        console.error('Execução falhou, desativando agendamento.');
        job.stop();
    }
});
