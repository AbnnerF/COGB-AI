const { gerarRespostaComPrompt } = require('./chatbot');

const sessoes = {};

function iniciarQuiz(grupoId, criadorId, nomeGrupo = 'grupo') {
  sessoes[grupoId] = {
    grupoId,
    criadorId,
    nomeGrupo,
    etapa: 'publico',
    publico: null,
    participantes: [],
    tema: null,
    dificuldade: null,
    quantidade: 0,
    perguntas: [],
    perguntaAtual: 0,
    respostas: {},
    quizPublicado: false,
  };

  return sessoes[grupoId];
}

function obterSessao(grupoId) {
  return sessoes[grupoId];
}

function obterSessaoDoCriador(criadorId) {
  return Object.values(sessoes).find(
    (sessao) => sessao.criadorId === criadorId && !sessao.quizPublicado
  );
}

function apagarSessao(grupoId) {
  delete sessoes[grupoId];
}

function definirParticipantes(grupoId, participantes) {
  const sessao = sessoes[grupoId];

  if (!sessao) return false;

  sessao.participantes = [...new Set(participantes)];

  return true;
}

function adicionarParticipantes(grupoId, ids) {
  const sessao = sessoes[grupoId];

  if (!sessao) return false;

  for (const id of ids) {
    if (!sessao.participantes.includes(id)) {
      sessao.participantes.push(id);
    }
  }

  return true;
}

function formatarPergunta(pergunta, numero, total) {
  return (
    `🧠 *QUIZ — PERGUNTA ${numero}/${total}*\n\n` +
    `❓ *${pergunta.pergunta}*\n\n` +
    `1️⃣ ${pergunta.alternativas[0]}\n` +
    `2️⃣ ${pergunta.alternativas[1]}\n` +
    `3️⃣ ${pergunta.alternativas[2]}\n` +
    `4️⃣ ${pergunta.alternativas[3]}`
  );
}

async function gerarPergunta(tema, dificuldade, numero) {
  const prompt = `Crie a pergunta ${numero} de um quiz em português brasileiro.

Tema: ${tema}
Dificuldade: ${dificuldade}

Responda SOMENTE com JSON válido, sem markdown:

{
  "pergunta": "texto da pergunta",
  "alternativas": [
    "alternativa 1",
    "alternativa 2",
    "alternativa 3",
    "alternativa 4"
  ],
  "correta": 1
}

Regras:
- Exatamente 4 alternativas.
- Apenas uma alternativa correta.
- "correta" deve ser 1, 2, 3 ou 4.
- Não explique nada fora do JSON.`;

  try {
    const resposta = await gerarRespostaComPrompt(
      'Você é um criador profissional de quizzes. Gere perguntas claras e justas.',
      prompt
    );

    const limpo = String(resposta || '')
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    const inicio = limpo.indexOf('{');
    const fim = limpo.lastIndexOf('}');

    const dados = JSON.parse(
      inicio >= 0 && fim >= 0
        ? limpo.slice(inicio, fim + 1)
        : limpo
    );

    if (
      !dados.pergunta ||
      !Array.isArray(dados.alternativas) ||
      dados.alternativas.length !== 4 ||
      ![1, 2, 3, 4].includes(Number(dados.correta))
    ) {
      throw new Error('Formato de pergunta inválido');
    }

    return {
      pergunta: String(dados.pergunta),
      alternativas: dados.alternativas.map(String),
      correta: Number(dados.correta),
    };
  } catch (erro) {
    console.log(
      'Erro ao gerar pergunta do quiz:',
      erro.message
    );

    return null;
  }
}

function iniciarRespostas(grupoId) {
  const sessao = sessoes[grupoId];

  if (!sessao) return false;

  sessao.respostas = {};

  for (const participante of sessao.participantes) {
    sessao.respostas[participante] = {
      pergunta: 0,
      acertos: 0,
      terminado: false,
    };
  }

  sessao.quizPublicado = true;

  return true;
}

function registrarResposta(grupoId, usuarioId, resposta) {
  const sessao = sessoes[grupoId];

  if (!sessao || !sessao.quizPublicado) {
    return {
      erro: 'QUIZ_NAO_ATIVO',
    };
  }

  if (!sessao.respostas[usuarioId]) {
    return {
      erro: 'NAO_PARTICIPA',
    };
  }

  const jogador = sessao.respostas[usuarioId];

  if (jogador.terminado) {
    return {
      erro: 'JA_TERMINOU',
    };
  }

  const numero = Number(resposta);

  if (![1, 2, 3, 4].includes(numero)) {
    return {
      erro: 'RESPOSTA_INVALIDA',
    };
  }

  const pergunta = sessao.perguntas[jogador.pergunta];

  if (!pergunta) {
    jogador.terminado = true;

    return {
      erro: 'FINALIZADO',
    };
  }

  const acertou = numero === pergunta.correta;

  if (acertou) {
    jogador.acertos++;
  }

  jogador.pergunta++;

  if (jogador.pergunta >= sessao.perguntas.length) {
    jogador.terminado = true;
  }

  return {
    acertou,
    correta: pergunta.correta,
    perguntaAtual: jogador.pergunta,
    acertos: jogador.acertos,
    terminou: jogador.terminado,
    total: sessao.perguntas.length,
  };
}

function obterProximaPergunta(grupoId, usuarioId) {
  const sessao = sessoes[grupoId];

  if (!sessao || !sessao.respostas[usuarioId]) {
    return null;
  }

  const indice = sessao.respostas[usuarioId].pergunta;

  return sessao.perguntas[indice] || null;
}

function resultadoJogador(grupoId, usuarioId) {
  const sessao = sessoes[grupoId];

  if (!sessao || !sessao.respostas[usuarioId]) {
    return null;
  }

  const jogador = sessao.respostas[usuarioId];

  return {
    acertos: jogador.acertos,
    total: sessao.perguntas.length,
    terminou: jogador.terminado,
  };
}

function ranking(grupoId) {
  const sessao = sessoes[grupoId];

  if (!sessao) return [];

  return Object.entries(sessao.respostas)
    .map(([id, dados]) => ({
      id,
      acertos: dados.acertos,
      terminou: dados.terminado,
    }))
    .sort((a, b) => b.acertos - a.acertos);
}

module.exports = {
  iniciarQuiz,
  obterSessao,
  obterSessaoDoCriador,
  apagarSessao,
  definirParticipantes,
  adicionarParticipantes,
  gerarPergunta,
  formatarPergunta,
  iniciarRespostas,
  registrarResposta,
  obterProximaPergunta,
  resultadoJogador,
  ranking,
};
