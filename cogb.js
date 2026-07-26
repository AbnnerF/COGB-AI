const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'cogb.json');

// Garante que a pasta e o arquivo de dados existem
function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
  }
}

function loadData() {
  ensureFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Garante que o usuário existe no banco de dados
function ensureUser(data, userId, name) {
  if (!data[userId]) {
    data[userId] = { name: name || userId, cogb: 0, ultimaViolacao: null, chatId: null };
  } else {
    if (name) data[userId].name = name; // mantém o nome atualizado
    if (data[userId].ultimaViolacao === undefined) data[userId].ultimaViolacao = null;
    if (data[userId].chatId === undefined) data[userId].chatId = null;
  }
}

// Registra uma violação: aumenta o COGB e marca a data, pra resetar a contagem de "bom comportamento"
function registrarViolacao(userId, name, delta, chatId) {
  const data = loadData();
  ensureUser(data, userId, name);

  let novoValor = data[userId].cogb + delta;
  if (novoValor > 100) novoValor = 100;

  data[userId].cogb = novoValor;
  data[userId].ultimaViolacao = Date.now();
  data[userId].chatId = chatId;
  saveData(data);

  return novoValor;
}

// Quantos dias sem violação são necessários pra começar a reduzir o COGB, e quanto reduz por vez
const DIAS_SEM_VIOLACAO_PARA_DESCER = 30; // ~1 mês de bom comportamento
const QUANTIDADE_QUE_DESCE = 5;

// Roda periodicamente: reduz o COGB de quem ficou tempo suficiente sem nenhuma violação nova.
// Retorna a lista de pessoas cujo COGB baixou, pra o bot poder avisar elas no grupo.
function aplicarDecaimentoAutomatico() {
  const data = loadData();
  const agora = Date.now();
  const limiteMs = DIAS_SEM_VIOLACAO_PARA_DESCER * 24 * 60 * 60 * 1000;
  const atualizados = [];

  for (const [userId, info] of Object.entries(data)) {
    if (info.cogb <= 0) continue;
    if (!info.ultimaViolacao) continue; // nunca violou nada, não tem o que "descer" por tempo
    if (agora - info.ultimaViolacao < limiteMs) continue;

    const novoValor = Math.max(0, info.cogb - QUANTIDADE_QUE_DESCE);
    data[userId].cogb = novoValor;
    // adia a próxima redução, senão desceria de novo amanhã
    data[userId].ultimaViolacao = agora - limiteMs + 24 * 60 * 60 * 1000;

    atualizados.push({ id: userId, name: info.name, novoValor, chatId: info.chatId });
  }

  saveData(data);
  return atualizados;
}

// Aumenta ou diminui o COGB de um usuário, sempre entre 0 e 100
function updateCogb(userId, name, delta) {
  const data = loadData();
  ensureUser(data, userId, name);

  let novoValor = data[userId].cogb + delta;
  if (novoValor > 100) novoValor = 100;
  if (novoValor < 0) novoValor = 0;

  data[userId].cogb = novoValor;
  saveData(data);

  return novoValor;
}

function getUserCogb(userId) {
  const data = loadData();
  return data[userId] ? data[userId].cogb : 0;
}

// Monta o texto com a lista de todos os membros do grupo e seus COGB, do maior pro menor.
// participantes: array de { id, name } vindo do grupo do WhatsApp
function formatList(participantes) {
  const data = loadData();

  if (!participantes || participantes.length === 0) {
    return '📊 *COGB do grupo*\n\nNão consegui ler a lista de membros do grupo.';
  }

  const linhas = participantes.map((p) => {
    const registro = data[p.id];
    return {
      name: registro?.name || p.name,
      cogb: registro ? registro.cogb : 0,
    };
  });

  linhas.sort((a, b) => b.cogb - a.cogb);

  let texto = '📊 *COGB do grupo* (chances de banimento)\n\n';
  for (const linha of linhas) {
    texto += `${barraDeRisco(linha.cogb)} ${linha.name}: *${linha.cogb}%*\n`;
  }
  return texto;
}

// Emoji visual simples de acordo com o nível de risco
function barraDeRisco(valor) {
  if (valor >= 80) return '🔴';
  if (valor >= 50) return '🟠';
  if (valor >= 20) return '🟡';
  return '🟢';
}

module.exports = {
  updateCogb,
  getUserCogb,
  formatList,
  registrarViolacao,
  aplicarDecaimentoAutomatico,
};
