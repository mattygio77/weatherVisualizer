FROM node:20-alpine

WORKDIR /app

COPY package.json ./
# Zero external runtime dependencies - uses Node.js standard libraries (dgram, http, fs)

COPY relay.js ./

EXPOSE 1514/udp
EXPOSE 3001/tcp

USER node

CMD ["node", "relay.js"]
