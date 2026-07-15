const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

/**
 * Advanced rate limiter middleware to prevent brute force attacks.
 * It identifies requests using a combination of the client's IP address
 * and the user ID (if the user is authenticated).
 */
const advancedRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes window
  max: 100, // Limit each IP/User to 100 requests per window
  keyGenerator: (req) => {
    if (req.user && req.user.id) {
      return `${ipKeyGenerator(req.ip)}_${req.user.id}`;
    }
    return ipKeyGenerator(req.ip);
  },
  message: {
    error: 'Too many requests, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

module.exports = advancedRateLimit;
