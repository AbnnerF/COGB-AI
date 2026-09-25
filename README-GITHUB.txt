CHAIM-BOT — ATUALIZAÇÃO COMPLETA

Base: index.js atual enviado pelo usuário + restauração das funções que estavam presentes na versão MASTER anterior.

CORREÇÕES PRINCIPAIS
- /bot restaurado e reforçado.
- /bot responde quando chamado, perguntas/saudações e participa espontaneamente de forma natural.
- Fallback da IA do /bot para reduzir falhas quando o wrapper de prompt falhar.
- Histórico do /bot registra também as respostas do próprio Chaim-Bot.
- Criador fixo reconhecido pelo número 5565996799870.
- /bot identifica o Criador e o trata como Criador.
- Ao detectar a entrada do Criador em grupo, o bot envia uma saudação.
- /kiss restaurado junto de /hug e /punch, com múltiplas fontes de GIF.
- /kill, /moeda e /caraoucoroa mantidos.
- UNO restaurado.
- Among Us restaurado.
- /ligado restaurado como comando de status.
- Outras funções presentes na versão MASTER anterior foram preservadas.
- Sintaxe do index.js verificada com node --check.

IMPORTANTE
Este pacote contém os arquivos que precisam ser substituídos/atualizados:
- index.js
- mensagens.js

Não apague os outros arquivos do projeto (chatbot.js, sticker.js, estado.js, tops.js, rpg.js, pokemon.js, package.json etc.).

Depois de substituir os dois arquivos no GitHub, faça commit/push. Só depois teste o bot antes de colocar no Northflank.

NÃO coloque chaves da Groq ou outras credenciais neste ZIP/GitHub. Use as variáveis de ambiente do serviço.
