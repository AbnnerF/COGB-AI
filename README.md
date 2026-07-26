# Bot de WhatsApp com COGB 🤖📊

Bot que atua em grupos de WhatsApp e mantém um "COGB" (chances de banimento) automático
para cada membro, usando IA para analisar o comportamento nas mensagens.

## O que ele faz

- Fica de olho nas mensagens do grupo.
- Quando alguém desrespeita, xinga ou ofende: o COGB da pessoa **sobe**.
- Quando alguém tem um ótimo comportamento (ajuda, é gentil, se desculpa): o COGB **desce**.
- Quando alguém digita `/Cogb` no grupo: o bot responde com a lista de todo mundo e a
  porcentagem de cada um.
- Se o COGB de alguém chegar a 100%, o bot manda um aviso automático pro admin no privado.

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
ADMIN_NUMBER=5511999999999
```

### 5. Rode o bot

```
npm start
```

Vai aparecer um **QR code no terminal**. Abra o WhatsApp no seu celular, vá em
**Configurações > Aparelhos conectados > Conectar um aparelho** e escaneie o código.

Pronto — o bot está rodando! Adicione o número que você conectou ao grupo (ou use seu
próprio número) e teste mandando `/Cogb`.

## Onde deixar ele rodando 24h

Rodar `npm start` no seu computador ou celular (via Termux) só mantém o bot ativo
enquanto o aparelho estiver ligado e conectado à internet. Para deixá-lo rodando sempre,
o mais simples para iniciantes é hospedar em um serviço de nuvem com plano gratuito, como:

- [Render](https://render.com)
- [Railway](https://railway.app)

Nesses serviços, você sobe esta mesma pasta de projeto, configura as variáveis de
ambiente (`GROQ_API_KEY` e `ADMIN_NUMBER`) no painel deles, e ele roda `npm start`
automaticamente. Na primeira vez, você vai precisar ver o QR code nos "logs" do serviço
para escanear.

## Ajustes que você pode querer fazer

- **Sensibilidade do COGB (quanto sobe)**: no arquivo `moderation.js`, o número `intensidade * 2.5`
  controla o quão rápido o COGB sobe numa violação. Aumente ou diminua conforme quiser.
- **Quando o COGB desce**: o COGB só baixa automaticamente quando a pessoa fica um tempo sem
  cometer nenhuma violação nova (não desce mais por causa de uma única mensagem boa/desculpa).
  No arquivo `cogb.js`, `DIAS_SEM_VIOLACAO_PARA_DESCER` controla quantos dias de bom comportamento
  são necessários (padrão: 30 dias) e `QUANTIDADE_QUE_DESCE` controla quanto desce a cada vez
  (padrão: 5%). Essa verificação roda automaticamente a cada 24h enquanto o bot estiver ligado.
- **Mensagens do bot**: estão todas em `index.js`, dentro de `sock.sendMessage`.
- **Reiniciar o placar de alguém**: edite ou apague a entrada da pessoa no arquivo
  `data/cogb.json`.

## Estrutura do projeto

```
whatsapp-cogb-bot/
├── index.js          → arquivo principal, conecta ao WhatsApp e escuta mensagens
├── cogb.js            → guarda e calcula o COGB de cada pessoa
├── moderation.js       → chama a IA para analisar cada mensagem
├── data/cogb.json      → banco de dados (arquivo simples) com o COGB de todos
├── .env.example        → modelo das variáveis de ambiente
└── package.json
```
