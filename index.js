require('dotenv').config();
process.on('uncaughtException', (err) => console.error('Erro nao tratado:', err.message));
process.on('unhandledRejection', (err) => console.error('Rejeicao nao tratada:', err?.message || err));

const fs = require('fs');
const path = require('path');
const os = require('os');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');
const { gerarResposta } = require('./chatbot');

let stickerLib = {};
try {
  stickerLib = require('./sticker');
} catch (e) {
  console.log('Modulo sticker.js carregado com avisos.');
}

console.log("Iniciando Chaim-Bot na Deplexo (Modo Completo Seguro)...");

async function iniciarBot() {
  // Pasta temporaria segura na Deplexo para evitar erros de escrita (ENOENT)
  const baseDir = fs.existsSync('/data') ? '/data' : os.tmpdir();
  const pastaAuth = path.join(baseDir, 'auth_info_baileys');
  
  if (!fs.existsSync(pastaAuth)) {
    fs.mkdirSync(pastaAuth, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  // Gera o código de pareamento automaticamente se o bot não estiver conectado
  if (!sock.authState.creds.registered) {
    const phoneNumber = process.env.BOT_NUMBER || "5565996799870"; // Altere para o número do seu bot
    setTimeout(async () => {
      try {
        console.log(`Solicitando codigo de pareamento para o numero: ${phoneNumber}...`);
        let code = await sock.requestPairingCode(phoneNumber.replace(/\D/g, ''));
        console.log(`\n========================================`);
        console.log(`👉 SEU CODIGO DE PAREAMENTO: ${code}`);
        console.log(`========================================\n`);
      } catch (err) {
        console.error("Erro ao gerar codigo de pareamento:", err.message);
      }
    }, 5000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexao fechada. Reconectando...', shouldReconnect);
      if (shouldReconnect) iniciarBot();
    } else if (connection === 'open') {
      console.log('Chaim-Bot conectado com sucesso no WhatsApp!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;
    const texto = m.message.conversation || m.message.extendedTextMessage?.text || '';
    
    // Comando basico de teste
    if (texto.toLowerCase() === '!ping') {
      await sock.sendMessage(m.key.remoteJid, { text: 'Pong! Chaim-Bot online e operacional.' });
    }
  });
}

iniciarBot();
