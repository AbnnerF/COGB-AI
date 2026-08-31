const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'pokemon_players.json');
const STARTERS = [
  { nome: 'Bulbasaur', emoji: '🌱', tipo: 'Grama/Veneno', hp: 45 },
  { nome: 'Charmander', emoji: '🔥', tipo: 'Fogo', hp: 39 },
  { nome: 'Squirtle', emoji: '💧', tipo: 'Água', hp: 44 },
];
const WILD = [
  { nome:'Pidgey', emoji:'🐦', tipo:'Normal/Voador', hp:40, raridade:'Comum' },
  { nome:'Rattata', emoji:'🐭', tipo:'Normal', hp:35, raridade:'Comum' },
  { nome:'Caterpie', emoji:'🐛', tipo:'Inseto', hp:45, raridade:'Comum' },
  { nome:'Pikachu', emoji:'⚡', tipo:'Elétrico', hp:35, raridade:'Raro' },
  { nome:'Eevee', emoji:'🦊', tipo:'Normal', hp:55, raridade:'Raro' },
  { nome:'Growlithe', emoji:'🐕', tipo:'Fogo', hp:55, raridade:'Raro' },
  { nome:'Dratini', emoji:'🐉', tipo:'Dragão', hp:41, raridade:'Muito raro' },
];
const CIDADES = ['Cidade de Pallet','Rota 1','Cidade de Viridian','Floresta de Viridian','Cidade de Pewter','Caverna de Pewter'];

function carregar(){ try { if(!fs.existsSync(DATA_FILE)) return {}; return JSON.parse(fs.readFileSync(DATA_FILE,'utf8')) || {}; } catch(e){ console.log('Pokémon:',e.message); return {}; } }
let players = carregar();
function salvar(){ fs.mkdirSync(DATA_DIR,{recursive:true}); fs.writeFileSync(DATA_FILE,JSON.stringify(players,null,2)); }
function getPlayer(jid,nome){ if(!players[jid]) players[jid]={jid,nome:nome||'Treinador',nivelTreinador:1,xpTreinador:0,pokeCoins:0,cidade:CIDADES[0],inicial:null,pokemons:[],encontro:null,criadoEm:new Date().toISOString()}; if(nome) players[jid].nome=nome; if(typeof players[jid].inicial==='string'){ const st=starterByName(players[jid].inicial); if(st && !players[jid].pokemons?.length){ const poke={...st,level:5,nivel:5,xp:0,maxHp:st.hp,hp:st.hp,capturado:true}; players[jid].pokemons=[poke]; players[jid].inicial=poke; } else if(st){ players[jid].inicial=players[jid].pokemons?.[0] || st; } } salvar(); return players[jid]; }
function perfil(jid){ return players[jid] || null; }
function starterByName(nome){ return STARTERS.find(x=>x.nome.toLowerCase()===String(nome).toLowerCase()); }
function chooseStarter(jid,nome,escolha){ const p=getPlayer(jid,nome); if(p.inicial) return p.pokemons[0]; const s=starterByName(escolha); if(!s) throw new Error('Inicial inválido'); const poke={...s,level:5,nivel:5,xp:0,maxHp:s.hp,hp:s.hp,capturado:true}; p.inicial=poke;p.pokemons=[poke];salvar();return poke; }
function profile(p){ const x=p.pokemons[0]; if(!x) return `🐾 *BEM-VINDO AO MUNDO POKÉMON!*\n\nUse */choose 1*, */choose 2* ou */choose 3* para escolher seu inicial.`; return `╭━━〔 🐾 POKÉMON 〕━━╮\n┃ 👤 Treinador: ${p.nome}\n┃ 📍 Cidade: ${p.cidade}\n┃ ⭐ Nível: ${p.nivelTreinador}\n┃ ✨ XP: ${p.xpTreinador}\n┃ 🪙 PokéCoins: ${p.pokeCoins}\n╰━━━━━━━━━━━━━━━━━━╯\n\n${x.emoji} *${x.nome}* — Nível ${x.nivel}\n🔹 Tipo: ${x.tipo}\n❤️ HP: ${x.hp}/${x.maxHp}`; }
function team(jid,nome){ const p=getPlayer(jid,nome); if(!p.pokemons.length) return '🐾 Você ainda não escolheu um Pokémon. Use */choose 1*, */choose 2* ou */choose 3*.'; return `🐾 *EQUIPE DE ${p.nome}*\n\n${p.pokemons.map((x,i)=>`${i+1}. ${x.emoji} *${x.nome}* — Nv.${x.nivel} — ❤️ ${x.hp}/${x.maxHp}`).join('\n')}`; }
function map(jid,nome){ return `🗺️ *MAPA*\n\n📍 ${getPlayer(jid,nome).cidade}`; }
function viajar(jid,nome){ const p=getPlayer(jid,nome); if(!p.inicial) return {ok:false,text:'🐾 Escolha seu Pokémon inicial primeiro com */choose 1*, */choose 2* ou */choose 3*.'}; const i=(CIDADES.indexOf(p.cidade)+1+Math.floor(Math.random()*2))%CIDADES.length; p.cidade=CIDADES[i]; const chance=Math.random(); let encontro=null; if(chance<0.55){ const w=WILD[Math.floor(Math.random()*WILD.length)]; encontro={...w,level:Math.max(2,p.nivelTreinador+Math.floor(Math.random()*4)-1),maxHp:w.hp,hp:w.hp}; p.encontro=encontro; } else p.encontro=null; salvar(); return {ok:true,cidade:p.cidade,encontro}; }
function capturar(jid,nome){ const p=getPlayer(jid,nome); if(!p.encontro) return {ok:false,text:'🔎 Você não encontrou nenhum Pokémon agora. Use */viajar* primeiro.'}; const alvo=p.encontro; const chance=alvo.raridade==='Muito raro'?0.25:alvo.raridade==='Raro'?0.45:0.65; if(Math.random()>chance) return {ok:false,text:`💨 ${alvo.emoji} *${alvo.nome}* escapou da Pokébola! Tente novamente.`}; const novo={...alvo,nivel:alvo.level||5,xp:0,maxHp:alvo.maxHp,hp:alvo.maxHp,capturado:true}; p.pokemons.push(novo);p.encontro=null;p.pokeCoins+=5;salvar();return {ok:true,pokemon:novo}; }
function shop(jid,nome){ const p=getPlayer(jid,nome); const seed=new Date().getUTCDate()+new Date().getUTCHours(); const rng=(seed*9301+49297)%233280; const a=WILD[(rng+1)%WILD.length],b=WILD[(rng+3)%WILD.length],c=WILD[(rng+5)%WILD.length]; const ofertas=[a,b,c]; p.shop=ofertas.map((x,i)=>({...x,preco:20+i*15})); p.shopAt=new Date().toISOString();salvar();return `🛒 *LOJA POKÉMON*\n\n${p.shop.map((x,i)=>`${i+1}. ${x.emoji} *${x.nome}* — ${x.raridade}\n   🪙 ${x.preco} PokéCoins`).join('\n\n')}\n\n💰 Seu saldo: ${p.pokeCoins}\nUse */buy 1*, */buy 2* ou */buy 3*.`; }
function buy(jid,nome,n){ const p=getPlayer(jid,nome); if(!p.shop) shop(jid,nome); const i=Number(n)-1; const item=p.shop?.[i]; if(!item) return {ok:false,text:'❌ Oferta inválida. Use */shop* novamente.'}; if(p.pokeCoins<item.preco) return {ok:false,text:`🪙 Você precisa de ${item.preco} PokéCoins e tem ${p.pokeCoins}.`}; p.pokeCoins-=item.preco;p.pokemons.push({...item,level:5,nivel:5,xp:0,maxHp:item.hp,hp:item.hp,capturado:true});salvar();return {ok:true,text:`🎉 Você comprou ${item.emoji} *${item.nome}*!`}; }
function help(){ return `🐾 *AJUDA — POKÉMON BETA 0.1*\n\n/pokemon — perfil\n/choose 1-3 — inicial permanente\n/pokemons — equipe\n/mapa — cidade atual\n/viajar — explorar e encontrar Pokémon\n/capturar — tentar capturar o encontrado\n/shop — loja diária\n/buy 1-3 — comprar\n/help p — esta ajuda\n\n🚫 Arceus, os trios e os grandes lendários ficam para atualizações futuras.`; }
module.exports={STARTERS,getPlayer,perfil,chooseStarter,profile,team,map,viajar,capturar,shop,buy,help};
