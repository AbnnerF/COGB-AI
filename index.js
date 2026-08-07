require('dotenv').config();
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { gerarResposta } = require('./chatbot');
const {
  gerarFigurinha,
  criarFigurinhaDeImagem,
  criarFigurinhaAnimada,
  obterDimensoes,
  obterDuracao,
  ehDesproporcional,
  DURACAO_MAXIMA_FIGURINHA,
} = require('./sticker');

const BOT_NUMBER = process.env.BOT_NUMBER; // número do chip que o bot vai usar, ex: 5511988887777

// Quanto tempo (em ms) o bot continua "no papo" depois da última mensagem, sem precisar ser chamado de novo
const TEMPO_INATIVIDADE_MS = 24 * 60 * 60 * 1000; // 24 horas

// Guarda, por grupo, se a conversa tá "ativa" no momento (bot participando sem precisar ser chamado)
const conversasAtivas = {}; // chatId -> timeoutHandle

// Guarda o histórico recente de cada conversa, pro bot lembrar do que já foi dito
const historicoConversas = {}; // chatId -> array de { role, content }
const MAX_HISTORICO = 20; // quantidade de mensagens recentes que ele guarda por grupo

// Guarda quem pediu "/Create fig" e tá esperando mandar a foto (chave: "chatId:remetenteId")
const aguardandoFoto = {};

// Guarda quem já mandou uma foto desproporcional e tá esperando escolher o formato
const aguardandoEscolhaFormato = {}; // chave -> { bufferImagem, legenda, timeoutHandle }

// Guarda os nomes dos contatos conforme o WhatsApp vai sincronizando
const contatosCache = {};

function salvarContato(contato) {
  const nome = contato.name || contato.notify || contato.verifiedName;
  if (contato.id && nome) {
    contatosCache[contato.id] = nome;
  }
}

// Remove as marcações de menção (tipo "@5511999999999") do texto antes de mandar pra IA
function limparMencoes(texto) {
  return texto.replace(/@\d+/g, '').trim();
}

// Espera um tempo (parecendo "digitando...") antes de mandar a mensagem, pra ficar mais natural
async function enviarComAtraso(sock, chatId, texto) {
  const atrasoMs = 2000 + Math.random() * 4000; // entre 2 e 6 segundos
  try {
    await sock.sendPresenceUpdate('composing', chatId);
  } catch (err) {
    // se não conseguir mostrar "digitando", não tem problema, segue o baile
  }
  await new Promise((resolve) => setTimeout(resolve, atrasoMs));
  await sock.sendMessage(chatId, { text: texto });
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
    if (!msg.message || msg.key.fromMe) return;

    const chatId = msg.key.remoteJid; // grupo ou conversa
    const isGroup = chatId.endsWith('@g.us');

    const remetenteId = msg.key.participant || msg.key.remoteJid;
    const nomeRemetente = contatosCache[remetenteId] || msg.pushName || remetenteId.split('@')[0];
    if (msg.pushName) contatosCache[remetenteId] = contatosCache[remetenteId] || msg.pushName;

    const chaveEspera = `${chatId}:${remetenteId}`;

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
          await sock.sendMessage(chatId, {
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

        await sock.sendMessage(chatId, {
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
        await sock.sendMessage(chatId, { text: 'Deu ruim pra criar a figurinha 😕 tenta de novo' });
        return;
      }

      await sock.sendMessage(chatId, { sticker: figurinha });
      return;
    }

    const texto =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      '';

    if (!texto) return;

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
        await sock.sendMessage(chatId, {
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
        await sock.sendMessage(chatId, { text: 'Deu ruim pra criar a figurinha 😕 tenta de novo' });
        return;
      }

      await sock.sendMessage(chatId, { sticker: figurinha });
      return;
    }

    // Comando /Create fig - pede pra pessoa mandar a foto (funciona em grupo ou no privado)
    if (texto.trim().toLowerCase() === '/create fig') {
      aguardandoFoto[chaveEspera] = setTimeout(() => {
        delete aguardandoFoto[chaveEspera];
      }, 5 * 60 * 1000); // expira em 5 minutos se ninguém mandar a foto

      await sock.sendMessage(chatId, {
        text: `Manda a foto, vídeo ou GIF aí! 📸 Se quiser, coloca uma legenda — isso vira o nome da figurinha. (vídeos com mais de ${DURACAO_MAXIMA_FIGURINHA}s são cortados automaticamente)`,
      });
      return;
    }

    // Comando /fig <descrição> - gera uma figurinha com IA (funciona em grupo ou no privado)
    if (texto.trim().toLowerCase().startsWith('/fig ')) {
      const descricao = texto.trim().slice(5).trim();
      if (!descricao) {
        await sock.sendMessage(chatId, { text: 'Descreve o que você quer na figurinha! Ex: /fig gato astronauta' });
        return;
      }

      try {
        await sock.sendPresenceUpdate('composing', chatId);
      } catch (err) {
        // sem problema se não conseguir mostrar "digitando"
      }

      const figurinha = await gerarFigurinha(descricao);
      if (!figurinha) {
        await sock.sendMessage(chatId, { text: 'Deu ruim pra gerar a figurinha agora 😕 tenta de novo' });
        return;
      }

      await sock.sendMessage(chatId, { sticker: figurinha });
      return;
    }

    if (!isGroup) return; // a conversa casual (/Bot) só funciona em grupos

    const comandoAtivar = texto.trim().toLowerCase() === '/bot';
    const conversaJaAtiva = Boolean(conversasAtivas[chatId]);

    // Se não foi o comando /Bot e a conversa não tá ativa nesse grupo, o bot ignora a mensagem
    if (!comandoAtivar && !conversaJaAtiva) return;

    // (Re)inicia o cronômetro: se ninguém mais falar nesse tempo, a conversa "desliga" e esquece o histórico
    if (conversasAtivas[chatId]) clearTimeout(conversasAtivas[chatId]);
    conversasAtivas[chatId] = setTimeout(() => {
      delete conversasAtivas[chatId];
      delete historicoConversas[chatId];
    }, TEMPO_INATIVIDADE_MS);

    // Quando é só o comando de ativação, começa um histórico novo e manda uma saudação
    if (comandoAtivar) {
      historicoConversas[chatId] = [];
      const saudacao = await gerarResposta([
        { role: 'user', content: `${nomeRemetente} acabou de te chamar pra participar da conversa do grupo, manda um "e aí" descontraído` },
      ]);
      if (saudacao) {
        historicoConversas[chatId].push({ role: 'assistant', content: saudacao });
        await enviarComAtraso(sock, chatId, saudacao);
      }
      return;
    }

    if (!historicoConversas[chatId]) historicoConversas[chatId] = [];
    historicoConversas[chatId].push({ role: 'user', content: `${nomeRemetente}: ${limparMencoes(texto)}` });

    const resposta = await gerarResposta(historicoConversas[chatId].slice(-MAX_HISTORICO));
    if (!resposta) return;

    historicoConversas[chatId].push({ role: 'assistant', content: resposta });
    historicoConversas[chatId] = historicoConversas[chatId].slice(-MAX_HISTORICO);

    await enviarComAtraso(sock, chatId, resposta);
  });
}

iniciarBot();
