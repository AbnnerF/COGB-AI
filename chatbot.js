require('dotenv').config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'openai/gpt-oss-20b';

const SYSTEM_BASE = Você é o Chaim-Bot, um assistente virtual que participa das conversas de um grupo de WhatsApp. Fale em português brasileiro de forma natural, clara, coerente e amigável.;

async function chamarGroq(messages, temperature = 0.7) {
if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY não configurada no .env');

const resposta = await fetch(
'https://api.groq.com/openai/v1/chat/completions',
{
method: 'POST',
headers: {
'Authorization': Bearer ${GROQ_API_KEY},
'Content-Type': 'application/json',
},
body: JSON.stringify({
model: GROQ_MODEL,
messages,
temperature,
max_tokens: 500,
}),
}
);

const texto = await resposta.text();
if (!resposta.ok) throw new Error(Groq HTTP ${resposta.status}: ${texto.slice(0, 300)});
const dados = JSON.parse(texto);
return dados?.choices?.[0]?.message?.content?.trim() || '';
}

async function gerarResposta(messages) {
return chamarGroq([{ role: 'system', content: SYSTEM_BASE }, ...messages]);
}

async function gerarRespostaComPrompt(prompt, mensagem) {
return chamarGroq([
{ role: 'system', content: ${SYSTEM_BASE}\n\nREGRAS ESPECÍFICAS:\n${prompt} },
{ role: 'user', content: mensagem },
]);
}

module.exports = { gerarResposta, gerarRespostaComPrompt };
