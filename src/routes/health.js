'use strict';

const express = require('express');
const { detectCrawlerMode } = require('../crawler');

const router = express.Router();

router.get('/', (req, res) => {
  const crawlerMode = detectCrawlerMode();
  const queue = req.app.get('queue');
  res.json({
    status: 'ok',
    crawler_mode: crawlerMode.mode,
    docker_image: crawlerMode.docker_image,
    launcher: crawlerMode.launcher,
    launcher_found: crawlerMode.launcher_found,
    node_version: process.version,
    uptime_seconds: Math.floor(process.uptime()),
    queue_concurrency: queue ? queue.concurrency : 1,
    queue_running: queue ? queue.running : 0,
    queue_pending: queue ? queue.size : 0,
  });
});

module.exports = router;
