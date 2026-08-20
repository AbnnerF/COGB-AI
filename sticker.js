const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const webp = require('node-webpmux');

const execAsync = promisify(exec);
const PASTA_TEMP = path.join(__dirname, 'tmp');

function garantirPastaTemp() {
  if (!fs.existsSync(PASTA_TEMP)) fs.mkdirSync(PASTA_TEMP, { recursive: true });
}

// Filtros de conversão pra cada modo de figurinha
const FILTROS = {
  recortada: 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512',
  original: 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0',
  esticada: 'scale=512:512',
};

// Descobre a largura e altura de uma imagem
async function obterDimensoes(bufferImagem) {
  garantirPastaTemp();
  const caminho = path.join(PASTA_TEMP, `${Date.now()}-${Math.floor(Math.random() * 10000)}-dim.jpg`);
  try {
    fs.writeFileSync(caminho, bufferImagem);
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${caminho}"`
    );
    const [largura, altura] = stdout.trim().split(',').map(Number);
    return { largura, altura };
  } finally {
    if (fs.existsSync(caminho)) fs.unlinkSync(caminho);
  }
}

// Diz se uma imagem é "desproporcional" o bastante pra valer a pena perguntar o formato
function ehDesproporcional({ largura, altura } = {}) {
  if (!largura || !altura) return false;
  const proporcao = largura / altura;
  return Math.abs(proporcao - 1) > 0.02; // mais de 2% de diferença entre largura e altura
}

// Converte um buffer de imagem (jpg/png/etc) num buffer de figurinha (webp 512x512)
async function converterParaWebp(bufferImagem, modo = 'recortada') {
  garantirPastaTemp();
  const nomeArquivo = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const caminhoEntrada = path.join(PASTA_TEMP, `${nomeArquivo}.jpg`);
  const caminhoSaida = path.join(PASTA_TEMP, `${nomeArquivo}.webp`);
  const filtro = FILTROS[modo] || FILTROS.recortada;

  try {
    fs.writeFileSync(caminhoEntrada, bufferImagem);
    await execAsync(
      `ffmpeg -y -i "${caminhoEntrada}" -vf "${filtro}" -vcodec libwebp -q:v 60 "${caminhoSaida}"`
    );
    return fs.readFileSync(caminhoSaida);
  } finally {
    if (fs.existsSync(caminhoEntrada)) fs.unlinkSync(caminhoEntrada);
    if (fs.existsSync(caminhoSaida)) fs.unlinkSync(caminhoSaida);
  }
}

// Escreve o "nome" da figurinha nos metadados dela (aparece em "Detalhes da figurinha" no WhatsApp)
async function adicionarMetadados(bufferWebp, nomeFigurinha) {
  const img = new webp.Image();
  const dados = {
    'sticker-pack-id': Date.now().toString(),
    'sticker-pack-name': nomeFigurinha || 'Figurinha',
    'sticker-pack-publisher': 'Bot',
    emojis: ['🙂'],
  };
  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const jsonBuffer = Buffer.from(JSON.stringify(dados), 'utf8');
  const exif = Buffer.concat([exifAttr, jsonBuffer]);
  exif.writeUIntLE(jsonBuffer.length, 14, 4);

  await img.load(bufferWebp);
  img.exif = exif;
  return img.save(null);
}

/**
 * Gera uma figurinha a partir de uma descrição em texto, usando IA (Pollinations.ai, gratuita).
 * Retorna um Buffer com a figurinha, ou null se der algum erro.
 */
async function gerarFigurinha(descricao) {
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(descricao)}?width=512&height=512&nologo=true`;
    const resposta = await fetch(url);

    if (!resposta.ok) {
      console.log('Erro ao baixar imagem gerada:', resposta.status);
      return null;
    }

    const bufferImagem = Buffer.from(await resposta.arrayBuffer());
    const webpBuffer = await converterParaWebp(bufferImagem);
    return adicionarMetadados(webpBuffer, descricao);
  } catch (err) {
    console.log('Erro ao gerar figurinha:', err.message);
    return null;
  }
}

/**
 * Transforma uma foto enviada pelo usuário numa figurinha, usando a legenda como nome dela.
 * modo: 'recortada' | 'original' | 'esticada'
 * Retorna um Buffer com a figurinha, ou null se der algum erro.
 */
async function criarFigurinhaDeImagem(bufferImagem, legenda, modo = 'recortada') {
  try {
    const webpBuffer = await converterParaWebp(bufferImagem, modo);
    return adicionarMetadados(webpBuffer, legenda);
  } catch (err) {
    console.log('Erro ao criar figurinha da imagem:', err.message);
    return null;
  }
}

// Quantos segundos, no máximo, uma figurinha animada pode ter
const DURACAO_MAXIMA_FIGURINHA = 5;

// Descobre a duração (em segundos) de um vídeo
async function obterDuracao(bufferVideo) {
  garantirPastaTemp();
  const caminho = path.join(PASTA_TEMP, `${Date.now()}-${Math.floor(Math.random() * 10000)}-dur.mp4`);
  try {
    fs.writeFileSync(caminho, bufferVideo);
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${caminho}"`
    );
    return parseFloat(stdout.trim());
  } finally {
    if (fs.existsSync(caminho)) fs.unlinkSync(caminho);
  }
}

// Filtros de vídeo pra cada modo (iguais aos de imagem, mas controlando a taxa de quadros)
const FILTROS_VIDEO = {
  recortada: 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=15',
  original: 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0,fps=15',
  esticada: 'scale=512:512,fps=15',
};

/**
 * Transforma um vídeo ou GIF numa figurinha animada.
 * Corta automaticamente pros primeiros segundos (DURACAO_MAXIMA_FIGURINHA) se for mais longo.
 * modo: 'recortada' | 'original' | 'esticada'
 * Retorna um Buffer com a figurinha, ou null se der algum erro.
 */
async function criarFigurinhaAnimada(bufferVideo, legenda, modo = 'recortada') {
  garantirPastaTemp();
  const nomeArquivo = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const caminhoEntrada = path.join(PASTA_TEMP, `${nomeArquivo}.mp4`);
  const caminhoSaida = path.join(PASTA_TEMP, `${nomeArquivo}.webp`);
  const filtro = FILTROS_VIDEO[modo] || FILTROS_VIDEO.recortada;

  try {
    fs.writeFileSync(caminhoEntrada, bufferVideo);
    await execAsync(
      `ffmpeg -y -i "${caminhoEntrada}" -t ${DURACAO_MAXIMA_FIGURINHA} -vf "${filtro}" -loop 0 -an -vsync 0 -vcodec libwebp -q:v 50 -preset default "${caminhoSaida}"`
    );
    const webpBuffer = fs.readFileSync(caminhoSaida);
    return adicionarMetadados(webpBuffer, legenda);
  } catch (err) {
    console.log('Erro ao criar figurinha animada:', err.message);
    return null;
  } finally {
    if (fs.existsSync(caminhoEntrada)) fs.unlinkSync(caminhoEntrada);
    if (fs.existsSync(caminhoSaida)) fs.unlinkSync(caminhoSaida);
  }
}

/**
 * Converte uma figurinha estática (webp) numa imagem comum (png).
 * Retorna um Buffer com a imagem, ou null se der algum erro.
 */
async function converterFigurinhaParaImagem(bufferWebp) {
  garantirPastaTemp();
  const nomeArquivo = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const caminhoEntrada = path.join(PASTA_TEMP, `${nomeArquivo}.webp`);
  const caminhoSaida = path.join(PASTA_TEMP, `${nomeArquivo}.png`);

  try {
    fs.writeFileSync(caminhoEntrada, bufferWebp);
    await execAsync(`dwebp "${caminhoEntrada}" -o "${caminhoSaida}"`);
    return fs.readFileSync(caminhoSaida);
  } catch (err) {
    console.log('Erro ao converter figurinha em imagem:', err.message);
    return null;
  } finally {
    if (fs.existsSync(caminhoEntrada)) fs.unlinkSync(caminhoEntrada);
    if (fs.existsSync(caminhoSaida)) fs.unlinkSync(caminhoSaida);
  }
}

/**
 * Converte uma figurinha animada (webp animado) num vídeo (mp4).
 * O ffmpeg do Termux não sabe ler figurinha animada direto, então a gente usa o webpmux
 * pra separar cada quadro, o dwebp pra decodificar cada um em PNG, e só então o ffmpeg
 * monta o vídeo com a sequência de PNGs.
 * Retorna um Buffer com o vídeo, ou null se der algum erro.
 */
async function converterFigurinhaParaVideo(bufferWebp) {
  garantirPastaTemp();
  const idPasta = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const pastaFrames = path.join(PASTA_TEMP, `frames-${idPasta}`);
  const caminhoEntrada = path.join(PASTA_TEMP, `${idPasta}.webp`);
  const caminhoSaida = path.join(PASTA_TEMP, `${idPasta}.mp4`);

  try {
    fs.mkdirSync(pastaFrames, { recursive: true });
    fs.writeFileSync(caminhoEntrada, bufferWebp);

    // Descobre quantos quadros a figurinha tem
    const { stdout: info } = await execAsync(`webpmux -info "${caminhoEntrada}"`);
    const match = info.match(/Number of frames:\s*(\d+)/i);
    const totalQuadros = match ? parseInt(match[1], 10) : 0;

    if (!totalQuadros) {
      console.log('Não encontrei quadros nessa figurinha (webpmux -info):', info);
      return null;
    }

    // Extrai cada quadro (webpmux) e decodifica pra PNG (dwebp)
    for (let i = 1; i <= totalQuadros; i++) {
      const quadroWebp = path.join(pastaFrames, `q${i}.webp`);
      const quadroPng = path.join(pastaFrames, `q${String(i).padStart(4, '0')}.png`);
      await execAsync(`webpmux -get frame ${i} "${caminhoEntrada}" -o "${quadroWebp}"`);
      await execAsync(`dwebp "${quadroWebp}" -o "${quadroPng}"`);
    }

    // Monta o vídeo a partir da sequência de PNGs
    await execAsync(
      `ffmpeg -y -framerate 15 -i "${pastaFrames}/q%04d.png" -movflags faststart -pix_fmt yuv420p ` +
        `-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" "${caminhoSaida}"`
    );

    return fs.readFileSync(caminhoSaida);
  } catch (err) {
    console.log('Erro ao converter figurinha em vídeo:', err.message);
    return null;
  } finally {
    if (fs.existsSync(caminhoEntrada)) fs.unlinkSync(caminhoEntrada);
    if (fs.existsSync(caminhoSaida)) fs.unlinkSync(caminhoSaida);
    if (fs.existsSync(pastaFrames)) fs.rmSync(pastaFrames, { recursive: true, force: true });
  }
}

/**
 * Extrai o áudio de um vídeo, devolvendo um mp3.
 * Retorna um Buffer com o áudio, ou null se der algum erro.
 */
async function converterVideoParaAudio(bufferVideo) {
  garantirPastaTemp();
  const nomeArquivo = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const caminhoEntrada = path.join(PASTA_TEMP, `${nomeArquivo}.mp4`);
  const caminhoSaida = path.join(PASTA_TEMP, `${nomeArquivo}.mp3`);

  try {
    fs.writeFileSync(caminhoEntrada, bufferVideo);
    await execAsync(`ffmpeg -y -i "${caminhoEntrada}" -vn -acodec libmp3lame -q:a 2 "${caminhoSaida}"`);
    return fs.readFileSync(caminhoSaida);
  } catch (err) {
    console.log('Erro ao converter vídeo em áudio:', err.message);
    return null;
  } finally {
    if (fs.existsSync(caminhoEntrada)) fs.unlinkSync(caminhoEntrada);
    if (fs.existsSync(caminhoSaida)) fs.unlinkSync(caminhoSaida);
  }
}

/**
 * Baixa um vídeo do YouTube e já devolve só o áudio (mp3), usando o yt-dlp.
 * Retorna um Buffer com o áudio, ou null se der algum erro.
 */
async function baixarAudioDoYoutube(url) {
  garantirPastaTemp();
  const nomeBase = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const caminhoSaida = path.join(PASTA_TEMP, `${nomeBase}.mp3`);
  const modelo = path.join(PASTA_TEMP, `${nomeBase}.%(ext)s`);

  try {
    await execAsync(`yt-dlp -x --audio-format mp3 --audio-quality 5 --no-playlist -o "${modelo}" "${url}"`, {
      timeout: 120000, // 2 minutos no máximo, pra não ficar travado num vídeo gigante
    });

    if (!fs.existsSync(caminhoSaida)) return null;
    return fs.readFileSync(caminhoSaida);
  } catch (err) {
    console.log('Erro ao baixar áudio do YouTube:', err.message);
    return null;
  } finally {
    if (fs.existsSync(caminhoSaida)) fs.unlinkSync(caminhoSaida);
  }
}

/**
 * Converte um GIF (bytes crus) num vídeo mp4, formato que o WhatsApp entende
 * pra reproduzir como "gif" de verdade (o WhatsApp não aceita o .gif bruto como vídeo).
 * Retorna um Buffer com o vídeo, ou null se der algum erro.
 */
async function converterGifParaVideo(bufferGif) {
  garantirPastaTemp();
  const nomeArquivo = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const caminhoEntrada = path.join(PASTA_TEMP, `${nomeArquivo}.gif`);
  const caminhoSaida = path.join(PASTA_TEMP, `${nomeArquivo}.mp4`);

  try {
    fs.writeFileSync(caminhoEntrada, bufferGif);
    await execAsync(
      `ffmpeg -y -i "${caminhoEntrada}" -movflags faststart -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" "${caminhoSaida}"`
    );
    return fs.readFileSync(caminhoSaida);
  } catch (err) {
    console.log('Erro ao converter gif em vídeo:', err.message);
    return null;
  } finally {
    if (fs.existsSync(caminhoEntrada)) fs.unlinkSync(caminhoEntrada);
    if (fs.existsSync(caminhoSaida)) fs.unlinkSync(caminhoSaida);
  }
}

/**
 * Gera uma imagem comum (não figurinha) a partir de uma descrição, usando IA (Pollinations.ai).
 * Retorna um Buffer com a imagem, ou null se der algum erro.
 */
async function gerarImagem(descricao) {
  try {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(descricao)}?width=768&height=768&nologo=true`;
    const resposta = await fetch(url);
    if (!resposta.ok) {
      console.log('Erro ao baixar imagem gerada:', resposta.status);
      return null;
    }
    return Buffer.from(await resposta.arrayBuffer());
  } catch (err) {
    console.log('Erro ao gerar imagem:', err.message);
    return null;
  }
}


/**
 * Gera um pack de figurinhas com IA.
 * Cria artes ORIGINAIS baseadas no tema, sem copiar uma figurinha existente.
 * Retorna uma lista de Buffers WebP.
 */
async function gerarPackDeFigurinhas(tema, quantidade = 6) {
  const total = Math.max(1, Math.min(Number(quantidade) || 6, 10));
  const ideias = [
    'reação feliz e comemorando',
    'reação de surpresa/chocado',
    'reação de risada',
    'reação de raiva engraçada',
    'reação triste/dramática',
    'reação de confusão',
    'reação de aprovação/positivo',
    'reação de vergonha',
    'reação de medo engraçado',
    'reação de vitória'
  ];

  const resultados = [];
  for (let i = 0; i < total; i++) {
    const prompt =
      `Crie uma figurinha ORIGINAL para WhatsApp sobre o tema "${tema}". ` +
      `Esta é a figurinha ${i + 1} de um pack. Cena: ${ideias[i]}. ` +
      `Visual de figurinha, personagem/arte original, composição centralizada, ` +
      `fundo simples, expressão muito clara, sem marcas d'água, sem logos e sem copiar ` +
      `personagens ou artes protegidas de outras obras. Tema apenas como inspiração. ` +
      `Formato quadrado 512x512.`;

    const figurinha = await gerarFigurinha(prompt);
    if (figurinha) resultados.push(figurinha);
  }

  return resultados;
}

/**
 * Pesquisa packs públicos no Sticker.ly e devolve apenas os links dos packs.
 * Não baixa nem redistribui as figurinhas do pack.
 */
async function pesquisarPacksStickerLy(termo) {
  try {
    const resposta = await fetch('https://api.sticker.ly/v4/stickerPack/smartSearch', {
      method: 'POST',
      headers: {
        'User-Agent': 'androidapp.stickerly/3.31.0 (Android)',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        keyword: termo,
        enabledKeywordSearch: true,
        filter: {
          extendSearchResult: false,
          sortBy: 'RECOMMENDED',
          languages: ['ALL'],
          minStickerCount: 5,
          searchBy: 'ALL',
          stickerType: 'ALL',
        },
      }),
    });

    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const dados = await resposta.json();
    const encontrados = [];
    const vistos = new Set();

    function visitar(valor) {
      if (!valor || encontrados.length >= 5) return;
      if (Array.isArray(valor)) {
        for (const item of valor) visitar(item);
        return;
      }
      if (typeof valor !== 'object') return;

      const id = valor.id || valor.packId || valor.stickerPackId || valor.stickerPackID;
      const nome = valor.name || valor.packName || valor.stickerPackName || valor.title || 'Pack';
      const url = valor.shareUrl || valor.shareURL || valor.packUrl || valor.url;
      const urlValida = typeof url === 'string' && /sticker\.ly\//i.test(url) ? url : null;
      const idValido = typeof id === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(id) ? id : null;
      const link = urlValida || (idValido ? `https://sticker.ly/s/${idValido}` : null);

      if (link && !vistos.has(link)) {
        vistos.add(link);
        encontrados.push({ nome: String(nome), link });
      }

      for (const chave of Object.keys(valor)) visitar(valor[chave]);
    }

    visitar(dados);
    return encontrados;
  } catch (err) {
    console.log('Erro ao pesquisar packs do Sticker.ly:', err.message);
    return [];
  }
}


/**
 * Baixa figurinhas de um pack público do Sticker.ly.
 * Escolhe aleatoriamente figurinhas do pack e evita repetir as últimas usadas
 * para o mesmo tema enquanto o processo do bot estiver ligado.
 */
const historicoPacksStickerLy = new Map();

function embaralhar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function coletarUrlsDeSticker(valor, resultado = [], vistos = new Set()) {
  if (!valor || resultado.length >= 200) return resultado;

  if (Array.isArray(valor)) {
    for (const item of valor) coletarUrlsDeSticker(item, resultado, vistos);
    return resultado;
  }

  if (typeof valor !== 'object') return resultado;

  for (const [chave, item] of Object.entries(valor)) {
    if (typeof item === 'string' && /^https?:\/\//i.test(item)) {
      const chaveNormalizada = chave.toLowerCase();
      const pareceImagem =
        /(image|sticker|resource|file|content|media|thumbnail|preview|url)/i.test(chaveNormalizada) &&
        !/share|profile|avatar|author|user|packurl/i.test(chaveNormalizada);

      if (pareceImagem && !/sticker\.ly\//i.test(item) && !vistos.has(item)) {
        vistos.add(item);
        resultado.push(item);
      }
    } else {
      coletarUrlsDeSticker(item, resultado, vistos);
    }
  }

  return resultado;
}

async function obterDadosPackStickerLy(packId) {
  const id = String(packId).match(/[A-Za-z0-9_-]{4,40}/)?.[0];
  if (!id) throw new Error('ID de pack inválido');

  const resposta = await fetch(`https://api.sticker.ly/v4/stickerPack/${id}?needRelation=true`, {
    headers: {
      'User-Agent': 'androidapp.stickerly/3.31.0 (Android)',
      Accept: 'application/json',
    },
  });

  if (!resposta.ok) throw new Error(`Sticker.ly respondeu HTTP ${resposta.status}`);
  return resposta.json();
}

async function baixarImagemStickerLy(url) {
  const resposta = await fetch(url, {
    headers: {
      'User-Agent': 'androidapp.stickerly/3.31.0 (Android)',
      Referer: 'https://sticker.ly/',
    },
  });

  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  const tipo = resposta.headers.get('content-type') || '';
  if (!tipo.startsWith('image/') && !/webp|png|jpeg|jpg|gif/i.test(url)) {
    throw new Error('recurso não parece ser uma imagem');
  }
  return Buffer.from(await resposta.arrayBuffer());
}

async function baixarPackStickerLy(termo, quantidade = 6) {
  try {
    const packs = await pesquisarPacksStickerLy(termo);
    if (!packs.length) return { nome: null, figurinhas: [] };

    // Tenta vários packs encontrados, começando por um escolhido aleatoriamente,
    // para não entregar sempre o mesmo conjunto.
    const ordemPacks = embaralhar(packs);
    const chaveHistorico = String(termo).trim().toLowerCase();
    const historico = historicoPacksStickerLy.get(chaveHistorico) || [];
    const historicoSet = new Set(historico);
    let candidatos = [];
    let nomePack = ordemPacks[0].nome;

    for (const pack of ordemPacks) {
      try {
        const dados = await obterDadosPackStickerLy(pack.link);
        const urls = coletarUrlsDeSticker(dados);
        const novos = urls.filter((url) => !historicoSet.has(url));
        candidatos.push(...novos.map((url) => ({ url, nome: pack.nome })));
        if (candidatos.length >= Math.max(quantidade * 4, 12)) break;
      } catch (err) {
        console.log(`Erro ao ler pack ${pack.nome}:`, err.message);
      }
    }

    if (!candidatos.length) {
      // Se já usamos tudo, libera o histórico para que o tema continue funcionando.
      historicoPacksStickerLy.delete(chaveHistorico);
      for (const pack of ordemPacks) {
        try {
          const dados = await obterDadosPackStickerLy(pack.link);
          const urls = coletarUrlsDeSticker(dados);
          candidatos.push(...urls.map((url) => ({ url, nome: pack.nome })));
          if (candidatos.length >= quantidade * 3) break;
        } catch (err) {}
      }
    }

    candidatos = embaralhar(candidatos);
    const escolhidos = candidatos.slice(0, quantidade);
    const figurinhas = [];

    for (const item of escolhidos) {
      try {
        const imagem = await baixarImagemStickerLy(item.url);
        const figurinha = await criarFigurinhaDeImagem(imagem, item.nome || termo, 'recortada');
        if (figurinha) {
          figurinhas.push(figurinha);
          historico.push(item.url);
          while (historico.length > 30) historico.shift();
        }
      } catch (err) {
        console.log('Erro ao baixar uma figurinha do Sticker.ly:', err.message);
      }
    }

    historicoPacksStickerLy.set(chaveHistorico, historico);
    if (figurinhas.length) nomePack = escolhidos[0]?.nome || nomePack;

    return { nome: nomePack, figurinhas };
  } catch (err) {
    console.log('Erro ao montar pack do Sticker.ly:', err.message);
    return { nome: null, figurinhas: [] };
  }
}

module.exports = {
  gerarFigurinha,
  gerarPackDeFigurinhas,
  pesquisarPacksStickerLy,
  baixarPackStickerLy,
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
};

