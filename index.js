require('dotenv').config();

process.on('uncaughtException', (err) => console.error('[ERRO NAO TRATADO]:', err?.stack || err));
process.on('unhandledRejection', (err) => console.error('[REJEICAO NAO TRATADA]:', err?.stack || err));

// Mantém o event loop ativo na Deplexo
setInterval(() => {}, 1000 * 60 * 60);

const fs = require('fs');
const path = require('path');
const os = require('os');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');

const estado = require('./estado');
const mensagens = require('./mensagens');
const pokemon = require('./pokemon');
const rpg = require('./rpg');
const tops = require('./tops');
const chatbot = require('./chatbot');
const sticker = require('./sticker');

const CRIADOR_NUMERO = (process.env.ADMIN_NUMBER || '5565996799870').replace(/\D/g, '');
const BOT_NUMERO = (process.env.BOT_NUMBER || '5565996799870').replace(/\D/g, '');

// Estados em memória por chat/usuário
const esperandoFigurinha = new Set();
const esperandoConversao = new Set();
const jogosForca = new Map();
const jogosQuiz = new Map();
const partidasUno = new Map();
const partidasAmong = new Map();
const historicoBot = new Map();

const PALAVRAS_FORCA = [
  { palavra: 'ABACAXI', dica: 'Fruta tropical com coroa' },
  { palavra: 'COMPUTADOR', dica: 'Máquina usada para programar e jogar' },
  { palavra: 'PIKACHU', dica: 'Pokémon elétrico mais famoso' },
  { palavra: 'ASTRONAUTA', dica: 'Profissional que viaja para o espaço' },
  { palavra: 'CHOCOLATE', dica: 'Doce feito de cacau' },
  { palavra: 'DINOSSAURO', dica: 'Réptil pré-histórico gigante' },
  { palavra: 'GUITARRA', dica: 'Instrumento musical de cordas' },
  { palavra: 'VULCAO', dica: 'Montanha que expele lava' },
  { palavra: 'PIRATA', dica: 'Navegador em busca de tesouros' },
  { palavra: 'SAMURAI', dica: 'Guerreiro tradicional do Japão' },
];

const PERGUNTAS_QUIZ = [
  { p: 'Qual o maior planeta do Sistema Solar?', r: 'jupiter', opcoes: 'A) Saturno  B) Júpiter  C) Marte' },
  { p: 'Quantos estados tem o Brasil (sem contar o DF)?', r: '26', opcoes: 'A) 25  B) 26  C) 27' },
  { p: 'Qual elemento químico tem símbolo O?', r: 'oxigenio', opcoes: 'A) Ouro  B) Ósmio  C) Oxigênio' },
  { p: 'Em que ano o homem pisou na Lua pela primeira vez?', r: '1969', opcoes: 'A) 1965  B) 1969  C) 1972' },
  { p: 'Qual Pokémon inicial de Kanto é do tipo Fogo?', r: 'charmander', opcoes: 'A) Bulbasaur  B) Squirtle  C) Charmander' },
  { p: 'Qual o animal terrestre mais rápido do mundo?', r: 'guepardo', opcoes: 'A) Leão  B) Guepardo  C) Cavalo' },
];

function normalizarTexto(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function extrairNumero(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

function ehCriador(senderJid) {
  const num = extrairNumero(senderJid);
  if (!num) return false;
  if (num === CRIADOR_NUMERO) return true;
  if (estado.ehDono(senderJid)) return true;
  return false;
}

function extrairTextoMensagem(m) {
  if (!m || !m.message) return '';
  const msg = m.message;
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.buttonsResponseMessage?.selectedButtonId ||
    msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ''
  ).trim();
}

function obterMencionados(m) {
  const ctx =
    m.message?.extendedTextMessage?.contextInfo ||
    m.message?.imageMessage?.contextInfo ||
    m.message?.videoMessage?.contextInfo ||
    {};
  const lista = [...(ctx.mentionedJid || [])];
  if (ctx.participant && !lista.includes(ctx.participant)) {
    lista.push(ctx.participant);
  }
  return lista;
}

function tagUsuario(jid) {
  return `@${extrairNumero(jid)}`;
}

// Correção leve de erros comuns de digitação nos comandos
function corrigirComando(cmd) {
  const mapa = {
    '/creat': '/create',
    '/paly': '/play',
    '/mnu': '/menu',
    '/men': '/menu',
    '/pokmon': '/pokemon',
    '/pokenon': '/pokemon',
    '/captura': '/capturar',
    '/viaja': '/viajar',
    '/convrt': '/convert',
    '/converter': '/convert',
    '/duel': '/duelo',
    '/top': '/tops',
    '/forc': '/forca',
    '/quizz': '/quiz',
    '/un': '/uno',
    '/among': '/amongus',
  };
  return mapa[cmd] || cmd;
}

function criarBaralhoUno() {
  const cores = ['🔴 Vermelho', '🔵 Azul', '🟢 Verde', '🟡 Amarelo'];
  const valores = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+2', 'Inverter', 'Pular'];
  const baralho = [];
  for (const cor of cores) {
    for (const val of valores) {
      baralho.push(`${cor} ${val}`);
    }
  }
  baralho.push('🌈 Coringa', '🌈 Coringa +4', '🌈 Coringa', '🌈 Coringa +4');
  return baralho.sort(() => Math.random() - 0.5);
}

let codigoJaSolicitado = false;

async function iniciarBot() {
  try {
    const baseDir = fs.existsSync('/data') ? '/data' : os.tmpdir();
    const pastaAuth = path.join(baseDir, 'cogb-ai-auth');
    if (!fs.existsSync(pastaAuth)) {
      fs.mkdirSync(pastaAuth, { recursive: true });
    }

    console.log('🚀 [1/4] Iniciando CHAIM-BOT / COGB-AI completo...');
    console.log('📂 [2/4] Pasta de sessão:', pastaAuth);

    const { state, saveCreds } = await useMultiFileAuthState(pastaAuth);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      syncFullHistory: false,
      markOnlineOnConnect: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'connecting') {
        console.log('🔌 [3/4] Conectando aos servidores do WhatsApp...');
      }

      if (!sock.authState.creds.registered && !codigoJaSolicitado) {
        codigoJaSolicitado = true;
        setTimeout(async () => {
          try {
            console.log(`🔑 [4/4] Solicitando código de pareamento para: ${BOT_NUMERO}...`);
            const code = await sock.requestPairingCode(BOT_NUMERO);
            console.log('\n================================================');
            console.log(`👉 SEU CÓDIGO DE PAREAMENTO: ${code}`);
            console.log('================================================\n');
          } catch (err) {
            console.error('❌ Erro ao solicitar código de pareamento:', err.message);
            codigoJaSolicitado = false;
          }
        }, 4000);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`⚠️ Conexão fechada (status ${statusCode}). Reconectando: ${shouldReconnect}`);
        if (shouldReconnect) {
          setTimeout(iniciarBot, 3500);
        }
      } else if (connection === 'open') {
        console.log('✅ CHAIM-BOT COMPLETO ONLINE E PRONTO PARA USO!');
      }
    });

    // Evento de entrada de participantes em grupos (saudação ao Criador ou aviso de grupo novo)
    sock.ev.on('group-participants.update', async (evento) => {
      try {
        const { id: chatId, participants, action } = evento;
        if (action !== 'add' || !Array.isArray(participants)) return;

        const botJid = sock.user?.id ? `${extrairNumero(sock.user.id)}@s.whatsapp.net` : '';

        for (const p of participants) {
          const pNum = extrairNumero(p);
          if (botJid && pNum === extrairNumero(botJid)) {
            if (!estado.temStatusRegistrado(chatId)) {
              estado.definirStatusGrupo(chatId, 'autorizado');
              await sock.sendMessage(chatId, { text: mensagens.MENSAGEM_GRUPO_ATIVADO });
            }
          } else if (pNum === CRIADOR_NUMERO) {
            await sock.sendMessage(chatId, {
              text: `👑✨ Atenção todos! O meu Criador ${tagUsuario(p)} acabou de entrar no grupo! Seja bem-vindo, chefe! 🤖💙`,
              mentions: [p],
            });
          }
        }
      } catch (e) {
        console.error('Erro group-participants.update:', e.message);
      }
    });

    // Processamento principal de mensagens
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const m of messages) {
        try {
          if (!m.message || m.key.fromMe) continue;

          const chatId = m.key.remoteJid;
          if (!chatId || chatId === 'status@broadcast') continue;

          const isGroup = chatId.endsWith('@g.us');
          const senderId = isGroup ? (m.key.participant || chatId) : chatId;
          const pushName = m.pushName || extrairNumero(senderId);
          const criador = ehCriador(senderId);

          if (criador && !estado.obterDono()) {
            estado.registrarCriadorUmaVez(senderId);
          }

          // Boas-vindas no PV na primeira interação
          if (!isGroup && !estado.jaRecebeuBoasVindas(senderId)) {
            estado.marcarBoasVindas(senderId);
            await sock.sendMessage(chatId, { text: mensagens.MENSAGEM_BOAS_VINDAS_PV });
          }

          // Verifica status do grupo (comandos administrativos /autorizar e /recusar)
          const textoBruto = extrairTextoMensagem(m);
          const textoLower = textoBruto.toLowerCase();

          if (isGroup && criador && textoLower === '/autorizar') {
            estado.definirStatusGrupo(chatId, 'autorizado');
            await sock.sendMessage(chatId, { text: mensagens.MENSAGEM_GRUPO_ATIVADO });
            continue;
          }

          if (isGroup && criador && textoLower === '/recusar') {
            estado.definirStatusGrupo(chatId, 'recusado');
            await sock.sendMessage(chatId, { text: mensagens.MENSAGEM_GRUPO_RECUSADO });
            await sock.groupLeave(chatId);
            continue;
          }

          if (isGroup && estado.statusDoGrupo(chatId) === 'pendente' && !criador) {
            if (textoBruto.startsWith('/')) {
              await sock.sendMessage(chatId, { text: mensagens.MENSAGEM_GRUPO_PENDENTE });
            }
            continue;
          }

          const chaveEspera = `${chatId}:${senderId}`;

          // 1. Fluxo de criação de figurinha após /create fig
          const msgImagem = m.message.imageMessage || m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
          const msgVideo = m.message.videoMessage || m.message.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
          const msgSticker = m.message.stickerMessage || m.message.extendedTextMessage?.contextInfo?.quotedMessage?.stickerMessage;

          if (esperandoFigurinha.has(chaveEspera) && (msgImagem || msgVideo)) {
            esperandoFigurinha.delete(chaveEspera);
            await sock.sendMessage(chatId, { text: '⏳ Criando sua figurinha, aguarde...' }, { quoted: m });

            const alvoDownload = m.message.imageMessage || m.message.videoMessage
              ? m
              : {
                  key: m.key,
                  message: m.message.extendedTextMessage.contextInfo.quotedMessage,
                };

            const buffer = await downloadMediaMessage(alvoDownload, 'buffer', {});
            const webp = msgImagem
              ? await sticker.criarFigurinhaImagem(buffer)
              : await sticker.criarFigurinhaVideo(buffer);

            if (webp) {
              await sock.sendMessage(chatId, { sticker: webp }, { quoted: m });
              estado.adicionarXp(senderId, pushName, 10);
            } else {
              await sock.sendMessage(chatId, { text: '❌ Não consegui transformar essa mídia em figurinha.' }, { quoted: m });
            }
            continue;
          }

          // 2. Fluxo de conversão de figurinha após /convert
          if (esperandoConversao.has(chaveEspera) && msgSticker) {
            esperandoConversao.delete(chaveEspera);
            await sock.sendMessage(chatId, { text: '🔄 Convertendo figurinha...' }, { quoted: m });

            const alvoDownload = m.message.stickerMessage
              ? m
              : {
                  key: m.key,
                  message: m.message.extendedTextMessage.contextInfo.quotedMessage,
                };

            const buffer = await downloadMediaMessage(alvoDownload, 'buffer', {});
            const png = await sticker.converterFigurinhaParaPng(buffer);
            if (png) {
              await sock.sendMessage(chatId, { image: png, caption: '✅ Figurinha convertida!' }, { quoted: m });
            } else {
              await sock.sendMessage(chatId, { text: '❌ Erro ao converter essa figurinha.' }, { quoted: m });
            }
            continue;
          }

          // 3. Resposta ativa de Quiz no chat
          if (jogosQuiz.has(chatId) && textoBruto && !textoBruto.startsWith('/')) {
            const q = jogosQuiz.get(chatId);
            if (normalizarTexto(textoBruto) === q.r) {
              jogosQuiz.delete(chatId);
              if (isGroup) tops.registrarVitoria(chatId, senderId, pushName, 'quiz');
              const resXp = estado.adicionarXp(senderId, pushName, 25);
              await sock.sendMessage(chatId, {
                text: `🎉 *ACERTOU!* Parabéns ${tagUsuario(senderId)}! (+25 XP${resXp.subiuDeNivel ? ` • Subiu para o Nível ${resXp.nivelNovo}!` : ''})`,
                mentions: [senderId],
              }, { quoted: m });
              continue;
            }
          }

          // 4. Resposta ativa de Forca (letra ou palavra inteira)
          if (jogosForca.has(chatId) && textoBruto && !textoBruto.startsWith('/')) {
            const f = jogosForca.get(chatId);
            const palpite = normalizarTexto(textoBruto).toUpperCase();
            if (palpite.length === 1 && /^[A-Z]$/.test(palpite)) {
              if (f.letras.includes(palpite)) {
                await sock.sendMessage(chatId, { text: `⚠️ A letra *${palpite}* já foi tentada!` }, { quoted: m });
                continue;
              }
              f.letras.push(palpite);
              if (!f.palavra.includes(palpite)) {
                f.erros += 1;
              }
              const mascarada = f.palavra.split('').map((l) => (f.letras.includes(l) ? l : '_')).join(' ');
              if (!mascarada.includes('_')) {
                jogosForca.delete(chatId);
                if (isGroup) tops.registrarVitoria(chatId, senderId, pushName, 'forca');
                estado.adicionarXp(senderId, pushName, 30);
                await sock.sendMessage(chatId, {
                  text: `🏆 *VITÓRIA NA FORCA!* ${tagUsuario(senderId)} completou a palavra: *${f.palavra}* (+30 XP)!`,
                  mentions: [senderId],
                });
              } else if (f.erros >= 6) {
                jogosForca.delete(chatId);
                await sock.sendMessage(chatId, { text: `💀 *FIM DE JOGO!* Vocês perderam. A palavra era: *${f.palavra}*.` });
              } else {
                await sock.sendMessage(chatId, {
                  text: `💀 *FORCA*

Palavra: \`${mascarada}\`
Dica: ${f.dica}
Erros: ${f.erros}/6
Letras usadas: ${f.letras.join(', ')}`,
                });
              }
              continue;
            } else if (palpite === f.palavra) {
              jogosForca.delete(chatId);
              if (isGroup) tops.registrarVitoria(chatId, senderId, pushName, 'forca');
              estado.adicionarXp(senderId, pushName, 30);
              await sock.sendMessage(chatId, {
                text: `🏆 *ACERTOU EM CHEIO!* ${tagUsuario(senderId)} descobriu a palavra: *${f.palavra}* (+30 XP)!`,
                mentions: [senderId],
              });
              continue;
            }
          }

          // Se não começa com '/', checa se mencionaram o bot ou falaram "chaim"
          if (!textoBruto.startsWith('/')) {
            if (/chaim/i.test(textoBruto) && textoBruto.length > 4) {
              const hist = historicoBot.get(chatId) || [];
              const prefixoCriador = criador ? '[O usuário falando agora é o seu Criador] ' : '';
              hist.push({ role: 'user', content: `${prefixoCriador}${pushName}: ${textoBruto}` });
              if (hist.length > 8) hist.shift();
              const resp = await chatbot.gerarResposta(hist);
              hist.push({ role: 'assistant', content: resp });
              historicoBot.set(chatId, hist);
              await sock.sendMessage(chatId, { text: resp }, { quoted: m });
            }
            continue;
          }

          // Parse de comandos
          const partes = textoBruto.split(/\s+/);
          const cmdRaw = partes[0].toLowerCase();
          const cmd = corrigirComando(cmdRaw);
          const arg1 = (partes[1] || '').toLowerCase();
          const resto = partes.slice(1).join(' ').trim();
          const mencionados = obterMencionados(m);

          // === MENU E SISTEMA ===
          if (cmd === '/menu' || cmd === '/help' && arg1 !== 'p') {
            await sock.sendMessage(chatId, { text: mensagens.MENSAGEM_MENU }, { quoted: m });
            continue;
          }

          if (cmd === '/ligado' || cmd === '/ping' || cmd === '/status') {
            const uptimeMin = Math.floor(process.uptime() / 60);
            await sock.sendMessage(chatId, {
              text: `🟢 *CHAIM-BOT ONLINE!*
⏱️ Tempo ativo: ${uptimeMin} min
⚡ Todos os sistemas operacionais!`,
            }, { quoted: m });
            continue;
          }

          if (cmd === '/updates') {
            await sock.sendMessage(chatId, {
              text: `🆕 *ATUALIZAÇÕES DO CHAIM-BOT*

✅ Sistema completo restaurado (Pokémon, RPG, UNO, Among Us, Figurinhas, IA e Rankings)
✅ Estabilidade reforçada no servidor`,
            }, { quoted: m });
            continue;
          }

          if (cmd === '/feedback') {
            if (!resto) {
              await sock.sendMessage(chatId, { text: '💡 Escreva sua sugestão após o comando. Ex: */feedback adicionar mais pokémons*' }, { quoted: m });
            } else {
              console.log(`💡 FEEDBACK de ${pushName} (${senderId}): ${resto}`);
              await sock.sendMessage(chatId, { text: '💙 Obrigado pelo feedback! Sua mensagem foi registrada para o Criador.' }, { quoted: m });
            }
            continue;
          }

          if (cmd === '/call') {
            await sock.sendMessage(chatId, {
              text: `📞 *CONTATO DO CRIADOR*

Para suporte, parcerias ou autorizar o bot em novos grupos:
👉 https://wa.me/${CRIADOR_NUMERO}`,
            }, { quoted: m });
            continue;
          }

          // === FIGURINHAS & CONVERSÃO ===
          if (cmd === '/create' && (arg1 === 'fig' || arg1 === 'figurinha')) {
            if (msgImagem || msgVideo) {
              await sock.sendMessage(chatId, { text: '⏳ Criando figurinha...' }, { quoted: m });
              const alvoDownload = (m.message.imageMessage || m.message.videoMessage)
                ? m
                : { key: m.key, message: m.message.extendedTextMessage.contextInfo.quotedMessage };
              const buffer = await downloadMediaMessage(alvoDownload, 'buffer', {});
              const webp = msgImagem
                ? await sticker.criarFigurinhaImagem(buffer)
                : await sticker.criarFigurinhaVideo(buffer);
              if (webp) {
                await sock.sendMessage(chatId, { sticker: webp }, { quoted: m });
                estado.adicionarXp(senderId, pushName, 10);
              } else {
                await sock.sendMessage(chatId, { text: '❌ Não consegui criar a figurinha.' }, { quoted: m });
              }
            } else {
              esperandoFigurinha.add(chaveEspera);
              await sock.sendMessage(chatId, {
                text: '📸 Envie agora a *imagem* ou *vídeo* (até 6s) que você quer transformar em figurinha!',
              }, { quoted: m });
            }
            continue;
          }

          if (cmd === '/convert') {
            if (msgSticker) {
              await sock.sendMessage(chatId, { text: '🔄 Convertendo figurinha...' }, { quoted: m });
              const alvoDownload = m.message.stickerMessage
                ? m
                : { key: m.key, message: m.message.extendedTextMessage.contextInfo.quotedMessage };
              const buffer = await downloadMediaMessage(alvoDownload, 'buffer', {});
              const png = await sticker.converterFigurinhaParaPng(buffer);
              if (png) {
                await sock.sendMessage(chatId, { image: png, caption: '✅ Figurinha convertida!' }, { quoted: m });
              } else {
                await sock.sendMessage(chatId, { text: '❌ Não consegui converter essa figurinha.' }, { quoted: m });
              }
            } else {
              esperandoConversao.add(chaveEspera);
              await sock.sendMessage(chatId, {
                text: '🔄 Envie ou responda a uma *figurinha* agora para eu converter em imagem!',
              }, { quoted: m });
            }
            continue;
          }

          // === MÚSICA / YOUTUBE ===
          if (cmd === '/play' || cmd === '/audio') {
            if (!resto) {
              await sock.sendMessage(chatId, { text: '🎵 Cole o link do YouTube após o comando! Ex: */play https://youtu.be/...*' }, { quoted: m });
              continue;
            }
            await sock.sendMessage(chatId, { text: '🎧 Baixando áudio, aguarde alguns segundos...' }, { quoted: m });
            const audioBuffer = await sticker.baixarAudioDoYoutube(resto);
            if (audioBuffer) {
              await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: 'audio/mp4' }, { quoted: m });
            } else {
              await sock.sendMessage(chatId, { text: '❌ Não consegui baixar esse áudio agora. Verifique se o link é válido.' }, { quoted: m });
            }
            continue;
          }

          // === DIVERSÃO & INTERAÇÕES ===
          if (cmd === '/dado') {
            const n = Math.floor(Math.random() * 6) + 1;
            await sock.sendMessage(chatId, { text: `🎲 ${tagUsuario(senderId)} rolou o dado e tirou: *${n}*!`, mentions: [senderId] }, { quoted: m });
            continue;
          }

          if (cmd === '/moeda' || cmd === '/caraoucoroa') {
            const lado = Math.random() < 0.5 ? '🪙 *CARA*' : '👑 *COROA*';
            await sock.sendMessage(chatId, { text: `🪙 A moeda caiu em: ${lado}!` }, { quoted: m });
            continue;
          }

          if (cmd === '/hug' || cmd === '/punch' || cmd === '/kiss' || cmd === '/kill') {
            const alvo = mencionados[0];
            if (!alvo) {
              await sock.sendMessage(chatId, { text: `⚠️ Marque alguém para usar ${cmd}! Ex: *${cmd} @pessoa*` }, { quoted: m });
              continue;
            }
            const acoes = {
              '/hug': `🫂 ${tagUsuario(senderId)} deu um abraço apertado em ${tagUsuario(alvo)}! 💙`,
              '/punch': `👊 ${tagUsuario(senderId)} deu um socão épico em ${tagUsuario(alvo)}! 💥`,
              '/kiss': `💋 ${tagUsuario(senderId)} deu um beijo apaixonado em ${tagUsuario(alvo)}! ❤️✨`,
              '/kill': `💀 ${tagUsuario(senderId)} eliminou ${tagUsuario(alvo)} do mapa! ⚰️`,
            };
            await sock.sendMessage(chatId, { text: acoes[cmd], mentions: [senderId, alvo] }, { quoted: m });
            continue;
          }

          if (cmd === '/duelo') {
            const alvo = mencionados[0];
            if (!alvo || alvo === senderId) {
              await sock.sendMessage(chatId, { text: '⚔️ Marque um adversário válido! Ex: */duelo @pessoa*' }, { quoted: m });
              continue;
            }
            const ganhou = Math.random() < 0.5;
            const vencedor = ganhou ? senderId : alvo;
            const perdedor = ganhou ? alvo : senderId;
            const nomeVenc = ganhou ? pushName : extrairNumero(alvo);
            const nomePerd = ganhou ? extrairNumero(alvo) : pushName;

            estado.registrarDuelo(vencedor, nomeVenc, perdedor, nomePerd);
            if (isGroup) tops.registrarVitoria(chatId, vencedor, nomeVenc, 'duelo');

            await sock.sendMessage(chatId, {
              text: `⚔️ *DUELO ENCERRADO!*

🏆 Vencedor: ${tagUsuario(vencedor)} (+30 XP)
💀 Derrotado: ${tagUsuario(perdedor)} (+10 XP)`,
              mentions: [vencedor, perdedor],
            }, { quoted: m });
            continue;
          }

          if (cmd === '/tops') {
            const cat = ['forca', 'quiz', 'duelo', 'outras'].includes(arg1) ? arg1 : 'total';
            await sock.sendMessage(chatId, { text: tops.formatarRanking(chatId, cat) }, { quoted: m });
            continue;
          }

          if (cmd === '/forca') {
            if (jogosForca.has(chatId)) {
              const f = jogosForca.get(chatId);
              const mascarada = f.palavra.split('').map((l) => (f.letras.includes(l) ? l : '_')).join(' ');
              await sock.sendMessage(chatId, { text: `💀 Já existe uma forca ativa!
Palavra: \`${mascarada}\`
Dica: ${f.dica}` }, { quoted: m });
              continue;
            }
            const sorteada = PALAVRAS_FORCA[Math.floor(Math.random() * PALAVRAS_FORCA.length)];
            jogosForca.set(chatId, { palavra: sorteada.palavra, dica: sorteada.dica, letras: [], erros: 0 });
            const mascarada = '_ '.repeat(sorteada.palavra.length).trim();
            await sock.sendMessage(chatId, {
              text: `💀 *JOGO DA FORCA INICIADO!*

Palavra: \`${mascarada}\`
Dica: ${sorteada.dica}

Envie uma *letra* ou a *palavra completa* no chat!`,
            });
            continue;
          }

          if (cmd === '/quiz') {
            const q = PERGUNTAS_QUIZ[Math.floor(Math.random() * PERGUNTAS_QUIZ.length)];
            jogosQuiz.set(chatId, q);
            await sock.sendMessage(chatId, {
              text: `🧠 *QUIZ DO CHAIM-BOT!*

❓ ${q.p}

${q.opcoes}

Responda escrevendo o nome da resposta certa!`,
            });
            continue;
          }

          // === POKÉMON ===
          if (cmd === '/pokemon') {
            const p = pokemon.getPlayer(senderId, pushName);
            await sock.sendMessage(chatId, { text: pokemon.profile(p) }, { quoted: m });
            continue;
          }

          if (cmd === '/choose') {
            const mapaEscolha = { '1': 'Bulbasaur', '2': 'Charmander', '3': 'Squirtle' };
            const escolhido = mapaEscolha[arg1];
            if (!escolhido) {
              await sock.sendMessage(chatId, {
                text: '🎒 Escolha seu Pokémon inicial:

1️⃣ */choose 1* — 🌱 Bulbasaur
2️⃣ */choose 2* — 🔥 Charmander
3️⃣ */choose 3* — 💧 Squirtle',
              }, { quoted: m });
              continue;
            }
            const poke = pokemon.chooseStarter(senderId, pushName, escolhido);
            await sock.sendMessage(chatId, {
              text: `🎉 Você escolheu ${poke.emoji} *${poke.nome}* como seu parceiro inicial! Use */viajar* para explorar!`,
            }, { quoted: m });
            continue;
          }

          if (cmd === '/pokemons') {
            await sock.sendMessage(chatId, { text: pokemon.team(senderId, pushName) }, { quoted: m });
            continue;
          }

          if (cmd === '/mapa') {
            await sock.sendMessage(chatId, { text: pokemon.map(senderId, pushName) }, { quoted: m });
            continue;
          }

          if (cmd === '/viajar') {
            const res = pokemon.viajar(senderId, pushName);
            if (!res.ok) {
              await sock.sendMessage(chatId, { text: res.text }, { quoted: m });
            } else if (res.encontro) {
              await sock.sendMessage(chatId, {
                text: `🚶 Você viajou para *${res.cidade}*!

🌿 Um ${res.encontro.emoji} *${res.encontro.nome}* selvagem (Nv.${res.encontro.level} • ${res.encontro.raridade}) apareceu!
🎯 Use */capturar* para tentar pegá-lo!`,
              }, { quoted: m });
            } else {
              await sock.sendMessage(chatId, {
                text: `🚶 Você chegou em *${res.cidade}*, mas nenhum Pokémon apareceu por aqui. Tente */viajar* novamente!`,
              }, { quoted: m });
            }
            continue;
          }

          if (cmd === '/capturar') {
            const res = pokemon.capturar(senderId, pushName);
            if (!res.ok) {
              await sock.sendMessage(chatId, { text: res.text }, { quoted: m });
            } else {
              await sock.sendMessage(chatId, {
                text: `🎊 *CAPTURADO!* Você pegou ${res.pokemon.emoji} *${res.pokemon.nome}* (Nv.${res.pokemon.nivel}) e ganhou +5 PokéCoins!`,
              }, { quoted: m });
            }
            continue;
          }

          if (cmd === '/shop') {
            await sock.sendMessage(chatId, { text: pokemon.shop(senderId, pushName) }, { quoted: m });
            continue;
          }

          if (cmd === '/buy') {
            const res = pokemon.buy(senderId, pushName, arg1);
            await sock.sendMessage(chatId, { text: res.text }, { quoted: m });
            continue;
          }

          if (cmd === '/help' && arg1 === 'p') {
            await sock.sendMessage(chatId, { text: pokemon.help() }, { quoted: m });
            continue;
          }

          // === RPG ===
          if (cmd === '/rpg') {
            const novo = estado.alternarRpgNoGrupo(chatId);
            if (novo) rpg.activate(chatId);
            await sock.sendMessage(chatId, {
              text: novo ? '🐉 *MODO RPG ATIVADO!* Use */battle*, */inventario*, */levels* e */inimigos*!' : '🐉 Modo RPG desativado neste grupo.',
            }, { quoted: m });
            continue;
          }

          if (cmd === '/levels') {
            const p = rpg.playerProfile(senderId, pushName);
            await sock.sendMessage(chatId, {
              text: `📊 *PERFIL RPG — ${p.nome}*

⭐ Nível: ${p.nivel}
✨ XP: ${p.xp}/${rpg.xpNecessario(p.nivel)}
❤️ HP: ${p.hp}/${p.maxHp}
🏆 Vitórias: ${p.vitorias}`,
            }, { quoted: m });
            continue;
          }

          if (cmd === '/inventario') {
            const inv = rpg.inventory(senderId, pushName);
            const itens = Object.entries(inv).map(([k, v]) => `• ${k}: ${v}x`).join('\n') || 'Vazio';
            await sock.sendMessage(chatId, { text: `🎒 *INVENTÁRIO DE ${pushName}*

${itens}` }, { quoted: m });
            continue;
          }

          if (cmd === '/inimigos') {
            let lista = rpg.enemies(chatId);
            if (!lista.length) lista = [rpg.generateEnemy(chatId)];
            const txt = lista.map((e, i) => `${i + 1}. 👹 *${e.nome}* — ❤️ ${e.hp}/${e.maxHp} HP | ⚔️ Dano: ${e.dano}`).join('\n');
            await sock.sendMessage(chatId, { text: `👹 *INIMIGOS NA ÁREA*

${txt}` }, { quoted: m });
            continue;
          }

          if (cmd === '/battle') {
            const inimigo = rpg.generateEnemy(chatId);
            const p = rpg.playerProfile(senderId, pushName);
            const danoPlayer = 15 + p.nivel * 6 + Math.floor(Math.random() * 10);
            if (danoPlayer >= inimigo.hp) {
              const ganho = 35 + p.nivel * 5;
              const up = rpg.addXp(senderId, pushName, ganho);
              await sock.sendMessage(chatId, {
                text: `⚔️ *BATALHA RPG!*

Você enfrentou 👹 *${inimigo.nome}* (${inimigo.hp} HP) e derrotou com um golpe de *${danoPlayer}* de dano!
✨ +${ganho} XP${up.subiu ? ` (Subiu para Nv.${up.nivelNovo}!)` : ''}`,
              }, { quoted: m });
            } else {
              await sock.sendMessage(chatId, {
                text: `⚔️ *BATALHA RPG!*

Você causou *${danoPlayer}* de dano em 👹 *${inimigo.nome}*, mas ele resistiu com ${inimigo.hp - danoPlayer} HP! Tente */battle* novamente!`,
              }, { quoted: m });
            }
            continue;
          }

          if (cmd === '/historia') {
            rpg.storyStart(chatId, senderId);
            await sock.sendMessage(chatId, {
              text: `📖 *CRÔNICAS DO REINO*

As sombras avançam sobre a vila. Reúnam seus aliados com */battle* para defender o reino!`,
            }, { quoted: m });
            continue;
          }

          // === UNO ===
          if (cmd === '/uno') {
            if (!arg1) {
              const baralho = criarBaralhoUno();
              partidasUno.set(chatId, {
                iniciado: false,
                baralho,
                mesa: baralho.pop(),
                turno: 0,
                jogadores: [{ id: senderId, nome: pushName, mao: baralho.splice(0, 5) }],
              });
              await sock.sendMessage(chatId, {
                text: `🃏 *SALA DE UNO CRIADA!*

Criador: ${tagUsuario(senderId)}
Outros jogadores podem entrar digitando */uno entrar* e depois usem */uno start*!`,
                mentions: [senderId],
              });
            } else if (arg1 === 'entrar') {
              const jogo = partidasUno.get(chatId);
              if (!jogo) {
                await sock.sendMessage(chatId, { text: '❌ Nenhuma sala de UNO aberta. Digite */uno* para criar!' }, { quoted: m });
              } else if (jogo.jogadores.some((j) => j.id === senderId)) {
                await sock.sendMessage(chatId, { text: '⚠️ Você já está na partida!' }, { quoted: m });
              } else {
                jogo.jogadores.push({ id: senderId, nome: pushName, mao: jogo.baralho.splice(0, 5) });
                await sock.sendMessage(chatId, { text: `✅ ${tagUsuario(senderId)} entrou no UNO! (${jogo.jogadores.length} jogadores)`, mentions: [senderId] });
              }
            } else if (arg1 === 'start') {
              const jogo = partidasUno.get(chatId);
              if (!jogo || jogo.jogadores.length < 2) {
                await sock.sendMessage(chatId, { text: '⚠️ Precisa de pelo menos 2 jogadores! Peça para alguém digitar */uno entrar*.' }, { quoted: m });
              } else {
                jogo.iniciado = true;
                const atual = jogo.jogadores[jogo.turno];
                await sock.sendMessage(chatId, {
                  text: `▶️ *UNO INICIADO!*

Carta na mesa: *${jogo.mesa}*
Vez de: ${tagUsuario(atual.id)}

Use */uno mao* no privado ou aqui para ver suas cartas e */uno jogar <número>*!`,
                  mentions: [atual.id],
                });
              }
            } else if (arg1 === 'mao' || arg1 === 'status') {
              const jogo = partidasUno.get(chatId);
              const jogador = jogo?.jogadores.find((j) => j.id === senderId);
              if (!jogador) {
                await sock.sendMessage(chatId, { text: '❌ Você não está numa partida de UNO aqui.' }, { quoted: m });
              } else {
                const lista = jogador.mao.map((c, i) => `${i + 1}. ${c}`).join('\n');
                await sock.sendMessage(chatId, { text: `🎴 *SUAS CARTAS (${jogador.nome})*
Mesa: *${jogo.mesa}*

${lista}` }, { quoted: m });
              }
            } else if (arg1 === 'jogar') {
              const jogo = partidasUno.get(chatId);
              if (!jogo || !jogo.iniciado) {
                await sock.sendMessage(chatId, { text: '❌ O jogo ainda não começou!' }, { quoted: m });
                continue;
              }
              const atual = jogo.jogadores[jogo.turno];
              if (atual.id !== senderId) {
                await sock.sendMessage(chatId, { text: `⏳ Não é sua vez! É a vez de ${tagUsuario(atual.id)}.`, mentions: [atual.id] }, { quoted: m });
                continue;
              }
              const idx = Number(partes[2]) - 1;
              if (isNaN(idx) || !atual.mao[idx]) {
                await sock.sendMessage(chatId, { text: '❌ Número de carta inválido. Veja com */uno mao*.' }, { quoted: m });
                continue;
              }
              const carta = atual.mao.splice(idx, 1)[0];
              jogo.mesa = carta;
              if (atual.mao.length === 0) {
                partidasUno.delete(chatId);
                if (isGroup) tops.registrarVitoria(chatId, senderId, pushName, 'outras');
                await sock.sendMessage(chatId, { text: `🏆 *UNO! VENCEDOR:* ${tagUsuario(senderId)} bateu todas as cartas!`, mentions: [senderId] });
              } else {
                jogo.turno = (jogo.turno + 1) % jogo.jogadores.length;
                const prox = jogo.jogadores[jogo.turno];
                await sock.sendMessage(chatId, {
                  text: `🎴 ${tagUsuario(senderId)} jogou *${carta}*! (Restam ${atual.mao.length} cartas)
👉 Próximo: ${tagUsuario(prox.id)}`,
                  mentions: [senderId, prox.id],
                });
              }
            } else if (arg1 === 'cancelar') {
              partidasUno.delete(chatId);
              await sock.sendMessage(chatId, { text: '❌ Partida de UNO cancelada.' }, { quoted: m });
            }
            continue;
          }

          if (cmd === '/comprar') {
            const jogo = partidasUno.get(chatId);
            const atual = jogo?.jogadores[jogo.turno];
            if (!jogo || !jogo.iniciado || atual?.id !== senderId) {
              await sock.sendMessage(chatId, { text: '❌ Você não pode comprar carta agora.' }, { quoted: m });
            } else {
              const nova = jogo.baralho.pop() || '🔵 Azul 5';
              atual.mao.push(nova);
              jogo.turno = (jogo.turno + 1) % jogo.jogadores.length;
              const prox = jogo.jogadores[jogo.turno];
              await sock.sendMessage(chatId, {
                text: `🛒 ${tagUsuario(senderId)} comprou uma carta e passou a vez para ${tagUsuario(prox.id)}!`,
                mentions: [senderId, prox.id],
              });
            }
            continue;
          }

          // === AMONG US ===
          if (cmd === '/amongus') {
            if (!arg1) {
              partidasAmong.set(chatId, {
                iniciado: false,
                jogadores: [{ id: senderId, nome: pushName, vivo: true, impostor: false, tarefas: 0 }],
              });
              await sock.sendMessage(chatId, {
                text: `🚀 *SALA DE AMONG US CRIADA!*

Entrem com */amongus entrar* e iniciem com */amongus start*!`,
              });
            } else if (arg1 === 'entrar') {
              const sala = partidasAmong.get(chatId);
              if (!sala) {
                await sock.sendMessage(chatId, { text: '❌ Nenhuma sala aberta. Use */amongus*!' }, { quoted: m });
              } else if (!sala.jogadores.some((j) => j.id === senderId)) {
                sala.jogadores.push({ id: senderId, nome: pushName, vivo: true, impostor: false, tarefas: 0 });
                await sock.sendMessage(chatId, { text: `👨‍🚀 ${tagUsuario(senderId)} entrou na nave! (${sala.jogadores.length} tripulantes)`, mentions: [senderId] });
              }
            } else if (arg1 === 'start') {
              const sala = partidasAmong.get(chatId);
              if (!sala || sala.jogadores.length < 3) {
                await sock.sendMessage(chatId, { text: '⚠️ Precisa de pelo menos 3 jogadores! Use */amongus entrar*.' }, { quoted: m });
              } else {
                sala.iniciado = true;
                const impIdx = Math.floor(Math.random() * sala.jogadores.length);
                sala.jogadores[impIdx].impostor = true;
                for (const j of sala.jogadores) {
                  await sock.sendMessage(j.id, {
                    text: j.impostor
                      ? '🔪 *VOCÊ É O IMPOSTOR!* Sabote e elimine os tripulantes sem ser descoberto!'
                      : '👨‍🚀 *VOCÊ É TRIPULANTE!* Faça suas missões usando */tarefa* no grupo!',
                  });
                }
                await sock.sendMessage(chatId, { text: '▶️ *AMONG US INICIADO!* Os papéis foram enviados no privado de cada jogador!' });
              }
            } else if (arg1 === 'status') {
              const sala = partidasAmong.get(chatId);
              if (!sala) {
                await sock.sendMessage(chatId, { text: '❌ Nenhuma partida de Among Us ativa.' }, { quoted: m });
              } else {
                const lista = sala.jogadores.map((j) => `${j.vivo ? '🟢' : '💀'} ${j.nome} (${j.tarefas}/3 tarefas)`).join('\n');
                await sock.sendMessage(chatId, { text: `📊 *STATUS DA NAVE*

${lista}` });
              }
            } else if (arg1 === 'report') {
              await sock.sendMessage(chatId, { text: '🚨 *REUNIÃO DE EMERGÊNCIA!* Discutam e votem com */vote @pessoa* ou */skip*!' });
            } else if (arg1 === 'cancel') {
              partidasAmong.delete(chatId);
              await sock.sendMessage(chatId, { text: '❌ Partida de Among Us cancelada.' });
            }
            continue;
          }

          if (cmd === '/tarefa') {
            const sala = partidasAmong.get(chatId);
            const j = sala?.jogadores.find((x) => x.id === senderId && x.vivo);
            if (!sala || !sala.iniciado || !j) {
              await sock.sendMessage(chatId, { text: '❌ Você não está numa partida ativa.' }, { quoted: m });
            } else {
              j.tarefas = Math.min(3, j.tarefas + 1);
              await sock.sendMessage(chatId, { text: `📝 ${tagUsuario(senderId)} completou uma tarefa! (${j.tarefas}/3)`, mentions: [senderId] });
            }
            continue;
          }

          if (cmd === '/vote' || cmd === '/skip') {
            const sala = partidasAmong.get(chatId);
            if (!sala || !sala.iniciado) continue;
            if (cmd === '/skip') {
              await sock.sendMessage(chatId, { text: `⏭️ ${tagUsuario(senderId)} pulou a votação.`, mentions: [senderId] });
            } else if (mencionados[0]) {
              const alvo = sala.jogadores.find((x) => x.id === mencionados[0]);
              if (alvo) {
                alvo.vivo = false;
                if (alvo.impostor) {
                  partidasAmong.delete(chatId);
                  await sock.sendMessage(chatId, {
                    text: `🎉 ${tagUsuario(alvo.id)} *ERA O IMPOSTOR!* Vitória dos Tripulantes! 👨‍🚀🏆`,
                    mentions: [alvo.id],
                  });
                } else {
                  await sock.sendMessage(chatId, {
                    text: `😱 ${tagUsuario(alvo.id)} *NÃO era o Impostor!* O jogo continua...`,
                    mentions: [alvo.id],
                  });
                }
              }
            }
            continue;
          }

          // === INTELIGÊNCIA ARTIFICIAL ===
          if (cmd === '/bot' || cmd === '/ia' || cmd === '/ask') {
            const pergunta = resto || 'Oi Chaim-Bot, tudo bem?';
            const prefixo = criador ? '[Falando com o Criador] ' : '';
            const resp = await chatbot.gerarResposta([{ role: 'user', content: `${prefixo}${pergunta}` }]);
            await sock.sendMessage(chatId, { text: resp }, { quoted: m });
            continue;
          }

          if (cmd === '/roast') {
            const alvo = mencionados[0] ? tagUsuario(mencionados[0]) : resto || 'esse cara';
            const resp = await chatbot.gerarRespostaComPrompt(
              'Faça uma zoeira/roast leve, engraçada e amigável em português do Brasil, sem ofensas graves.',
              `Zoe ${alvo}`
            );
            await sock.sendMessage(chatId, {
              text: resp,
              mentions: mencionados[0] ? [mencionados[0]] : [],
            }, { quoted: m });
            continue;
          }

          if (cmd === '/story') {
            const resp = await chatbot.gerarRespostaComPrompt(
              'Crie uma história curta, criativa e envolvente em português do Brasil (máximo 2 parágrafos).',
              resto || 'Uma aventura épica no espaço'
            );
            await sock.sendMessage(chatId, { text: resp }, { quoted: m });
            continue;
          }

          if (cmd === '/translate') {
            const resp = await chatbot.gerarRespostaComPrompt(
              'Traduza o texto a seguir para o português do Brasil (ou para o inglês caso já esteja em português). Responda apenas com a tradução.',
              resto || 'Hello world'
            );
            await sock.sendMessage(chatId, { text: resp }, { quoted: m });
            continue;
          }

          if (cmd === '/resumo') {
            const resp = await chatbot.gerarRespostaComPrompt(
              'Resuma o texto a seguir em tópicos curtos e claros em português do Brasil.',
              resto || 'Nada informado para resumir.'
            );
            await sock.sendMessage(chatId, { text: resp }, { quoted: m });
            continue;
          }

          if (cmd === '/rate') {
            const nota = Math.floor(Math.random() * 11);
            const alvo = mencionados[0] ? tagUsuario(mencionados[0]) : tagUsuario(senderId);
            await sock.sendMessage(chatId, {
              text: `⭐ Eu dou nota *${nota}/10* para ${alvo}!`,
              mentions: [mencionados[0] || senderId],
            }, { quoted: m });
            continue;
          }

        } catch (errMsg) {
          console.error('Erro ao processar mensagem individual:', errMsg?.message || errMsg);
        }
      }
    });

  } catch (erroGeral) {
    console.error('❌ Erro crítico em iniciarBot:', erroGeral?.stack || erroGeral);
    setTimeout(iniciarBot, 5000);
  }
}

iniciarBot();
