FROM node:20-bookworm-slim

WORKDIR /app

# Ferramentas usadas pelo COGB-AI para áudio, vídeo e figurinhas.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ffmpeg \
       webp \
       python3 \
       python3-pip \
       ca-certificates \
       curl \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# A pasta será usada pelo Baileys para guardar a sessão.
RUN mkdir -p /app/auth_info

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
