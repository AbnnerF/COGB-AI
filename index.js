require('dotenv').config();
const pino = require('pino');
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

const ADMIN_NUMBER = process.env.ADMIN_NUMBER; // número que autoriza o bot em novos grupos, ex: 5511999999999
const BOT_NUMBER = process.env.BOT_NUMBER; // número do chip que o bot vai usar, ex: 5511988887777

// Guarda quem pediu "/Create fig" e tá esperando mandar a foto (chave: "chatId:remetenteId")
const aguardandoFoto = {};

// Guarda quem já mandou uma foto desproporcional e tá esperando escolher o formato
const aguardandoEscolhaFormato = {}; // chave -> { bufferImagem, legenda, timeoutHandle }

// Guarda quem pediu "/convert" e tá esperando mandar a figurinha
const aguardandoConversao = {}; // chave -> timeoutHandle

// Guarda quem pediu "/audio" e tá esperando mandar o vídeo (ou um link do YouTube)
const aguardandoAudio = {}; // chave -> timeoutHandle

// Reconhece links do YouTube (youtube.com/watch?v=... ou youtu.be/...)
const REGEX_YOUTUBE = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]+\S*)/i;

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

// Espera um tempo (parecendo "digitando...") antes de mandar a mensagem do chat casual (/Bot)
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
        const ativado = estado.alternarRpgNoGrupo(chatId);
        try {
          await enviarMsg(sock, chatId, {
            text: ativado
              ? '⚔️🎮 *Sistema de RPG ativado nesse grupo!*\n\nUsem comandos, participem de duelos, ganhem XP e subam de nível!\nDigite */perfil* pra ver o seu, e */duelo @pessoa* pra desafiar alguém.'
              : '🛑 Sistema de RPG desativado nesse grupo.',
          });
        } catch (err) {
          console.log('Erro ao alternar RPG do grupo:', err.message);
        }
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

    // Dá um pouco de XP por usar qualquer comando, se o RPG tiver ativado nesse grupo
    // (duelo tem sua própria recompensa de XP, então não soma aqui também)
    const primeiroTermo = texto.trim().split(/\s+/)[0].toLowerCase();
    if (isGroup && estado.rpgAtivoNoGrupo(chatId) && primeiroTermo.startsWith('/') && !['/duelo'].includes(primeiroTermo)) {
      const ganho = Math.floor(Math.random() * 6) + 5; // 5 a 10 XP
      const { nivelAntigo, nivelNovo, subiuDeNivel } = estado.adicionarXp(remetenteId, nomeRemetente, ganho);
      if (subiuDeNivel) {
        try {
          await enviarMsg(sock, chatId, {
            text: `🎉 @${remetenteId.split('@')[0]} subiu pro nível *${nivelNovo}*! (era nível ${nivelAntigo})`,
            mentions: [remetenteId],
          });
        } catch (err) {
          console.log('Erro ao avisar level up:', err.message);
        }
      }
    }

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

      await enviarMsg(sock, chatId, {
        text:
          `⚔️ *BATALHA INICIADA!*\n${nomeRemetente} VS ${nomeAlvo}\n\n` +
          `💥 ${nomeRemetente}: ${atkRemetente} ATK\n🛡️ ${nomeAlvo}: ${atkAlvo} ATK\n\n` +
          `🏆 VENCEDOR: ${nomeVencedor}! (+30 XP)`,
        mentions: [remetenteId, alvoId],
      });
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

    // Comando /menu - mostra o tutorial com todas as funções (funciona em grupo ou no privado)
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
  });
}

iniciarBot();

