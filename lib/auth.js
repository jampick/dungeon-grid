// Auth helpers: password hashing + login rate limiter factory.
// Extracted so server.js stays thin and tests can exercise them directly.

import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';

// Cost 10 for production, callers may pass 4 in tests to keep hashing cheap.
export function hashPassword(pw, cost = 10) {
  if (typeof pw !== 'string' || !pw) throw new Error('password required');
  return bcrypt.hashSync(pw, cost);
}

export function verifyPassword(pw, hash) {
  if (!pw || !hash) return false;
  try { return bcrypt.compareSync(pw, hash); }
  catch { return false; }
}

// 10 attempts per 15 minutes per IP. Applied to all login / password-change
// endpoints so a stolen session id can't be brute-forced for its join password
// and so the global DM password is protected against online guessing.
export function makeLoginLimiter(opts = {}) {
  return rateLimit({
    windowMs: opts.windowMs ?? 15 * 60 * 1000,
    max: opts.max ?? 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'too many login attempts' },
    // Default keyGenerator uses the client IP; override in tests where
    // supertest / undici requests may not populate req.ip predictably.
    ...(opts.keyGenerator ? { keyGenerator: opts.keyGenerator } : {}),
  });
}
