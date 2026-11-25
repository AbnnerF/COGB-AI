require('dotenv').config();

process.on('uncaughtException', (err) => {
  console.error('❌ ERRO FATAL (uncaughtException):', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ REJEICAO NAO TRATADA:', reason);
});

const fs = require('fs');
const path = require('path');
const os = require('os');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

console.log("🚀 A iniciar o Chaim-Bot...");

async function iniciarBot() {
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

  if (!sock.authState.creds.registered) {
    const phoneNumber = process.env.BOT_NUMBER || "5565996799870";
    setTimeout(async () => {
      try {
        console.log(`A solicitar codigo de pareamento para: ${phoneNumber}...`);
        let code = await sock.requestPairingCode(phoneNumber.replace(/\D/g, ''));
        console.log(`\n========================================`);
        console.log(`👉 CODIGO DE PAREAMENTO: ${code}`);
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
      console.log('Conexao fechada. A reconectar...', shouldReconnect);
      if (shouldReconnect) iniciarBot();
    } else if (connection === 'open') {
      console.log('✅ Chaim-Bot conectado com sucesso!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const m = messages[0];
    if (!m.message || m.key.fromMe) return;
    const texto = m.message.conversation || m.message.extendedTextMessage?.text || '';
    
    if (texto.toLowerCase() === '!ping') {
      await sock.sendMessage(m.key.remoteJid, { text: 'Pong! Bot online.' });
    }
  });
}

iniciarBot();
