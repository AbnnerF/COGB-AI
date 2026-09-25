FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Ferramentas usadas pelo COGB-AI para áudio, vídeo e figurinhas.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ffmpeg \
       webp \
       yt-dlp \
       python3 \
       ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
