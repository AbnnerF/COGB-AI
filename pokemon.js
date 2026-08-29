const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'pokemon_players.json');
const STARTERS = [
  { nome: 'Bulbasaur', emoji: '🌱', tipo: 'Grama/Veneno', hp: 45 },
  { nome: 'Charmander', emoji: '🔥', tipo: 'Fogo', hp: 39 },
  { nome: 'Squirtle', emoji: '💧', tipo: 'Água', hp: 44 },
];

function carregar() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) || {};
  } catch (e) {
    console.log('Pokémon: não foi possível ler os dados:', e.message);
    return {};
  }
}

let players = carregar();
function salvar() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(players, null, 2));
  } catch (e) {
    console.log('Pokémon: não foi possível salvar os dados:', e.message);
  }
}

function perfil(jid) { return players[jid] || null; }
function menuInicial() {
  return `🐾 *BEM-VINDO AO MUNDO POKÉMON!*

Sua jornada está prestes a começar.

🎒 Primeiro, escolha seu Pokémon inicial usando:
*/choose 1* — 🌱 Bulbasaur
*/choose 2* — 🔥 Charmander
*/choose 3* — 💧 Squirtle

⚠️ *Escolha com cuidado:* seu Pokémon inicial ficará registrado permanentemente na sua conta.`;
}

function criarStarter(starter) {
  return {
    nome: starter.nome,
    emoji: starter.emoji,
    tipo: starter.tipo,
    nivel: 5,
    xp: 0,
    hp: starter.hp,
    hpMax: starter.hp,
    capturado: true,
  };
}

function escolher(jid, escolha) {
  if (players[jid]) return { ok: false, motivo: 'ja_escolheu', player: players[jid] };
  const valor = String(escolha || '').trim().toLowerCase();
  let starter = null;
  if (/^[123]$/.test(valor)) starter = STARTERS[Number(valor) - 1];
  else starter = STARTERS.find(s => s.nome.toLowerCase() === valor);
  if (!starter) return { ok: false, motivo: 'invalido' };

  players[jid] = {
    jid,
    nivelTreinador: 1,
    xpTreinador: 0,
    pokeCoins: 0,
    cidade: 'Cidade de Pallet',
    inicial: starter.nome,
    pokemons: [criarStarter(starter)],
    criadoEm: new Date().toISOString(),
  };
  salvar();
  return { ok: true, player: players[jid], starter };
}

function textoPerfil(jid, nome) {
  const p = perfil(jid);
  if (!p) return menuInicial();
  const inicial = p.pokemons[0];
  return `╭━━━〔 🐾 POKÉMON 〕━━━╮
┃ 👤 Treinador: ${nome || 'Treinador'}
┃ 📍 Local: ${p.cidade}
┃ ⭐ Nível: ${p.nivelTreinador}
┃ ✨ XP: ${p.xpTreinador}
┃ 🪙 PokéCoins: ${p.pokeCoins}
╰━━━━━━━━━━━━━━━━━━━━╯

🌟 *Pokémon inicial:* ${inicial.emoji} ${inicial.nome}
🔹 Tipo: ${inicial.tipo}
⭐ Nível: ${inicial.nivel}
❤️ HP: ${inicial.hp}/${inicial.hpMax}`;
}

function textoHelp() {
  return `🐾 *AJUDA — SISTEMA POKÉMON BETA 0.1*

/pokemon — abre seu perfil Pokémon
/choose 1, 2 ou 3 — escolhe o inicial (uma única vez)
/mapa — mostra sua cidade atual
/viajar — começa a exploração
/pokemons — mostra sua equipe
/capturar — tenta capturar um Pokémon encontrado
/shop — abre a loja
/buy <número> — compra um item da loja
/h pokemon — inicia a história Pokémon

⚠️ Arceus, os trios e os grandes lendários ainda não estão disponíveis na Beta 0.1.`;
}

module.exports = {
  STARTERS,
  perfil,
  escolher,
  textoPerfil,
  textoHelp,
  menuInicial,
};
