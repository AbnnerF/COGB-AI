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
        {
          contatosBoasVindas: [],
          contatosAvisadosConvert: [],
          gruposStatus: {},
          filaAutorizacao: [],
          donoId: null,
          rpgGrupos: {},
          jogadores: {},
        },
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
  if (dados.donoId === undefined) dados.donoId = null; // compatibilidade com estado antigo
  if (!dados.rpgGrupos) dados.rpgGrupos = {}; // compatibilidade com estado antigo
  if (!dados.jogadores) dados.jogadores = {}; // compatibilidade com estado antigo
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

// --- Dono/criador do bot ---

function definirDono(id) {
  const estado = carregarEstado();
  estado.donoId = id;
  salvarEstado(estado);
}

function ehDono(id) {
  return carregarEstado().donoId === id;
}

function obterDono() {
  return carregarEstado().donoId;
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

function listarGrupos() {
  return carregarEstado().gruposStatus;
}

// --- Sistema de RPG (ativado por grupo, via /RPG) ---

function rpgAtivoNoGrupo(chatId) {
  return Boolean(carregarEstado().rpgGrupos[chatId]);
}

// Liga/desliga o RPG nesse grupo. Retorna o novo estado (true = ativado).
function alternarRpgNoGrupo(chatId) {
  const estado = carregarEstado();
  const novoValor = !estado.rpgGrupos[chatId];
  estado.rpgGrupos[chatId] = novoValor;
  salvarEstado(estado);
  return novoValor;
}

// --- Jogadores (XP, nível, vitórias/derrotas) ---

function xpParaNivel(xp) {
  return Math.floor(xp / 100) + 1;
}

function obterJogador(id, nomeFallback) {
  const estado = carregarEstado();
  const jogador = estado.jogadores[id] || {
    nome: nomeFallback || id,
    xp: 0,
    vitorias: 0,
    derrotas: 0,
    comandosUsados: 0,
  };
  if (nomeFallback) jogador.nome = nomeFallback;
  return jogador;
}

// Soma XP pro jogador (e conta como mais um comando usado). Retorna dados sobre o nível.
function adicionarXp(id, nomeFallback, quantidade) {
  const estado = carregarEstado();
  const jogador = estado.jogadores[id] || {
    nome: nomeFallback || id,
    xp: 0,
    vitorias: 0,
    derrotas: 0,
    comandosUsados: 0,
  };

  const nivelAntigo = xpParaNivel(jogador.xp);
  jogador.xp += quantidade;
  jogador.comandosUsados += 1;
  if (nomeFallback) jogador.nome = nomeFallback;
  const nivelNovo = xpParaNivel(jogador.xp);

  estado.jogadores[id] = jogador;
  salvarEstado(estado);

  return { jogador, nivelAntigo, nivelNovo, subiuDeNivel: nivelNovo > nivelAntigo };
}

// Registra o resultado de um duelo entre dois jogadores
function registrarDuelo(vencedorId, nomeVencedor, perdedorId, nomePerdedor) {
  const estado = carregarEstado();

  const vencedor = estado.jogadores[vencedorId] || {
    nome: nomeVencedor,
    xp: 0,
    vitorias: 0,
    derrotas: 0,
    comandosUsados: 0,
  };
  const perdedor = estado.jogadores[perdedorId] || {
    nome: nomePerdedor,
    xp: 0,
    vitorias: 0,
    derrotas: 0,
    comandosUsados: 0,
  };

  vencedor.nome = nomeVencedor;
  vencedor.vitorias += 1;
  vencedor.comandosUsados += 1;
  vencedor.xp += 30;

  perdedor.nome = nomePerdedor;
  perdedor.derrotas += 1;
  perdedor.xp += 10;

  estado.jogadores[vencedorId] = vencedor;
  estado.jogadores[perdedorId] = perdedor;
  salvarEstado(estado);
}

module.exports = {
  jaRecebeuBoasVindas,
  marcarBoasVindas,
  jaFoiAvisadoConvert,
  marcarAvisoConvert,
  definirDono,
  ehDono,
  obterDono,
  statusDoGrupo,
  temStatusRegistrado,
  definirStatusGrupo,
  adicionarNaFila,
  proximoDaFila,
  removerDaFila,
  listarGrupos,
  rpgAtivoNoGrupo,
  alternarRpgNoGrupo,
  xpParaNivel,
  obterJogador,
  adicionarXp,
  registrarDuelo,
};

