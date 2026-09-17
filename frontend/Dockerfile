# Fase 1: aqui construimos para tirar todo lo pesado despues y no llevarlo a produccion.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Valor por defecto para no romper la build si se olvida el --build-arg.
ARG API_URL=http://localhost:3001
ENV API_URL=$API_URL
# Compila y borra devDependencies para no llevar herramientas a produccion.
RUN npm run build && npm prune --omit=dev
# Fase 2: imagen final limpia solo con lo necesario para correr.
FROM node:22-alpine
WORKDIR /app
# Activa optimizaciones de produccion en Next.js.
ENV NODE_ENV=production
ARG API_URL=http://localhost:3001
ENV API_URL=$API_URL
# Trae solo el resultado de la fase build ya con dueno node para poder correr sin root.
COPY --from=build --chown=node:node /app ./
# Corre sin privilegios para que un ataque no tenga control de administrador.
USER node
EXPOSE 3000
CMD ["npm", "start"]

