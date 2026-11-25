const fs = require('fs');
const path = require('path');
const os = require('os');

function resolverDataDir() {
  if (process.env.COGB_DATA_DIR) {
    return path.resolve(process.env.COGB_DATA_DIR);
  }
  try {
    if (fs.existsSync('/data') && fs.statSync('/data').isDirectory()) {
      fs.accessSync('/data', fs.constants.W_OK);
      return path.join('/data', 'cogb-ai');
    }
  } catch (e) {}
  return path.join(os.tmpdir(), 'cogb-ai-data');
}

const DATA_DIR = resolverDataDir();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getDataFile(fileName, legacyPaths = []) {
  ensureDataDir();
  const target = path.join(DATA_DIR, fileName);

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
