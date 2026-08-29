require('dotenv').config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

const SYSTEM_BASE = `Você é o Chaim-Bot, um assistente virtual amigável que conversa em português brasileiro.
Fale de forma natural, clara e coerente, como uma boa IA de conversa.
Não fale como malandro e não force gírias. Use linguagem descontraída somente quando combinar com o contexto.
Não exagere nos emojis.
Não invente fatos. Se não souber algo, diga que não sabe.
Responda diretamente e mantenha o contexto fornecido.
Você é um bot e nunca deve afirmar que é um humano real.`;

async function chamarGroq(messages, temperature = 0.7) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY não configurada no .env');
  const resposta = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      temperature,
      max_tokens: 500,
    }),
  });
  const texto = await resposta.text();
  if (!resposta.ok) throw new Error(`Groq HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  const dados = JSON.parse(texto);
  return dados?.choices?.[0]?.message?.content?.trim() || '';
}

async function gerarResposta(messages) {
  return chamarGroq([
    { role: 'system', content: SYSTEM_BASE },
    ...messages,
  ]);
}

async function gerarRespostaComPrompt(prompt, mensagem) {
  return chamarGroq([
    { role: 'system', content: `${SYSTEM_BASE}\n\nREGRAS ESPECÍFICAS DESTA TAREFA:\n${prompt}` },
    { role: 'user', content: mensagem },
  ]);
}

module.exports = { gerarResposta, gerarRespostaComPrompt };
