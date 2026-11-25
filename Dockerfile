FROM node:20-bookworm-slim

WORKDIR /app

# Instala apenas o essencial (FFmpeg para áudio/vídeos) de forma rápida
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copia as dependências e instala
COPY package*.json ./
RUN npm install

# Copia o restante do código
COPY . .

CMD ["npm", "start"]
