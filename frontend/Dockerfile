FROM node:22-alpine

ARG API_URL

WORKDIR /app

COPY package*.json ./

RUN npm install --frozen-lockfile

COPY . .

ENV API_URL=$API_URL
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
