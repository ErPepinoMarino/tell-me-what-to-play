# Fase 1: aqui construimos para tirar todo lo pesado despues y no llevarlo a produccion.
FROM node:22 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
# Compila. Sin prune: migrate/seed usan esta misma imagen y necesitan prisma+tsx.
RUN npm run build
# Fase 2: imagen final limpia solo con lo necesario para correr.
FROM node:22
WORKDIR /app
# Activa optimizaciones de produccion en Fastify/Node.
ENV NODE_ENV=production
# Trae solo el resultado de la fase build ya con dueno node para poder correr sin root.
COPY --from=build --chown=node:node /app ./
# Corre sin privilegios para que un ataque no tenga control de administrador.
USER node
EXPOSE 3001
CMD ["node", "./dist/server.js"]
