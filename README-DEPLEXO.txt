CHAIM-BOT — configuração para Deplexo

O index.js atual já inclui um servidor HTTP de saúde para hospedagem:
- PORT = process.env.PORT || 3000
- escuta em 0.0.0.0
- /health e / retornam "COGB-AI online"
- o servidor HTTP é independente da conexão do WhatsApp/Baileys

No Deplexo, deixe a variável PORT ser fornecida pela plataforma se ela fizer isso automaticamente.
Não coloque chaves secretas neste arquivo.

Mantenha os demais arquivos do projeto (chatbot.js, sticker.js, estado.js, tops.js, rpg.js, pokemon.js, mensagens.js, package.json etc.).
