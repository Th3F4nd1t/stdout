'use strict';

const express = require('express');
const { getJobStatus } = require('../printer');

const router = express.Router();

/**
 * GET /api/status/:jobId
 * Returns the current status of a print job.
 */
router.get('/status/:jobId', async (req, res) => {
  const { jobId } = req.params;
  if (!jobId || !/^[\w\-]+$/.test(jobId)) {
    return res.status(400).json({ error: 'Invalid job ID' });
  }

  try {
    const status = await getJobStatus(jobId);
    if (!status) {
      return res.status(404).json({ error: 'Job not found', jobId });
    }
    return res.json(status);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to query job status', details: err.message });
  }
});

module.exports = router;
