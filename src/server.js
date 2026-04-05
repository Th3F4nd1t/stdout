'use strict';

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const printRouter = require('./routes/print');
const statusRouter = require('./routes/status');

const app = express();

// ── Security middleware ──────────────────────────────────────────────────────

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);

// ── Rate limiting ────────────────────────────────────────────────────────────

const isTest = process.env.NODE_ENV === 'test';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTest ? 10_000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const printLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isTest ? 10_000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many print requests, please slow down.' },
});

app.use(limiter);

// ── Body parsing ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ── Static files ─────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ────────────────────────────────────────────────────────────────

app.use('/api', printLimiter, printRouter);
app.use('/api', statusRouter);

// ── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Catch-all: serve index.html (SPA) ────────────────────────────────────────

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`stdout print server running at http://${HOST}:${PORT}`);
  });
}

module.exports = app;
