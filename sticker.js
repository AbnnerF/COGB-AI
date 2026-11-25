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

module.exports = { baixarAudioDoYoutube };
