# Un solo contenedor (SPECS.md §4.1): shared + server + web en la misma
# imagen, el server sirve el SPA compilado.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:22-alpine AS production
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

# El cast de fichero (M1 parte 3) remuxea a faststart lo que suba un
# usuario EN TIEMPO DE EJECUCION (apps/server/src/lib/remux.ts, detras
# de KAGAMI_REMUX_FASTSTART, ver README.md), asi que ffmpeg tiene que
# vivir en la imagen final. Si no estuviera disponible, kagami sigue
# sirviendo el fichero tal cual y avisa en la UI de que el salto puede
# no funcionar — nunca falla en silencio — pero instalarlo aqui es lo
# normal, no la excepcion.
RUN apk add --no-cache ffmpeg

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist

EXPOSE 7421
CMD ["node", "apps/server/dist/index.js"]
