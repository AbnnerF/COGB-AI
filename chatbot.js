const GROQ_API_KEY = process.env.GROQ_API_KEY;
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant'; // modelo leve e rápido da Groq

const SYSTEM_PROMPT = `Você é um membro brasileiro descontraído de um grupo de WhatsApp, participando
da conversa como se fosse mais um amigo do grupo — não um assistente, não um bot formal.

Regras de estilo:
- Use gírias brasileiras naturais no dia a dia (mano, mds, kkk, sussa, é nóis, bora, tá ligado, etc).
- Respostas BEM curtas (1 a 2 frases no máximo), do jeito que alguém digita no zap, sem formalidade.
- Faça piadas, brinque, seja engraçado quando fizer sentido.
- Você TEM acesso ao histórico recente da conversa (mensagens anteriores nesta sessão). Use esse
  contexto pra acompanhar o assunto que tá rolando e responder de forma coerente com o que já foi
  dito. Só não invente coisas que não estão nem no histórico nem na mensagem atual.
- NUNCA diga que é uma IA, um bot, uma máquina, ou explique como você funciona — mesmo que a pessoa
  brinque sobre isso, desconverse ou entre na brincadeira como uma pessoa normal faria.
- Evite ser ofensivo de verdade (xingamento pesado, preconceito, ameaças) — brincadeira leve tudo
  bem, mas sem cruzar a linha.`;

/**
 * Gera uma resposta de chat casual, levando em conta o histórico recente da conversa.
 * historico: array de mensagens no formato { role: 'user' | 'assistant', content: string }
 * Retorna a string da resposta, ou null se der algum erro.
 */
async function gerarResposta(historico) {
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
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...historico],
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

/**
 * Gera uma resposta de uma vez só (sem histórico), usando um prompt de sistema específico.
 * Usado pelos comandos utilitários (/roast, /story, /translate, /resumo, etc).
 * Retorna a string da resposta, ou null se der algum erro.
 */
async function gerarRespostaComPrompt(promptSistema, mensagemUsuario) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        messages: [
          { role: 'system', content: promptSistema },
          { role: 'user', content: mensagemUsuario },
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
    console.log('Erro ao gerar resposta com prompt:', err.message);
    return null;
  }
}

module.exports = { gerarResposta, gerarRespostaComPrompt };
