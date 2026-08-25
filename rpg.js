const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'rpg_data.json');
let data = { enabled: false, mainGroup: null, groups: {}, players: {}, enemies: {}, battles: {}, stories: {} };

function load(){ try { if(fs.existsSync(FILE)){ const x=JSON.parse(fs.readFileSync(FILE,'utf8')); data={...data,...x}; } } catch(e){ console.log('Erro ao carregar rpg_data.json:',e.message); } }
function save(){ try{ fs.writeFileSync(FILE, JSON.stringify(data,null,2)); }catch(e){ console.log('Erro ao salvar rpg_data.json:',e.message); } }
function activate(groupId){ data.enabled=true; data.mainGroup=groupId; save(); }
function deactivate(){ data.enabled=false; save(); }
function isEnabled(){ return !!data.enabled; }
function setGroupRole(groupId, role){ if(!data.groups[groupId]) data.groups[groupId]={}; data.groups[groupId].role=role; save(); }
function getGroupRole(groupId){ return data.groups[groupId]?.role || null; }
function ensurePlayer(id,nome){ if(!data.players[id]) data.players[id]={id,nome:nome||id.split('@')[0],xp:0,nivel:1,hp:100,maxHp:100,energia:100,habilidades:[{nome:'Golpe Rápido',dano:12,precisao:0.85}],inventario:{'Poção de Cura':2},vitorias:0,derrotas:0}; if(nome) data.players[id].nome=nome; return data.players[id]; }
function xpNecessario(nivel){ return nivel*100; }
function addXp(id,nome,quantidade){ const p=ensurePlayer(id,nome); const antigo=p.nivel; p.xp=Math.max(0,p.xp+Math.max(0,Number(quantidade)||0)); while(p.xp>=xpNecessario(p.nivel)){ p.xp-=xpNecessario(p.nivel); p.nivel++; p.maxHp+=15; p.hp=p.maxHp; p.energia=100; p.habilidades.push({nome:`Habilidade Nv.${p.nivel}`,dano:10+p.nivel*4,precisao:0.78}); } save(); return {player:p,nivelAntigo:antigo,nivelNovo:p.nivel,subiu:antigo!==p.nivel}; }
function inventory(id,nome){ return ensurePlayer(id,nome).inventario; }
function addItem(id,nome,item,qtd=1){ const inv=inventory(id,nome); inv[item]=(inv[item]||0)+qtd; save(); }
function useItem(id,nome,item){ const inv=inventory(id,nome); if(!inv[item]) return false; inv[item]--; if(inv[item]<=0) delete inv[item]; save(); return true; }
function playerProfile(id,nome){ return ensurePlayer(id,nome); }
function registerEnemy(groupId, enemy){ if(!data.enemies[groupId]) data.enemies[groupId]=[]; const e={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),nome:enemy.nome||'Monstro',maxHp:Number(enemy.maxHp)||50,hp:Number(enemy.maxHp)||50,dano:Number(enemy.dano)||8,velocidade:Number(enemy.velocidade)||5,precisao:Number(enemy.precisao)||0.75,ataques:Array.isArray(enemy.ataques)&&enemy.ataques.length?enemy.ataques:[{nome:'Golpe',dano:Number(enemy.dano)||8,precisao:Number(enemy.precisao)||0.75}]}; data.enemies[groupId].push(e); save(); return e; }
function enemies(groupId){ return data.enemies[groupId]||[]; }
function averageLevel(){ const ps=Object.values(data.players); if(!ps.length)return 1; return Math.max(1,Math.round(ps.reduce((a,p)=>a+p.nivel,0)/ps.length)); }
function generateEnemy(groupId){ const lvl=averageLevel(); const nomes=['Goblin','Lobo Sombrio','Slime Arcano','Orc Guerreiro','Aranha Gigante','Cavaleiro Corrompido','Dragão Jovem']; const nome=nomes[Math.min(nomes.length-1,Math.floor((lvl-1)/2))]; const hp=45+lvl*18; const dano=6+lvl*3; return registerEnemy(groupId,{nome,maxHp:hp,dano,velocidade:5+Math.min(8,lvl),precisao:0.68+Math.min(.18,lvl*.01),ataques:[{nome:'Ataque',dano,precisao:.7+Math.min(.18,lvl*.01)},{nome:'Golpe Brutal',dano:dano+lvl*2,precisao:.55}]}); }
function startBattle(groupId, enemyId, party){ let e=(enemies(groupId).find(x=>x.id===enemyId)||enemies(groupId)[0]); if(!e) e=generateEnemy(groupId); const players=party.map(x=>{const p=ensurePlayer(x.id,x.nome); return {id:x.id,nome:p.nome};}); data.battles[groupId]={enemy:JSON.parse(JSON.stringify(e)),party:players,turn:0,log:[]}; save(); return data.battles[groupId]; }
function battle(groupId){ return data.battles[groupId]||null; }
function endBattle(groupId){ delete data.battles[groupId]; save(); }
function storyStart(groupId, creator){ data.stories[groupId]={active:true,creator,party:[],scene:0}; save(); return data.stories[groupId]; }
function story(groupId){ return data.stories[groupId]||null; }
function setStoryParty(groupId,party){ if(!data.stories[groupId]) return null; data.stories[groupId].party=party.map(x=>x.id); save(); return data.stories[groupId]; }
function allGroupIds(role){ return Object.entries(data.groups).filter(([,v])=>v.role===role).map(([id])=>id); }
load();
module.exports={activate,deactivate,isEnabled,setGroupRole,getGroupRole,allGroupIds,ensurePlayer,addXp,inventory,addItem,useItem,playerProfile,registerEnemy,enemies,generateEnemy,averageLevel,startBattle,battle,endBattle,storyStart,story,setStoryParty,xpNecessario};
