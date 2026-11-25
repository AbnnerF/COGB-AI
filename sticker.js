const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');

const execFileAsync = promisify(execFile);
const PASTA_TEMP = path.join(os.tmpdir(), 'cogb-ai-sticker-tmp');

function garantirPastaTemp() {
  if (!fs.existsSync(PASTA_TEMP)) fs.mkdirSync(PASTA_TEMP, { recursive: true });
}

async function criarFigurinhaImagem(bufferImagem) {
  garantirPastaTemp();
  const id = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const entrada = path.join(PASTA_TEMP, `${id}.jpg`);
  const saida = path.join(PASTA_TEMP, `${id}.webp`);
  fs.writeFileSync(entrada, bufferImagem);

  try {
    await execFileAsync('ffmpeg', [
      '-y', '-i', entrada,
      '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
      '-vcodec', 'libwebp', '-lossless', '0', '-qscale', '75', '-preset', 'default', '-an', '-vsync', '0',
      saida
    ], { timeout: 30000 });
    if (!fs.existsSync(saida)) return null;
    return fs.readFileSync(saida);
  } catch (e) {
    console.error('Erro criarFigurinhaImagem:', e.message);
    return null;
  } finally {
    if (fs.existsSync(entrada)) fs.unlinkSync(entrada);
    if (fs.existsSync(saida)) fs.unlinkSync(saida);
  }
}

async function criarFigurinhaVideo(bufferVideo) {
  garantirPastaTemp();
  const id = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const entrada = path.join(PASTA_TEMP, `${id}.mp4`);
  const saida = path.join(PASTA_TEMP, `${id}.webp`);
  fs.writeFileSync(entrada, bufferVideo);

  try {
    await execFileAsync('ffmpeg', [
      '-y', '-i', entrada,
      '-t', '6',
      '-vf', 'fps=12,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
      '-vcodec', 'libwebp', '-loop', '0', '-preset', 'default', '-an', '-vsync', '0', '-qscale', '60',
      saida
    ], { timeout: 45000 });
    if (!fs.existsSync(saida)) return null;
    return fs.readFileSync(saida);
  } catch (e) {
    console.error('Erro criarFigurinhaVideo:', e.message);
    return null;
  } finally {
    if (fs.existsSync(entrada)) fs.unlinkSync(entrada);
    if (fs.existsSync(saida)) fs.unlinkSync(saida);
  }
}

async function converterFigurinhaParaPng(bufferWebp) {
  garantirPastaTemp();
  const id = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const entrada = path.join(PASTA_TEMP, `${id}.webp`);
  const saida = path.join(PASTA_TEMP, `${id}.png`);
  fs.writeFileSync(entrada, bufferWebp);

  try {
    await execFileAsync('ffmpeg', ['-y', '-i', entrada, saida], { timeout: 25000 });
    if (!fs.existsSync(saida)) return null;
    return fs.readFileSync(saida);
  } catch (e) {
    console.error('Erro converterFigurinhaParaPng:', e.message);
    return null;
  } finally {
    if (fs.existsSync(entrada)) fs.unlinkSync(entrada);
    if (fs.existsSync(saida)) fs.unlinkSync(saida);
  }
}

async function baixarAudioDoYoutube(url) {
  garantirPastaTemp();
  const nomeBase = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const caminhoSaida = path.join(PASTA_TEMP, `${nomeBase}.mp3`);
  const modelo = path.join(PASTA_TEMP, `${nomeBase}.%(ext)s`);

  const caminhoCookies = path.join(__dirname, 'cookies.txt');
  const cookiesArg = fs.existsSync(caminhoCookies) ? ['--cookies', caminhoCookies] : [];

  try {
    const baseArgs = [
      '--no-warnings', '--no-playlist', '--extract-audio',
      '--audio-format', 'mp3', '--audio-quality', '5',
      '--force-ipv4', ...cookiesArg, '--output', modelo,
    ];
    await execFileAsync('yt-dlp', [...baseArgs, url], { timeout: 150000 });
    if (!fs.existsSync(caminhoSaida)) return null;
    return fs.readFileSync(caminhoSaida);
  } catch (err) {
    return null;
  } finally {
    if (fs.existsSync(caminhoSaida)) fs.unlinkSync(caminhoSaida);
  }
}

module.exports = {
  criarFigurinhaImagem,
  criarFigurinhaVideo,
  converterFigurinhaParaPng,
  baixarAudioDoYoutube,
};
