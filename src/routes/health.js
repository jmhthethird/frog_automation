'use strict';

const express = require('express');
const { detectLauncher } = require('../crawler');
const { version } = require('../../package.json');

const router = express.Router();

router.get('/', (req, res) => {
  const launcher = detectLauncher();
  res.json({
    status: 'ok',
    version,
    launcher: launcher.path,
    launcher_found: launcher.found,
    node_version: process.version,
    uptime_seconds: Math.floor(process.uptime()),
  });
});

module.exports = router;
