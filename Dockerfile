FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

COPY . .

# Bake the Prisma client into the image so cron machines (which run
# `node app/cron/*.js` directly, bypassing `npm run docker-start`) have it.
RUN npx prisma generate

RUN npm run build

CMD ["npm", "run", "docker-start"]
