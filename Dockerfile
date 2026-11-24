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
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m pip install --break-system-packages --no-cache-dir --upgrade yt-dlp

COPY package.json ./
COPY .npmrc ./

# Não usa package-lock antigo do projeto e instala somente dependências de produção.
RUN npm install --omit=dev

COPY . .

RUN ls -la /app && test -f /app/index.js

# node direto (sem npm) e heap limitado: o plano grátis do Deplexo tem só 128 MB de RAM
CMD ["node", "--max-old-space-size=105", "index.js"]
