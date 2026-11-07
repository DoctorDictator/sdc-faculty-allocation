FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
COPY auth.ts next.config.ts prisma.config.ts tsconfig.json next-env.d.ts ./
COPY src ./src
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "npm run db:deploy && npm run db:seed && npm run start"]
