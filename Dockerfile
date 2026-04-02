FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY server.js .
COPY public/ public/
EXPOSE 3000
CMD ["node", "server.js"]
