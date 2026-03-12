'use strict';

const express = require('express');
const { detectLauncher } = require('../crawler');

const router = express.Router();

router.get('/', (req, res) => {
  const launcher = detectLauncher();
  const queue = req.app.get('queue');
  res.json({
    status: 'ok',
    launcher: launcher.path,
    launcher_found: launcher.found,
    node_version: process.version,
    uptime_seconds: Math.floor(process.uptime()),
    queue_concurrency: queue ? queue.concurrency : 1,
    queue_running: queue ? queue.running : 0,
    queue_pending: queue ? queue.size : 0,
  });
});

module.exports = router;
