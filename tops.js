const fs = require('fs');
const path = require('path');

// Ranking das brincadeiras, separado por grupo.
// O arquivo é criado automaticamente na primeira vitória.
const ARQUIVO = path.join(__dirname, 'tops.json');

let dados = {};

function carregar() {
  try {
    if (fs.existsSync(ARQUIVO)) {
      const bruto = fs.readFileSync(ARQUIVO, 'utf8');
      dados = bruto.trim() ? JSON.parse(bruto) : {};
    }
  } catch (err) {
    console.log('Erro ao carregar tops.json:', err.message);
    dados = {};
  }
}

function salvar() {
  try {
    fs.writeFileSync(ARQUIVO, JSON.stringify(dados, null, 2));
  } catch (err) {
    console.log('Erro ao salvar tops.json:', err.message);
  }
}

function garantirJogador(grupoId, jogadorId, nome) {
  if (!dados[grupoId]) dados[grupoId] = {};
  if (!dados[grupoId][jogadorId]) {
    dados[grupoId][jogadorId] = {
      nome: nome || jogadorId.split('@')[0],
      total: 0,
      forca: 0,
      quiz: 0,
      duelo: 0,
      outras: 0,
    };
  }

  if (nome) dados[grupoId][jogadorId].nome = nome;
  return dados[grupoId][jogadorId];
}

function registrarVitoria(grupoId, jogadorId, nome, categoria = 'outras') {
  if (!grupoId || !jogadorId) return;

  const jogador = garantirJogador(grupoId, jogadorId, nome);
  const categoriaValida = ['forca', 'quiz', 'duelo', 'outras'].includes(categoria)
    ? categoria
    : 'outras';

  jogador.total += 1;
  jogador[categoriaValida] += 1;
  salvar();
}

function obterRanking(grupoId, categoria = 'total') {
  const jogadores = Object.values(dados[grupoId] || {});
  const campo = ['total', 'forca', 'quiz', 'duelo', 'outras'].includes(categoria)
    ? categoria
    : 'total';

  return jogadores
    .filter((j) => Number(j[campo]) > 0)
    .sort((a, b) => {
      if (b[campo] !== a[campo]) return b[campo] - a[campo];
      return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    });
}

function nomeCategoria(categoria) {
  return {
    total: '🏆 TOP GERAL',
    forca: '💀 TOP FORCA',
    quiz: '🧠 TOP QUIZ',
    duelo: '⚔️ TOP DUELOS',
    outras: '🎮 TOP OUTRAS BRINCADEIRAS',
  }[categoria] || '🏆 TOP GERAL';
}

function formatarRanking(grupoId, categoria = 'total') {
  const ranking = obterRanking(grupoId, categoria);
  const titulo = nomeCategoria(categoria);

  if (!ranking.length) {
    return `${titulo}\n\nAinda não existem vitórias registradas nessa categoria. 😅\n\nJoguem alguma brincadeira para começar o ranking!`;
  }

  const linhas = [`╔══════════════════════╗`, `     ${titulo}`, `╚══════════════════════╝`, ''];
  const campo = ['total', 'forca', 'quiz', 'duelo', 'outras'].includes(categoria) ? categoria : 'total';
  const medalhas = ['🥇', '🥈', '🥉'];

  ranking.slice(0, 10).forEach((jogador, index) => {
    const medalha = medalhas[index] || `${index + 1}º`;
    linhas.push(`${medalha} *${jogador.nome}* — *${jogador[campo]}* vitória${jogador[campo] === 1 ? '' : 's'}`);
  });

  linhas.push('');
  linhas.push(`📊 Mostrando os ${Math.min(10, ranking.length)} melhores jogadores.`);
  return linhas.join('\n');
}

function obterJogador(grupoId, jogadorId) {
  return dados[grupoId]?.[jogadorId] || null;
}

carregar();

module.exports = {
  registrarVitoria,
  obterRanking,
  formatarRanking,
  obterJogador,
};
