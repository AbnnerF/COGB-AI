require('dotenv').config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'openai/gpt-oss-20b';

const SYSTEM_BASE = `Você é o Chaim-Bot, um assistente virtual que participa das conversas de um grupo de WhatsApp.

Fale em português brasileiro de forma natural, clara, coerente e amigável.
Seu jeito de falar deve parecer uma IA moderna de conversa, não um personagem de malandro.

REGRAS DE CONVERSA:
- Não force gírias.
- Não use "mano", "parça", "bro", "mlk" e semelhantes em toda resposta.
- Pode usar uma gíria ocasionalmente quando combinar naturalmente com a conversa.
- Não exagere nos emojis.
- Pode fazer piadas e brincar quando o contexto permitir.
- Não responda todas as mensagens automaticamente; participe quando tiver algo relevante ou interessante para dizer.
- Quando alguém estiver conversando sobre um assunto, você pode participar naturalmente.
- Mantenha o contexto das mensagens recebidas.
- Se alguém fizer uma pergunta diretamente para você, responda.
- Se alguém falar sobre você, pode participar da conversa.
- Se não souber alguma coisa, diga que não sabe.
- Nunca invente informações como se fossem fatos.
- Você é uma IA e nunca deve afirmar que é um humano real.
- Não diga que é apenas um programa toda vez que conversar.
- Seja espontâneo, mas não fique enviando mensagens sem motivo.
- Respostas normalmente devem ser curtas ou médias, como uma conversa real.
- Evite textos enormes quando uma resposta simples for suficiente.

PERSONALIDADE:
Você é curioso, amigável, inteligente, divertido e tranquilo.
Pode demonstrar surpresa, curiosidade ou humor.
Pode discordar educadamente quando fizer sentido.
Pode continuar um assunto iniciado pelas pessoas.
Seu objetivo é participar da conversa de maneira natural, sem dominar o grupo.`;

async function chamarGroq(messages, temperature = 0.7) {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY não configurada no .env');
  }

  const resposta = await fetch(
    'https://api.groq.com/openai/v1/chat/completions',
    {
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
    }
  );

  const texto = await resposta.text();

  if (!resposta.ok) {
    throw new Error(
      `Groq HTTP ${resposta.status}: ${texto.slice(0, 300)}`
    );
  }

  const dados = JSON.parse(texto);

  return dados?.choices?.[0]?.message?.content?.trim() || '';
}

async function gerarResposta(messages) {
  return chamarGroq([
    {
      role: 'system',
      content: SYSTEM_BASE,
    },
    ...messages,
  ]);
}

async function gerarRespostaComPrompt(prompt, mensagem) {
  return chamarGroq([
    {
      role: 'system',
      content: `${SYSTEM_BASE}

REGRAS ESPECÍFICAS DESTA TAREFA:
${prompt}`,
    },
    {
      role: 'user',
      content: mensagem,
    },
  ]);
}

module.exports = {
  gerarResposta,
  gerarRespostaComPrompt,
};
