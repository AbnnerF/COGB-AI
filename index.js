require('dotenv').config();
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { gerarResposta } = require('./chatbot');

const BOT_NUMBER = process.env.BOT_NUMBER; // número do chip que o bot vai usar, ex: 5511988887777

// Quanto tempo (em ms) o bot continua "no papo" depois da última mensagem, sem precisar ser chamado de novo
const TEMPO_INATIVIDADE_MS = 20 * 1000;

// Guarda, por grupo, se a conversa tá "ativa" no momento (bot participando sem precisar ser chamado)
const conversasAtivas = {}; // chatId -> timeoutHandle

// Guarda os nomes dos contatos conforme o WhatsApp vai sincronizando
const contatosCache = {};

function salvarContato(contato) {
  const nome = contato.name || contato.notify || contato.verifiedName;
  if (contato.id && nome) {
    contatosCache[contato.id] = nome;
  }
}

// Remove as marcações de menção (tipo "@5511999999999") do texto antes de mandar pra IA
function limparMencoes(texto) {
  return texto.replace(/@\d+/g, '').trim();
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
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log('Motivo da desconexão (código):', statusCode, '-', lastDisconnect?.error?.message);
      const deveReconectar = statusCode !== DisconnectReason.loggedOut;
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

    const comandoAtivar = texto.trim().toLowerCase() === '/bot';
    const conversaJaAtiva = Boolean(conversasAtivas[chatId]);

    // Se não foi o comando /Bot e a conversa não tá ativa nesse grupo, o bot ignora a mensagem
    if (!comandoAtivar && !conversaJaAtiva) return;

    // (Re)inicia o cronômetro de 20s: se ninguém mais falar nesse tempo, a conversa "desliga"
    if (conversasAtivas[chatId]) clearTimeout(conversasAtivas[chatId]);
    conversasAtivas[chatId] = setTimeout(() => {
      delete conversasAtivas[chatId];
    }, TEMPO_INATIVIDADE_MS);

    // Quando é só o comando de ativação, manda uma saudação em vez de tentar "responder" o comando
    if (comandoAtivar) {
      const saudacao = await gerarResposta(nomeRemetente, 'acabou de te chamar pra participar da conversa do grupo, manda um "e aí" descontraído');
      if (saudacao) await sock.sendMessage(chatId, { text: saudacao });
      return;
    }

    const resposta = await gerarResposta(nomeRemetente, limparMencoes(texto));
    if (!resposta) return;

    await sock.sendMessage(chatId, { text: resposta });
  });
}

iniciarBot();

