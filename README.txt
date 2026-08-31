CHAIM-BOT — ATUALIZAÇÃO GERAL

Arquivos:
- index.js: Among Us corrigido, menu/updates completos, Pokémon, /kiss, /call e brincadeiras rápidas.
- pokemon.js: módulo Pokémon compatível com o index.js atual.

IMPORTANTE:
1. Não substitua seu chatbot.js; mantenha o modelo Groq openai/gpt-oss-20b.
2. O pokemon.js desta atualização deve ficar na raiz do projeto, junto do index.js.
3. O arquivo data/pokemon_players.json será criado automaticamente.
4. Faça backup do seu index.js e pokemon.js antes de substituir.

CALL:
- /call no PV orienta a fazer a ligação.
- A versão atual tenta aceitar a chamada quando a instalação do Baileys expõe acceptCall.
- /music call está preparado como comando, mas tocar áudio dentro da chamada ainda não está conectado ao transporte RTP; não é apresentado como funcional para evitar uma falsa promessa.

AMONG US:
- /amongus
- /party amongUs @pessoas
- tarefas enviadas no PV
- respostas 1/2 no PV
- encontros
- oportunidade secreta do impostor
- report, vote, skip, status e cancel
