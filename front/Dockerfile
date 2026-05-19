FROM node:20-alpine

WORKDIR /app/front

COPY front/package*.json ./
RUN npm ci

COPY front/. .

EXPOSE 5173

CMD ["npm", "run", "dev:docker"]
