const fs = require('fs');
const path = require('path');

const PASTA_DADOS = path.join(__dirname, 'data');
const ARQUIVO_ESTADO = path.join(PASTA_DADOS, 'estado.json');

function garantirArquivo() {
  if (!fs.existsSync(PASTA_DADOS)) fs.mkdirSync(PASTA_DADOS, { recursive: true });
  if (!fs.existsSync(ARQUIVO_ESTADO)) {
    fs.writeFileSync(
      ARQUIVO_ESTADO,
      JSON.stringify({ contatosBoasVindas: [], gruposStatus: {}, filaAutorizacao: [] }, null, 2)
    );
  }
}

function carregarEstado() {
  garantirArquivo();
  return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf-8'));
}

function salvarEstado(estado) {
  garantirArquivo();
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2));
}

// --- Boas-vindas no privado (uma vez por pessoa) ---

function jaRecebeuBoasVindas(id) {
  return carregarEstado().contatosBoasVindas.includes(id);
}

function marcarBoasVindas(id) {
  const estado = carregarEstado();
  if (!estado.contatosBoasVindas.includes(id)) {
    estado.contatosBoasVindas.push(id);
    salvarEstado(estado);
  }
}

// --- Autorização de grupos ---

// Grupos que o bot já conhecia antes desse recurso existir ficam liberados por padrão;
// só grupos detectados via evento de entrada ficam "pendente" até autorização.
function statusDoGrupo(chatId) {
  const estado = carregarEstado();
  return estado.gruposStatus[chatId] || 'autorizado';
}

function definirStatusGrupo(chatId, status) {
  const estado = carregarEstado();
  estado.gruposStatus[chatId] = status;
  salvarEstado(estado);
}

function adicionarNaFila(chatId) {
  const estado = carregarEstado();
  if (!estado.filaAutorizacao.includes(chatId)) {
    estado.filaAutorizacao.push(chatId);
    salvarEstado(estado);
  }
}

function proximoDaFila() {
  return carregarEstado().filaAutorizacao[0] || null;
}

function removerDaFila(chatId) {
  const estado = carregarEstado();
  estado.filaAutorizacao = estado.filaAutorizacao.filter((id) => id !== chatId);
  salvarEstado(estado);
}

module.exports = {
  jaRecebeuBoasVindas,
  marcarBoasVindas,
  statusDoGrupo,
  definirStatusGrupo,
  adicionarNaFila,
  proximoDaFila,
  removerDaFila,
};
