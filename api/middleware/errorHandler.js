'use strict';

const logger = require('../lib/logger').child({ module: 'error-handler' });

function errorHandler(err, req, res, next) {
  logger.error('express error', {
    method: req.method,
    path: req.path,
    error: err && err.message,
    stack: err && err.stack,
  });

  if (res.headersSent) {
    return next(err);
  }

  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { errorHandler };
