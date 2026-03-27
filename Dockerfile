FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/relay/package.json apps/relay/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm install

COPY tsconfig.base.json ./
COPY apps/relay apps/relay
COPY packages/shared packages/shared

EXPOSE 3001

CMD ["npm", "run", "dev", "--workspace=@sbe/relay"]
