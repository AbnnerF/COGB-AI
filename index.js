async function iniciarBot() {
  const baseDir = fs.existsSync('/data') ? '/data' : os.tmpdir();
  const pastaAuth = path.join(baseDir, 'auth_info_baileys');
  
  if (!fs.existsSync(pastaAuth)) {
    fs.mkdirSync(pastaAuth, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false, // Desativamos o QR code visual
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  // Se nao estiver pareado, gera o codigo de pareamento no terminal
  if (!sock.authState.creds.registered) {
    const phoneNumber = process.env.BOT_NUMBER || "556599... (seu número com DDD)"; // Insira seu número aqui ou via variavel de ambiente
    setTimeout(async () => {
      try {
        let code = await sock.requestPairingCode(phoneNumber.replace(/\D/g, ''));
        console.log(`\n========================================`);
        console.log(`👉 SEU CODIGO DE PAREAMENTO DO WHATSAPP: ${code}`);
        console.log(`========================================\n`);
      } catch (err) {
        console.error("Erro ao gerar codigo de pareamento:", err.message);
      }
    }, 4000);
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
