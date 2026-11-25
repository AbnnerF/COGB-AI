FROM node:20-bookworm-slim

WORKDIR /app

# Instala o ffmpeg necessário para áudio/mídia
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copia os pacotes e instala
COPY package*.json ./
RUN npm install

# Copia todo o código restante
COPY . .

# Inicia a aplicação
CMD ["node", "index.js"]
