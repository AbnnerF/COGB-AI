const GROQ_API_KEY = process.env.GROQ_API_KEY;
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant'; // modelo leve e rápido da Groq

const SYSTEM_PROMPT = `Você é um membro brasileiro descontraído de um grupo de WhatsApp, participando
da conversa como se fosse mais um amigo do grupo. Use gírias brasileiras naturais, faça piadas,
seja engraçado e informal. Respostas curtas (1 a 3 frases), como uma pessoa de verdade digitando
no WhatsApp, não como um assistente formal. Nunca se apresente como IA ou bot a menos que perguntem
diretamente. Evite ser ofensivo de verdade (xingamento pesado, preconceito, ameaças) — brincadeira
leve tudo bem, mas sem cruzar a linha.`;

/**
 * Gera uma resposta de chat casual para uma mensagem do grupo.
 * Retorna a string da resposta, ou null se der algum erro.
 */
async function gerarResposta(nomeUsuario, mensagem) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${nomeUsuario} disse: ${mensagem}` },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.choices || !data.choices[0]) {
      console.log('Resposta da Groq (erro):', JSON.stringify(data));
      return null;
    }

    return data.choices[0].message.content.trim();
  } catch (err) {
    console.log('Erro ao gerar resposta do chat:', err.message);
    return null;
  }
}

module.exports = { gerarResposta };
