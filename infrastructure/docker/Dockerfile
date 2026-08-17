FROM node:20-bookworm-slim AS build
ARG APP
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @riftgrid/${APP}... build

FROM node:20-bookworm-slim
ARG APP
ENV NODE_ENV=production
ENV APP_NAME=$APP
WORKDIR /workspace
COPY --from=build /workspace /workspace
CMD ["sh", "-c", "if [ \"$APP_NAME\" = \"web\" ]; then pnpm --filter @riftgrid/web start; else node apps/$APP_NAME/dist/main.js; fi"]
