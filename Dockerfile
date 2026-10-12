FROM node:20-bookworm-slim

WORKDIR /app

# Dependências do bot e ferramentas usadas por áudio/stickers.
# O Git é necessário para evitar falha do npm quando alguma dependência
# ou metadado do projeto precisar ser resolvido pelo npm.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       git \
       python3 \
       python3-pip \
       ffmpeg \
       webp \
       yt-dlp \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY .npmrc ./

# Não usa package-lock antigo do projeto e instala somente dependências de produção.
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
