const GROQ_API_KEY = process.env.GROQ_API_KEY;
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile'; // modelo gratuito da Groq, bom pra classificação

/**
 * Analisa uma mensagem e decide se o COGB da pessoa deve subir.
 * Retorna { acao: 'violacao' | 'neutro', delta: number, motivo: string }
 */
async function analisarMensagem(texto) {
  const systemPrompt = `Você modera um grupo de WhatsApp que usa um bot chamado COGB (chances de banimento).

Responda APENAS em JSON puro, sem markdown, sem explicações fora do JSON, no formato:
{"acao": "violacao" | "neutro", "intensidade": 1 a 10, "motivo": "breve explicação em português"}

Regras:
- "violacao": a mensagem contém xingamento, ofensa, ameaça ou agressão CLARA e direta contra alguém do grupo.
- "neutro": qualquer outra coisa — inclui conversa normal, brincadeiras leves entre amigos, sarcasmo sem alvo,
  desculpas ou autocrítica (ex: "desculpa por xingar ontem"), e qualquer comentário sobre o próprio bot/COGB
  ou suas configurações (ex: "esse bot tira meu COGB à toa", "vou atualizar as regras dele").
- "intensidade" mede o quão grave foi a violação (1 = leve, 10 = extremo). Só relevante se "acao" for "violacao".
- Seja MUITO conservador: na dúvida, classifique como "neutro". Só marque como violação se não houver
  nenhuma outra leitura razoável da mensagem. Uma pessoa comentando sobre o próprio comportamento passado,
  se desculpando, ou falando do bot NUNCA deve ser tratada como uma nova violação.`;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: texto },
        ],
      }),
    });

    const data = await response.json();

    if (!data.choices || !data.choices[0]) {
      throw new Error('Resposta inesperada da API');
    }

    const textoResposta = data.choices[0].message.content
      .replace(/```json|```/g, '')
      .trim();

    const resultado = JSON.parse(textoResposta);

    return converterParaDelta(resultado);
  } catch (err) {
    console.error('Erro ao analisar mensagem:', err.message);
    return { acao: 'neutro', delta: 0, motivo: 'erro na análise' };
  }
}

// Converte a classificação da IA num valor de delta pro COGB
function converterParaDelta(resultado) {
  if (resultado.acao === 'violacao') {
    const intensidade = Math.min(10, Math.max(1, resultado.intensidade || 1));
    // violação leve soma pouco, violação grave soma bastante (até +25)
    return { acao: 'violacao', delta: intensidade * 2.5, motivo: resultado.motivo };
  }

  return { acao: 'neutro', delta: 0, motivo: resultado.motivo || '' };
}

module.exports = { analisarMensagem };
