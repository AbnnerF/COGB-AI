require('dotenv').config();

async function gerarResposta(messages) {
  // Aqui fica a tua lógica original de IA / Groq ou respostas automáticas
  return "Olá! Chaim-Bot ativo e operacional.";
}

async function gerarRespostaComPrompt(prompt, texto) {
  return "Olá! Chaim-Bot ativo.";
}

module.exports = { gerarResposta, gerarRespostaComPrompt };
