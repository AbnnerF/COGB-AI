require('dotenv').config();
process.on('uncaughtException', (err) => console.error('⚠️ Erro não tratado:', err.message));
process.on('unhandledRejection', (err) => console.error('⚠️ Rejeição não tratada:', err?.message || err));

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const {
default: makeWASocket,
Browsers,
fetchLatestBaileysVersion,
useMultiFileAuthState,
DisconnectReason,
downloadMediaMessage,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { gerarResposta, gerarRespostaComPrompt } = require('./chatbot');
let stickerLib = {};
try {
stickerLib = require('./sticker');
} catch (e) {
console.log('⚠️ Módulo sticker.js não encontrado; funções de figurinha desativadas.');
}
const {
gerarFigurinha = async () => null,
gerarPackDeFigurinhas = async () => null,
adicionarMetadados = async (b) => b,
pesquisarPacksStickerLy = async () => [],
buscarFigurinhasPorTema = async () => [],
buscarPackCompletoPorTema = async () => null,
criarFigurinhaDeImagem = async () => null,
criarFigurinhaAnimada = async () => null,
converterFigurinhaParaImagem = async () => null,
converterFigurinhaParaVideo = async () => null,
converterVideoParaAudio = async () => null,
converterGifParaVideo = async () => null,
baixarAudioDoYoutube = async () => null,
gerarImagem = async () => null,
obterDimensoes = async () => ({ width: 512, height: 512 }),
obterDuracao = async () => 0,
ehDesproporcional = () => false,
DURACAO_MAXIMA_FIGURINHA = 10,
} = stickerLib;
const {
MENSAGEM_BOAS_VINDAS_PV,
MENSAGEM_NOVA_FUNCAO_CONVERT,
MENSAGEM_GRUPO_ATIVADO,
MENSAGEM_MENU,
MENSAGEM_AJUDA_IA,
} = require('./mensagens');
const estado = require('./estado');
const tops = require('./tops');
const rpg = require('./rpg');
const pokemon = require('./pokemon');

const ADMIN_NUMBER = process.env.ADMIN_NUMBER;
const BOT_NUMBER = process.env.BOT_NUMBER;
const NUMERO_CRIADOR = '5565996799870';

function numeroBaseJid(jid) { return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, ''); }
function ehCriador(remetenteId) {
const donoSalvo = estado.obterDono?.();
return donoSalvo ? numeroBaseJid(remetenteId) === numeroBaseJid(donoSalvo) : numeroBaseJid(remetenteId) === NUMERO_CRIADOR;
}

const PASTA_AUTH = path.join(__dirname, 'auth_info_baileys');

async function iniciarBot() {
const { state, saveCreds } = await useMultiFileAuthState(PASTA_AUTH);
const { version } = await fetchLatestBaileysVersion();

const sock = makeWASocket({
version,
logger: pino({ level: 'silent' }),
auth: state,
browser: Browsers.macOS('Chrome'),
printQRInTerminal: true,
});

sock.ev.on('creds.update', saveCreds);

sock.ev.on('connection.update', async (update) => {
const { connection, lastDisconnect } = update;
if (connection === 'close') {
const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
console.log('⚠️ Conexão fechada. Reconectando...', shouldReconnect);
if (shouldReconnect) {
setTimeout(iniciarBot, 3000);
}
} else if (connection === 'open') {
console.log('🤖 Chaim-Bot conectado com sucesso!');
}
});

sock.ev.on('messages.upsert', async ({ messages, type }) => {
if (type !== 'notify') return;
for (const msg of messages) {
if (!msg.message || msg.key.fromMe) continue;

  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith('@g.us');
  const remetenteId = isGroup ? msg.key.participant : chatId;
  const nomeRemetente = msg.pushName || 'Usuário';

  const textoMensagem =
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    msg.message.imageMessage?.caption ||
    msg.message.videoMessage?.caption ||
    '';

  const textoLower = textoMensagem.trim().toLowerCase();
  const textoLimpo = textoMensagem.trim();

  // Registro do Administrador
  if (!isGroup && textoLower === 'chaim-bot-admin01') {
    const adminConfigurado = numeroBaseJid(ADMIN_NUMBER);
    const numeroReal = numeroBaseJid(msg.key.remoteJidAlt || remetenteId);
    const ehDonoValido = msg.key.fromMe ||
      (adminConfigurado && (numeroReal === adminConfigurado || numeroBaseJid(remetenteId) === adminConfigurado)) ||
      numeroReal === NUMERO_CRIADOR;

    if (!ehDonoValido) {
      await sock.sendMessage(chatId, { text: '⛔ Este registro só pode ser feito pelo número ADMIN_NUMBER configurado.' });
      continue;
    }
    const registro = estado.registrarCriadorUmaVez(numeroReal || remetenteId);
    await sock.sendMessage(chatId, { text: registro.ok
      ? '👑 *Criador registrado permanentemente!* Este registro não poderá ser substituído por outro número.'
      : '⚠️ O Criador já foi registrado anteriormente. Por segurança, não é possível trocar o registro.' });
    continue;
  }

  // Comando /viajar do Pokémon
  if (textoLower === '/viajar') {
    const res = pokemon.viajar(remetenteId, nomeRemetente);
    if (!res.ok) { await sock.sendMessage(chatId, { text: res.text }); continue; }
    const txtEnc = res.encontro
      ? `\n\n🔎 Você encontrou um *${res.encontro.emoji} ${res.encontro.nome}* (${res.encontro.raridade} — Nv.${res.encontro.level})!\nUse */capturar* para tentar pegá-lo!`
      : '\n\n🌿 Nenhum Pokémon apareceu por aqui agora.';
    await sock.sendMessage(chatId, { text: `🗺️ Você viajou para *${res.cidade}*!${txtEnc}` });
    continue;
  }

  // Comando /capturar do Pokémon
  if (textoLower === '/capturar') {
    const res = pokemon.capturar(remetenteId, nomeRemetente);
    await sock.sendMessage(chatId, { text: res.ok
      ? `🎉 *Parabéns!* Você capturou ${res.pokemon.emoji} *${res.pokemon.nome}* (Nv.${res.pokemon.nivel}) e ganhou +5 PokéCoins!`
      : res.text });
    continue;
  }

  // Comando /shop do Pokémon
  if (textoLower === '/shop') {
    await sock.sendMessage(chatId, { text: pokemon.shop(remetenteId, nomeRemetente) });
    continue;
  }

  // Comando /buy do Pokémon
  if (textoLower.startsWith('/buy')) {
    const num = textoLimpo.split(/\s+/)[1];
    const res = pokemon.buy(remetenteId, nomeRemetente, num);
    await sock.sendMessage(chatId, { text: res.text });
    continue;
  }

  // Comando /audio ou /play (YouTube)
  if (textoLower.startsWith('/audio') || textoLower.startsWith('/play') || textoLower.startsWith('/music')) {
    const termo = textoLimpo.split(' ').slice(1).join(' ');
    if (!termo) {
      await sock.sendMessage(chatId, { text: '⚠️ Envie o link ou o nome da música após o comando. Ex: /audio https://youtube.com/...' });
      continue;
    }
    await sock.sendMessage(chatId, { text: '⏳ Baixando áudio do YouTube com autenticação...' });
    let urlBusca = termo;
    if (!termo.startsWith('http')) {
      urlBusca = `ytsearch1:${termo}`;
    }
    const audioBuffer = await baixarAudioDoYoutube(urlBusca);
    if (audioBuffer) {
      await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: 'audio/mp4', ptt: false });
    } else {
      await sock.sendMessage(chatId, { text: '❌ Erro ao baixar o áudio. Verifique se o link é válido ou se os cookies estão corretos.' });
    }
    continue;
  }

  // Comando /pack e /packs
  if (textoLower.startsWith('/pack') || textoLower.startsWith('/packs')) {
    const tema = textoLimpo.split(' ').slice(1).join(' ');
    if (!tema) {
      await sock.sendMessage(chatId, { text: '⚠️ Informe o tema do pack. Ex: /pack anime' });
      continue;
    }
    await sock.sendMessage(chatId, { text: `🔍 Buscando packs sobre "${tema}"...` });
    const pack = await buscarPackCompletoPorTema(tema);
    if (pack && pack.stickers?.length) {
      for (const sth of pack.stickers.slice(0, 5)) {
        await sock.sendMessage(chatId, { sticker: sth });
      }
    } else {
      await sock.sendMessage(chatId, { text: `❌ Nenhum pack encontrado para "${tema}".` });
    }
    continue;
  }
}


});
}

iniciarBot();
