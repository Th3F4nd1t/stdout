'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { listPrinters, getDefaultPrinter, printFile } = require('../printer');

const router = express.Router();

// ── Upload configuration ────────────────────────────────────────────────────

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/plain',
  'application/postscript',
]);

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10) * 1024 * 1024;

// ── Allowed print option values ──────────────────────────────────────────────

const ALLOWED_PAGE_SIZES   = ['Letter', 'Legal', 'A4', 'A5', 'Tabloid'];
const ALLOWED_ORIENTATIONS = ['portrait', 'landscape'];
const ALLOWED_COLOR_MODES  = ['color', 'monochrome'];
const ALLOWED_SIDES        = ['one-sided', 'two-sided-long-edge', 'two-sided-short-edge'];

// ── Multer storage ────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, _file, cb) => {
    const ext = path.extname(_file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Unsupported file type'));
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE } });

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/printers
 * Returns the list of available printers and the default one.
 */
router.get('/printers', async (_req, res) => {
  try {
    const [printers, defaultPrinter] = await Promise.all([
      listPrinters(),
      getDefaultPrinter(),
    ]);
    res.json({ printers, default: defaultPrinter });
  } catch (err) {
    res.status(500).json({ error: 'Failed to query printers', details: err.message });
  }
});

/**
 * POST /api/print
 * Accepts a multipart/form-data upload with a "file" field and optional print settings.
 *
 * Body fields:
 *   file        (required) The document to print.
 *   printer     (optional) Printer name — defaults to system default.
 *   copies      (optional, default 1) Number of copies.
 *   pageSize    (optional) One of ALLOWED_PAGE_SIZES.
 *   orientation (optional) One of ALLOWED_ORIENTATIONS.
 *   colorMode   (optional) One of ALLOWED_COLOR_MODES.
 *   sides       (optional) One of ALLOWED_SIDES.
 */
router.post('/print', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Reconstruct the file path from UPLOAD_DIR + the basename only, preventing
  // any path traversal that could come from req.file.path.
  const filePath = path.join(UPLOAD_DIR, path.basename(req.file.path));

  const options = {
    printer: sanitizeString(req.body.printer),
    copies: sanitizeCopies(req.body.copies),
    pageSize: sanitizeEnum(req.body.pageSize, ALLOWED_PAGE_SIZES),
    orientation: sanitizeEnum(req.body.orientation, ALLOWED_ORIENTATIONS),
    colorMode: sanitizeEnum(req.body.colorMode, ALLOWED_COLOR_MODES),
    sides: sanitizeEnum(req.body.sides, ALLOWED_SIDES),
  };

  try {
    const { jobId } = await printFile(filePath, options);
    // Clean up the uploaded file after submitting to CUPS
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr) console.error('Failed to delete uploaded file %s: %s', filePath, unlinkErr.message);
    });
    return res.json({ success: true, jobId, message: `Print job submitted: ${jobId}` });
  } catch (err) {
    fs.unlink(filePath, (unlinkErr) => {
      if (unlinkErr) console.error('Failed to delete uploaded file %s: %s', filePath, unlinkErr.message);
    });
    return res.status(500).json({ error: 'Print job failed', details: err.message });
  }
});

// ── Multer error handler ─────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError || err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB.` });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(415).json({ error: 'Unsupported file type. Allowed: PDF, images, plain text, PostScript.' });
    }
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: 'Unexpected server error' });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeString(value) {
  if (typeof value !== 'string') return undefined;
  // Allow only safe printer/page-size name characters
  return value.replace(/[^a-zA-Z0-9_\-. ]/g, '').trim() || undefined;
}

function sanitizeCopies(value) {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1) return 1;
  if (n > 99) return 99;
  return n;
}

function sanitizeEnum(value, allowed) {
  return allowed.includes(value) ? value : undefined;
}

module.exports = router;

