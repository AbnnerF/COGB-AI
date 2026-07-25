const GROQ_API_KEY = process.env.GROQ_API_KEY;
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile'; // modelo gratuito da Groq, bom pra classificação

/**
 * Analisa uma mensagem e decide se o COGB da pessoa deve subir, descer ou ficar igual.
 * Retorna { acao: 'violacao' | 'elogio' | 'neutro', delta: number, motivo: string }
 */
async function analisarMensagem(texto) {
  const systemPrompt = `Você modera um grupo de WhatsApp. Analise a mensagem do usuário e classifique-a.

Responda APENAS em JSON puro, sem markdown, sem explicações fora do JSON, no formato:
{"acao": "violacao" | "elogio" | "neutro", "intensidade": 1 a 10, "motivo": "breve explicação em português"}

Regras:
- "violacao": a mensagem desrespeita, xinga, ofende, ameaça ou é agressiva com alguém do grupo.
- "elogio": a mensagem demonstra ótimo comportamento, gentileza, ajuda ao próximo ou reconhecimento de erro passado.
- "neutro": conversa normal, sem nada de especial.
- "intensidade" mede o quão forte foi a violação ou o quão bom foi o comportamento (1 = leve, 10 = extremo).
- Seja bem conservador: na dúvida, classifique como "neutro". Brincadeiras leves entre amigos geralmente são "neutro".`;

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
  const intensidade = Math.min(10, Math.max(1, resultado.intensidade || 1));

  if (resultado.acao === 'violacao') {
    // violação leve soma pouco, violação grave soma bastante (até +25)
    return { acao: 'violacao', delta: intensidade * 2.5, motivo: resultado.motivo };
  }

  if (resultado.acao === 'elogio') {
    // bom comportamento reduz o COGB (até -15)
    return { acao: 'elogio', delta: -(intensidade * 1.5), motivo: resultado.motivo };
  }

  return { acao: 'neutro', delta: 0, motivo: resultado.motivo || '' };
}

module.exports = { analisarMensagem };
