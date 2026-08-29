const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'pokemon_players.json');
fs.mkdirSync(DATA_DIR, { recursive: true });

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return {}; }
}
function save(data) { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }

const SPECIES = {
  Bulbasaur: { emoji: '🌱', hp: 45, attack: 49, type: 'Planta/Veneno' },
  Charmander: { emoji: '🔥', hp: 39, attack: 52, type: 'Fogo' },
  Squirtle: { emoji: '💧', hp: 44, attack: 48, type: 'Água' },
};

function getPlayer(id, name) {
  const db = load();
  if (!db[id]) db[id] = { id, name: name || id.split('@')[0], pokecoins: 0, location: 'Cidade de Pallet', inicial: null, equipe: [] };
  if (name) db[id].name = name;
  save(db);
  return db[id];
}

function chooseStarter(id, name, species) {
  const db = load();
  const p = db[id] || { id, name, pokecoins: 0, location: 'Cidade de Pallet', inicial: null, equipe: [] };
  if (p.inicial) return p.inicial;
  const s = SPECIES[species];
  if (!s) throw new Error('Inicial inválido');
  p.inicial = { nome: species, emoji: s.emoji, tipo: s.type, level: 5, xp: 0, hp: s.hp + 20, maxHp: s.hp + 20, attack: s.attack };
  p.equipe = [p.inicial];
  db[id] = p; save(db); return p.inicial;
}

function profile(p) {
  return `🐾 *PERFIL POKÉMON*\n\n👤 Treinador: *${p.name}*\n📍 Local: *${p.location}*\n🪙 PokéCoins: *${p.pokecoins}*\n\n${p.inicial.emoji} *${p.inicial.nome}*\n🔹 Tipo: ${p.inicial.tipo}\n⭐ Nível: ${p.inicial.level}\n✨ XP: ${p.inicial.xp}\n❤️ HP: ${p.inicial.hp}/${p.inicial.maxHp}`;
}
function team(id, name) {
  const p = getPlayer(id, name);
  if (!p.equipe.length) return '🐾 Você ainda não escolheu seu Pokémon inicial. Use */pokemon*.';
  return `📦 *SEUS POKÉMON*\n\n${p.equipe.map((x,i)=>`${i+1}. ${x.emoji} *${x.nome}* — Nv. ${x.level} — ❤️ ${x.hp}/${x.maxHp}`).join('\n')}`;
}
function map(id, name) {
  const p = getPlayer(id, name);
  return `🗺️ *MAPA DA REGIÃO*\n\n📍 Você está em: *${p.location}*\n\n🧭 Use */viajar* para explorar novas áreas.`;
}

module.exports = { getPlayer, chooseStarter, profile, team, map, SPECIES };
