'use strict';

/* ─── State ─────────────────────────────────────────────────────────────────── */
let selectedFile = null;
const jobHistory = []; // { id, name, jobId, time, state }

/* ─── DOM refs ──────────────────────────────────────────────────────────────── */
const printerSelect   = document.getElementById('printer-select');
const refreshBtn      = document.getElementById('refresh-printers');
const noPrintersMsg   = document.getElementById('no-printers-msg');
const dropZone        = document.getElementById('drop-zone');
const fileInput       = document.getElementById('file-input');
const fileInfo        = document.getElementById('file-info');
const fileName        = document.getElementById('file-name');
const clearFileBtn    = document.getElementById('clear-file');
const copiesInput     = document.getElementById('copies');
const pageSizeSelect  = document.getElementById('page-size');
const orientationSel  = document.getElementById('orientation');
const colorModeSelect = document.getElementById('color-mode');
const sidesSel        = document.getElementById('sides');
const printBtn        = document.getElementById('print-btn');
const statusBar       = document.getElementById('status-bar');
const jobList         = document.getElementById('job-list');

/* ─── Printer list ──────────────────────────────────────────────────────────── */
async function loadPrinters() {
  printerSelect.innerHTML = '<option value="">Loading…</option>';
  printerSelect.disabled = true;

  try {
    const res = await fetch('/api/printers');
    const data = await res.json();
    const { printers, default: def } = data;

    if (!printers || printers.length === 0) {
      printerSelect.innerHTML = '<option value="">No printers found</option>';
      noPrintersMsg.classList.remove('hidden');
    } else {
      noPrintersMsg.classList.add('hidden');
      printerSelect.innerHTML = '<option value="">System default</option>';
      printers.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p + (p === def ? ' (default)' : '');
        if (p === def) opt.selected = true;
        printerSelect.appendChild(opt);
      });
    }
  } catch {
    printerSelect.innerHTML = '<option value="">Error loading printers</option>';
    noPrintersMsg.classList.remove('hidden');
  } finally {
    printerSelect.disabled = false;
  }
}

refreshBtn.addEventListener('click', loadPrinters);

/* ─── File selection ────────────────────────────────────────────────────────── */
function setFile(file) {
  if (!file) return;
  selectedFile = file;
  fileName.textContent = file.name;
  fileInfo.classList.remove('hidden');
  dropZone.querySelector('.drop-label').textContent = 'File selected ✓';
  updatePrintBtn();
}

function clearFile() {
  selectedFile = null;
  fileInput.value = '';
  fileInfo.classList.add('hidden');
  dropZone.querySelector('.drop-label').innerHTML = 'Drop file here or <u>click to choose</u>';
  updatePrintBtn();
}

fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
clearFileBtn.addEventListener('click', clearFile);

// Drag-and-drop
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});

// Keyboard activation
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

/* ─── Print button state ────────────────────────────────────────────────────── */
function updatePrintBtn() {
  printBtn.disabled = !selectedFile;
}

/* ─── Status bar ────────────────────────────────────────────────────────────── */
function showStatus(msg, type /* 'success'|'error'|'loading' */) {
  statusBar.textContent = msg;
  statusBar.className = `status-bar ${type}`;
  statusBar.classList.remove('hidden');
}

function hideStatus() {
  statusBar.classList.add('hidden');
}

/* ─── Job list ──────────────────────────────────────────────────────────────── */
function renderJobs() {
  jobList.innerHTML = '';

  if (jobHistory.length === 0) {
    const li = document.createElement('li');
    li.className = 'job-item placeholder';
    li.textContent = 'No jobs yet.';
    jobList.appendChild(li);
    return;
  }

  // Newest first
  [...jobHistory].reverse().forEach((job) => {
    const li = document.createElement('li');
    li.className = 'job-item';

    const badge = document.createElement('span');
    badge.className = `job-badge ${job.state}`;
    badge.textContent = job.state;

    const name = document.createElement('span');
    name.className = 'job-name';
    name.textContent = job.name;
    name.title = job.jobId ? `Job ID: ${job.jobId}` : '';

    const time = document.createElement('span');
    time.className = 'job-time';
    time.textContent = job.time;

    li.appendChild(badge);
    li.appendChild(name);
    li.appendChild(time);
    jobList.appendChild(li);
  });
}

/* ─── Print submission ──────────────────────────────────────────────────────── */
printBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  printBtn.disabled = true;
  showStatus('Uploading and submitting print job…', 'loading');

  const formData = new FormData();
  formData.append('file', selectedFile);

  const printer = printerSelect.value;
  if (printer) formData.append('printer', printer);

  const copies = parseInt(copiesInput.value, 10);
  if (copies > 0) formData.append('copies', String(copies));

  const pageSize = pageSizeSelect.value;
  if (pageSize) formData.append('pageSize', pageSize);

  const orientation = orientationSel.value;
  if (orientation) formData.append('orientation', orientation);

  const colorMode = colorModeSelect.value;
  if (colorMode) formData.append('colorMode', colorMode);

  const sides = sidesSel.value;
  if (sides) formData.append('sides', sides);

  const job = {
    id: Date.now(),
    name: selectedFile.name,
    jobId: null,
    time: new Date().toLocaleTimeString(),
    state: 'submitted',
  };
  jobHistory.push(job);
  renderJobs();

  try {
    const res = await fetch('/api/print', { method: 'POST', body: formData });
    const data = await res.json();

    if (res.ok && data.success) {
      job.jobId = data.jobId;
      job.state = 'queued';
      showStatus(`✓ ${data.message}`, 'success');
      clearFile();
      // Poll for status
      if (data.jobId) pollJobStatus(job);
    } else {
      job.state = 'error';
      showStatus(`✗ ${data.error || 'Print failed'}${data.details ? ': ' + data.details : ''}`, 'error');
    }
  } catch (err) {
    job.state = 'error';
    showStatus(`✗ Network error: ${err.message}`, 'error');
  } finally {
    renderJobs();
    updatePrintBtn();
  }
});

/* ─── Job status polling ────────────────────────────────────────────────────── */
async function pollJobStatus(job, attempts = 0) {
  if (!job.jobId || attempts > 20) return;

  await delay(3000);

  try {
    const res = await fetch(`/api/status/${encodeURIComponent(job.jobId)}`);
    if (!res.ok) return; // job may have been flushed from lpstat

    const data = await res.json();
    job.state = data.state || job.state;
    renderJobs();

    if (job.state !== 'completed' && job.state !== 'error') {
      pollJobStatus(job, attempts + 1);
    }
  } catch {
    // silently stop polling on network error
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ─── Init ──────────────────────────────────────────────────────────────────── */
loadPrinters();
renderJobs();
