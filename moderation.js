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
- "violacao": a mensagem contém xingamento, ofensa, ameaça ou agressão CLARA, DIRETA e em português
  (ou outro idioma que você reconheça com certeza) contra alguém do grupo.
- "neutro": qualquer outra coisa, incluindo:
  - conversa normal, brincadeiras leves entre amigos, sarcasmo sem alvo
  - desculpas ou autocrítica (ex: "desculpa por xingar ontem")
  - comentários sobre o próprio bot/COGB ou suas configurações
  - emoticons, carinhas (ex: "×_×", ":/", "-_-"), figurinhas, ou reações sem texto
  - sequências de símbolos, pontuação repetida, ou "keysmash" sem sentido claro (ex: "m(#!$+_;$+$;$;$;")
  - siglas, abreviações ou gírias que você NÃO reconhece com certeza como ofensivas
  - qualquer mensagem cujo significado esteja ambíguo ou pouco claro
- Se você não tem certeza absoluta de que é uma ofensa real e compreensível, classifique como "neutro".
  Símbolos, emoticons e siglas desconhecidas NUNCA devem ser tratados como violação, mesmo que pareçam
  suspeitos — só ofensas em palavras reais e claras contam.
- "intensidade" mede o quão grave foi a violação (1 = leve, 10 = extremo, reservado para ameaças graves
  ou discurso de ódio). A grande maioria das violações reais deve ficar entre 1 e 4. Só use 8+ em casos
  claramente extremos (ameaças de violência real, discurso de ódio explícito).`;

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

// Converte a classificação da IA num valor de delta pro COGB.
// Nenhuma mensagem sozinha pode subir mais que MAX_DELTA_POR_MENSAGEM,
// mesmo em caso de erro de classificação da IA.
const MAX_DELTA_POR_MENSAGEM = 12;

function converterParaDelta(resultado) {
  if (resultado.acao === 'violacao') {
    const intensidade = Math.min(10, Math.max(1, resultado.intensidade || 1));
    const delta = Math.min(MAX_DELTA_POR_MENSAGEM, intensidade * 2);
    return { acao: 'violacao', delta, motivo: resultado.motivo };
  }

  return { acao: 'neutro', delta: 0, motivo: resultado.motivo || '' };
}

module.exports = { analisarMensagem };
