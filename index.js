require('dotenv').config();
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { updateCogb, formatList } = require('./cogb');
const { analisarMensagem } = require('./moderation');

const ADMIN_NUMBER = process.env.ADMIN_NUMBER; // ex: 5511999999999

async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  // Mostra o QR code no terminal pra você escanear com o WhatsApp
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Escaneie o QR code abaixo no seu WhatsApp:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const deveReconectar =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexão fechada. Reconectando?', deveReconectar);
      if (deveReconectar) iniciarBot();
    } else if (connection === 'open') {
      console.log('✅ Bot conectado ao WhatsApp!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const chatId = msg.key.remoteJid; // grupo ou conversa
    const isGroup = chatId.endsWith('@g.us');
    if (!isGroup) return; // o bot só atua em grupos

    const remetenteId = msg.key.participant || msg.key.remoteJid;
    const nomeRemetente = msg.pushName || remetenteId.split('@')[0];

    const texto =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      '';

    if (!texto) return;

    // Comando /Cogb - mostra a lista de todos os membros
    if (texto.trim().toLowerCase() === '/cogb') {
      await sock.sendMessage(chatId, { text: formatList() });
      return;
    }

    // Qualquer outra mensagem passa pela análise da IA
    const resultado = await analisarMensagem(texto);

    if (resultado.delta === 0) return; // mensagem neutra, não faz nada

    const novoValor = updateCogb(remetenteId, nomeRemetente, resultado.delta);

    if (resultado.acao === 'violacao') {
      await sock.sendMessage(chatId, {
        text: `⚠️ ${nomeRemetente}, isso não foi legal. Seu COGB subiu para *${novoValor}%*.`,
        mentions: [remetenteId],
      });

      if (novoValor >= 100 && ADMIN_NUMBER) {
        await sock.sendMessage(`${ADMIN_NUMBER}@s.whatsapp.net`, {
          text: `🚨 *Alerta de COGB máximo!*\n\n${nomeRemetente} chegou a 100% de COGB no grupo.\nMotivo mais recente: ${resultado.motivo}`,
        });
      }
    }

    if (resultado.acao === 'elogio') {
      await sock.sendMessage(chatId, {
        text: `🎉 Parabéns, ${nomeRemetente}! Seu comportamento foi ótimo e seu COGB baixou para *${novoValor}%*.`,
        mentions: [remetenteId],
      });
    }
  });
}

iniciarBot();
