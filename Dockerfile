# Usa Node 20 sobre Debian (ligero y estable)
FROM node:20-bullseye-slim

# Instala dependencias del sistema que necesita Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libc6 \
    libcairo2 \
    libcap2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxshmfence1 \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

# Crea directorio de la app
WORKDIR /app

# Variables para puppeteer en contenedor
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=production

# Copiamos primero package* para aprovechar la cache
COPY package*.json ./

# Instala dependencias (usa ci si hay lock)
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copia el resto del código
COPY . .

# Asegura que exista el directorio de sesión (lo montarás como volumen en local/Railway)
RUN mkdir -p /app/.wwebjs_auth /app/logs

# Expone el puerto si tu bot sirve algo (ajústalo si usás otro)
EXPOSE 3000

# Comando de arranque
CMD ["node", "src/index.js"]
