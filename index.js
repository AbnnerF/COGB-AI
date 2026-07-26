require('dotenv').config();
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { updateCogb, formatList, registrarViolacao, aplicarDecaimentoAutomatico } = require('./cogb');
const { analisarMensagem } = require('./moderation');

const ADMIN_NUMBER = process.env.ADMIN_NUMBER; // ex: 5511999999999
const BOT_NUMBER = process.env.BOT_NUMBER; // número do chip que o bot vai usar, ex: 5511988887777

// Guarda os nomes dos contatos conforme o WhatsApp vai sincronizando
const contatosCache = {};

function salvarContato(contato) {
  const nome = contato.name || contato.notify || contato.verifiedName;
  if (contato.id && nome) {
    contatosCache[contato.id] = nome;
  }
}

async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  // Se ainda não estiver registrado e um BOT_NUMBER foi configurado,
  // pede um código de pareamento em vez do QR code (mais fácil no celular)
  if (BOT_NUMBER && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const codigo = await sock.requestPairingCode(BOT_NUMBER);
        console.log('\n🔑 Seu código de pareamento é: ' + codigo);
        console.log('No WhatsApp Business: Aparelhos conectados > Conectar com número de telefone > digite esse código.\n');
      } catch (err) {
        console.log('Erro ao gerar código de pareamento:', err.message);
      }
    }, 3000);
  }

  sock.ev.on('creds.update', saveCreds);

  // Uma vez por dia, verifica se alguém já ficou tempo suficiente sem violar
  // nenhuma regra e, se sim, reduz o COGB dessa pessoa automaticamente
  setInterval(async () => {
    const atualizados = aplicarDecaimentoAutomatico();
    for (const pessoa of atualizados) {
      if (!pessoa.chatId) continue;
      try {
        await sock.sendMessage(pessoa.chatId, {
          text: `🎉 ${pessoa.name} manteve um bom comportamento e seu COGB baixou para *${pessoa.novoValor}%*.`,
          mentions: [pessoa.id],
        });
      } catch (err) {
        console.log('Erro ao avisar decaimento de COGB:', err.message);
      }
    }
  }, 24 * 60 * 60 * 1000); // a cada 24 horas

  // Vai guardando os nomes reais dos contatos conforme o WhatsApp sincroniza
  sock.ev.on('contacts.upsert', (contatos) => contatos.forEach(salvarContato));
  sock.ev.on('contacts.update', (contatos) => contatos.forEach(salvarContato));

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
    const nomeRemetente = contatosCache[remetenteId] || msg.pushName || remetenteId.split('@')[0];
    if (msg.pushName) contatosCache[remetenteId] = contatosCache[remetenteId] || msg.pushName;

    const texto =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      '';

    if (!texto) return;

    // Comando /Cogb - mostra a lista de todos os membros do grupo
    if (texto.trim().toLowerCase() === '/cogb') {
      try {
        const metadata = await sock.groupMetadata(chatId);
        const participantes = metadata.participants.map((p) => ({
          id: p.id,
          name: contatosCache[p.id] || p.id.split('@')[0],
        }));
        await sock.sendMessage(chatId, { text: formatList(participantes) });
      } catch (err) {
        console.log('Erro ao buscar participantes do grupo:', err.message);
        await sock.sendMessage(chatId, {
          text: '⚠️ Não consegui buscar a lista de membros do grupo agora.',
        });
      }
      return;
    }

    // Qualquer outra mensagem passa pela análise da IA
    const resultado = await analisarMensagem(texto);

    if (resultado.delta === 0) return; // mensagem neutra, não faz nada

    const novoValor = registrarViolacao(remetenteId, nomeRemetente, resultado.delta, chatId);

    await sock.sendMessage(chatId, {
      text: `⚠️ ${nomeRemetente}, isso não foi legal. Seu COGB subiu para *${novoValor}%*.`,
      mentions: [remetenteId],
    });

    if (novoValor >= 100 && ADMIN_NUMBER) {
      await sock.sendMessage(`${ADMIN_NUMBER}@s.whatsapp.net`, {
        text: `🚨 *Alerta de COGB máximo!*\n\n${nomeRemetente} chegou a 100% de COGB no grupo.\nMotivo mais recente: ${resultado.motivo}`,
      });
    }
  });
}

iniciarBot();
          
