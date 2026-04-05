FROM node:20-alpine

# Install CUPS client tools (lp, lpstat) and ghostscript for PostScript support
RUN apk add --no-cache cups-client ghostscript

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

# Non-root user for security
RUN addgroup -S stdout && adduser -S stdout -G stdout
RUN mkdir -p /app/uploads && chown stdout:stdout /app/uploads

USER stdout

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "src/server.js"]
