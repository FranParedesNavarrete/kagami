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

# Fixtures de /diag/range (M1, ROADMAP.md primera tarea): dos mp4 casi
# identicos, uno con moov al principio y otro al final, generados con
# ffmpeg (apps/server/scripts/gen-diag-videos.sh). No se committean al
# repo (serian ~25MB de binario para una herramienta de diagnostico que
# se piensa retirar en cuanto la tabla de la LG este rellena, ver
# docs/spike-range.md) y no se montan por volumen (eso exigiria un paso
# manual fuera de `docker compose up --build`, justo lo que esto tiene
# que evitar). Generarlos aqui, en la imagen de build, es lo unico que
# deja `docker compose up -d --build` autosuficiente de cero.
RUN apk add --no-cache ffmpeg bash \
	&& cd apps/server \
	&& bash scripts/gen-diag-videos.sh

FROM node:22-alpine AS production
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
COPY --from=build /app/apps/server/data/diag-range apps/server/data/diag-range

EXPOSE 7421
CMD ["node", "apps/server/dist/index.js"]
