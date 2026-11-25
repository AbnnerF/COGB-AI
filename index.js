require('dotenv').config();

process.on('uncaughtException', (err) => console.error('[ERRO FATAL]:', err));
process.on('unhandledRejection', (err) => console.error('[REJEICAO]:', err));

// Mantém o processo Node vivo na Deplexo mesmo se o Baileys reiniciar
setInterval(() => {}, 1000 * 60 * 60);

const fs = require('fs');
const path = require('path');
const os = require('os');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

console.log('=== [1/4] INICIANDO CHAIM-BOT ===');

let codigoJaSolicitado = false;

async function iniciarBot() {
  try {
    const baseDir = fs.existsSync('/data') ? '/data' : os.tmpdir();
    const pastaAuth = path.join(baseDir, 'auth_info_baileys');
    if (!fs.existsSync(pastaAuth)) fs.mkdirSync(pastaAuth, { recursive: true });

    console.log('=== [2/4] CARREGANDO SESSAO EM:', pastaAuth);
    const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'connecting') {
        console.log('=== [3/4] CONECTANDO AOS SERVIDORES DO WHATSAPP... ===');
      }

      // Solicita o código de pareamento assim que começar a conectar e não estiver registrado
      if (!sock.authState.creds.registered && !codigoJaSolicitado) {
        codigoJaSolicitado = true;
        const phoneNumber = (process.env.BOT_NUMBER || '5565996799870').replace(/\D/g, '');
        setTimeout(async () => {
          try {
            console.log(`=== [4/4] PEDINDO CODIGO PARA: ${phoneNumber} ===`);
            const code = await sock.requestPairingCode(phoneNumber);
            console.log('\n==========================================');
            console.log(`👉 CODIGO DE PAREAMENTO: ${code}`);
            console.log('==========================================\n');
          } catch (err) {
            console.error('Erro ao pedir codigo:', err.message);
            codigoJaSolicitado = false;
          }
        }, 4000);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`Conexao fechada (status ${statusCode}). Reconectando: ${shouldReconnect}`);
        if (shouldReconnect) {
          setTimeout(iniciarBot, 3000);
        }
      } else if (connection === 'open') {
        console.log('✅ CHAIM-BOT CONECTADO E ONLINE NO WHATSAPP!');
      }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
      const m = messages[0];
      if (!m.message || m.key.fromMe) return;
      const texto = m.message.conversation || m.message.extendedTextMessage?.text || '';

      if (texto.toLowerCase() === '!ping') {
        await sock.sendMessage(m.key.remoteJid, { text: 'Pong! Chaim-Bot online!' });
      }
    });
  } catch (erroGeral) {
    console.error('Erro na funcao iniciarBot:', erroGeral);
    setTimeout(iniciarBot, 5000);
  }
}

iniciarBot();
