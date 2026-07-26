# Bot de WhatsApp conversador 🤖💬

Bot que participa de grupos de WhatsApp como se fosse mais um amigo — usa gírias, faz piadas,
conversa de boa. Só entra na conversa quando é chamado (@mencionado), e "sai" sozinho depois
de 20 segundos sem ninguém falar, voltando a ficar quieto até ser chamado de novo.

## O que ele faz

- Fica quieto no grupo até alguém **marcar ele** (@) numa mensagem.
- Quando marcado, começa a responder normalmente, de forma descontraída e engraçada.
- Continua respondendo enquanto a conversa estiver rolando.
- Se ninguém mandar mensagem nenhuma por **20 segundos**, ele "desliga" e volta a ficar quieto —
  só volta a responder se alguém marcar ele de novo.

## Passo a passo para rodar (do zero)

### 1. Instale o Node.js

Baixe e instale em [nodejs.org](https://nodejs.org) (versão 18 ou mais nova). Depois de
instalar, confirme no terminal:

```
node -v
```

### 2. Baixe/extraia esta pasta e instale as dependências

Dentro da pasta do projeto, rode:

```
npm install
```

### 3. Pegue sua chave da API da Groq (gratuita)

1. Crie uma conta em [console.groq.com/keys](https://console.groq.com/keys).
2. Toque em "Create API Key", dê um nome e copie a chave gerada (começa com `gsk_`).
3. Não precisa cartão de crédito — a Groq tem uso gratuito generoso.

### 4. Configure as variáveis de ambiente

Copie o arquivo `.env.example` e renomeie a cópia para `.env`. Abra e preencha:

```
GROQ_API_KEY=sua_chave_aqui
BOT_NUMBER=numero_do_chip_do_bot_com_ddi
```

### 5. Rode o bot

```
npm start
```

Vai aparecer um **código de pareamento no terminal**. No WhatsApp Business do número do bot:
Configurações > Aparelhos conectados > Conectar um aparelho > "Conectar com número de telefone" >
digite o código.

## Onde deixar ele rodando 24h

Rodar `npm start` no seu computador ou celular (via Termux) só mantém o bot ativo enquanto o
aparelho estiver ligado e conectado à internet. Se quiser deixá-lo sempre online, considere um
serviço de nuvem — mas atenção: planos gratuitos de hospedagem costumam "hibernar" depois de um
tempo sem uso, o que derruba a conexão do bot. Rodar no próprio celular via Termux, com o celular
sempre carregando e o app aberto, costuma ser a alternativa mais simples e gratuita.

## Ajustes que você pode querer fazer

- **Tempo de inatividade**: no `index.js`, a constante `TEMPO_INATIVIDADE_MS` controla quantos
  segundos sem mensagens fazem o bot "desligar" (padrão: 20 segundos).
- **Personalidade do bot**: no `chatbot.js`, o `SYSTEM_PROMPT` controla como ele fala — ajuste
  ali se quiser um tom diferente, mais ou menos engraçado, etc.

## Estrutura do projeto

```
whatsapp-cogb-bot/
├── index.js       → arquivo principal, conecta ao WhatsApp e escuta mensagens
├── chatbot.js      → chama a IA da Groq pra gerar as respostas do bot
├── .env.example    → modelo das variáveis de ambiente
└── package.json
```
