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
  console.log('Modulo sticker.js nao carregado.');
}

console.log("Iniciando Chaim-Bot na Deplexo...");

async function iniciarBot() {
  const baseDir = fs.existsSync('/data') ? '/data' : os.tmpdir();
  const pastaAuth = path.join(baseDir, 'auth_info_baileys');
  
  if (!fs.existsSync(pastaAuth)) {
    fs.mkdirSync(pastaAuth, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false, // Desativado pois estamos na Deplexo
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  // Se o bot ainda nao estiver registado, solicita o codigo de pareamento
  if (!sock.authState.creds.registered) {
    // Insira aqui o seu número de WhatsApp com o DDD (ex: 5565999999999) 
    // ou configure a variavel de ambiente BOT_NUMBER no painel da Deplexo
    const phoneNumber = process.env.BOT_NUMBER || "5565996799870"; 
    
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
    
    if (texto.toLowerCase() === '!ping') {
      await sock.sendMessage(m.key.remoteJid, { text: 'Pong! Bot online e operacional.' });
    }
  });
}

iniciarBot();
