require('dotenv').config();
process.on('uncaughtException', (err) => console.error('Erro nao tratado:', err.message));
process.on('unhandledRejection', (err) => console.error('Rejeicao nao tratada:', err?.message || err));

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
  console.log('Modulo sticker.js nao encontrado; funcoes de figurinha desativadas.');
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

console.log("Iniciando Chaim-Bot...");
Analisando
