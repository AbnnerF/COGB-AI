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
const qrcode = require('qrcode-terminal');
const { gerarResposta } = require('./chatbot');

let stickerLib = {};
try {
  stickerLib = require('./sticker');
} catch (e) {
  console.log('Modulo sticker.js nao carregado.');
}

console.log("Iniciando Chaim-Bot no modo completo...");

async function iniciarBot() {
  // Usa /data se existir na Deplexo, ou cai para a pasta temporaria /tmp com permissao garantida
  const baseDir = fs.existsSync('/data') ? '/data' : os.tmpdir();
  const pastaAuth = path.join(baseDir, 'auth_info_baileys');
  
  if (!fs.existsSync(pastaAuth)) {
    fs.mkdirSync(pastaAuth, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('Escaneie o QR Code abaixo para conectar:');
      qrcode.generate(qr, { small: true });
    }
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
    
    if (texto.toLowerCase() === '!ping') {
      await sock.sendMessage(m.key.remoteJid, { text: 'Pong! Bot online e operacional.' });
    }
  });
}

iniciarBot();
