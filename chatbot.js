require('dotenv').config();
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'openai/gpt-oss-20b';

async function gerarResposta(messages) {
  return "Ola! Chaim-Bot ativo.";
}
module.exports = { gerarResposta };