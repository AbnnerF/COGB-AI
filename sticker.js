const { exec, execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const webp = require('node-webpmux');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const PASTA_TEMP = process.env.COGB_TMP_DIR
? path.resolve(process.env.COGB_TMP_DIR)
: path.join(os.tmpdir(), 'cogb-ai-sticker-tmp');

function garantirPastaTemp() {
if (!fs.existsSync(PASTA_TEMP)) fs.mkdirSync(PASTA_TEMP, { recursive: true });
}

const FILTROS = {
recortada: 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512',
original: 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0',
esticada: 'scale=512:512',
};

async function obterDimensoes(bufferImagem) {
garantirPastaTemp();
const caminho = path.join(PASTA_TEMP, ${Date.now()}-${Math.floor(Math.random() * 10000)}-dim.jpg);
try {
fs.writeFileSync(caminho, bufferImagem);
const { stdout } = await execAsync(
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${caminho}"
);
const [largura, altura] = stdout.trim().split(',').map(Number);
return { largura, altura };
} finally {
if (fs.existsSync(caminho)) fs.unlinkSync(caminho);
}
}

function ehDesproporcional({ largura, altura } = {}) {
if (!largura || !altura) return false;
const proporcao = largura / altura;
return Math.abs(proporcao - 1) > 0.02;
}

async function converterParaWebp(bufferImagem, modo = 'recortada') {
garantirPastaTemp();
const nomeArquivo = ${Date.now()}-${Math.floor(Math.random() * 10000)};
const caminhoEntrada = path.join(PASTA_TEMP, ${nomeArquivo}.jpg);
const caminhoSaida = path.join(PASTA_TEMP, ${nomeArquivo}.webp);
const filtro = FILTROS[modo] || FILTROS.recortada;

try {
fs.writeFileSync(caminhoEntrada, bufferImagem);
await execAsync(
ffmpeg -y -i "${caminhoEntrada}" -vf "${filtro}" -vcodec libwebp -q:v 60 "${caminhoSaida}"
);
return fs.readFileSync(caminhoSaida);
} finally {
if (fs.existsSync(caminhoEntrada)) fs.unlinkSync(caminhoEntrada);
if (fs.existsSync(caminhoSaida)) fs.unlinkSync(caminhoSaida);
}
}

async function adicionarMetadados(bufferWebp, nomeFigurinha) {
const img = new webp.Image();
const dados = {
'sticker-pack-id': Date.now().toString(),
'sticker-pack-name': nomeFigurinha || 'Figurinha',
'sticker-pack-publisher': 'Chaim-Bot',
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

async function gerarFigurinha(descricao) {
try {
const url = https://image.pollinations.ai/prompt/${encodeURIComponent(descricao)}?width=512&height=512&nologo=true;
const resposta = await fetch(url);
if (!resposta.ok) return null;
const bufferImagem = Buffer.from(await resposta.arrayBuffer());
const webpBuffer = await converterParaWebp(bufferImagem);
return adicionarMetadados(webpBuffer, descricao);
} catch (err) {
return null;
}
}

async function criarFigurinhaDeImagem(bufferImagem, legenda, modo = 'recortada') {
try {
const webpBuffer = await converterParaWebp(bufferImagem, modo);
return adicionarMetadados(webpBuffer, legenda);
} catch (err) {
return null;
}
}

const DURACAO_MAXIMA_FIGURINHA = 5;

const FILTROS_VIDEO = {
recortada: 'scale=512:512:force_original_aspect_ratio=increase,crop=512:512,fps=15',
original: 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=white@0,fps=15',
esticada: 'scale=512:512,fps=15',
};

async function criarFigurinhaAnimada(bufferVideo, legenda, modo = 'recortada') {
garantirPastaTemp();
const nomeArquivo = ${Date.now()}-${Math.floor(Math.random() * 10000)};
const caminhoEntrada = path.join(PASTA_TEMP, ${nomeArquivo}.mp4);
const caminhoSaida = path.join(PASTA_TEMP, ${nomeArquivo}.webp);
const filtro = FILTROS_VIDEO[modo] || FILTROS_VIDEO.recortada;

try {
fs.writeFileSync(caminhoEntrada, bufferVideo);
await execAsync(
ffmpeg -y -i "${caminhoEntrada}" -t ${DURACAO_MAXIMA_FIGURINHA} -vf "${filtro}" -loop 0 -an -vsync 0 -vcodec libwebp -q:v 50 -preset default "${caminhoSaida}"
);
const webpBuffer = fs.readFileSync(caminhoSaida);
return adicionarMetadados(webpBuffer, legenda);
} catch (err) {
return null;
} finally {
if (fs.existsSync(caminhoEntrada)) fs.unlinkSync(caminhoEntrada);
if (fs.existsSync(caminhoSaida)) fs.unlinkSync(caminhoSaida);
}
}

async function baixarAudioDoYoutube(url) {
garantirPastaTemp();
const nomeBase = ${Date.now()}-${Math.floor(Math.random() * 10000)};
const caminhoSaida = path.join(PASTA_TEMP, ${nomeBase}.mp3);
const modelo = path.join(PASTA_TEMP, ${nomeBase}.%(ext)s);

const caminhoCookies = [
path.join(__dirname, 'cookies.txt'),
path.join(process.env.COGB_DATA_DIR || '/data', 'cookies.txt')
].find(p => fs.existsSync(p));

const cookiesArg = caminhoCookies ? ['--cookies', caminhoCookies] : [];

try {
const baseArgs = [
'--no-warnings', '--no-playlist', '--extract-audio',
'--audio-format', 'mp3', '--audio-quality', '5',
'--force-ipv4', '--js-runtimes', 'node',
'--remote-components', 'ejs:github',
...cookiesArg,
'--output', modelo,
];
try {
await execFileAsync('yt-dlp', [...baseArgs, url], {
timeout: 150000, maxBuffer: 4 * 1024 * 1024,
});
} catch (primeiroErro) {
const argsAlternativos = [
'--no-warnings', '--no-playlist', '--extract-audio',
'--audio-format', 'mp3', '--audio-quality', '5',
'--force-ipv4', '--js-runtimes', 'node',
'--remote-components', 'ejs:github',
...cookiesArg,
'--extractor-args', 'youtube:player_client=android,web',
'--output', modelo, url,
];
await execFileAsync('yt-dlp', argsAlternativos, {
timeout: 150000, maxBuffer: 4 * 1024 * 1024,
});
}

if (!fs.existsSync(caminhoSaida)) return null;
return fs.readFileSync(caminhoSaida);


} catch (err) {
return null;
} finally {
if (fs.existsSync(caminhoSaida)) fs.unlinkSync(caminhoSaida);
}
}

async function pesquisarPacksStickerLy(tema) {
try {
const url = https://api.sticker.ly/v4/stickerPack/smartSearch?keyword=${encodeURIComponent(tema)}&page=1&size=6;
const res = await fetch(url, {
headers: {
'User-Agent': 'androidapp.stickerly/3.22.0 (Android 13; pt-BR)',
'Accept': 'application/json',
},
});
if (!res.ok) return [];
const json = await res.json();
const lista = json?.result?.stickerPacks || json?.stickerPacks || [];
return lista.slice(0, 5).map((p) => ({
id: p.packId || p.id,
nome: p.name || tema,
publisher: p.authorName || p.publisher || 'Sticker.ly',
link: p.shareUrl || https://sticker.ly/s/${p.packId || p.id},
stickers: (p.stickers || []).map((s) => s.imageUrl || s.url).filter(Boolean),
}));
} catch (err) {
return [];
}
}

async function buscarPackCompletoPorTema(tema) {
const packs = await pesquisarPacksStickerLy(tema);
for (const pack of packs) {
if (!pack.stickers?.length) continue;
const buffers = [];
for (const imgUrl of pack.stickers.slice(0, 12)) {
try {
const r = await fetch(imgUrl);
if (!r.ok) continue;
const buf = Buffer.from(await r.arrayBuffer());
const webpBuf = await converterParaWebp(buf, 'original');
buffers.push(await adicionarMetadados(webpBuf, pack.nome));
} catch (_) {}
}
if (buffers.length >= 3) {
return { nome: pack.nome, publisher: pack.publisher, stickers: buffers };
}
}
return null;
}

module.exports = {
gerarFigurinha,
criarFigurinhaDeImagem,
criarFigurinhaAnimada,
baixarAudioDoYoutube,
pesquisarPacksStickerLy,
buscarPackCompletoPorTema,
adicionarMetadados,
obterDimensoes,
ehDesproporcional,
DURACAO_MAXIMA_FIGURINHA,
};
