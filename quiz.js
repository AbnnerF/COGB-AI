const { gerarRespostaComPrompt } = require('./chatbot');

const sessoes = {};

function iniciarQuiz(chatId, criadorId) {
  sessoes[chatId] = {
    criadorId,
    etapa: 'publico',
    publico: null,
    participantes: [],
    tema: null,
    dificuldade: null,
    quantidade: 0,
    perguntas: [],
    perguntaAtual: 0,
    respostas: {},
    esperandoConfirmacao: false,
    quizPublicado: false,
  };

  return sessoes[chatId];
}

function obterSessao(chatId) {
  return sessoes[chatId];
}

function apagarSessao(chatId) {
  delete sessoes[chatId];
}

async function gerarPergunta(tema, dificuldade, numero) {
  const prompt =
    `Crie a pergunta ${numero} de um quiz em português brasileiro.

Tema: ${tema}
Dificuldade: ${dificuldade}

Regras:
- Crie apenas UMA pergunta.
- Crie exatamente 4 alternativas.
- Apenas UMA alternativa pode ser correta.
- Não use pegadinhas injustas.
- Não coloque a resposta correta sempre na mesma posição.
- Responda SOMENTE neste formato JSON:

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

O campo "correta" deve ser o número da alternativa correta, de 1 a 4.`;

  try {
    const resposta = await gerarRespostaComPrompt(
      'Você é um criador profissional de quizzes. Siga exatamente o formato solicitado.',
      prompt
    );

    const limpo = resposta
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    const dados = JSON.parse(limpo);

    if (
      !dados.pergunta ||
      !Array.isArray(dados.alternativas) ||
      dados.alternativas.length !== 4 ||
      ![1, 2, 3, 4].includes(Number(dados.correta))
    ) {
      throw new Error('Formato de pergunta inválido');
    }

    return {
      pergunta: dados.pergunta,
      alternativas: dados.alternativas,
      correta: Number(dados.correta),
    };
  } catch (erro) {
    console.log('Erro ao gerar pergunta do quiz:', erro.message);
    return null;
  }
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

function adicionarParticipantes(chatId, ids) {
  const sessao = sessoes[chatId];

  if (!sessao) return false;

  for (const id of ids) {
    if (!sessao.participantes.includes(id)) {
      sessao.participantes.push(id);
    }
  }

  return true;
}

function iniciarRespostas(chatId) {
  const sessao = sessoes[chatId];

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

function registrarResposta(chatId, usuarioId, resposta) {
  const sessao = sessoes[chatId];

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

function resultadoJogador(chatId, usuarioId) {
  const sessao = sessoes[chatId];

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

module.exports = {
  iniciarQuiz,
  obterSessao,
  apagarSessao,
  gerarPergunta,
  formatarPergunta,
  adicionarParticipantes,
  iniciarRespostas,
  registrarResposta,
  resultadoJogador,
};
