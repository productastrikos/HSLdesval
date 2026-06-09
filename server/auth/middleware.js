'use strict';

const jwt    = require('jsonwebtoken');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const users  = require('./users');

// JWT signing secret. Priority:
//   1. JWT_SECRET from the environment (recommended for production / multi-instance).
//   2. A persistent random secret stored in data/.jwt-secret (auto-generated once;
//      survives restarts so sessions are not invalidated on every redeploy).
// We never fall back to a hardcoded value — a shipped default would let anyone
// forge admin tokens.
function resolveSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const dir  = path.join(__dirname, '..', 'data');
  const file = path.join(dir, '.jwt-secret');
  try {
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    console.warn('[Auth] JWT_SECRET not set — generated a persistent random secret (data/.jwt-secret). For production, set JWT_SECRET in the environment.');
    return secret;
  } catch (err) {
    console.warn(`[Auth] Could not persist a JWT secret (${err.message}); using an in-memory secret — users will need to log in again after each restart.`);
    return crypto.randomBytes(48).toString('hex');
  }
}

const JWT_SECRET = resolveSecret();
const JWT_EXPIRY = '8h';

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function authenticate(req, res, next) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    const user    = users.findById(payload.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access required' });
  }
  next();
}

module.exports = { sign, authenticate, requireAdmin };
