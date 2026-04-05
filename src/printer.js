'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * List available CUPS printers.
 * Returns an array of printer name strings.
 */
async function listPrinters() {
  try {
    const { stdout } = await execFileAsync('lpstat', ['-a']);
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' ')[0]);
  } catch {
    return [];
  }
}

/**
 * Get the default CUPS printer name.
 * Returns null if none is configured.
 */
async function getDefaultPrinter() {
  try {
    const { stdout } = await execFileAsync('lpstat', ['-d']);
    // stdout: "system default destination: <name>"
    const match = stdout.trim().match(/:\s+(\S+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Submit a print job via CUPS lp command.
 *
 * @param {string} filePath  Absolute path to the file to print.
 * @param {object} options
 * @param {string}  [options.printer]     Printer name (defaults to system default).
 * @param {number}  [options.copies=1]    Number of copies.
 * @param {string}  [options.pageSize]    Page size, e.g. "Letter", "A4".
 * @param {string}  [options.orientation] "portrait" | "landscape"
 * @param {string}  [options.colorMode]   "color" | "monochrome"
 * @param {string}  [options.sides]       "one-sided" | "two-sided-long-edge" | "two-sided-short-edge"
 * @returns {{ jobId: string }}
 */
async function printFile(filePath, options = {}) {
  const args = [];

  if (options.printer) {
    args.push('-d', options.printer);
  }

  const copies = parseInt(options.copies, 10);
  if (copies > 0) {
    args.push('-n', String(copies));
  }

  const lpoptions = [];

  if (options.pageSize) {
    lpoptions.push(`media=${options.pageSize}`);
  }

  if (options.orientation === 'landscape') {
    lpoptions.push('orientation-requested=4');
  } else if (options.orientation === 'portrait') {
    lpoptions.push('orientation-requested=3');
  }

  if (options.colorMode === 'monochrome') {
    lpoptions.push('ColorModel=Gray');
  } else if (options.colorMode === 'color') {
    lpoptions.push('ColorModel=RGB');
  }

  if (options.sides) {
    lpoptions.push(`sides=${options.sides}`);
  }

  if (lpoptions.length) {
    args.push('-o', lpoptions.join(' '));
  }

  args.push(filePath);

  const { stdout } = await execFileAsync('lp', args);
  // stdout: "request id is <printer>-<number> (1 file(s))"
  const match = stdout.trim().match(/request id is (\S+)/);
  const jobId = match ? match[1] : null;
  return { jobId };
}

/**
 * Get the status of a specific print job.
 * Returns an object with { jobId, state, details } or null if not found.
 */
async function getJobStatus(jobId) {
  try {
    const { stdout } = await execFileAsync('lpstat', ['-W', 'all', '-l']);
    const lines = stdout.split('\n');
    let current = null;
    const details = [];

    for (const line of lines) {
      // Job header looks like: printer-12  user  1234  Mon Apr  5 …
      const headerMatch = line.match(/^(\S+)\s+\S+\s+\d+/);
      if (headerMatch) {
        if (current && current.jobId === jobId) {
          return { jobId: current.jobId, state: current.state, details: details.join('\n') };
        }
        current = { jobId: headerMatch[1], state: 'queued' };
        details.length = 0;
        continue;
      }
      if (current) {
        const stateLine = line.trim();
        if (stateLine) details.push(stateLine);
        if (/completed/i.test(stateLine)) current.state = 'completed';
        else if (/processing/i.test(stateLine)) current.state = 'processing';
        else if (/stopped|aborted/i.test(stateLine)) current.state = 'error';
      }
    }

    if (current && current.jobId === jobId) {
      return { jobId: current.jobId, state: current.state, details: details.join('\n') };
    }

    return null;
  } catch {
    return null;
  }
}

module.exports = { listPrinters, getDefaultPrinter, printFile, getJobStatus };
