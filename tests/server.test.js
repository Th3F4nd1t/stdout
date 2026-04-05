'use strict';

const request = require('supertest');
const path = require('path');
const fs = require('fs');

// ── Mock the printer module so we don't invoke real CUPS ──────────────────────
jest.mock('../src/printer', () => ({
  listPrinters: jest.fn(),
  getDefaultPrinter: jest.fn(),
  printFile: jest.fn(),
  getJobStatus: jest.fn(),
}));

// Require app AFTER mocks are registered
const app = require('../src/server');
const printer = require('../src/printer');

// ── Health check ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

// ── GET /api/printers ─────────────────────────────────────────────────────────

describe('GET /api/printers', () => {
  it('returns printers and default', async () => {
    printer.listPrinters.mockResolvedValueOnce(['HP_LaserJet', 'Epson_ET3850']);
    printer.getDefaultPrinter.mockResolvedValueOnce('HP_LaserJet');

    const res = await request(app).get('/api/printers');
    expect(res.status).toBe(200);
    expect(res.body.printers).toEqual(['HP_LaserJet', 'Epson_ET3850']);
    expect(res.body.default).toBe('HP_LaserJet');
  });

  it('returns empty list when CUPS unavailable', async () => {
    printer.listPrinters.mockResolvedValueOnce([]);
    printer.getDefaultPrinter.mockResolvedValueOnce(null);

    const res = await request(app).get('/api/printers');
    expect(res.status).toBe(200);
    expect(res.body.printers).toEqual([]);
    expect(res.body.default).toBeNull();
  });

  it('returns 500 on unexpected error', async () => {
    printer.listPrinters.mockRejectedValueOnce(new Error('unexpected'));
    printer.getDefaultPrinter.mockResolvedValueOnce(null);

    const res = await request(app).get('/api/printers');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to query printers/);
  });
});

// ── POST /api/print ───────────────────────────────────────────────────────────

const FIXTURE_PDF = path.join(__dirname, 'fixtures', 'test.pdf');

beforeAll(() => {
  const dir = path.join(__dirname, 'fixtures');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Minimal PDF so multer file-filter accepts it
  fs.writeFileSync(
    FIXTURE_PDF,
    '%PDF-1.4\n1 0 obj<</Type /Catalog>>endobj\nxref\n0 1\n0000000000 65535 f \ntrailer<</Size 1>>\n%%EOF\n',
  );
});

afterAll(() => {
  if (fs.existsSync(FIXTURE_PDF)) fs.unlinkSync(FIXTURE_PDF);
});

describe('POST /api/print', () => {
  it('returns 400 when no file is attached', async () => {
    const res = await request(app).post('/api/print');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No file uploaded/);
  });

  it('submits a print job and returns jobId', async () => {
    printer.printFile.mockResolvedValueOnce({ jobId: 'HP_LaserJet-42' });

    const res = await request(app)
      .post('/api/print')
      .attach('file', FIXTURE_PDF)
      .field('copies', '2')
      .field('orientation', 'landscape');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.jobId).toBe('HP_LaserJet-42');
  });

  it('forwards print options to printFile', async () => {
    printer.printFile.mockResolvedValueOnce({ jobId: 'HP_LaserJet-5' });

    await request(app)
      .post('/api/print')
      .attach('file', FIXTURE_PDF)
      .field('printer', 'HP_LaserJet')
      .field('copies', '3')
      .field('pageSize', 'A4')
      .field('colorMode', 'monochrome')
      .field('sides', 'two-sided-long-edge');

    const [, opts] = printer.printFile.mock.calls[printer.printFile.mock.calls.length - 1];
    expect(opts.printer).toBe('HP_LaserJet');
    expect(opts.copies).toBe(3);
    expect(opts.pageSize).toBe('A4');
    expect(opts.colorMode).toBe('monochrome');
    expect(opts.sides).toBe('two-sided-long-edge');
  });

  it('returns 500 when printFile rejects', async () => {
    printer.printFile.mockRejectedValueOnce(new Error('lp: no such printer'));

    const res = await request(app)
      .post('/api/print')
      .attach('file', FIXTURE_PDF);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Print job failed/);
  });

  it('rejects an unsupported file type', async () => {
    const tmpFile = path.join(__dirname, 'fixtures', 'test.exe');
    fs.writeFileSync(tmpFile, 'MZ\x00\x00');

    try {
      const res = await request(app)
        .post('/api/print')
        .attach('file', tmpFile, { contentType: 'application/octet-stream' });

      expect(res.status).toBe(415);
      expect(res.body.error).toMatch(/Unsupported file type/);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('clamps copies to max 99', async () => {
    printer.printFile.mockResolvedValueOnce({ jobId: 'test-1' });

    await request(app)
      .post('/api/print')
      .attach('file', FIXTURE_PDF)
      .field('copies', '9999');

    const [, opts] = printer.printFile.mock.calls[printer.printFile.mock.calls.length - 1];
    expect(opts.copies).toBe(99);
  });

  it('ignores invalid enum values for options', async () => {
    printer.printFile.mockResolvedValueOnce({ jobId: 'test-2' });

    await request(app)
      .post('/api/print')
      .attach('file', FIXTURE_PDF)
      .field('colorMode', 'rainbow')
      .field('sides', 'five-sided');

    const [, opts] = printer.printFile.mock.calls[printer.printFile.mock.calls.length - 1];
    expect(opts.colorMode).toBeUndefined();
    expect(opts.sides).toBeUndefined();
  });
});

// ── GET /api/status/:jobId ────────────────────────────────────────────────────

describe('GET /api/status/:jobId', () => {
  it('returns 400 for a job ID containing invalid characters', async () => {
    const res = await request(app).get('/api/status/bad!job@id');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid job ID/);
  });

  it('returns 404 when job is not found', async () => {
    printer.getJobStatus.mockResolvedValueOnce(null);

    const res = await request(app).get('/api/status/HP_LaserJet-99');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/);
  });

  it('returns job status when found', async () => {
    printer.getJobStatus.mockResolvedValueOnce({
      jobId: 'HP_LaserJet-42',
      state: 'processing',
      details: 'Status: processing',
    });

    const res = await request(app).get('/api/status/HP_LaserJet-42');
    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe('HP_LaserJet-42');
    expect(res.body.state).toBe('processing');
  });

  it('returns 500 on unexpected error', async () => {
    printer.getJobStatus.mockRejectedValueOnce(new Error('cups crashed'));

    const res = await request(app).get('/api/status/HP_LaserJet-1');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Failed to query job status/);
  });
});

// ── SPA catch-all ─────────────────────────────────────────────────────────────

describe('GET unknown route', () => {
  it('serves index.html', async () => {
    const res = await request(app).get('/some/unknown/route');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });
});
