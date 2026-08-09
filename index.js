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
  converterFigurinhaParaImagem,
  converterFigurinhaParaVideo,
  obterDimensoes,
  obterDuracao,
  ehDesproporcional,
  DURACAO_MAXIMA_FIGURINHA,
} = require('./sticker');
const {
  MENSAGEM_BOAS_VINDAS_PV,
  MENSAGEM_NOVA_FUNCAO_CONVERT,
  MENSAGEM_GRUPO_ATIVADO,
  MENSAGEM_GRUPO_PENDENTE,
  MENSAGEM_GRUPO_RECUSADO,
} = require('./mensagens');
const estado = require('./estado');

const ADMIN_NUMBER = process.env.ADMIN_NUMBER; // número que autoriza o bot em novos grupos, ex: 5511999999999
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

// Guarda quem pediu "/convert" e tá esperando mandar a figurinha
const aguardandoConversao = {}; // chave -> timeoutHandle

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

// Espera 1 segundo antes de mandar uma mensagem, pra não parecer instantâneo/robótico
async function enviarMsg(sock, chatId, conteudo) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sock.sendMessage(chatId, conteudo);
}

// Espera um tempo (parecendo "digitando...") antes de mandar a mensagem do chat casual (/Bot)
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
    if (!msg.message || msg.key.fromMe) return;

    const chatId = msg.key.remoteJid; // grupo ou conversa
    const isGroup = chatId.endsWith('@g.us');

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

    const texto =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      '';

    if (!texto) return;

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
        text: `Manda a foto, vídeo ou GIF aí! 📸 Se quiser, coloca uma legenda — isso vira o nome da figurinha. (vídeos com mais de ${DURACAO_MAXIMA_FIGURINHA}s são cortados automaticamente)`,
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
    // (esse fluxo já tem seu próprio atraso de "digitando", por isso fica fora do enviarMsg de 3s fixos)
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

