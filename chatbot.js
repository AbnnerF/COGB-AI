require('dotenv').config();

async function chamarGroq(mensagens) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return null;
  }
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
        messages: mensagens,
        temperature: 0.7,
        max_tokens: 500
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('Erro Groq:', err.message);
    return null;
  }
}

async function gerarResposta(messages) {
  const lista = Array.isArray(messages)
    ? messages
    : [{ role: 'user', content: String(messages || 'Oi') }];

  const resposta = await chamarGroq([
    {
      role: 'system',
      content: 'Você é o Chaim-Bot, um bot de WhatsApp divertido, prestativo, com humor leve e respostas diretas em português do Brasil.'
    },
    ...lista
  ]);

  return resposta || '🤖 Olá! Sou o Chaim-Bot! (Configure a GROQ_API_KEY no painel para respostas completas de IA).';
}

async function gerarRespostaComPrompt(prompt, texto) {
  const resposta = await chamarGroq([
    { role: 'system', content: String(prompt) },
    { role: 'user', content: String(texto) }
  ]);
  return resposta || '🤖 Não consegui processar a IA agora, tente novamente em instantes.';
}

module.exports = { gerarResposta, gerarRespostaComPrompt };
