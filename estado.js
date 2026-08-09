const fs = require('fs');
const path = require('path');

const PASTA_DADOS = path.join(__dirname, 'data');
const ARQUIVO_ESTADO = path.join(PASTA_DADOS, 'estado.json');

function garantirArquivo() {
  if (!fs.existsSync(PASTA_DADOS)) fs.mkdirSync(PASTA_DADOS, { recursive: true });
  if (!fs.existsSync(ARQUIVO_ESTADO)) {
    fs.writeFileSync(
      ARQUIVO_ESTADO,
      JSON.stringify(
        { contatosBoasVindas: [], contatosAvisadosConvert: [], gruposStatus: {}, filaAutorizacao: [] },
        null,
        2
      )
    );
  }
}

function carregarEstado() {
  garantirArquivo();
  const dados = JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf-8'));
  if (!dados.contatosAvisadosConvert) dados.contatosAvisadosConvert = []; // compatibilidade com estado antigo
  return dados;
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

// --- Aviso da função /convert (uma vez por pessoa) ---

function jaFoiAvisadoConvert(id) {
  return carregarEstado().contatosAvisadosConvert.includes(id);
}

function marcarAvisoConvert(id) {
  const estado = carregarEstado();
  if (!estado.contatosAvisadosConvert.includes(id)) {
    estado.contatosAvisadosConvert.push(id);
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

// Diz se esse grupo já teve status registrado alguma vez (autorizado, pendente ou negado),
// pra não pedir autorização de novo pra um grupo que já foi processado antes
function temStatusRegistrado(chatId) {
  const estado = carregarEstado();
  return Object.prototype.hasOwnProperty.call(estado.gruposStatus, chatId);
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
  jaFoiAvisadoConvert,
  marcarAvisoConvert,
  statusDoGrupo,
  temStatusRegistrado,
  definirStatusGrupo,
  adicionarNaFila,
  proximoDaFila,
  removerDaFila,
};
