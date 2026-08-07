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
  return Math.abs(proporcao - 1) > 0.05; // mais de 5% de diferença entre largura e altura
}

// Converte um buffer de imagem (jpg/png/etc) num buffer de figurinha (webp 512x512)
async function converterParaWebp(bufferImagem, modo = 'original') {
  garantirPastaTemp();
  const nomeArquivo = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const caminhoEntrada = path.join(PASTA_TEMP, `${nomeArquivo}.jpg`);
  const caminhoSaida = path.join(PASTA_TEMP, `${nomeArquivo}.webp`);
  const filtro = FILTROS[modo] || FILTROS.original;

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
async function criarFigurinhaDeImagem(bufferImagem, legenda, modo = 'original') {
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
async function criarFigurinhaAnimada(bufferVideo, legenda, modo = 'original') {
  garantirPastaTemp();
  const nomeArquivo = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const caminhoEntrada = path.join(PASTA_TEMP, `${nomeArquivo}.mp4`);
  const caminhoSaida = path.join(PASTA_TEMP, `${nomeArquivo}.webp`);
  const filtro = FILTROS_VIDEO[modo] || FILTROS_VIDEO.original;

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

module.exports = {
  gerarFigurinha,
  criarFigurinhaDeImagem,
  criarFigurinhaAnimada,
  obterDimensoes,
  obterDuracao,
  ehDesproporcional,
  DURACAO_MAXIMA_FIGURINHA,
};
