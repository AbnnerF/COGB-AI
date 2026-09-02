require('dotenv').config();
const pino = require('pino');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { gerarResposta, gerarRespostaComPrompt } = require('./chatbot');
const {
  gerarFigurinha,
  gerarPackDeFigurinhas,
  adicionarMetadados,
  pesquisarPacksStickerLy,
  buscarFigurinhasPorTema,
  buscarPackCompletoPorTema,
  criarFigurinhaDeImagem,
  criarFigurinhaAnimada,
  converterFigurinhaParaImagem,
  converterFigurinhaParaVideo,
  converterVideoParaAudio,
  converterGifParaVideo,
  baixarAudioDoYoutube,
  gerarImagem,
  obterDimensoes,
  obterDuracao,
  ehDesproporcional,
  DURACAO_MAXIMA_FIGURINHA,
} = require('./sticker');
const {
  MENSAGEM_BOAS_VINDAS_PV,
  MENSAGEM_NOVA_FUNCAO_CONVERT,
  MENSAGEM_MENU,
  MENSAGEM_GRUPO_ATIVADO,
  MENSAGEM_GRUPO_PENDENTE,
  MENSAGEM_GRUPO_RECUSADO,
} = require('./mensagens');
const estado = require('./estado');
const tops = require('./tops');
const rpg = require('./rpg');
const pokemon = require('./pokemon');

const ADMIN_NUMBER = process.env.ADMIN_NUMBER; // número que autoriza o bot em novos grupos, ex: 5511999999999
const BOT_NUMBER = process.env.BOT_NUMBER; // número do chip que o bot vai usar, ex: 5511988887777


// -------------------- /PLAY + CORREÇÃO DE COMANDOS --------------------
// Procura uma música no YouTube mesmo quando o nome não está 100% correto.
function normalizarBuscaMusica(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function pontuarResultadoMusica(consulta, titulo) {
  const a = normalizarBuscaMusica(consulta).split(' ').filter(t => t.length > 1);
  const b = normalizarBuscaMusica(titulo).split(' ');
  if (!a.length || !b.length) return 0;
  let encontrados = 0;
  for (const token of a) {
    if (b.some(x => x === token || x.includes(token) || token.includes(x))) encontrados++;
  }
  return encontrados / a.length;
}

// Retorna os melhores candidatos do YouTube. Usamos mais de um resultado
// para saber quando a busca por nome está ambígua.
async function pesquisarMusicasNoYoutube(consulta, limite = 5) {
  const termo = String(consulta || '').trim();
  if (!termo) return [];

  try {
    const { stdout } = await execFileAsync('yt-dlp', [
      '--js-runtimes', 'node',
      '--flat-playlist',
      '--print', '%(id)s\t%(title)s',
      '--skip-download',
      '--playlist-end', String(limite),
      `ytsearch${limite}:${termo}`,
    ], { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });

    return stdout.trim().split(/\r?\n/).filter(Boolean).map(linha => {
      const [id, ...tituloPartes] = linha.split('\t');
      const titulo = tituloPartes.join('\t').trim();
      if (!id || !/^[\w-]{6,}$/.test(id)) return null;
      return { id, titulo: titulo || termo, url: `https://www.youtube.com/watch?v=${id}` };
    }).filter(Boolean).map(r => ({
      ...r,
      pontuacao: pontuarResultadoMusica(termo, r.titulo),
    })).sort((a, b) => b.pontuacao - a.pontuacao);
  } catch (err) {
    console.log('Erro ao pesquisar música no YouTube:', err.message);
    return [];
  }
}

async function pesquisarMusicaNoYoutube(consulta) {
  const resultados = await pesquisarMusicasNoYoutube(consulta, 5);
  return resultados[0] || null;
}

// Lê uma faixa do Spotify sem precisar de token: o endpoint oEmbed fornece
// título/artista, e depois usamos esses dados para localizar o áudio no YouTube.
async function obterDadosSpotify(url) {
  try {
    const resposta = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
    if (!resposta.ok) return null;
    const dados = await resposta.json();
    const titulo = String(dados.title || '').trim();
    const autor = String(dados.author_name || '').trim();
    if (!titulo) return null;
    return { titulo, autor, busca: `${titulo} ${autor}`.trim() };
  } catch (err) {
    console.log('Erro ao consultar Spotify:', err.message);
    return null;
  }
}

// Distância de edição simples para corrigir pequenos erros de digitação.
function distanciaLevenshtein(a, b) {
  a = String(a || '').toLowerCase();
  b = String(b || '').toLowerCase();
  const linha = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    let anterior = linha[0];
    linha[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const atual = linha[j];
      linha[j] = a[i - 1] === b[j - 1]
        ? anterior
        : Math.min(anterior + 1, linha[j] + 1, linha[j - 1] + 1);
      anterior = atual;
    }
  }
  return linha[b.length];
}

const COMANDOS_CORRIGIVEIS = [
  'menu', 'updates', 'update', 'bot', 'help', 'p', 'pokemon', 'choose', 'mapa', 'viajar', 'capturar', 'pokemons', 'play', 'audio', 'fig', 'forca', 'duelo', 'tops', 'top',
  'pack', 'packs', 'convert', 'quiz', 'party', 'feedback', 'ligado',
  'rpg', 'levels', 'inimigos', 'inimigo', 'historia', 'história', 'inventario', 'inventário', 'battle', 'party', 'create', 'cancel', 'perfil', 'hug', 'punch', 'kiss', 'kill', 'amongus', 'status', 'report', 'vote', 'skip', 'uno', 'comprar', 'compra', 'music', 'call', 'rate', 'roast', 'imagem', 'img',
];

function corrigirComandoDigitado(texto) {
  const valor = String(texto || '').trim();
  if (!valor.startsWith('/')) return valor;

  const partes = valor.split(/\s+/);
  const comandoOriginal = partes[0].slice(1).toLowerCase();
  if (!comandoOriginal) return valor;
  if (COMANDOS_CORRIGIVEIS.includes(comandoOriginal)) return valor;

  // Primeiro tenta corrigir apenas o nome do comando.
  let melhor = null;
  for (const candidato of COMANDOS_CORRIGIVEIS) {
    const distancia = distanciaLevenshtein(comandoOriginal, candidato);
    const limite = candidato.length <= 4 ? 1 : 2;
    if (distancia <= limite && (!melhor || distancia < melhor.distancia)) {
      melhor = { candidato, distancia };
    }
  }

  if (!melhor) return valor;
  partes[0] = `/${melhor.candidato}`;
  return partes.join(' ');
}

// Guarda quem pediu "/Create fig" e tá esperando mandar a foto (chave: "chatId:remetenteId")
const aguardandoFoto = {};

// Guarda o estado do /create pack por usuário/chat
// chave -> { fase: 'quantidade'|'nome'|'fotos', total, nomePack, packId, figurinhas, timeoutHandle }
const aguardandoPack = {};

// Guarda quem já mandou uma foto desproporcional e tá esperando escolher o formato
const aguardandoEscolhaFormato = {}; // chave -> { bufferImagem, legenda, timeoutHandle }

// Guarda quem pediu "/convert" e tá esperando mandar a figurinha
const aguardandoConversao = {}; // chave -> timeoutHandle

// Guarda quem pediu "/audio" e tá esperando mandar o vídeo (ou um link do YouTube)
const aguardandoAudio = {}; // chave -> timeoutHandle

// Guarda /play quando o nome da música ficou ambíguo e precisamos do artista.
const aguardandoArtistaPlay = {}; // chave -> { consulta, timeoutHandle }

// Reconhece links do YouTube (youtube.com/watch?v=... ou youtu.be/...)
const REGEX_YOUTUBE = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+\S*)/i;
const REGEX_SPOTIFY = /(https?:\/\/(?:open\.)?spotify\.com\/(?:intl-[^/]+\/)?track\/[A-Za-z0-9]+[^\s]*)/i;

// Sistema de QUIZ: cada criador pode ter um quiz ativo por vez.
// O estado fica em memória enquanto o bot está ligado.
const quizzesAtivos = {};
const rpgPendencias = {}; // escolhas de habilidade/alvo durante batalhas

// -------------------- MODO /BOT: PARTICIPANTE DO GRUPO --------------------
const conversasBot = {};
const botSilencioTimers = {};
const botCooldownAte = {};
const BOT_HISTORICO_MAX = 14;
const BOT_SILENCIO_MS = 5000;
const BOT_COOLDOWN_MS = 120000;

function botAtivo(chatId) {
  return Boolean(conversasBot[chatId]?.ativo);
}

function registrarConversaBot(chatId, nome, texto) {
  if (!chatId || !texto) return;
  const c = conversasBot[chatId] ||= { ativo: false, historico: [], ultimaMensagem: Date.now() };
  c.historico.push({ nome: String(nome || 'Pessoa'), texto: String(texto).slice(0, 800) });
  if (c.historico.length > BOT_HISTORICO_MAX) c.historico.splice(0, c.historico.length - BOT_HISTORICO_MAX);
  c.ultimaMensagem = Date.now();
}

function contextoBot(chatId) {
  return (conversasBot[chatId]?.historico || [])
    .map(x => `${x.nome}: ${x.texto}`)
    .join('\n');
}

function reiniciarTimerSilencio(sock, chatId) {
  if (!isGroupId(chatId) || !botAtivo(chatId)) return;
  clearTimeout(botSilencioTimers[chatId]);
  botSilencioTimers[chatId] = setTimeout(() => tentarFalaEspontanea(sock, chatId), BOT_SILENCIO_MS);
}

function isGroupId(id) { return typeof id === 'string' && id.endsWith('@g.us'); }

async function tentarFalaEspontanea(sock, chatId) {
  if (!botAtivo(chatId)) return;
  if (Date.now() < (botCooldownAte[chatId] || 0)) return;
  const c = conversasBot[chatId];
  if (!c || Date.now() - c.ultimaMensagem < BOT_SILENCIO_MS - 50) return;
  // O bot nem sempre entra na conversa: isso evita spam e deixa a presença mais natural.
  if (Math.random() > 0.28) return;

  try {
    const resposta = await gerarRespostaComPrompt(
      `Você é o Chaim-Bot, um participante virtual de um grupo de WhatsApp.\n` +
      `Fale em português brasileiro natural, como uma IA amigável e espontânea.\n` +
      `Não use gírias em excesso, não fale como malandro e não force emojis.\n` +
      `Você acompanha o contexto abaixo e pode entrar no assunto quando tiver algo útil, engraçado ou interessante a dizer.\n` +
      `Se não houver motivo natural para falar, responda exatamente SILENCIO.\n` +
      `Nunca diga que é humano; você é o Chaim-Bot.\n\nCONVERSA RECENTE:\n${contextoBot(chatId)}`,
      'Entre na conversa somente se houver um motivo natural. Se não houver, responda SILENCIO.'
    );
    if (!resposta || resposta.trim().toUpperCase() === 'SILENCIO') return;
    botCooldownAte[chatId] = Date.now() + BOT_COOLDOWN_MS;
    await enviarMsg(sock, chatId, { text: resposta.trim().slice(0, 1200) });
  } catch (err) {
    console.log('Erro na fala espontânea do /bot:', err.message);
  }
}

async function responderModoBot(sock, chatId, nomeRemetente, texto, mencionado = []) {
  const contexto = contextoBot(chatId);
  const resposta = await gerarRespostaComPrompt(
    `Você é o Chaim-Bot, um participante virtual de um grupo de WhatsApp.\n` +
    `Converse em português brasileiro de forma natural, clara e amigável.\n` +
    `Você pode brincar, opinar, explicar assuntos e acompanhar conversas.\n` +
    `Não fique preso a quem ativou o /bot: converse com qualquer membro.\n` +
    `Use poucas gírias e nunca fale como malandro. Não force emojis.\n` +
    `Se alguém perguntar algo, responda. Se o grupo estiver falando de um tema, acompanhe o tema.\n` +
    `Você pode mencionar que pode ajudar com comandos do Chaim-Bot, mas NÃO execute comandos inventados pela sua própria resposta.\n` +
    `Não invente informações sobre mensagens que não aparecem no contexto.\n\nCONVERSA RECENTE:\n${contexto}`,
    `${nomeRemetente} disse: ${texto}`
  );
  return resposta;
}


// -------------------- JOGO DA FORCA --------------------
// Um jogo ativo por grupo. O estado fica em memória enquanto o bot estiver ligado.
const forcasAtivas = {};

const BANCO_FORCA = [
  { categoria: '🎮 Jogos', palavras: ['SONIC', 'MARIO', 'MINECRAFT', 'ROBLOX', 'FORTNITE', 'POKEMON', 'TERRARIA', 'UNDERTALE', 'FNAF', 'ZELDA'] },
  { categoria: '🎬 Filmes', palavras: ['AVATAR', 'BATMAN', 'SUPERMAN', 'SHREK', 'TITANIC', 'MATRIX', 'GODZILLA', 'VENOM', 'DEADPOOL', 'HOMEMARANHA'] },
  { categoria: '📺 Séries', palavras: ['WANDINHA', 'STRANGERTHINGS', 'LOKI', 'FLASH', 'SUPERNATURAL', 'ARCANE', 'LOST', 'SMALLVILLE'] },
  { categoria: '🐉 Anime', palavras: ['NARUTO', 'GOKU', 'VEGETA', 'ONEPIECE', 'BLEACH', 'ICHIGO', 'SAITAMA', 'DEKU', 'TANJIRO', 'SUKUNA'] },
  { categoria: '🤪 Memes', palavras: ['TROLL', 'BRAINROT', 'MEME', 'SKIBIDI', 'GIGACHAD', 'PIPOCA', 'CAPIVARA'] },
];

function normalizarForca(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function sortearForca() {
  const grupo = BANCO_FORCA[Math.floor(Math.random() * BANCO_FORCA.length)];
  const palavra = grupo.palavras[Math.floor(Math.random() * grupo.palavras.length)];
  return { categoria: grupo.categoria, palavra, normalizada: normalizarForca(palavra) };
}

function mostrarPalavraForca(jogo) {
  return [...jogo.normalizada].map((letra) => jogo.letras.includes(letra) ? letra : '⬜').join(' ');
}

function mensagemForca(jogo, extra = '') {
  const errosMaximos = 6;
  const desenho = ['🪦', '😵', '😨', '😬', '😐', '🙂', '😎'][Math.min(jogo.erros, errosMaximos)];
  return (
    `🎮 *JOGO DA FORCA*\n\n` +
    `${desenho} Erros: *${jogo.erros}/${errosMaximos}*\n` +
    `🏷️ Categoria: *${jogo.categoria}*\n\n` +
    `🔤 *${mostrarPalavraForca(jogo)}*\n\n` +
    `🔠 Letras usadas: ${jogo.letras.length ? jogo.letras.join(', ') : 'nenhuma'}\n\n` +
    `${extra ? extra + '\n\n' : ''}` +
    `💡 Mande *uma letra* ou tente a palavra inteira.\n` +
    `🛑 Para cancelar: */cancel forca*`
  );
}

// Guarda os nomes dos contatos conforme o WhatsApp vai sincronizando
const contatosCache = {};

function salvarContato(contato) {
  const nome = contato.name || contato.notify || contato.verifiedName;
  if (contato.id && nome) {
    contatosCache[contato.id] = nome;
  }
}

// Espera 1 segundo antes de mandar uma mensagem, pra não parecer instantâneo/robótico
async function enviarMsg(sock, chatId, conteudo) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sock.sendMessage(chatId, conteudo);
}

// Envia um pacote de figurinhas de verdade (stickerPackMessage).
// O projeto usa a variante do Baileys com suporte nativo a sticker packs.
async function enviarPacoteDeFigurinhas(sock, chatId, figurinhas, nomePack, publisher = 'COGB-AI') {
  if (!Array.isArray(figurinhas) || !figurinhas.length) {
    throw new Error('O pack não possui figurinhas.');
  }

  const stickers = figurinhas.map((item) => ({
    data: item.buffer || item,
    emojis: item.emojis || ['🙂'],
    isAnimated: Boolean(item.isAnimated),
  }));

  const capa = stickers[0].data;

  return sock.sendMessage(chatId, {
    stickerPack: {
      name: String(nomePack || 'Meu Pack').slice(0, 100),
      publisher: String(publisher || 'COGB-AI').slice(0, 100),
      description: 'Pack criado pelo COGB-AI',
      cover: capa,
      stickers,
    },
  });
}

// -------------------- SISTEMA DE QUIZ --------------------

function quizChaveCriador(criadorId) {
  return `quiz:${criadorId}`;
}

function normalizarAlternativa(valor) {
  return String(valor || '').trim().toUpperCase().replace(/\s+/g, '');
}

function obterRespostasQuiz(texto) {
  const respostas = {};
  const linhas = String(texto || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const linha of linhas) {
    const match = linha.match(/^R([1-4])\s*[:\-]\s*(.+)$/i);
    if (match) respostas[`R${match[1]}`] = match[2].trim();
  }

  return respostas;
}

function formatarQuizBonito(quiz) {
  let texto = `╔══════════════════════════╗\n`;
  texto += `       🎮 *QUIZ DO CHAIM-BOT*       \n`;
  texto += `╚══════════════════════════╝\n\n`;
  texto += `📚 *${quiz.perguntas.length}/10 perguntas*\n`;
  texto += `👑 Criado por: @${quiz.criadorId.split('@')[0]}\n\n`;

  quiz.perguntas.forEach((pergunta, index) => {
    texto += `┏━━━〔 🧠 ${index + 1}/${quiz.perguntas.length} 〕━━━\n`;
    texto += `┃ *Pergunta:* ${pergunta.enunciado}\n`;
    texto += `┃\n`;
    texto += `┃ R1️⃣ ${pergunta.respostas.R1}\n`;
    texto += `┃ R2️⃣ ${pergunta.respostas.R2}\n`;
    texto += `┃ R3️⃣ ${pergunta.respostas.R3}\n`;
    texto += `┃ R4️⃣ ${pergunta.respostas.R4}\n`;
    texto += `┗━━━━━━━━━━━━━━━━━━━━\n\n`;
  });

  texto += `💬 *Como responder:*\n`;
  texto += `Envie o número da pergunta + R1/R2/R3/R4.\n`;
  texto += `Exemplo: *1:R2 2:R4 3:R1*\n\n`;
  texto += `📌 Você pode corrigir sua resposta enquanto o quiz estiver aberto.\n`;
  texto += `🏁 Quando todos terminarem, o criador deve enviar *confirm*.\n`;

  return texto;
}

function extrairRespostasParticipante(texto, quantidadePerguntas) {
  const respostas = {};
  const normalizado = String(texto || '').toUpperCase();
  const regex = /(?:Q)?(\d{1,2})\s*[:=\-]?\s*(R[1-4])\b/g;
  let match;

  while ((match = regex.exec(normalizado))) {
    const numero = Number(match[1]);
    if (numero >= 1 && numero <= quantidadePerguntas) respostas[numero] = match[2];
  }

  return respostas;
}

function idsUnicos(ids) {
  return [...new Set((ids || []).filter(Boolean))];
}

// ------------------ FIM DO SISTEMA DE QUIZ ------------------

async function publicarQuizNoGrupo(sock, quiz) {
  const chatId = quiz.grupoId;

  if (quiz.modoParticipacao === 'grupo') {
    try {
      const metadata = await sock.groupMetadata(chatId);
      const botId = sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
      quiz.participantes = metadata.participants
        .map((p) => p.id)
        .filter((id) => !botId || id !== botId);
    } catch (err) {
      console.log('Erro ao obter participantes do grupo para o quiz:', err.message);
      quiz.participantes = [];
    }
  }

  quiz.participantes = idsUnicos(quiz.participantes);
  quiz.respostasParticipantes = {};
  quiz.fase = 'emJogo';

  let textoJogo = formatarQuizBonito(quiz);
  textoJogo += `\n👥 *Participantes: ${quiz.participantes.length}*`;
  textoJogo += `\n\n⏳ *O quiz está valendo! Boa sorte!*`;

  try {
    await enviarMsg(sock, chatId, {
      text: textoJogo,
      mentions: quiz.participantes,
    });

    setTimeout(async () => {
      if (quiz.fase !== 'emJogo') return;
      try {
        await enviarMsg(sock, chatId, {
          text:
            `⏱️ *QUIZ PUBLICADO!*\n\n` +
            `Respondam todas as perguntas e, quando terminarem, o criador ` +
            `@${quiz.criadorId.split('@')[0]} deve enviar *confirm* aqui no grupo.\n\n` +
            `🏁 Depois do confirm eu vou mostrar quem acertou cada questão e qual era a resposta correta.`,
          mentions: [quiz.criadorId],
        });
      } catch (err) {
        console.log('Erro ao pedir confirmação do quiz:', err.message);
      }
    }, 5000);

    await enviarMsg(sock, quiz.criadorId, {
      text: '🚀 *Quiz publicado no grupo!*\n\nAgora aguarde o pessoal responder. Quando todos terminarem, escreva *confirm* no grupo para revelar os resultados.'
    });
  } catch (err) {
    console.log('Erro ao publicar quiz:', err.message);
    quiz.fase = 'confirmarPublicacao';
    await enviarMsg(sock, quiz.criadorId, {
      text: '❌ Não consegui publicar o quiz no grupo. Tente *CONFIRMAR* novamente.'
    });
  }
}

async function revelarResultadoQuiz(sock, quiz) {
  if (quiz.fase !== 'emJogo') return;

  quiz.fase = 'finalizando';
  const linhas = [
    `╔══════════════════════════╗`,
    `      🏆 *RESULTADO DO QUIZ*`,
    `╚══════════════════════════╝`,
    ``,
    `🎮 *${quiz.perguntas.length}/10 perguntas*`,
    ``
  ];
  const mentions = [];

  const pontuacoes = {};
  quiz.participantes.forEach((id) => { pontuacoes[id] = 0; });

  quiz.perguntas.forEach((pergunta, index) => {
    const numero = index + 1;
    const acertaram = [];
    const erraram = [];

    for (const participanteId of quiz.participantes) {
      const respostaDada = quiz.respostasParticipantes[participanteId]?.[numero];
      if (respostaDada === pergunta.correta) {
        acertaram.push(participanteId);
        pontuacoes[participanteId] = (pontuacoes[participanteId] || 0) + 1;
      } else {
        erraram.push(participanteId);
      }
    }

    const nomesAcertaram = acertaram.length
      ? acertaram.map((id) => `@${id.split('@')[0]}`).join(', ')
      : 'Ninguém 😢';
    const nomesErraram = erraram.length
      ? erraram.map((id) => `@${id.split('@')[0]}`).join(', ')
      : 'Ninguém 🎉';

    linhas.push(`┏━━━〔 🧠 ${numero}/${quiz.perguntas.length} 〕━━━`);
    linhas.push(`❓ ${pergunta.enunciado}`);
    linhas.push(``);
    linhas.push(`✅ *Resposta correta:* ${pergunta.correta} — ${pergunta.respostas[pergunta.correta]}`);
    linhas.push(``);
    linhas.push(`🏆 *Acertaram:* ${nomesAcertaram}`);
    linhas.push(`❌ *Erraram ou não responderam:* ${nomesErraram}`);
    linhas.push(`┗━━━━━━━━━━━━━━━━━━━━`);
    linhas.push(``);

    mentions.push(...acertaram, ...erraram);
  });

  const maiorPontuacao = Math.max(0, ...Object.values(pontuacoes));
  const vencedoresQuiz = maiorPontuacao > 0
    ? Object.entries(pontuacoes).filter(([, pontos]) => pontos === maiorPontuacao).map(([id]) => id)
    : [];

  linhas.push(`🎉 *Fim do quiz!*`);
  linhas.push(`👑 Criado por: @${quiz.criadorId.split('@')[0]}`);

  if (vencedoresQuiz.length) {
    const nomes = vencedoresQuiz.map((id) => `@${id.split('@')[0]}`).join(', ');
    linhas.push(`🏆 *Vencedor${vencedoresQuiz.length > 1 ? 'es' : ''}:* ${nomes}`);
    linhas.push(`⭐ ${maiorPontuacao}/${quiz.perguntas.length} acerto${maiorPontuacao === 1 ? '' : 's'}`);
    vencedoresQuiz.forEach((id) => {
      const nome = contatosCache[id] || id.split('@')[0];
      tops.registrarVitoria(quiz.grupoId, id, nome, 'quiz');
    });
    mentions.push(...vencedoresQuiz);
  } else {
    linhas.push(`😢 Ninguém acertou nenhuma pergunta, então não houve vitória no TOP.`);
  }

  mentions.push(quiz.criadorId);

  try {
    await enviarMsg(sock, quiz.grupoId, {
      text: linhas.join('\n'),
      mentions: idsUnicos(mentions),
    });
  } catch (err) {
    console.log('Erro ao revelar resultado do quiz:', err.message);
  }

  delete quizzesAtivos[quizChaveCriador(quiz.criadorId)];

  try {
    await enviarMsg(sock, quiz.criadorId, {
      text: '🏁 *Resultado revelado!* O quiz foi encerrado.'
    });
  } catch (err) {}
}

// Espera um tempo (parecendo "digitando...") antes de mandar a mensagem do chat casual (/Bot)

// Finaliza o pack quando todas as mídias já foram escolhidas/processadas.
async function finalizarPackCriado(sock, chatId, chaveEspera) {
  const sessaoPack = aguardandoPack[chaveEspera];
  if (!sessaoPack) return;

  delete aguardandoPack[chaveEspera];

  await enviarMsg(sock, chatId, {
    text: `🛠️ *Montando seu pacote de figurinhas...*\n\n📦 Nome: *${sessaoPack.nomePack}*\n🖼️ Mídias: *${sessaoPack.figurinhas.length}/${sessaoPack.total}*\n\nAguarde, vou transformar tudo e colocar em UM único pacote. 📦✨`,
  });

  const figurinhasProntas = [];

  for (const item of sessaoPack.figurinhas) {
    try {
      const webpBuffer = item.animada
        ? await criarFigurinhaAnimada(item.buffer, item.legenda, item.modo)
        : await criarFigurinhaDeImagem(item.buffer, item.legenda, item.modo);
      if (webpBuffer) {
        figurinhasProntas.push({ buffer: webpBuffer, emojis: ['🙂'] });
      }
    } catch (e) {
      console.log('Erro ao converter mídia do pack:', e.message);
    }
  }

  if (!figurinhasProntas.length) {
    await enviarMsg(sock, chatId, { text: '❌ Não consegui transformar as mídias em figurinhas.' });
    return;
  }

  try {
    await enviarPacoteDeFigurinhas(sock, chatId, figurinhasProntas, sessaoPack.nomePack, 'COGB-AI');
    await enviarMsg(sock, chatId, {
      text: `🎉 *Pacote criado e enviado!*\n\n📦 *${sessaoPack.nomePack}*\n🖼️ ${figurinhasProntas.length} figurinha(s)\n\nEle foi enviado como um pacote único.`,
    });
  } catch (e) {
    console.log('Erro ao enviar stickerPackMessage:', e.message);
    await enviarMsg(sock, chatId, {
      text: '❌ Não consegui enviar o pacote nativo. Verifique o Baileys e rode *npm install* novamente.',
    });
  }
}

// Processa uma única foto/vídeo do /create pack.
// Se for desproporcional, pausa e espera a escolha antes de tocar na próxima.
async function processarMidiaDoPack(sock, msg, chatId, chaveEspera) {
  const sessaoPack = aguardandoPack[chaveEspera];
  if (!sessaoPack) return;

  try {
    clearTimeout(sessaoPack.timeoutHandle);

    const bufferImagem = await downloadMediaMessage(msg, 'buffer', {});
    const ehVideoPack = Boolean(msg.message.videoMessage);
    const legenda = msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || '';

    if (ehVideoPack && !msg.message.videoMessage.gifPlayback) {
      const duracao = await obterDuracao(bufferImagem).catch(() => null);
      if (duracao && duracao > DURACAO_MAXIMA_FIGURINHA) {
        await enviarMsg(sock, chatId, {
          text: `🎬 Esse vídeo tem ${duracao.toFixed(1)}s. Vou usar somente os primeiros ${DURACAO_MAXIMA_FIGURINHA}s na figurinha animada.`,
        });
      }
    }

    const dimensoes = await obterDimensoes(bufferImagem).catch(() => null);

    if (dimensoes && ehDesproporcional(dimensoes)) {
      sessaoPack.fase = 'escolhendo_formato';
      sessaoPack.midiaPendente = {
        buffer: bufferImagem,
        legenda,
        animada: ehVideoPack,
      };
      sessaoPack.processandoMidia = false;
      sessaoPack.timeoutHandle = setTimeout(() => { delete aguardandoPack[chaveEspera]; }, 5 * 60 * 1000);

      await enviarMsg(sock, chatId, {
        text: `Essa ${ehVideoPack ? 'mídia/vídeo' : 'imagem'} não é quadrada! Como você quer esta figurinha?\n\n1️⃣ Recortada\n2️⃣ Original\n3️⃣ Esticada\n\nResponda com *1*, *2* ou *3*.\n\n🛑 Para cancelar: */cancel pack*`,
      });
      return;
    }

    sessaoPack.figurinhas.push({
      buffer: bufferImagem,
      legenda,
      animada: ehVideoPack,
      modo: 'recortada',
    });

    const recebidas = sessaoPack.figurinhas.length;

    if (recebidas >= sessaoPack.total) {
      await finalizarPackCriado(sock, chatId, chaveEspera);
      return;
    }

    sessaoPack.processandoMidia = false;
    sessaoPack.fase = 'fotos';
    sessaoPack.timeoutHandle = setTimeout(() => { delete aguardandoPack[chaveEspera]; }, 10 * 60 * 1000);

    await enviarMsg(sock, chatId, {
      text: `✅ ${recebidas}/${sessaoPack.total} mídia(s) recebida(s)!\n\nManda a próxima foto ou vídeo. 📸🎬\n\nPara cancelar: */cancel pack*`,
    });

    const proxima = sessaoPack.filaMidias?.shift();
    if (proxima) {
      sessaoPack.processandoMidia = true;
      await processarMidiaDoPack(sock, proxima, chatId, chaveEspera);
    }
  } catch (err) {
    console.log('Erro ao receber mídia do pack:', err.message);
    sessaoPack.processandoMidia = false;
    sessaoPack.fase = 'fotos';
    sessaoPack.timeoutHandle = setTimeout(() => { delete aguardandoPack[chaveEspera]; }, 10 * 60 * 1000);
    await enviarMsg(sock, chatId, { text: '❌ Deu erro ao processar essa foto/vídeo. Tenta mandar novamente.' });
  }
}

async function iniciarBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
  });

  // Se ainda não estiver registrado e um BOT_NUMBER foi configurado,
  // pede um código de pareamento em vez do QR code (mais fácil no celular)
  if (BOT_NUMBER && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const codigo = await sock.requestPairingCode(BOT_NUMBER);
        console.log('\n🔑 Seu código de pareamento é: ' + codigo);
        console.log('No WhatsApp Business: Aparelhos conectados > Conectar com número de telefone > digite esse código.\n');
      } catch (err) {
        console.log('Erro ao gerar código de pareamento:', err.message);
      }
    }, 3000);
  }

  sock.ev.on('creds.update', saveCreds);

  // Vai guardando os nomes reais dos contatos conforme o WhatsApp sincroniza
  sock.ev.on('contacts.upsert', (contatos) => contatos.forEach(salvarContato));
  sock.ev.on('contacts.update', (contatos) => contatos.forEach(salvarContato));

  // Monta um relatório com todos os grupos conhecidos e o status de cada um
  async function gerarRelatorioGrupos() {
    const grupos = estado.listarGrupos();
    const entradas = Object.entries(grupos);

    if (entradas.length === 0) return '📋 Nenhum grupo registrado ainda.';

    let texto = '📋 *Grupos conhecidos:*\n\n';
    for (const [idGrupo, status] of entradas) {
      let nome = idGrupo;
      try {
        const metadata = await sock.groupMetadata(idGrupo);
        nome = metadata.subject || idGrupo;
      } catch (err) {
        // grupo pode ter sido apagado ou o bot removido de lá
      }
      const emoji = status === 'autorizado' ? '✅' : status === 'negado' ? '🚫' : '⏳';
      texto += `${emoji} ${nome} — _${status}_\n`;
    }
    return texto;
  }

  // Pede autorização ao admin quando o bot é adicionado a um grupo (ou entra num criado agora)
  async function pedirAutorizacaoDoGrupo(chatId, nomeGrupo) {
    if (estado.temStatusRegistrado(chatId)) return; // já processado antes, não pede de novo

    estado.definirStatusGrupo(chatId, 'pendente');
    estado.adicionarNaFila(chatId);

    try {
      await enviarMsg(sock, chatId, { text: MENSAGEM_GRUPO_PENDENTE });
    } catch (err) {
      console.log('Erro ao avisar grupo pendente:', err.message);
    }

    if (ADMIN_NUMBER) {
      try {
        await enviarMsg(sock, `${ADMIN_NUMBER}@s.whatsapp.net`, {
          text: `🤖 Fui adicionado no grupo *"${nomeGrupo}"*.\n\nPermite minha entrada nesse grupo? Responda *SIM* ou *NÃO*.`,
        });
      } catch (err) {
        console.log('Erro ao mandar DM de autorização pro admin:', err.message);
      }
    } else {
      console.log('ADMIN_NUMBER não está configurado no .env — não dá pra pedir autorização por DM.');
    }
  }

  // Caso 1: bot adicionado a um grupo que já existia
  sock.ev.on('group-participants.update', async (evento) => {
    try {
      if (evento.action !== 'add') return;

      const botBase = sock.user.id.split(':')[0].split('@')[0];
      const botFoiAdicionado = evento.participants.some((p) => p.split('@')[0] === botBase);
      if (!botFoiAdicionado) return;

      let nomeGrupo = 'um grupo';
      try {
        const metadata = await sock.groupMetadata(evento.id);
        nomeGrupo = metadata.subject || nomeGrupo;
      } catch (err) {
        // sem problema se não conseguir pegar o nome
      }

      await pedirAutorizacaoDoGrupo(evento.id, nomeGrupo);
    } catch (err) {
      console.log('Erro ao processar entrada em grupo:', err.message);
    }
  });

  // Caso 2: bot já entra num grupo recém-criado (o criador já bota o bot como membro inicial)
  sock.ev.on('groups.upsert', async (grupos) => {
    for (const grupo of grupos) {
      try {
        const chatId = grupo.id;
        if (estado.temStatusRegistrado(chatId)) continue; // já conhecido, ignora

        // só trata como "acabou de entrar" se o grupo foi criado há pouco tempo
        // (evita disparar autorização de novo pra grupos antigos sincronizados ao conectar)
        const criadoRecentemente = grupo.creation && Date.now() / 1000 - grupo.creation < 120;
        if (!criadoRecentemente) continue;

        await pedirAutorizacaoDoGrupo(chatId, grupo.subject || 'um grupo');
      } catch (err) {
        console.log('Erro ao processar grupo novo:', err.message);
      }
    }
  });

  // Mostra o QR code no terminal pra você escanear com o WhatsApp
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📱 Escaneie o QR code abaixo no seu WhatsApp:\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log('Motivo da desconexão (código):', statusCode, '-', lastDisconnect?.error?.message);
      const deveReconectar = statusCode !== DisconnectReason.loggedOut;
      console.log('Conexão fechada. Reconectando?', deveReconectar);
      if (deveReconectar) setTimeout(iniciarBot, 3000);
    } else if (connection === 'open') {
      console.log('✅ Bot conectado ao WhatsApp!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const chatId = msg.key.remoteJid; // grupo ou conversa
    const isGroup = chatId.endsWith('@g.us');

    // Comando especial: você (o dono) ativa um grupo pendente na mão, escrevendo
    // "/Ligado" direto no grupo usando o próprio WhatsApp Business do número do bot
    if (msg.key.fromMe) {
      const textoProprio = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
      const comandoProprio = textoProprio.trim().toLowerCase();

      if (isGroup && comandoProprio === '/ligado') {
        if (estado.statusDoGrupo(chatId) !== 'autorizado') {
          estado.definirStatusGrupo(chatId, 'autorizado');
          estado.removerDaFila(chatId);
          try {
            await enviarMsg(sock, chatId, { text: MENSAGEM_GRUPO_ATIVADO });
          } catch (err) {
            console.log('Erro ao ativar grupo manualmente:', err.message);
          }
        }
      }

      if (isGroup && comandoProprio === '/rpg') {
        rpg.activate(chatId);
        estado.alternarRpgNoGrupo(chatId);
        try { await enviarMsg(sock, chatId, { text: '⚔️🎮 *RPG da comunidade ativado!*\n\nEste grupo é a central do RPG. Agora outros grupos podem ser registrados com */levels*, */inimigos*, */historia*, */inventario* e */battle*.' }); } catch (err) { console.log('Erro ao ativar RPG:', err.message); }
      }

      return; // ignora o resto das próprias mensagens do bot
    }

    // Grupo ainda pendente ou recusado: bot fica quieto, não processa nada nesse grupo
    if (isGroup && estado.statusDoGrupo(chatId) !== 'autorizado') return;

    const remetenteId = msg.key.participant || msg.key.remoteJid;
    const nomeRemetente = contatosCache[remetenteId] || msg.pushName || remetenteId.split('@')[0];
    if (msg.pushName) contatosCache[remetenteId] = contatosCache[remetenteId] || msg.pushName;

    const chaveEspera = `${chatId}:${remetenteId}`;

    // Convite de grupo nativo (aquele card "Convite para grupo") mandado no privado do bot
    if (!isGroup && msg.message.groupInviteMessage) {
      const convite = msg.message.groupInviteMessage;
      const grupoJid = convite.groupJid;
      const nomeGrupo = convite.groupName || 'um grupo';

      try {
        await sock.groupAcceptInviteV4(remetenteId, convite);
        await pedirAutorizacaoDoGrupo(grupoJid, nomeGrupo);
        await enviarMsg(sock, chatId, {
          text: `✅ Entrei no grupo *"${nomeGrupo}"*! Vou pedir autorização antes de ativar minhas funções lá.`,
        });
      } catch (err) {
        console.log('Erro ao entrar no grupo via convite:', err.message);
        await enviarMsg(sock, chatId, {
          text: '❌ Não consegui entrar nesse grupo pelo convite. Ele pode estar expirado ou eu já fui removido de lá antes.',
        });
      }
      return;
    }

    // Se a pessoa já tinha pedido "/convert" e agora mandou a figurinha
    if (msg.message.stickerMessage && aguardandoConversao[chaveEspera]) {
      clearTimeout(aguardandoConversao[chaveEspera]);
      delete aguardandoConversao[chaveEspera];

      const ehAnimada = Boolean(msg.message.stickerMessage.isAnimated);
      const bufferFigurinha = await downloadMediaMessage(msg, 'buffer', {});

      try {
        await sock.sendPresenceUpdate('composing', chatId);
      } catch (err) {
        // sem problema se não conseguir mostrar "digitando"
      }

      const resultado = ehAnimada
        ? await converterFigurinhaParaVideo(bufferFigurinha)
        : await converterFigurinhaParaImagem(bufferFigurinha);

      if (!resultado) {
        await enviarMsg(sock, chatId, { text: 'Deu ruim pra converter essa figurinha 😕 tenta de novo' });
        return;
      }

      await enviarMsg(sock, chatId, ehAnimada ? { video: resultado } : { image: resultado });
      return;
    }

    // Se a pessoa já tinha pedido "/audio" e agora mandou o vídeo
    if (msg.message.videoMessage && aguardandoAudio[chaveEspera]) {
      clearTimeout(aguardandoAudio[chaveEspera]);
      delete aguardandoAudio[chaveEspera];

      const bufferVideo = await downloadMediaMessage(msg, 'buffer', {});

      try {
        await sock.sendPresenceUpdate('composing', chatId);
      } catch (err) {
        // sem problema se não conseguir mostrar "digitando"
      }

      const audio = await converterVideoParaAudio(bufferVideo);

      if (!audio) {
        await enviarMsg(sock, chatId, { text: 'Deu ruim pra extrair o áudio desse vídeo 😕 tenta de novo' });
        return;
      }

      await enviarMsg(sock, chatId, { audio, mimetype: 'audio/mpeg' });
      return;
    }

    // Se a pessoa está criando um pack e mandou uma foto/vídeo.
    // As mídias são processadas UMA POR VEZ, mesmo se a pessoa enviar várias de uma vez.
    if ((msg.message.imageMessage || msg.message.videoMessage) && aguardandoPack[chaveEspera]) {
      const sessaoPack = aguardandoPack[chaveEspera];

      // Se já estamos processando uma mídia ou esperando a escolha da anterior,
      // guarda as próximas na fila. Assim nunca aparecem várias perguntas 1/2/3 juntas.
      if (sessaoPack.processandoMidia || sessaoPack.fase === 'escolhendo_formato') {
        sessaoPack.filaMidias = sessaoPack.filaMidias || [];
        sessaoPack.filaMidias.push(msg);
        return;
      }

      if (sessaoPack.fase === 'fotos') {
        sessaoPack.processandoMidia = true;
        await processarMidiaDoPack(sock, msg, chatId, chaveEspera);
        return;
      }
    }

    // Se a pessoa já tinha pedido "/Create fig" e agora mandou uma foto, vídeo ou GIF
    if ((msg.message.imageMessage || msg.message.videoMessage) && aguardandoFoto[chaveEspera]) {
      clearTimeout(aguardandoFoto[chaveEspera]);
      delete aguardandoFoto[chaveEspera];

      const ehVideo = Boolean(msg.message.videoMessage);
      const legenda = msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || '';
      const bufferMidia = await downloadMediaMessage(msg, 'buffer', {});

      // Se for vídeo (não GIF) e for mais longo que o permitido, avisa que vai cortar
      if (ehVideo && !msg.message.videoMessage.gifPlayback) {
        const duracao = await obterDuracao(bufferMidia).catch(() => null);
        if (duracao && duracao > DURACAO_MAXIMA_FIGURINHA) {
          await enviarMsg(sock, chatId, {
            text: `Esse vídeo tem ${duracao.toFixed(1)}s, mas figurinha animada só aguenta até ${DURACAO_MAXIMA_FIGURINHA}s — vou cortar e usar só o começo dele.`,
          });
        }
      }

      const dimensoes = await obterDimensoes(bufferMidia).catch(() => null);

      // Se não é quadrado(a), pergunta como a pessoa quer o formato antes de criar
      if (dimensoes && ehDesproporcional(dimensoes)) {
        aguardandoEscolhaFormato[chaveEspera] = {
          bufferImagem: bufferMidia,
          legenda,
          animada: ehVideo,
          timeoutHandle: setTimeout(() => {
            delete aguardandoEscolhaFormato[chaveEspera];
          }, 5 * 60 * 1000),
        };

        await enviarMsg(sock, chatId, {
          text:
            `Essa ${ehVideo ? 'mídia' : 'imagem'} não é quadrada! Como você quer a figurinha?\n\n` +
            '1️⃣ Recortada — corta as bordas pra preencher tudo\n' +
            '2️⃣ Original — mantém a imagem inteira, com bordas\n' +
            '3️⃣ Esticada — estica pra preencher (pode distorcer um pouco)\n\n' +
            'Responde com o número ou o nome da opção.',
        });
        return;
      }

      try {
        await sock.sendPresenceUpdate('composing', chatId);
      } catch (err) {
        // sem problema se não conseguir mostrar "digitando"
      }

      const figurinha = ehVideo
        ? await criarFigurinhaAnimada(bufferMidia, legenda)
        : await criarFigurinhaDeImagem(bufferMidia, legenda);

      if (!figurinha) {
        await enviarMsg(sock, chatId, { text: 'Deu ruim pra criar a figurinha 😕 tenta de novo' });
        return;
      }

      await enviarMsg(sock, chatId, { sticker: figurinha });
      return;
    }

    // Escolha do formato de uma mídia desproporcional dentro do /create pack.
    // Depois da escolha, a próxima mídia da fila é processada.
    if (aguardandoPack[chaveEspera]?.fase === 'escolhendo_formato') {
      const sessaoPack = aguardandoPack[chaveEspera];
      const escolha = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim().toLowerCase();
      const modos = {
        '1': 'recortada', '2': 'original', '3': 'esticada',
        recortada: 'recortada', original: 'original', esticada: 'esticada',
      };
      const modo = modos[escolha];

      if (!modo) {
        await enviarMsg(sock, chatId, { text: '❌ Escolha *1*, *2* ou *3* (recortada, original ou esticada).' });
        return;
      }

      clearTimeout(sessaoPack.timeoutHandle);
      const pendente = sessaoPack.midiaPendente;
      if (!pendente) {
        sessaoPack.fase = 'fotos';
        sessaoPack.processandoMidia = false;
        await enviarMsg(sock, chatId, { text: '❌ A mídia pendente se perdeu. Mande essa foto/vídeo novamente.' });
        return;
      }

      sessaoPack.figurinhas.push({
        buffer: pendente.buffer,
        legenda: pendente.legenda,
        animada: pendente.animada,
        modo,
      });
      delete sessaoPack.midiaPendente;

      const recebidas = sessaoPack.figurinhas.length;

      if (recebidas >= sessaoPack.total) {
        await finalizarPackCriado(sock, chatId, chaveEspera);
        return;
      }

      sessaoPack.fase = 'fotos';
      sessaoPack.processandoMidia = false;
      sessaoPack.timeoutHandle = setTimeout(() => { delete aguardandoPack[chaveEspera]; }, 10 * 60 * 1000);

      await enviarMsg(sock, chatId, {
        text: `✅ ${recebidas}/${sessaoPack.total} mídia(s) recebida(s)!\n\nManda a próxima foto ou vídeo. 📸🎬\n\nPara cancelar: */cancel pack*`,
      });

      // Agora sim, processa SOMENTE a próxima mídia que já estava na fila.
      const proxima = sessaoPack.filaMidias?.shift();
      if (proxima) {
        sessaoPack.processandoMidia = true;
        await processarMidiaDoPack(sock, proxima, chatId, chaveEspera);
      }
      return;
    }

    const texto =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      '';

    if (!texto) return;

    let textoLimpo = texto.trim();
    textoLimpo = corrigirComandoDigitado(textoLimpo);
    const textoLower = textoLimpo.toLowerCase();
    const comando = textoLower.split(/\s+/)[0];
    const mencionado = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

    const ehComandoRpg = ['/rpg','/levels','/inimigos','/inimigo','/historia','/história','/inventario','/inventário','/battle','/party','/criar'].includes(comando);

    // ==================== /BOT PARTICIPANTE ====================
    if (isGroup && comando === '/bot') {
      const estadoBot = conversasBot[chatId] ||= { ativo: false, historico: [], ultimaMensagem: Date.now() };
      estadoBot.ativo = !estadoBot.ativo;
      if (!estadoBot.ativo) {
        clearTimeout(botSilencioTimers[chatId]);
        await enviarMsg(sock, chatId, { text: '🤖 Modo de conversa do Chaim-Bot desativado neste grupo.' });
        return;
      }
      registrarConversaBot(chatId, nomeRemetente, '/bot');
      await enviarMsg(sock, chatId, {
        text: `🤖 *Modo Chaim-Bot ativado!*\n\nAgora eu posso participar da conversa com todo mundo, responder perguntas e entrar nos assuntos do grupo. Também posso conversar espontaneamente de vez em quando. 😄\n\nPara sair desse modo, use */bot* novamente.`
      });
      reiniciarTimerSilencio(sock, chatId);
      return;
    }

    // Registra mensagens normais antes dos comandos para dar contexto ao participante virtual.
    if (isGroup && botAtivo(chatId) && !textoLower.startsWith('/')) {
      registrarConversaBot(chatId, nomeRemetente, textoLimpo);
      reiniciarTimerSilencio(sock, chatId);

      const contexto = contextoBot(chatId).toLowerCase();
      const citouBot = /\b(chaim|bot)\b/i.test(textoLimpo) || mencionado.includes(sock.user?.id);
      // Responde diretamente quando chamado; em outras mensagens, a fala espontânea fica para o timer.
      if (citouBot) {
        try {
          await sock.sendPresenceUpdate('composing', chatId);
          const respostaBot = await responderModoBot(sock, chatId, nomeRemetente, textoLimpo, mencionado);
          if (respostaBot) {
            botCooldownAte[chatId] = Date.now() + 15000;
            await enviarMsg(sock, chatId, { text: respostaBot.trim().slice(0, 1500) });
          }
        } catch (err) {
          console.log('Erro ao responder no modo /bot:', err.message);
        }
      }
      return;
    }

    // Ativação inicial: somente o dono configurado ou um administrador do grupo pode criar a comunidade RPG.
    if (isGroup && comando === '/rpg' && !rpg.isEnabled()) {
      let podeAtivar = ADMIN_NUMBER && remetenteId.startsWith(String(ADMIN_NUMBER));
      try {
        const meta = await sock.groupMetadata(chatId);
        const membro = meta.participants.find(p => p.id === remetenteId);
        podeAtivar = podeAtivar || membro?.admin === 'admin' || membro?.admin === 'superadmin';
      } catch (_) {}
      if (!podeAtivar) { await enviarMsg(sock, chatId, {text:'🔒 Só o dono do bot ou um administrador pode ativar o RPG nesta comunidade.'}); return; }
      rpg.activate(chatId);
      if (!estado.rpgAtivoNoGrupo(chatId)) estado.alternarRpgNoGrupo(chatId);
      await enviarMsg(sock, chatId, {text:'⚔️🎮 *RPG DA COMUNIDADE ATIVADO!*\n\nEste é o grupo principal. Agora use */levels*, */inimigos*, */historia*, */inventario* ou */battle* nos grupos destinados a cada função.'});
      return;
    }


    // ==================== POKÉMON BETA 0.1 ====================
    if (textoLower === '/pokemon') {
      const p = pokemon.getPlayer(remetenteId, nomeRemetente);
      if (!p.inicial) {
        await enviarMsg(sock, chatId, { text:
          `🐾 *BEM-VINDO AO MUNDO POKÉMON!*\n\nOlá, treinador! Antes de começar sua jornada, você precisa escolher seu primeiro Pokémon.\n\n🌱 */choose 1* — Bulbasaur\n🔥 */choose 2* — Charmander\n💧 */choose 3* — Squirtle\n\n⚠️ Sua escolha é permanente. Pense bem antes de escolher!` });
      } else {
        await enviarMsg(sock, chatId, { text: pokemon.profile(p) });
      }
      return;
    }

    if (textoLower.startsWith('/choose')) {
      const p = pokemon.getPlayer(remetenteId, nomeRemetente);
      if (p.inicial) { await enviarMsg(sock, chatId, { text: `🔒 Você já escolheu *${p.inicial.nome}*. O Pokémon inicial não pode ser trocado.` }); return; }
      const op = textoLimpo.split(/\s+/)[1];
      const escolhidos = { '1':'Bulbasaur', '2':'Charmander', '3':'Squirtle' };
      if (!escolhidos[op]) { await enviarMsg(sock, chatId, { text: `🐾 Escolha seu inicial:\n\n🌱 /choose 1 — Bulbasaur\n🔥 /choose 2 — Charmander\n💧 /choose 3 — Squirtle` }); return; }
      const novo = pokemon.chooseStarter(remetenteId, nomeRemetente, escolhidos[op]);
      await enviarMsg(sock, chatId, { text: `🎉 *${nomeRemetente} escolheu ${novo.nome}!*

${novo.emoji} *${novo.nome}* — Nível ${novo.level}
❤️ HP: ${novo.hp}/${novo.maxHp}

🌟 Sua jornada Pokémon começou!` });
      return;
    }

    if (textoLower === '/pokemons') { await enviarMsg(sock, chatId, { text: pokemon.team(remetenteId, nomeRemetente) }); return; }
    if (textoLower === '/mapa') { await enviarMsg(sock, chatId, { text: pokemon.map(remetenteId, nomeRemetente) }); return; }
    if (textoLower === '/help p' || textoLower === '/help pokemon') {
      await enviarMsg(sock, chatId, { text: `🐾 *AJUDA — POKÉMON BETA 0.1*\n\n/pokemon — seu perfil\n/choose 1, 2 ou 3 — escolher inicial\n/pokemons — sua equipe\n/mapa — localização atual\n/viajar — explorar a região\n/capturar — tentar capturar um Pokémon encontrado\n/shop — loja Pokémon\n/buy <número> — comprar da loja\n\n🪙 PokéCoins são usadas na loja.\n🚫 Grandes lendários e os trios ficam para atualizações futuras.` });
      return;
    }

    // -------------------- RPG DA COMUNIDADE --------------------
    if (isGroup && ehComandoRpg && rpg.isEnabled()) {
      const roleMap = {
        '/levels':'levels','/inimigos':'inimigos','/inimigo':'inimigos','/historia':'historia','/história':'historia','/inventario':'inventario','/inventário':'inventario','/battle':'battle'
      };

      if (roleMap[comando] && !['/rpg'].includes(comando)) rpg.setGroupRole(chatId, roleMap[comando]);

      if (comando === '/rpg') {
        rpg.activate(chatId);
        estado.alternarRpgNoGrupo(chatId);
        await enviarMsg(sock, chatId, { text:'⚔️ *RPG ativado nesta comunidade!*\n\n📊 Use */levels* em um grupo para torná-lo a área de níveis.\n👹 */inimigos* para a área de inimigos.\n📖 */historia* para a campanha.\n🎒 */inventario* para inventários.\n⚔️ */battle* para batalhas.' });
        return;
      }

      if (comando === '/levels') {
        const p = rpg.playerProfile(remetenteId,nomeRemetente);
        const args=textoLimpo.split(/\s+/).slice(1).join(' ');
        if (args.toLowerCase()==='setup') { rpg.setGroupRole(chatId,'levels'); await enviarMsg(sock,chatId,{text:'📊 *Área de LEVELS configurada neste grupo!*'}); return; }
        await enviarMsg(sock,chatId,{text:`📊 *LEVELS*\n\n👤 @${remetenteId.split('@')[0]}\n⭐ Nível: *${p.nivel}*\n✨ XP: *${p.xp}/${rpg.xpNecessario(p.nivel)}*\n❤️ HP: *${p.hp}/${p.maxHp}*`,mentions:[remetenteId]}); return;
      }

      if (comando === '/inventario' || comando === '/inventário') {
        const inv=rpg.inventory(remetenteId,nomeRemetente); const itens=Object.entries(inv); await enviarMsg(sock,chatId,{text:`🎒 *INVENTÁRIO DE ${nomeRemetente}*\n\n${itens.length?itens.map(([k,v])=>`• ${k} ×${v}`).join('\n'):'Está vazio.'}`}); return;
      }

      if (comando === '/inimigos' || comando === '/inimigo') {
        const args=textoLimpo.split(/\s+/).slice(1); if(args[0]?.toLowerCase()==='setup'){rpg.setGroupRole(chatId,'inimigos'); await enviarMsg(sock,chatId,{text:'👹 *Área de INIMIGOS configurada!*\n\nAdmin pode usar */criar inimigo Nome|HP|Dano|Velocidade*.'}); return;}
        if(args[0]?.toLowerCase()==='spawn'){const e=rpg.generateEnemy(chatId); await enviarMsg(sock,chatId,{text:`🚨 *NOVO INIMIGO NA ÁREA!*\n\n👹 *${e.nome}*\n❤️ ${e.hp}/${e.maxHp} HP\n⚔️ Dano: ${e.dano}\n💨 Velocidade: ${e.velocidade}\n\nUse */battle* para iniciar a luta.`}); return;}
        const lista=rpg.enemies(chatId); await enviarMsg(sock,chatId,{text:`👹 *INIMIGOS REGISTRADOS*\n\n${lista.length?lista.map(e=>`• ${e.nome} — ❤️ ${e.maxHp} HP — ⚔️ ${e.dano}`).join('\n'):'Nenhum ainda. Use */inimigos spawn* para o bot criar um.'}`}); return;
      }

      if (comando === '/criar' && /^\/criar\s+inimigo\b/i.test(textoLimpo)) {
        const dados=textoLimpo.replace(/^\/criar\s+inimigo\s*/i,'').split('|').map(x=>x.trim()); const e=rpg.registerEnemy(chatId,{nome:dados[0],maxHp:Number(dados[1]),dano:Number(dados[2]),velocidade:Number(dados[3]),precisao:.75}); await enviarMsg(sock,chatId,{text:`👹 Inimigo criado!\n\n*${e.nome}* — ❤️ ${e.maxHp} HP — ⚔️ ${e.dano} dano — 💨 ${e.velocidade} velocidade`}); return;
      }

      if (comando === '/party' && /^\/party\s+history/i.test(textoLimpo)) {
        const st=rpg.story(chatId); if(!st||!st.active){await enviarMsg(sock,chatId,{text:'📖 Nenhuma história está aberta neste grupo. Use */historia* primeiro.'});return;} const party=([...new Set([remetenteId,...mencionado])]).map(id=>({id,nome:contatosCache[id]||id.split('@')[0]})); rpg.setStoryParty(chatId,party); await enviarMsg(sock,chatId,{text:`📖 *PARTY DA HISTÓRIA*\n\n${party.map((x,i)=>`${i+1}. @${x.id.split('@')[0]}`).join('\n')}\n\n⚔️ Esses aventureiros participarão da campanha!`,mentions:party.map(x=>x.id)}); return;
      }

      if (comando === '/historia' || comando === '/história') {
        const args=textoLimpo.split(/\s+/).slice(1);
        const atual=rpg.story(chatId);
        if(args[0]?.toLowerCase()==='continuar' || args[0]?.toLowerCase()==='avançar' || args[0]?.toLowerCase()==='avancar'){
          if(!atual?.active || !atual.party?.length){await enviarMsg(sock,chatId,{text:'📖 Primeiro use */historia* e depois */party history* mencionando os aventureiros.'});return;}
          const cenas=[
            '🌲 A trilha se divide em duas. Um brilho azul vem da esquerda, enquanto pegadas enormes seguem para a direita.',
            '🕯️ Vocês encontram uma ruína antiga. No centro há um baú coberto por símbolos que ninguém reconhece.',
            '🌧️ Uma tempestade começa. Ao longe, uma criatura observa o grupo antes de desaparecer na mata.',
            '⛰️ A floresta termina diante de uma caverna. De dentro vem um som grave e ameaçador.'
          ];
          const cena=cenas[Math.floor(Math.random()*cenas.length)];
          const ids=atual.party.map(id=>({id,nome:contatosCache[id]||id.split('@')[0]}));
          if(Math.random()<0.45){const e=rpg.generateEnemy(chatId);rpg.startBattle(chatId,e.id,ids);await enviarMsg(sock,chatId,{text:`📖 *A HISTÓRIA CONTINUA...*\n\n${cena}\n\n💥 De repente, *${e.nome}* aparece!\n❤️ ${e.hp}/${e.maxHp} HP\n\n⚔️ A batalha começou! Turno de @${ids[0].id.split('@')[0]}.\n1️⃣ Habilidade\n2️⃣ Corpo a corpo\n3️⃣ Poção`,mentions:[ids[0].id]});}
          else {const achados=['Poção de Cura','Poção de Cura','Cristal Arcano','Espada Misteriosa'];const item=achados[Math.floor(Math.random()*achados.length)];const ganhador=ids[Math.floor(Math.random()*ids.length)];rpg.addItem(ganhador.id,ganhador.nome,item,1);for(const id of ids)rpg.addXp(id.id,id.nome,10);await enviarMsg(sock,chatId,{text:`📖 *A HISTÓRIA CONTINUA...*\n\n${cena}\n\n🎁 @${ganhador.id.split('@')[0]} encontrou *${item}*!\n✨ Todos os aventureiros ganharam *+10 XP*.\n\nUse */historia continuar* para avançar novamente.`,mentions:ids.map(x=>x.id)});for(const levelsChat of rpg.allGroupIds('levels'))await enviarMsg(sock,levelsChat,{text:`✨ A party da história ganhou *+10 XP*! Os jogadores avançaram na aventura.`,mentions:ids.map(x=>x.id)});}
          return;
        }
        rpg.storyStart(chatId,remetenteId); rpg.setGroupRole(chatId,'historia'); await enviarMsg(sock,chatId,{text:'📖 *UMA NOVA AVENTURA COMEÇA...*\n\n🌲 Os aventureiros chegam a uma floresta coberta por neblina. Entre as árvores, vocês ouvem um rugido distante.\n\n👥 Para entrar na aventura, use */party history* mencionando os jogadores.\n\n➡️ Depois use */historia continuar* para explorar a próxima cena.'}); return;
      }

      if (comando === '/battle') {
        let b=rpg.battle(chatId); if(!b){const e=rpg.enemies(chatId)[0]||rpg.generateEnemy(chatId); const ids=mencionado.length?mencionado:[remetenteId]; b=rpg.startBattle(chatId,e.id,ids.map(id=>({id,nome:contatosCache[id]||id.split('@')[0]})));}
        const alvo=b.party[b.turn%b.party.length]; const e=b.enemy; await enviarMsg(sock,chatId,{text:`⚔️ *BATALHA!*\n\n👹 ${e.nome}\n❤️ ${e.hp}/${e.maxHp}\n\n🎮 Turno de @${alvo.id.split('@')[0]}\n\n1️⃣ Usar habilidade\n2️⃣ Atacar corpo a corpo\n3️⃣ Usar poção\n\nResponda com *1*, *2* ou *3*.`,mentions:[alvo.id]}); return;
      }
    }

    // Ações de uma batalha RPG já ativa.
    if (isGroup && rpg.isEnabled() && rpg.battle(chatId) && textoLimpo.trim()) {
      const b=rpg.battle(chatId); const alvo=b.party[b.turn%b.party.length];
      if(alvo.id===remetenteId){
        const p=rpg.playerProfile(remetenteId,nomeRemetente);
        const pend=rpgPendencias[chaveEspera];
        let dano=0, texto='';

        if(pend?.tipo==='habilidade' && /^[0-9]+$/.test(textoLimpo)){
          const idx=Number(textoLimpo)-1; const h=p.habilidades[idx]; delete rpgPendencias[chaveEspera];
          if(!h){await enviarMsg(sock,chatId,{text:'❌ Essa habilidade não existe. Escolha um número válido.'});return;}
          if(Math.random()>h.precisao){texto=`💨 ${b.enemy.nome} desviou da habilidade *${h.nome}*!`;}
          else{dano=h.dano; b.enemy.hp=Math.max(0,b.enemy.hp-dano); texto=`✨ @${remetenteId.split('@')[0]} usou *${h.nome}* e causou *${dano} de dano*!`;}
        } else if(pend?.tipo==='pocao' && /^[0-9]+$/.test(textoLimpo)){
          const idx=Number(textoLimpo)-1; const alvoP=b.party[idx]; delete rpgPendencias[chaveEspera];
          if(!alvoP){await enviarMsg(sock,chatId,{text:'❌ Jogador inválido.'});return;}
          if(!rpg.useItem(remetenteId,nomeRemetente,'Poção de Cura')){texto='🧪 Você não possui Poção de Cura.';}
          else{const tp=rpg.playerProfile(alvoP.id,alvoP.nome); tp.hp=Math.min(tp.maxHp,tp.hp+30); texto=`🧪 @${remetenteId.split('@')[0]} usou uma Poção de Cura em @${alvoP.id.split('@')[0]} e recuperou 30 HP!`;}
        } else if(/^[123]$/.test(textoLimpo)){
          if(textoLimpo==='1'){
            if(p.habilidades.length>1){rpgPendencias[chaveEspera]={tipo:'habilidade'}; await enviarMsg(sock,chatId,{text:`✨ *Escolha a habilidade de @${remetenteId.split('@')[0]}:*\n\n${p.habilidades.map((h,i)=>`${i+1}️⃣ ${h.nome} — ${h.dano} dano — ${Math.round(h.precisao*100)}% precisão`).join('\n')}`,mentions:[remetenteId]});return;}
            const h=p.habilidades[0]; if(Math.random()>h.precisao)texto=`💨 ${b.enemy.nome} desviou da habilidade *${h.nome}*!`; else{dano=h.dano;b.enemy.hp=Math.max(0,b.enemy.hp-dano);texto=`✨ @${remetenteId.split('@')[0]} usou *${h.nome}* e causou *${dano} de dano*!`;}
          } else if(textoLimpo==='2'){
            dano=8+p.nivel*3; if(Math.random()>.82)texto=`💨 ${b.enemy.nome} desviou do ataque de @${remetenteId.split('@')[0]}!`; else{b.enemy.hp=Math.max(0,b.enemy.hp-dano);texto=`⚔️ @${remetenteId.split('@')[0]} causou *${dano} de dano* em ${b.enemy.nome}!`;}
          } else {
            if(b.party.length>1){rpgPendencias[chaveEspera]={tipo:'pocao'}; await enviarMsg(sock,chatId,{text:`🧪 *Em quem quer usar a Poção de Cura?*\n\n${b.party.map((x,i)=>`${i+1}️⃣ @${x.id.split('@')[0]}`).join('\n')}`,mentions:b.party.map(x=>x.id)});return;}
            if(!rpg.useItem(remetenteId,nomeRemetente,'Poção de Cura'))texto='🧪 Você não possui Poção de Cura.';else{p.hp=Math.min(p.maxHp,p.hp+30);texto=`🧪 @${remetenteId.split('@')[0]} usou uma Poção de Cura e recuperou 30 HP!`;}
          }
        } else return;

        if(b.enemy.hp<=0){const recompensa=rpg.addXp(remetenteId,nomeRemetente,25);p.vitorias++;rpg.endBattle(chatId);await enviarMsg(sock,chatId,{text:`${texto}\n\n🏆 *${b.enemy.nome} foi derrotado!*\n✨ @${remetenteId.split('@')[0]} ganhou *+25 XP*!`,mentions:[remetenteId]});for(const levelsChat of rpg.allGroupIds('levels')){await enviarMsg(sock,levelsChat,{text:`✨ @${remetenteId.split('@')[0]} ganhou *+25 XP*! Agora está com *${recompensa.player.xp} XP* no nível *${recompensa.player.nivel}*.`,mentions:[remetenteId]});if(recompensa.subiu)await enviarMsg(sock,levelsChat,{text:`🎉 @${remetenteId.split('@')[0]} *SUBIU DE NÍVEL!* Agora é nível *${recompensa.nivelNovo}*!`,mentions:[remetenteId]});}return;}
        const ataque=b.enemy.ataques[Math.floor(Math.random()*b.enemy.ataques.length)]; if(Math.random()<=ataque.precisao){p.hp=Math.max(0,p.hp-ataque.dano);texto+=`\n\n👹 ${b.enemy.nome} usou *${ataque.nome}* e causou *${ataque.dano} dano*!`;}else texto+=`\n\n💨 ${b.enemy.nome} tentou atacar, mas errou!`; if(p.hp<=0){p.hp=1; rpg.addXp(remetenteId,nomeRemetente,5);texto+=`\n\n💀 @${remetenteId.split('@')[0]} caiu, mas foi salvo com 1 HP!`;}
        b.turn++; const prox=b.party[b.turn%b.party.length]; await enviarMsg(sock,chatId,{text:`${texto}\n\n❤️ @${remetenteId.split('@')[0]}: ${p.hp}/${p.maxHp} HP\n\n🎮 Turno de @${prox.id.split('@')[0]}\n1️⃣ Habilidade\n2️⃣ Corpo a corpo\n3️⃣ Poção`,mentions:[remetenteId,prox.id]}); return;
      }
    }

    // Cancelamento dos fluxos de criação
    if (textoLower === '/cancel fig') {
      let cancelou = false;
      if (aguardandoFoto[chaveEspera]) {
        clearTimeout(aguardandoFoto[chaveEspera]);
        delete aguardandoFoto[chaveEspera];
        cancelou = true;
      }
      if (aguardandoEscolhaFormato[chaveEspera]) {
        clearTimeout(aguardandoEscolhaFormato[chaveEspera].timeoutHandle);
        delete aguardandoEscolhaFormato[chaveEspera];
        cancelou = true;
      }
      await enviarMsg(sock, chatId, {
        text: cancelou ? '🛑 Criação da figurinha cancelada.\n\nPara começar novamente, use */create fig*.' : 'ℹ️ Você não tem uma criação de figurinha em andamento.'
      });
      return;
    }

    if (textoLower === '/cancel pack') {
      if (aguardandoPack[chaveEspera]) {
        clearTimeout(aguardandoPack[chaveEspera].timeoutHandle);
        delete aguardandoPack[chaveEspera];
        await enviarMsg(sock, chatId, { text: '🛑 Criação do pack cancelada.\n\nPara começar novamente, use */create pack*.' });
      } else {
        await enviarMsg(sock, chatId, { text: 'ℹ️ Você não tem um pack em criação.' });
      }
      return;
    }

    // /create pack: primeiro pergunta quantas figurinhas serão enviadas
    if (textoLower === '/create pack') {
      if (aguardandoPack[chaveEspera]) {
        clearTimeout(aguardandoPack[chaveEspera].timeoutHandle);
      }
      aguardandoPack[chaveEspera] = {
        fase: 'quantidade',
        total: 0,
        nomePack: '',
        packId: '',
        figurinhas: [],
        filaMidias: [],
        processandoMidia: false,
        timeoutHandle: setTimeout(() => {
          delete aguardandoPack[chaveEspera];
        }, 10 * 60 * 1000),
      };

      await enviarMsg(sock, chatId, {
        text: '📦 *Criar Pack de Figurinhas*\n\nQuantas figurinhas você quer no pack?\nDigite um número de *1 a 50*.\n\nPara cancelar: */cancel pack*',
      });
      return;
    }

    // Recebe a quantidade do /create pack
    if (aguardandoPack[chaveEspera]?.fase === 'quantidade') {
      const quantidade = Number(textoLimpo);

      if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 50) {
        await enviarMsg(sock, chatId, { text: '❌ Digite somente um número inteiro de *1 a 50*. Exemplo: *10*.' });
        return;
      }

      const sessaoPack = aguardandoPack[chaveEspera];
      clearTimeout(sessaoPack.timeoutHandle);
      sessaoPack.fase = 'nome';
      sessaoPack.total = quantidade;
      sessaoPack.figurinhas = [];
      sessaoPack.timeoutHandle = setTimeout(() => {
        delete aguardandoPack[chaveEspera];
      }, 10 * 60 * 1000);

      await enviarMsg(sock, chatId, {
        text: `✅ Beleza! Vou criar um pack com *${quantidade} figurinha(s)*.\n\nAgora escolha o *nome do pack* e envie somente o nome em uma mensagem. 📦\n\nExemplo: *Meu Pack de Memes*\n\n🛑 Para cancelar: */cancel pack*`,
      });
      return;
    }

    // Recebe o nome do /create pack e depois começa a coleta das fotos
    if (aguardandoPack[chaveEspera]?.fase === 'nome') {
      const nomePack = textoLimpo.trim();
      if (!nomePack || nomePack.length < 1) {
        await enviarMsg(sock, chatId, { text: '❌ Digite um nome para o pack. Exemplo: *Meu Pack de Memes*.' });
        return;
      }

      const sessaoPack = aguardandoPack[chaveEspera];
      clearTimeout(sessaoPack.timeoutHandle);
      sessaoPack.nomePack = nomePack.slice(0, 100);
      sessaoPack.packId = `cogb-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      sessaoPack.fase = 'fotos';
      sessaoPack.timeoutHandle = setTimeout(() => {
        delete aguardandoPack[chaveEspera];
      }, 10 * 60 * 1000);

      await enviarMsg(sock, chatId, {
        text: `📦 Nome definido: *${sessaoPack.nomePack}*\n\nAgora mande as *${sessaoPack.total} fotos ou vídeos*, um por vez. 📸🎬\nO bot vai transformar todas em figurinhas e montar o pack com esse nome.\n\n📊 Progresso: *0/${sessaoPack.total}*\n🛑 Para cancelar: */cancel pack*`,
      });
      return;
    }

    // ==================== SISTEMA DE QUIZ ====================
    const quizAtual = quizzesAtivos[quizChaveCriador(remetenteId)];

    if (isGroup && textoLower === '/quiz') {
      if (quizAtual) {
        await enviarMsg(sock, chatId, {
          text: '⚠️ Você já tem um quiz em andamento. Termine ou cancele o atual antes de criar outro.'
        });
        return;
      }

      let nomeGrupo = 'seu grupo';
      try {
        const metadata = await sock.groupMetadata(chatId);
        nomeGrupo = metadata.subject || nomeGrupo;
      } catch (err) {}

      quizzesAtivos[quizChaveCriador(remetenteId)] = {
        criadorId: remetenteId,
        nomeCriador: nomeRemetente,
        grupoId: chatId,
        fase: 'pergunta',
        numeroPergunta: 1,
        perguntas: [],
        participantes: [],
        respostasParticipantes: {},
        modoParticipacao: null,
      };

      await enviarMsg(sock, remetenteId, {
        text:
          `╔══════════════════════════╗\n` +
          `       🎮 *CRIADOR DE QUIZ*       \n` +
          `╚══════════════════════════╝\n\n` +
          `📍 Grupo: *${nomeGrupo}*\n\n` +
          `🧠 *Pergunta 1/10*\n\n` +
          `Envie neste formato:\n\n` +
          `*Pergunta:* Qual é a resposta correta?\n` +
          `R1: Resposta 1\n` +
          `R2: Resposta 2\n` +
          `R3: Resposta 3\n` +
          `R4: Resposta 4\n\n` +
          `Depois eu vou perguntar qual é a resposta certa. Você responderá *R1*, *R2*, *R3* ou *R4*.\n\n` +
          `📌 Mínimo: *3/10*\n` +
          `📌 Máximo: *10/10*\n` +
          `📌 Depois de 3 perguntas, use */fimquiz* para terminar.`
      });
      return;
    }

    // Configuração do quiz no PV.
    if (!isGroup && quizAtual) {
      const quiz = quizAtual;

      if (quiz.fase === 'pergunta') {
        if (textoLower === '/cancelquiz') {
          delete quizzesAtivos[quizChaveCriador(remetenteId)];
          await enviarMsg(sock, chatId, { text: '🛑 Quiz cancelado.' });
          return;
        }

        if (textoLower === '/fimquiz') {
          if (quiz.perguntas.length < 3) {
            await enviarMsg(sock, chatId, `⚠️ Você tem ${quiz.perguntas.length}/10. O mínimo para terminar é *3/10*.`);
            return;
          }

          quiz.fase = 'participacao';
          await enviarMsg(sock, chatId, {
            text:
              `✅ *Quiz finalizado com ${quiz.perguntas.length}/10!*\n\n` +
              `Escolha quem poderá participar:\n\n` +
              `👥 *1* — Grupo todo\n` +
              `🎯 *2* — Pessoas específicas\n\n` +
              `Responda apenas *1* ou *2*.\n\n` +
              `💡 Se escolher 2, use */party* no grupo para mencionar até 9 pessoas.`
          });
          return;
        }

        if (quiz.perguntas.length >= 10) {
          quiz.fase = 'participacao';
          await enviarMsg(sock, chatId, {
            text: '🏆 Você chegou a *10/10*! Agora responda *1* para grupo todo ou *2* para pessoas específicas.'
          });
          return;
        }

        const respostas = obterRespostasQuiz(texto);
        if (!respostas.R1 || !respostas.R2 || !respostas.R3 || !respostas.R4) {
          await enviarMsg(sock, chatId, {
            text:
              `❌ Preciso das 4 respostas.\n\n` +
              `Use:\nR1: resposta\nR2: resposta\nR3: resposta\nR4: resposta`
          });
          return;
        }

        const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const perguntaLinha = linhas.find((l) => /^pergunta\s*:/i.test(l));
        const enunciado = perguntaLinha
          ? perguntaLinha.replace(/^pergunta\s*:/i, '').trim()
          : (linhas.find((l) => !/^R[1-4]\s*[:\-]/i.test(l)) || `Questão ${quiz.numeroPergunta}`);

        quiz.respostasPendentes = respostas;
        quiz.enunciadoPendente = enunciado;
        quiz.fase = 'correta';

        await enviarMsg(sock, chatId, {
          text:
            `🧠 *Qual é a resposta correta da ${quiz.numeroPergunta}/10?*\n\n` +
            `R1️⃣ ${respostas.R1}\n` +
            `R2️⃣ ${respostas.R2}\n` +
            `R3️⃣ ${respostas.R3}\n` +
            `R4️⃣ ${respostas.R4}\n\n` +
            `👉 Responda apenas com *R1*, *R2*, *R3* ou *R4*.`
        });
        return;
      }

      if (quiz.fase === 'correta') {
        const correta = normalizarAlternativa(textoLimpo);

        if (!['R1', 'R2', 'R3', 'R4'].includes(correta)) {
          await enviarMsg(sock, chatId, {
            text: '❌ Resposta inválida. Digite *R1*, *R2*, *R3* ou *R4*.'
          });
          return;
        }

        quiz.perguntas.push({
          enunciado: quiz.enunciadoPendente,
          respostas: quiz.respostasPendentes,
          correta,
        });

        quiz.respostasPendentes = null;
        quiz.enunciadoPendente = null;

        if (quiz.perguntas.length >= 10) {
          quiz.fase = 'participacao';
          await enviarMsg(sock, chatId, {
            text: '🏆 *10/10 concluído!*\n\nDigite *1* para grupo todo ou *2* para pessoas específicas.'
          });
          return;
        }

        quiz.numeroPergunta += 1;
        quiz.fase = 'pergunta';

        await enviarMsg(sock, chatId, {
          text:
            `✅ Resposta correta salva como *${correta}*!\n\n` +
            `🧠 *Pergunta ${quiz.numeroPergunta}/10*\n\n` +
            `Envie:\n*Pergunta:* ...\nR1: ...\nR2: ...\nR3: ...\nR4: ...\n\n` +
            `Quando tiver pelo menos 3 perguntas, use */fimquiz*.`
        });
        return;
      }

      if (quiz.fase === 'participacao') {
        if (textoLimpo === '1') {
          quiz.modoParticipacao = 'grupo';
          quiz.participantes = null;
          quiz.fase = 'confirmarPublicacao';

          await enviarMsg(sock, chatId, {
            text:
              `👥 *GRUPO TODO selecionado!*\n\n` +
              `Todos os membros do grupo poderão responder.\n\n` +
              `✅ Digite *CONFIRMAR* para publicar.\n` +
              `❌ Digite *CANCELAR* para voltar.`
          });
          return;
        }

        if (textoLimpo === '2') {
          quiz.modoParticipacao = 'party';
          quiz.fase = 'aguardandoParty';

          await enviarMsg(sock, chatId, {
            text:
              `🎯 *PESSOAS ESPECÍFICAS selecionadas!*\n\n` +
              `Agora vá ao grupo e envie:\n\n` +
              `*/party @pessoa1 @pessoa2 ...*\n\n` +
              `👥 Máximo: *9 pessoas mencionadas*.\n` +
              `👑 Você participará automaticamente.`
          });
          return;
        }

        await enviarMsg(sock, chatId, '❌ Escolha *1* ou *2*.');
        return;
      }

      if (quiz.fase === 'confirmarPublicacao') {
        if (textoLower === 'cancelar') {
          quiz.fase = 'participacao';
          await enviarMsg(sock, chatId, { text: '↩️ Voltamos. Digite *1* para grupo todo ou *2* para pessoas específicas.' });
          return;
        }

        if (textoLower === 'confirmar') {
          await publicarQuizNoGrupo(sock, quiz);
          return;
        }

        await enviarMsg(sock, chatId, { text: 'Digite *CONFIRMAR* para publicar ou *CANCELAR* para voltar.' });
        return;
      }
    }

    // /party seleciona até 9 pessoas mencionadas para o quiz atual.
    if (isGroup && textoLower.startsWith('/party')) {
      const quiz = quizAtual;

      if (!quiz || quiz.grupoId !== chatId || quiz.fase !== 'aguardandoParty') {
        await enviarMsg(sock, chatId, { text: '❌ Você não tem um quiz esperando participantes neste grupo.' });
        return;
      }

      const mentionedJid = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
      const mencionados = idsUnicos(mentionedJid);

      if (!mencionados.length) {
        await enviarMsg(sock, chatId, { text: '👥 Mencione as pessoas. Exemplo: */party @pessoa1 @pessoa2*' });
        return;
      }

      if (mencionados.length > 9) {
        await enviarMsg(sock, chatId, { text: '⚠️ O /party aceita no máximo *9 pessoas mencionadas*.' });
        return;
      }

      quiz.participantes = idsUnicos([remetenteId, ...mencionados]);
      quiz.fase = 'confirmarPublicacao';

      const lista = quiz.participantes.map((id) => `• @${id.split('@')[0]}`).join('\n');

      await enviarMsg(sock, chatId, {
        text:
          `╔════════════════════╗\n` +
          `      🎯 *PARTY DO QUIZ*\n` +
          `╚════════════════════╝\n\n` +
          `👥 *Participantes (${quiz.participantes.length}):*\n${lista}\n\n` +
          `✅ Agora mande *CONFIRMAR* no seu PV comigo.\n` +
          `❌ Para cancelar, mande *CANCELAR* no PV.`,
        mentions: quiz.participantes,
      });
      return;
    }

    // Respostas e confirmação final do quiz no grupo.
    if (isGroup) {
      const quizzesDoGrupo = Object.values(quizzesAtivos).filter((q) => q.grupoId === chatId && q.fase === 'emJogo');

      for (const quiz of quizzesDoGrupo) {
        const elegivel = quiz.modoParticipacao === 'grupo'
          ? quiz.participantes.includes(remetenteId)
          : quiz.participantes.includes(remetenteId);

        if (!elegivel) continue;

        if (textoLower === 'confirm' && remetenteId === quiz.criadorId) {
          await revelarResultadoQuiz(sock, quiz);
          return;
        }

        const respostas = extrairRespostasParticipante(textoLimpo, quiz.perguntas.length);
        if (!Object.keys(respostas).length) continue;

        quiz.respostasParticipantes[remetenteId] ||= {};
        Object.assign(quiz.respostasParticipantes[remetenteId], respostas);

        await enviarMsg(sock, chatId, {
          text:
            `✅ @${remetenteId.split('@')[0]} respondeu ${Object.keys(respostas).length} pergunta(s)!\n` +
            `📌 Você pode enviar respostas novas ou corrigir as anteriores.\n` +
            `🏁 O resultado será revelado quando o criador enviar *confirm*.`,
          mentions: [remetenteId],
        });
        return;
      }
    }

    // XP do RPG é concedido pelas atividades do RPG (batalhas, história e duelos),
    // e os avisos de XP/level-up são enviados para a área /levels da comunidade.

    // Se a pessoa já tinha pedido "/audio" e agora mandou um link do YouTube (em vez de vídeo)
    if (aguardandoAudio[chaveEspera]) {
      const linkYoutube = texto.match(REGEX_YOUTUBE);
      if (linkYoutube) {
        clearTimeout(aguardandoAudio[chaveEspera]);
        delete aguardandoAudio[chaveEspera];

        try {
          await sock.sendPresenceUpdate('composing', chatId);
        } catch (err) {
          // sem problema se não conseguir mostrar "digitando"
        }

        const audio = await baixarAudioDoYoutube(linkYoutube[1]);

        if (!audio) {
          await enviarMsg(sock, chatId, {
            text: 'Deu ruim pra baixar esse vídeo do YouTube 😕 confere o link e tenta de novo',
          });
          return;
        }

        await enviarMsg(sock, chatId, { audio, mimetype: 'audio/mpeg' });
        return;
      }
    }

    // Comando secreto: reconhece quem manda como o criador/dono do bot — só funciona uma vez,
    // pra ninguém mais conseguir "roubar" esse posto depois que já tem um dono definido
    if (!isGroup && texto.trim() === '/1480018122') {
      const donoAtual = estado.obterDono();
      if (donoAtual && donoAtual !== remetenteId) {
        return; // já tem dono e não é quem mandou agora: ignora, sem nem responder
      }

      estado.definirDono(remetenteId);
      const relatorio = await gerarRelatorioGrupos();
      await enviarMsg(sock, chatId, {
        text: `👑 Prontinho! Agora eu te reconheço como meu criador.\n\n${relatorio}`,
      });
      return;
    }

    // Link de convite de grupo mandado no privado: o bot entra sozinho no grupo
    const linkConvite = !isGroup && texto.match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/);
    if (linkConvite) {
      const codigo = linkConvite[1];
      try {
        const novoGrupoId = await sock.groupAcceptInvite(codigo);

        let nomeGrupo = 'um grupo';
        try {
          const metadata = await sock.groupMetadata(novoGrupoId);
          nomeGrupo = metadata.subject || nomeGrupo;
        } catch (err) {
          // sem problema se não conseguir pegar o nome
        }

        await pedirAutorizacaoDoGrupo(novoGrupoId, nomeGrupo);
        await enviarMsg(sock, chatId, {
          text: `✅ Entrei no grupo *"${nomeGrupo}"*! Vou pedir autorização antes de ativar minhas funções lá.`,
        });
      } catch (err) {
        console.log('Erro ao entrar no grupo via link:', err.message);
        await enviarMsg(sock, chatId, {
          text: '❌ Não consegui entrar nesse grupo. O link pode estar errado, expirado, ou eu já fui removido de lá antes.',
        });
      }
      return;
    }

    const remetenteBase = remetenteId.split('@')[0];
    const ehAdmin = ADMIN_NUMBER && remetenteBase === ADMIN_NUMBER;

    // Se quem mandou é o admin, no privado, e tem um grupo esperando autorização
    if (!isGroup && ehAdmin) {
      const grupoPendente = estado.proximoDaFila();
      if (grupoPendente) {
        const resposta = texto.trim().toLowerCase();
        const respostasSim = ['sim', 's', 'autorizo', 'autorizado', 'pode', 'aceito', 'ok'];
        const respostasNao = ['não', 'nao', 'n', 'negar', 'negado', 'recusar', 'recuso'];

        if (respostasSim.includes(resposta)) {
          estado.definirStatusGrupo(grupoPendente, 'autorizado');
          estado.removerDaFila(grupoPendente);
          try {
            await enviarMsg(sock, grupoPendente, { text: MENSAGEM_GRUPO_ATIVADO });
          } catch (err) {
            console.log('Erro ao avisar grupo autorizado:', err.message);
          }
          await enviarMsg(sock, chatId, { text: '✅ Autorizado! Já ativei minhas funções nesse grupo.' });
          return;
        }

        if (respostasNao.includes(resposta)) {
          estado.definirStatusGrupo(grupoPendente, 'negado');
          estado.removerDaFila(grupoPendente);
          try {
            await enviarMsg(sock, grupoPendente, { text: MENSAGEM_GRUPO_RECUSADO });
            await sock.groupLeave(grupoPendente);
          } catch (err) {
            console.log('Erro ao sair do grupo:', err.message);
          }
          await enviarMsg(sock, chatId, { text: '🚫 Beleza, saí do grupo.' });
          return;
        }
      }
    }

    // Primeira mensagem de alguém no privado: manda a apresentação, uma única vez.
    // Quem já conhecia o bot (recebeu a apresentação antiga) recebe o aviso da função nova, também uma vez.
    if (!isGroup) {
      if (!estado.jaRecebeuBoasVindas(remetenteId)) {
        estado.marcarBoasVindas(remetenteId);
        estado.marcarAvisoConvert(remetenteId); // a apresentação nova já fala do /convert
        await enviarMsg(sock, chatId, { text: MENSAGEM_BOAS_VINDAS_PV });
      } else if (!estado.jaFoiAvisadoConvert(remetenteId)) {
        estado.marcarAvisoConvert(remetenteId);
        await enviarMsg(sock, chatId, { text: MENSAGEM_NOVA_FUNCAO_CONVERT });
      }
    }

    // Se a pessoa tá escolhendo o formato de uma figurinha pendente
    if (aguardandoEscolhaFormato[chaveEspera]) {
      const escolha = texto.trim().toLowerCase();
      const mapaEscolhas = {
        '1': 'recortada', recortada: 'recortada', recortar: 'recortada',
        '2': 'original', original: 'original',
        '3': 'esticada', esticada: 'esticada', esticado: 'esticada',
      };
      const modo = mapaEscolhas[escolha];

      if (!modo) {
        await enviarMsg(sock, chatId, {
          text: 'Não entendi 😅 responde com 1, 2 ou 3 (ou o nome da opção: recortada, original, esticada).',
        });
        return;
      }

      const pendente = aguardandoEscolhaFormato[chaveEspera];
      clearTimeout(pendente.timeoutHandle);
      delete aguardandoEscolhaFormato[chaveEspera];

      try {
        await sock.sendPresenceUpdate('composing', chatId);
      } catch (err) {
        // sem problema se não conseguir mostrar "digitando"
      }

      const figurinha = pendente.animada
        ? await criarFigurinhaAnimada(pendente.bufferImagem, pendente.legenda, modo)
        : await criarFigurinhaDeImagem(pendente.bufferImagem, pendente.legenda, modo);

      if (!figurinha) {
        await enviarMsg(sock, chatId, { text: 'Deu ruim pra criar a figurinha 😕 tenta de novo' });
        return;
      }

      await enviarMsg(sock, chatId, { sticker: figurinha });
      return;
    }

    // Comando /ia e /ask <pergunta> - conversa direta com a IA, sem manter histórico
    if (texto.trim().toLowerCase().startsWith('/ia ') || texto.trim().toLowerCase().startsWith('/ask ')) {
      const pergunta = texto.trim().slice(texto.indexOf(' ') + 1).trim();
      if (!pergunta) {
        await enviarMsg(sock, chatId, { text: 'Faz uma pergunta depois do comando! Ex: /ia qual a capital do Japão?' });
        return;
      }

      try {
        await sock.sendPresenceUpdate('composing', chatId);
      } catch (err) {
        // sem problema
      }

      const resposta = await gerarResposta([{ role: 'user', content: pergunta }]);
      await enviarMsg(sock, chatId, { text: resposta || 'Deu ruim pra responder agora 😕 tenta de novo' });
      return;
    }

    // Comando /roast @pessoa - a IA cria uma zoeira leve sobre a pessoa mencionada (só em grupos)
    if (isGroup && texto.trim().toLowerCase().startsWith('/roast')) {
      const mentionedJid = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
      const alvoId = mentionedJid[0];

      if (!alvoId) {
        await enviarMsg(sock, chatId, { text: 'Menciona alguém! Ex: /roast @pessoa' });
        return;
      }

      const nomeAlvo = contatosCache[alvoId] || alvoId.split('@')[0];
      const resposta = await gerarRespostaComPrompt(
        'Você cria zoeiras curtas, leves e engraçadas sobre pessoas, em português brasileiro, no estilo de ' +
          'brincadeira entre amigos. NUNCA seja realmente ofensivo, preconceituoso, ou cruel — mantenha tudo ' +
          'no nível de brincadeira inofensiva. Responda só com a zoeira em 1 ou 2 frases, nada mais.',
        `Cria uma zoeira sobre uma pessoa chamada ${nomeAlvo}`
      );

      await enviarMsg(sock, chatId, {
        text: resposta ? `${resposta}` : 'Deu ruim pra pensar numa zoeira agora 😕',
        mentions: [alvoId],
      });
      return;
    }

    // Comando /story <tema> - a IA cria uma historinha curta
    if (texto.trim().toLowerCase().startsWith('/story ')) {
      const tema = texto.trim().slice(7).trim();
      if (!tema) {
        await enviarMsg(sock, chatId, { text: 'Me dá um tema! Ex: /story um gato astronauta' });
        return;
      }

      try {
        await sock.sendPresenceUpdate('composing', chatId);
      } catch (err) {
        // sem problema
      }

      const resposta = await gerarRespostaComPrompt(
        'Você escreve historinhas curtas, criativas e envolventes em português brasileiro, com no máximo ' +
          '6 a 8 frases. Responda só com a história, sem introduções nem comentários.',
        `Cria uma historinha curta sobre: ${tema}`
      );

      await enviarMsg(sock, chatId, { text: resposta || 'Deu ruim pra criar a história agora 😕 tenta de novo' });
      return;
    }

    // Comando /translate <texto> - traduz (PT -> EN, ou qualquer outro idioma -> PT)
    if (texto.trim().toLowerCase().startsWith('/translate ')) {
      const textoTraduzir = texto.trim().slice(11).trim();
      if (!textoTraduzir) {
        await enviarMsg(sock, chatId, { text: 'Manda o texto pra traduzir! Ex: /translate bom dia' });
        return;
      }

      const resposta = await gerarRespostaComPrompt(
        'Você é um tradutor. Se o texto do usuário estiver em português, traduza pro inglês. Se estiver em ' +
          'qualquer outro idioma, traduza pro português. Responda SOMENTE com a tradução, sem explicações, ' +
          'sem aspas, sem comentários.',
        textoTraduzir
      );

      await enviarMsg(sock, chatId, { text: resposta || 'Deu ruim pra traduzir agora 😕 tenta de novo' });
      return;
    }

    // Comando /resumo <texto> - resume um texto
    if (texto.trim().toLowerCase().startsWith('/resumo ')) {
      const textoResumir = texto.trim().slice(8).trim();
      if (!textoResumir) {
        await enviarMsg(sock, chatId, { text: 'Manda o texto pra resumir! Ex: /resumo <texto grande aqui>' });
        return;
      }

      const resposta = await gerarRespostaComPrompt(
        'Você resume textos em português brasileiro de forma clara, objetiva e fiel ao conteúdo original, ' +
          'em no máximo 3 a 4 frases. Responda somente com o resumo, sem introduções.',
        textoResumir
      );

      await enviarMsg(sock, chatId, { text: resposta || 'Deu ruim pra resumir agora 😕 tenta de novo' });
      return;
    }

    // Comando /imagine <descrição> - gera uma imagem comum (não figurinha) com IA
    if (texto.trim().toLowerCase().startsWith('/imagine ')) {
      const descricao = texto.trim().slice(9).trim();
      if (!descricao) {
        await enviarMsg(sock, chatId, { text: 'Descreve o que você quer! Ex: /imagine paisagem no espaço' });
        return;
      }

      try {
        await sock.sendPresenceUpdate('composing', chatId);
      } catch (err) {
        // sem problema
      }

      const imagem = await gerarImagem(descricao);
      if (!imagem) {
        await enviarMsg(sock, chatId, { text: 'Deu ruim pra gerar a imagem agora 😕 tenta de novo' });
        return;
      }

      await enviarMsg(sock, chatId, { image: imagem, caption: descricao });
      return;
    }

    // Comando /dado - rola um dado de 1 a 6
    if (texto.trim().toLowerCase() === '/dado') {
      const resultado = Math.floor(Math.random() * 6) + 1;
      await enviarMsg(sock, chatId, { text: `🎲 Deu *${resultado}*!` });
      return;
    }

    // Comando /coin - cara ou coroa
    if (texto.trim().toLowerCase() === '/coin') {
      const resultado = Math.random() < 0.5 ? 'Cara' : 'Coroa';
      await enviarMsg(sock, chatId, { text: `🪙 Deu *${resultado}*!` });
      return;
    }

    // Comando /rate @pessoa - dá uma nota aleatória e uma fala engraçadinha (só em grupos)
    if (isGroup && texto.trim().toLowerCase().startsWith('/rate')) {
      const mentionedJid = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
      const alvoId = mentionedJid[0];

      if (!alvoId) {
        await enviarMsg(sock, chatId, { text: 'Menciona alguém! Ex: /rate @pessoa' });
        return;
      }

      const nota = Math.floor(Math.random() * 11); // 0 a 10
      const FALAS = ['🔥 Mandou bem!', '😅 Podia ser melhor...', '👑 Simplesmente perfeito(a)!', '🤔 Meio na média', '💀 Ixi...'];
      const fala = FALAS[Math.floor(Math.random() * FALAS.length)];

      await enviarMsg(sock, chatId, {
        text: `⭐ @${alvoId.split('@')[0]} recebeu nota *${nota}/10*! ${fala}`,
        mentions: [alvoId],
      });
      return;
    }

    // Comando /duelo @pessoa - batalha aleatória entre dois membros (só com RPG ativado)
    if (isGroup && texto.trim().toLowerCase().startsWith('/duelo')) {
      if (!estado.rpgAtivoNoGrupo(chatId)) {
        await enviarMsg(sock, chatId, { text: 'O sistema de RPG não tá ativado nesse grupo ainda 😕' });
        return;
      }

      const mentionedJid = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
      const alvoId = mentionedJid[0];

      if (!alvoId) {
        await enviarMsg(sock, chatId, { text: 'Menciona alguém pra duelar! Ex: /duelo @pessoa' });
        return;
      }

      if (alvoId === remetenteId) {
        await enviarMsg(sock, chatId, { text: 'Não dá pra duelar com você mesmo! 😅' });
        return;
      }

      const nomeAlvo = contatosCache[alvoId] || alvoId.split('@')[0];
      const atkRemetente = Math.floor(Math.random() * 51) + 50; // 50 a 100
      const atkAlvo = Math.floor(Math.random() * 51) + 50;

      const vencedorId = atkRemetente >= atkAlvo ? remetenteId : alvoId;
      const nomeVencedor = vencedorId === remetenteId ? nomeRemetente : nomeAlvo;
      const perdedorId = vencedorId === remetenteId ? alvoId : remetenteId;
      const nomePerdedor = vencedorId === remetenteId ? nomeAlvo : nomeRemetente;

      estado.registrarDuelo(vencedorId, nomeVencedor, perdedorId, nomePerdedor);
      tops.registrarVitoria(chatId, vencedorId, nomeVencedor, 'duelo');
      const recompensa = rpg.addXp(vencedorId, nomeVencedor, 30);

      await enviarMsg(sock, chatId, {
        text:
          `⚔️ *BATALHA INICIADA!*\n${nomeRemetente} VS ${nomeAlvo}\n\n` +
          `💥 ${nomeRemetente}: ${atkRemetente} ATK\n🛡️ ${nomeAlvo}: ${atkAlvo} ATK\n\n` +
          `🏆 VENCEDOR: ${nomeVencedor}! (+30 XP)`,
        mentions: [remetenteId, alvoId],
      });
      const levelsGroups = rpg.allGroupIds('levels');
      for (const levelsChat of levelsGroups) {
        await enviarMsg(sock, levelsChat, { text: `✨ @${vencedorId.split('@')[0]} ganhou *+30 XP*! Agora está com *${recompensa.player.xp} XP* no nível *${recompensa.player.nivel}*.`, mentions: [vencedorId] });
        if (recompensa.subiu) await enviarMsg(sock, levelsChat, { text: `🎉 @${vencedorId.split('@')[0]} *SUBIU DE NÍVEL!* Agora é nível *${recompensa.nivelNovo}*!`, mentions: [vencedorId] });
      }
      return;
    }

    // Comando /perfil - mostra nível, XP, vitórias e derrotas (só com RPG ativado)
    if (isGroup && texto.trim().toLowerCase().startsWith('/perfil')) {
      if (!estado.rpgAtivoNoGrupo(chatId)) {
        await enviarMsg(sock, chatId, { text: 'O sistema de RPG não tá ativado nesse grupo ainda 😕' });
        return;
      }

      const mentionedJid = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
      const idAlvo = mentionedJid[0] || remetenteId;
      const nomeAlvo = mentionedJid[0] ? contatosCache[idAlvo] || idAlvo.split('@')[0] : nomeRemetente;

      const jogador = estado.obterJogador(idAlvo, nomeAlvo);
      const nivel = estado.xpParaNivel(jogador.xp);
      const xpNoNivel = jogador.xp % 100;
      const blocosCheios = Math.round(xpNoNivel / 10);
      const barra = '█'.repeat(blocosCheios) + '░'.repeat(10 - blocosCheios);

      await enviarMsg(sock, chatId, {
        text:
          `👤 *Perfil de ${jogador.nome}*\n\n` +
          `🏅 Nível ${nivel} — ${jogador.xp} XP\n${barra} ${xpNoNivel}%\n\n` +
          `🏆 Vitórias: ${jogador.vitorias}\n💀 Derrotas: ${jogador.derrotas}\n🕹️ Comandos usados: ${jogador.comandosUsados}`,
        mentions: mentionedJid[0] ? [idAlvo] : [],
      });
      return;
    }

    // Comandos "de ação" estilo Discord (/hug, /punch) - só funcionam em grupos
    const ACOES_DISCORD = {
      '/hug': { categoria: 'hug', verbo: 'abraçou', emoji: '🤗' },
      '/punch': { categoria: 'punch', verbo: 'socou', emoji: '👊' },
    };
    const primeiraPalavra = texto.trim().split(/\s+/)[0].toLowerCase();

    if (isGroup && ACOES_DISCORD[primeiraPalavra]) {
      const acao = ACOES_DISCORD[primeiraPalavra];
      const mentionedJid = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
      const alvoId = mentionedJid[0];

      if (!alvoId) {
        await enviarMsg(sock, chatId, { text: `Menciona alguém! Ex: ${primeiraPalavra} @pessoa` });
        return;
      }

      try {
        let respostaApi;
        try {
          respostaApi = await fetch(`https://nekos.best/api/v2/${acao.categoria}`, {
            headers: {
              'User-Agent': 'ChaimBot/1.0 (https://github.com/AbnnerF/COGB-AI)',
              Accept: 'application/json',
            },
          });
        } catch (erroRede) {
          throw new Error(`falha ao contatar a API de gifs: ${erroRede.message}`);
        }

        const textoResposta = await respostaApi.text();
        let dados;
        try {
          dados = JSON.parse(textoResposta);
        } catch (erroParse) {
          console.log('Resposta da nekos.best não era JSON:', textoResposta.slice(0, 300));
          throw new Error('resposta inesperada da API de gifs');
        }

        const urlGif = dados?.results?.[0]?.url;
        if (!urlGif) throw new Error('a API não devolveu nenhum gif');

        let bufferGif;
        try {
          const respostaGif = await fetch(urlGif, {
            headers: {
              'User-Agent': 'ChaimBot/1.0 (https://github.com/AbnnerF/COGB-AI)',
              Referer: 'https://nekos.best/',
            },
          });
          if (!respostaGif.ok) throw new Error(`status HTTP ${respostaGif.status}`);
          bufferGif = Buffer.from(await respostaGif.arrayBuffer());
          console.log(`Gif baixado: ${bufferGif.length} bytes (${urlGif})`);
          if (bufferGif.length < 1000) throw new Error(`gif baixado ficou pequeno demais (${bufferGif.length} bytes)`);
        } catch (erroRede) {
          throw new Error(`falha ao baixar o gif: ${erroRede.message}`);
        }

        const bufferVideo = await converterGifParaVideo(bufferGif);
        if (!bufferVideo) throw new Error('não consegui converter o gif pra vídeo');

        await enviarMsg(sock, chatId, {
          video: bufferVideo,
          gifPlayback: true,
          caption: `@${remetenteId.split('@')[0]} ${acao.verbo} @${alvoId.split('@')[0]}! ${acao.emoji}`,
          mentions: [remetenteId, alvoId],
        });
      } catch (err) {
        console.log(`Erro ao processar ${primeiraPalavra}:`, err.message);
        await enviarMsg(sock, chatId, { text: 'Deu ruim pra buscar o gif agora 😕 tenta de novo' });
      }
      return;
    }




    // ==================== JOGO DA FORCA ====================
    if (isGroup && textoLower === '/cancel forca') {
      if (forcasAtivas[chatId]) {
        const jogador = forcasAtivas[chatId].jogador;
        delete forcasAtivas[chatId];
        await enviarMsg(sock, chatId, {
          text: `🛑 @${jogador.split('@')[0]} cancelou a Forca.\n\nUse */forca* para começar outra.`,
          mentions: [jogador],
        });
      } else {
        await enviarMsg(sock, chatId, { text: 'ℹ️ Não existe uma partida de Forca ativa neste grupo.' });
      }
      return;
    }

    if (isGroup && textoLower === '/forca') {
      if (forcasAtivas[chatId]) {
        await enviarMsg(sock, chatId, { text: '⚠️ Já existe uma partida de Forca neste grupo! Termine a atual ou use */cancel forca*.' });
        return;
      }

      const sorteio = sortearForca();
      forcasAtivas[chatId] = {
        ...sorteio,
        jogador: remetenteId,
        nomeJogador: nomeRemetente,
        letras: [],
        erros: 0,
        inicio: Date.now(),
      };

      await enviarMsg(sock, chatId, {
        text: `🔥 *Nova partida de FORCA!*\n\n👥 *Todos podem jogar!*\n\n${mensagemForca(forcasAtivas[chatId], '🎯 Quem descobrir primeiro vence!')}`,
      });
      return;
    }

    if (isGroup && forcasAtivas[chatId] && (!textoLower.startsWith('/') || textoLower.startsWith('/f ') || textoLower.startsWith('/forca '))) {
      const jogo = forcasAtivas[chatId];
      let tentativa = normalizarForca(textoLimpo);
      const tentativaPalavra = textoLower.startsWith('/f ') || textoLower.startsWith('/forca ');

      // Durante a partida, mensagens normais do grupo não contam como tentativa.
      // Para tentar a palavra inteira, use /f palavra ou /forca palavra.
      if (!tentativaPalavra && tentativa.length !== 1) return;
      if (tentativaPalavra) {
        const partes = textoLimpo.split(/\s+/);
        tentativa = normalizarForca(partes.slice(1).join(' '));
        if (!tentativa) return;
      }

      if (tentativa.length > 1) {
        if (tentativa === jogo.normalizada) {
          const tempo = Math.max(1, Math.round((Date.now() - jogo.inicio) / 1000));
          delete forcasAtivas[chatId];
          tops.registrarVitoria(chatId, remetenteId, nomeRemetente, 'forca');
          await enviarMsg(sock, chatId, {
            text: `🏆 *@${remetenteId.split('@')[0]} venceu a FORCA!*\n\n` +
              `🎯 Palavra: *${jogo.normalizada}*\n` +
              `❌ Erros: *${jogo.erros}/6*\n` +
              `⏱️ Tempo: *${tempo}s*\n\n` +
              `🎉 Parabéns! Use */forca* para jogar novamente.`,
            mentions: [remetenteId],
          });
        } else {
          jogo.erros += 1;
          if (jogo.erros >= 6) {
            delete forcasAtivas[chatId];
            await enviarMsg(sock, chatId, {
              text: `💀 *Fim de jogo!*\n\n` +
                `A palavra era: *${jogo.normalizada}*\n` +
                `😢 Ninguém conseguiu descobrir a palavra.\n\n` +
                `Tente novamente com */forca*!`,
            });
          } else {
            await enviarMsg(sock, chatId, { text: mensagemForca(jogo, '❌ Palavra incorreta! Você perdeu 1 tentativa.') });
          }
        }
        return;
      }

      const letra = tentativa;
      if (jogo.letras.includes(letra)) {
        await enviarMsg(sock, chatId, { text: `⚠️ A letra *${letra}* já foi usada!\n\n${mensagemForca(jogo)}` });
        return;
      }

      jogo.letras.push(letra);

      if (!jogo.normalizada.includes(letra)) {
        jogo.erros += 1;
        if (jogo.erros >= 6) {
          delete forcasAtivas[chatId];
          await enviarMsg(sock, chatId, {
            text: `💀 *Fim de jogo!*\n\n` +
              `A palavra era: *${jogo.normalizada}*\n` +
              `😢 Ninguém conseguiu descobrir a palavra.\n\n` +
              `Tente novamente com */forca*!`,
          });
        } else {
          await enviarMsg(sock, chatId, { text: mensagemForca(jogo, `❌ A letra *${letra}* não está na palavra!`) });
        }
        return;
      }

      if ([...jogo.normalizada].every((l) => jogo.letras.includes(l))) {
        const tempo = Math.max(1, Math.round((Date.now() - jogo.inicio) / 1000));
        delete forcasAtivas[chatId];
        tops.registrarVitoria(chatId, remetenteId, nomeRemetente, 'forca');
        await enviarMsg(sock, chatId, {
          text: `🏆 *@${remetenteId.split('@')[0]} venceu a FORCA!*\n\n` +
            `🎯 Palavra: *${jogo.normalizada}*\n` +
            `❌ Erros: *${jogo.erros}/6*\n` +
            `⏱️ Tempo: *${tempo}s*\n\n` +
            `🎉 Parabéns! Use */forca* para jogar novamente.`,
          mentions: [remetenteId],
        });
      } else {
        await enviarMsg(sock, chatId, { text: mensagemForca(jogo, `✅ Boa! A letra *${letra}* existe na palavra.`) });
      }
      return;
    }

    // ==================== TOPS DAS BRINCADEIRAS ====================
    // /tops ou /top = ranking geral do grupo
    // /tops forca | /tops quiz | /tops duelo = ranking por brincadeira
    if (isGroup && (textoLower === '/tops' || textoLower.startsWith('/tops ') || textoLower === '/top')) {
      const parte = textoLower === '/top' ? 'geral' : textoLimpo.slice(5).trim().toLowerCase();
      const mapa = {
        '': 'total',
        'geral': 'total',
        'total': 'total',
        'forca': 'forca',
        'força': 'forca',
        'quiz': 'quiz',
        'duelo': 'duelo',
        'outras': 'outras',
      };
      const categoria = mapa[parte];

      if (!categoria) {
        await enviarMsg(sock, chatId, {
          text: `🏆 *TOPS DAS BRINCADEIRAS*\n\nUse:\n/tops — ranking geral\n/tops forca — melhores da Forca\n/tops quiz — melhores do Quiz\n/tops duelo — melhores dos duelos\n/tops outras — outras brincadeiras`,
        });
        return;
      }

      await enviarMsg(sock, chatId, { text: tops.formatarRanking(chatId, categoria) });
      return;
    }

    // Comando /pack <tema> - encontra UM pacote real do tema e envia o pacote inteiro
    if (textoLower.startsWith('/pack ')) {
      const temaPack = textoLimpo.slice(6).trim();
      if (!temaPack) {
        await enviarMsg(sock, chatId, {
          text: '📦 Use assim: /pack memes\nExemplo: /pack Dragon Ball',
        });
        return;
      }

      try {
        await sock.sendPresenceUpdate('composing', chatId);
      } catch (err) {}

      await enviarMsg(sock, chatId, {
        text: `🔎 *Procurando um pacote de ${temaPack}...*\n\nVou procurar packs relacionados ao tema, não somente packs cujo nome seja exatamente igual. 📦🔍`,
      });

      const packEncontrado = await buscarPackCompletoPorTema(temaPack);
      if (!packEncontrado || !packEncontrado.stickers?.length) {
        await enviarMsg(sock, chatId, {
          text: `❌ Não consegui encontrar um pacote utilizável para *${temaPack}* agora.\n\nTenta outro tema.`,
        });
        return;
      }

      try {
        await enviarPacoteDeFigurinhas(
          sock,
          chatId,
          packEncontrado.stickers,
          packEncontrado.nome,
          packEncontrado.publisher || 'Sticker.ly'
        );

        await enviarMsg(sock, chatId, {
          text: `🎉 *Pacote encontrado!*\n\n📦 *${packEncontrado.nome}*\n🖼️ ${packEncontrado.stickers.length} figurinhas\n\nTema pesquisado: *${temaPack}*`,
        });
      } catch (e) {
        console.log('Erro ao enviar pacote encontrado:', e.message);
        await enviarMsg(sock, chatId, {
          text: '❌ Encontrei o pacote, mas o seu Baileys não conseguiu enviá-lo como pacote. Confira a atualização do Baileys incluída neste ZIP.',
        });
      }
      return;
    }

    // Comando /packs <tema> - pesquisa packs públicos e manda os links para o usuário
    if (textoLower.startsWith('/packs ')) {
      const termoPacks = textoLimpo.slice(7).trim();
      if (!termoPacks) {
        await enviarMsg(sock, chatId, {
          text: '🔎 Use assim: /packs memes\nExemplo: /packs animais',
        });
        return;
      }

      try {
        await sock.sendPresenceUpdate('composing', chatId);
      } catch (err) {}

      const packsEncontrados = await pesquisarPacksStickerLy(termoPacks);
      if (!packsEncontrados.length) {
        await enviarMsg(sock, chatId, {
          text: `😕 Não encontrei packs para *${termoPacks}* agora.`,
        });
        return;
      }

      const linhas = [`🔎 *Packs encontrados para: ${termoPacks}*`, ''];
      packsEncontrados.forEach((pack, index) => {
        linhas.push(`${index + 1}. *${pack.nome}*`);
        linhas.push(`   ${pack.link}`);
        linhas.push('');
      });
      linhas.push('💡 Os links abrem os packs no Sticker.ly.');

      await enviarMsg(sock, chatId, { text: linhas.join('\n') });
      return;
    }

    // /updates — novidades atuais do bot
    if (texto.trim().toLowerCase() === '/updates' || texto.trim().toLowerCase() === '/update') {
      await enviarMsg(sock, chatId, {
        text: `🚀 *ATUALIZAÇÕES DO COGB-AI*\n\n` +
          `🎵 *Música*\n` +
          `• /play — pesquisa músicas por nome ou link\n` +
          `• Busca aproximada para nomes digitados errado\n` +
          `• Links do Spotify podem ser usados para identificar a faixa\n\n` +
          `🎮 *Brincadeiras*\n` +
          `• /forca — jogo da Forca\n` +
          `• /quiz — sistema de Quiz\n` +
          `• /duelo — duelos entre jogadores\n` +
          `• /tops — ranking das brincadeiras\n\n` +
          `🎨 *Figurinhas*\n` +
          `• /create fig — cria figurinha\n` +
          `• /create pack — cria packs com fotos e vídeos\n` +
          `• /pack <tema> — procura packs por tema\n` +
          `• /packs <tema> — encontra packs disponíveis\n\n` +
          `⚔️ *RPG*\n` +
          `• Sistema de níveis, XP, inventário, inimigos, batalhas e história.\n\n` +
          `🤖 *Modo /bot participante:* conversa com o grupo, responde quando chamado e pode entrar espontaneamente no assunto.\n\n` +
          `🐾 *Pokémon Beta 0.1:* /pokemon, /choose, /pokemons, /mapa e /help p.\n` +
          `🚫 Grandes lendários e trios ainda não foram liberados.\n\n` +
          `🤖 *Também temos correção automática de pequenos erros nos comandos.*`,
      });
      return;
    }
    // /menu — usa o menu centralizado em mensagens.js.
    if (texto.trim().toLowerCase() === '/menu') {
      await enviarMsg(sock, chatId, { text: MENSAGEM_MENU });
      return;
    }
    // Comando /feedback <mensagem> - encaminha pro dono do bot
    if (texto.trim().toLowerCase().startsWith('/feedback ')) {
      const mensagemFeedback = texto.trim().slice(10).trim();

      if (!mensagemFeedback) {
        await enviarMsg(sock, chatId, { text: 'Escreve o feedback depois do comando! Ex: /feedback esse bot é muito bom!' });
        return;
      }

      const donoId = estado.obterDono();
      if (donoId) {
        let origem = nomeRemetente;
        if (isGroup) {
          try {
            const metadata = await sock.groupMetadata(chatId);
            origem = `${nomeRemetente} (grupo: ${metadata.subject || chatId})`;
          } catch (err) {
            origem = `${nomeRemetente} (grupo)`;
          }
        }

        try {
          await enviarMsg(sock, donoId, {
            text: `📝 *Novo feedback recebido!*\n\n👤 De: ${origem}\n\n"${mensagemFeedback}"`,
          });
        } catch (err) {
          console.log('Erro ao encaminhar feedback:', err.message);
        }
      } else {
        console.log('Feedback recebido, mas ainda não tem dono definido:', mensagemFeedback);
      }

      await enviarMsg(sock, chatId, { text: '✅ Feedback enviado, valeu! 💙' });
      return;
    }


    // Se /play ficou ambíguo, a próxima mensagem informa o cantor/artista.
    const chavePlay = `${chatId}:${remetenteId}`;
    if (aguardandoArtistaPlay[chavePlay] && !textoLower.startsWith('/')) {
      const pendente = aguardandoArtistaPlay[chavePlay];
      clearTimeout(pendente.timeoutHandle);
      delete aguardandoArtistaPlay[chavePlay];
      const buscaFinal = `${pendente.consulta} ${textoLimpo}`.trim();
      await enviarMsg(sock, chatId, { text: `🔎 Procurando *${pendente.consulta}* do artista *${textoLimpo}*...` });
      const resultado = await pesquisarMusicaNoYoutube(buscaFinal);
      if (!resultado) {
        await enviarMsg(sock, chatId, { text: '❌ Não encontrei essa música com esse artista. Tenta /play novamente com mais detalhes.' });
        return;
      }
      const audio = await baixarAudioDoYoutube(resultado.url);
      if (!audio) {
        await enviarMsg(sock, chatId, { text: '❌ Encontrei a música, mas não consegui obter o áudio agora.' });
        return;
      }
      await enviarMsg(sock, chatId, { text: `🎵 *${resultado.titulo}*\n\n▶️ Encontrada pelo COGB-AI!` });
      await sock.sendMessage(chatId, { audio, mimetype: 'audio/mpeg' });
      return;
    }

    // Comando /play <música ou link> - pesquisa por nome, YouTube ou Spotify.
    if (textoLower === '/play' || textoLower.startsWith('/play ')) {
      const consulta = textoLimpo.slice(5).trim();
      if (!consulta) {
        await enviarMsg(sock, chatId, {
          text: '🎵 Use assim: */play nome da música*\n\nTambém pode usar um link do YouTube ou Spotify.'
        });
        return;
      }

      try { await sock.sendPresenceUpdate('composing', chatId); } catch (err) {}

      let resultado = null;
      const linkYoutube = consulta.match(REGEX_YOUTUBE);
      const linkSpotify = consulta.match(REGEX_SPOTIFY);

      if (linkYoutube) {
        resultado = { url: linkYoutube[1], titulo: 'Música do YouTube' };
      } else if (linkSpotify) {
        await enviarMsg(sock, chatId, { text: '🟢 Lendo a música do Spotify e procurando o áudio...' });
        const spotify = await obterDadosSpotify(linkSpotify[1]);
        if (!spotify) {
          await enviarMsg(sock, chatId, { text: '❌ Não consegui identificar essa faixa do Spotify.' });
          return;
        }
        const candidatos = await pesquisarMusicasNoYoutube(spotify.busca, 5);
        resultado = candidatos[0] || null;
        if (resultado) resultado.titulo = `${spotify.titulo} — ${spotify.autor}`;
      } else {
        await enviarMsg(sock, chatId, { text: `🔎 Procurando *${consulta}*...` });
        const candidatos = await pesquisarMusicasNoYoutube(consulta, 5);
        resultado = candidatos[0] || null;

        // Se a busca ficou pouco confiável, perguntamos o artista em vez de
        // arriscar enviar uma música errada.
        if (resultado && resultado.pontuacao < 0.60 && consulta.split(/\s+/).length <= 7) {
          const timeoutHandle = setTimeout(() => delete aguardandoArtistaPlay[chavePlay], 2 * 60 * 1000);
          aguardandoArtistaPlay[chavePlay] = { consulta, timeoutHandle };
          await enviarMsg(sock, chatId, {
            text: `🤔 Encontrei algumas músicas parecidas, mas não tenho certeza de qual é.\n\n🎤 Qual é o nome do cantor/artista de *${consulta}*?`
          });
          return;
        }
      }

      if (!resultado) {
        await enviarMsg(sock, chatId, { text: '❌ Não encontrei essa música. Tenta escrever mais algum detalhe ou o nome do artista.' });
        return;
      }

      const audio = await baixarAudioDoYoutube(resultado.url);
      if (!audio) {
        await enviarMsg(sock, chatId, { text: '❌ Encontrei a música, mas não consegui obter o áudio agora. Tenta novamente daqui a pouco.' });
        return;
      }

      await enviarMsg(sock, chatId, { text: `🎵 *${resultado.titulo}*\n\n▶️ Encontrada pelo COGB-AI!` });
      await sock.sendMessage(chatId, { audio, mimetype: 'audio/mpeg' });
      return;
    }

    // Comando /audio - pede pra pessoa mandar o vídeo, ou já aceita um link do YouTube direto
    if (texto.trim().toLowerCase().startsWith('/audio')) {
      const linkJunto = texto.match(REGEX_YOUTUBE);

      if (linkJunto) {
        try {
          await sock.sendPresenceUpdate('composing', chatId);
        } catch (err) {
          // sem problema se não conseguir mostrar "digitando"
        }

        const audio = await baixarAudioDoYoutube(linkJunto[1]);

        if (!audio) {
          await enviarMsg(sock, chatId, {
            text: 'Deu ruim pra baixar esse vídeo do YouTube 😕 confere o link e tenta de novo',
          });
          return;
        }

        await enviarMsg(sock, chatId, { audio, mimetype: 'audio/mpeg' });
        return;
      }

      aguardandoAudio[chaveEspera] = setTimeout(() => {
        delete aguardandoAudio[chaveEspera];
      }, 5 * 60 * 1000); // expira em 5 minutos se ninguém mandar nada

      await enviarMsg(sock, chatId, {
        text: 'Manda o vídeo que você quer transformar em áudio, ou cola um link do YouTube! 🎬🎵',
      });
      return;
    }

    // Comando /convert - pede pra pessoa mandar a figurinha (funciona em grupo ou no privado)
    if (texto.trim().toLowerCase() === '/convert') {
      aguardandoConversao[chaveEspera] = setTimeout(() => {
        delete aguardandoConversao[chaveEspera];
      }, 5 * 60 * 1000); // expira em 5 minutos se ninguém mandar a figurinha

      await enviarMsg(sock, chatId, {
        text: 'Manda a figurinha que você quer converter! 🔄 Normal vira imagem, animada vira vídeo.',
      });
      return;
    }

    // Comando /Create fig - pede pra pessoa mandar a foto (funciona em grupo ou no privado)
    if (texto.trim().toLowerCase() === '/create fig') {
      aguardandoFoto[chaveEspera] = setTimeout(() => {
        delete aguardandoFoto[chaveEspera];
      }, 5 * 60 * 1000); // expira em 5 minutos se ninguém mandar a foto

      await enviarMsg(sock, chatId, {
        text: `Manda a foto, vídeo ou GIF aí! 📸 Se quiser, coloca uma legenda — isso vira o nome da figurinha. (vídeos com mais de ${DURACAO_MAXIMA_FIGURINHA}s são cortados automaticamente)\n\n🛑 Para cancelar: */cancel fig*`,
      });
      return;
    }

    // Comando /fig <descrição> - gera uma figurinha com IA (funciona em grupo ou no privado)
    if (texto.trim().toLowerCase().startsWith('/fig ')) {
      const descricao = texto.trim().slice(5).trim();
      if (!descricao) {
        await enviarMsg(sock, chatId, { text: 'Descreve o que você quer na figurinha! Ex: /fig gato astronauta' });
        return;
      }

      try {
        await sock.sendPresenceUpdate('composing', chatId);
      } catch (err) {
        // sem problema se não conseguir mostrar "digitando"
      }

      const figurinha = await gerarFigurinha(descricao);
      if (!figurinha) {
        await enviarMsg(sock, chatId, { text: 'Deu ruim pra gerar a figurinha agora 😕 tenta de novo' });
        return;
      }

      await enviarMsg(sock, chatId, { sticker: figurinha });
      return;
    }
  });

  // Verificação periódica da área de inimigos: um novo encontro surge a cada 3-5 horas.
  if (!global.__cogbRpgScheduler) {
    global.__cogbRpgScheduler = true;
    const agendarInimigos = () => {
      const espera = (3 * 60 * 60 * 1000) + Math.floor(Math.random() * (2 * 60 * 60 * 1000));
      setTimeout(async () => {
        if (rpg.isEnabled()) {
          for (const enemyChat of rpg.allGroupIds('inimigos')) {
            try {
              const e = rpg.generateEnemy(enemyChat);
              await enviarMsg(sock, enemyChat, { text: `🚨 *NOVOS INIMIGOS CHEGARAM À ÁREA!*\n\n👹 *${e.nome}*\n❤️ ${e.hp}/${e.maxHp} HP\n⚔️ Dano: ${e.dano}\n💨 Velocidade: ${e.velocidade}\n\nPreparem-se, aventureiros! Use */battle* para enfrentar.` });
            } catch (err) { console.log('Erro no encontro automático:', err.message); }
          }
        }
        agendarInimigos();
      }, espera);
    };
    agendarInimigos();
  }
}

iniciarBot();

