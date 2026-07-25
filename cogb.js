const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'cogb.json');

// Garante que o arquivo de dados existe
function ensureFile() {
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
    data[userId] = { name: name || userId, cogb: 0 };
  } else if (name) {
    data[userId].name = name; // mantém o nome atualizado
  }
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

// Monta o texto com a lista de todos os membros e seus COGB, do maior pro menor
function formatList() {
  const data = loadData();
  const entries = Object.entries(data);

  if (entries.length === 0) {
    return '📊 *COGB do grupo*\n\nAinda não há registros de ninguém.';
  }

  entries.sort((a, b) => b[1].cogb - a[1].cogb);

  let texto = '📊 *COGB do grupo* (chances de banimento)\n\n';
  for (const [, info] of entries) {
    texto += `${barraDeRisco(info.cogb)} ${info.name}: *${info.cogb}%*\n`;
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
};
