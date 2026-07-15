'use strict';

const logger = require('./logger').child({ module: 'async-handler' });

const asyncHandler = (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch((err) => {
    logger.error('Unhandled route error', err);
    if (res.headersSent) return next(err);
    return res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  });
};

module.exports = asyncHandler;
