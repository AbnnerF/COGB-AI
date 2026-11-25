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
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { gerarResposta, gerarRespostaComPrompt } = require('./chatbot');
let stickerLib = {};
try {
  stickerLib = require('./sticker');
} catch (e) {
  console.log('Modulo sticker.js nao encontrado; funcoes de figurinha desativadas.');
}

console.log("Iniciando Chaim-Bot na Deplexo...");