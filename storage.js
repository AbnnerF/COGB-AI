const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.COGB_DATA_DIR
  ? path.resolve(process.env.COGB_DATA_DIR)
  : (fs.existsSync('/data') && fs.statSync('/data').isDirectory()
      ? path.join('/data', 'cogb-ai')
      : path.join(__dirname, 'data'));

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getDataFile(fileName, legacyPaths = []) {
  ensureDataDir();
  const target = path.join(DATA_DIR, fileName);

  // Migra dados antigos somente quando o arquivo persistente ainda não existe.
  if (!fs.existsSync(target)) {
    for (const legacyPath of legacyPaths) {
      try {
        if (legacyPath && fs.existsSync(legacyPath) && fs.statSync(legacyPath).isFile()) {
          fs.copyFileSync(legacyPath, target);
          console.log(`💾 Dados antigos migrados para o armazenamento persistente: ${fileName}`);
          break;
        }
      } catch (err) {
        console.log(`⚠️ Não foi possível migrar ${fileName}: ${err.message}`);
      }
    }
  }

  return target;
}

module.exports = { DATA_DIR, ensureDataDir, getDataFile };
