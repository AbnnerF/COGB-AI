require('dotenv').config();

console.log("=== ETAPA 1: Carregando variaveis de ambiente ===");
console.log("ADMIN_NUMBER configurado:", process.env.ADMIN_NUMBER ? "Sim" : "Nao");

process.on('uncaughtException', (err) => {
  console.error('❌ ERRO FATAL (uncaughtException):', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ REJEICAO NAO TRATADA:', reason);
});

console.log("=== ETAPA 2: Carregando modulos internos ===");
const fs = require('fs');
const path = require('path');

try {
  const chatbot = require('./chatbot');
  console.log("Módulo chatbot carregado com sucesso.");
} catch (e) {
  console.error("Erro ao carregar chatbot.js:", e.message);
}

try {
  const sticker = require('./sticker');
  console.log("Módulo sticker carregado com sucesso.");
} catch (e) {
  console.error("Erro ao carregar sticker.js:", e.message);
}

console.log("=== ETAPA 3: Fim dos testes de arranque ===");
