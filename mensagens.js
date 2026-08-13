const MENSAGEM_BOAS_VINDAS_PV = `🤖✨ OLÁ! EU SOU O CHAIM-BOT! ✨🤖

👋 Prazer! Eu sou o Chaim-Bot, um bot de WhatsApp feito para deixar suas conversas muito mais divertidas! 📱💙

🎨 MINHAS FUNÇÕES:

🖼️ Criar figurinhas a partir de imagens
🎞️ Criar figurinhas animadas a partir de vídeos
🔄 Converter figurinhas normais em imagens
🎬 Converter figurinhas animadas em vídeos
✨ Recorte e remoção de fundo
🔧 Correção e melhorias nas figurinhas
👥 Funcionamento em PV e grupos!

⚙️ COMO CRIAR UMA FIGURINHA?

É simples! 😎

Primeiro, use o comando:

👉 /create fig

📸 Depois, envie a imagem ou vídeo que deseja transformar em figurinha.

🤖 O Chaim-Bot faz o resto!

🔄 E QUER CONVERTER UMA FIGURINHA?

Também dá! 😎

Você pode converter:
🖼️ Figurinha normal → Imagem
🎞️ Figurinha animada → Vídeo

🔄 COMO CONVERTER UMA FIGURINHA?

É simples! 😎

Primeiro, use o comando:

👉 /convert

📸 Depois, envie a figurinha que deseja converter.

🖼️ Figurinha normal → Imagem
🎞️ Figurinha animada → Vídeo

🤖 O Chaim-Bot faz o resto! ✨

🚀 MAIS FUNÇÕES ESTÃO POR VIR!

👥 QUER O CHAIM-BOT NO SEU GRUPO?

Se quiser convidar o Chaim-Bot para ser o bot do seu grupo, entre em contato pelo número:

📞 +55 65 99679-9870

💙 CHAIM-BOT — seu bot de figurinhas e conversões! 🤖✨`;

const MENSAGEM_NOVA_FUNCAO_CONVERT = `🎉🤖 NOVA FUNÇÃO NO CHAIM-BOT!

🚀 Hoje o Chaim-Bot ganhou uma nova função!

🔄 /convert acaba de ser lançado! ✨

Agora você pode converter suas figurinhas facilmente:

🖼️ Figurinha normal → Imagem
🎞️ Figurinha animada → Vídeo

📌 Como usar:
1️⃣ Digite /convert
2️⃣ Depois envie a figurinha
3️⃣ O Chaim-Bot fará a conversão! 🤖✨

🔥 /convert — NOVO no Chaim-Bot!

💙 Aproveitem a nova função!`;

const MENSAGEM_GRUPO_ATIVADO = `🤖✨ Olá, pessoal!

Acabei de entrar no grupo! 👋😎
Eu sou o Chaim-Bot, o novo bot de vocês! 💙

🎨 Quer criar uma figurinha? É bem simples:

1️⃣ Primeiro, envie:
👉 "/create fig"

2️⃣ Depois que eu pedir, mande a foto ou vídeo 📸🎞️

🤖✨ E eu vou transformar em uma figurinha para vocês!

Também posso criar figurinhas animadas! 🎞️🔥

📋 Digite */menu* pra ver tudo que eu sei fazer!

👥 Espero me divertir bastante com vocês!

⚡ Chaim-Bot — agora fazendo parte do grupo! 🤖💙`;

const MENSAGEM_MENU = `📋🤖 MENU — CHAIM-BOT

Olha tudo que eu sei fazer! 😎

🖼️ */create fig*
Cria uma figurinha a partir de uma imagem, vídeo ou GIF que você mandar.
1️⃣ Digite /create fig
2️⃣ Mande a foto, vídeo ou GIF (com legenda opcional, vira o nome da figurinha)

🎨 */fig <descrição>*
Cria uma figurinha do zero, com IA, a partir do que você descrever.
Ex: /fig gato astronauta

🔄 */convert*
Converte uma figurinha de volta pra foto ou vídeo.
1️⃣ Digite /convert
2️⃣ Mande a figurinha
🖼️ Normal vira imagem, 🎞️ animada vira vídeo

🎵 */audio*
Extrai o áudio de um vídeo (tipo tirar a música dele).
1️⃣ Digite /audio
2️⃣ Mande o vídeo, ou cole um link do YouTube (funciona os dois!)

💬 */Bot* (só em grupos)
Me chama pra bater papo com vocês! Eu entro na conversa com gírias e piadas,
e fico "desligado" de novo depois de um tempo sem ninguém falar.

📝 */feedback <mensagem>*
Manda uma sugestão, elogio ou reclamação direto pra quem cuida de mim.
Ex: /feedback esse bot é muito bom!

👥 QUER O CHAIM-BOT NO SEU GRUPO?
Entre em contato pelo número:
📞 +55 65 99679-9870

💙 CHAIM-BOT — seu bot de figurinhas, conversões e conversa! 🤖✨`;

const MENSAGEM_GRUPO_PENDENTE = `⚠️🤖 AVISO — CHAIM-BOT

Olá, pessoal! 👋

Parece que o dono ou os administradores deste grupo ainda não entraram em contato com o responsável pelo Chaim-Bot para autorizar minha entrada.

🔒 Por enquanto, minhas funções permanecerão desativadas neste grupo.

📞 Para autorizar o bot, o dono ou algum administrador deve entrar em contato com:

+55 65 99679-9870

✅ Após a autorização, minhas funções poderão ser ativadas normalmente.

🤖 Chaim-Bot agradece a compreensão! 💙`;

const MENSAGEM_GRUPO_RECUSADO = `😔 Não fui autorizado a participar deste grupo.

Vou sair agora. Até mais! 👋`;

module.exports = {
  MENSAGEM_BOAS_VINDAS_PV,
  MENSAGEM_NOVA_FUNCAO_CONVERT,
  MENSAGEM_MENU,
  MENSAGEM_GRUPO_ATIVADO,
  MENSAGEM_GRUPO_PENDENTE,
  MENSAGEM_GRUPO_RECUSADO,
};
