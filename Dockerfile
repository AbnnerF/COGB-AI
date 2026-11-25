FROM node:20-bookworm-slim

WORKDIR /app

# Instala apenas as dependências essenciais do sistema de forma rápida
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copia os arquivos de dependência primeiro para aproveitar o cache
COPY package*.json ./

# Instala as dependências do Node
RUN npm install

# Copia o restante do código da aplicação
COPY . .

# Comando para iniciar o bot
CMD ["npm", "start"]
