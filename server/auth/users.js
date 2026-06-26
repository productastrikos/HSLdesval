'use strict';

const fs     = require('fs');
const path   = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    const defaults = [
      {
        id:           'user-admin-1',
        username:     'admin',
        passwordHash: bcrypt.hashSync('admin123', 10),
        fullName:     'System Administrator',
        role:         'admin',
        department:   'Administration',
        active:       true,
        createdAt:    new Date().toISOString(),
      },
      {
        id:           'user-eng-1',
        username:     'engineer1',
        passwordHash: bcrypt.hashSync('engineer123', 10),
        fullName:     'Design Engineer',
        role:         'user',
        department:   'Electrical',
        active:       true,
        createdAt:    new Date().toISOString(),
      },
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaults, null, 2));
    console.log('[Auth] Default users created (admin / engineer1)');
  }
}

function load() {
  ensureFile();
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function save(users) {
  ensureFile();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function strip(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

function findByUsername(username) {
  return load().find(u => u.username === username) || null;
}

function findById(id) {
  return load().find(u => u.id === id) || null;
}

function getAll() {
  return load().map(strip);
}

function create({ username, password, fullName, role, department, active }) {
  const users = load();
  if (users.find(u => u.username === username)) throw new Error('Username already exists');
  const user = {
    id:           'user-' + Date.now(),
    username:     username.trim().toLowerCase(),
    passwordHash: bcrypt.hashSync(password, 10),
    fullName:     fullName || username,
    role:         role === 'admin' ? 'admin' : 'user',
    department:   department || 'General',
    active:       active === undefined ? true : !!active,
    createdAt:    new Date().toISOString(),
  };
  users.push(user);
  save(users);
  return strip(user);
}

function update(id, changes) {
  const users = load();
  const idx   = users.findIndex(u => u.id === id);
  if (idx === -1) throw new Error('User not found');
  const u = { ...users[idx] };
  if (changes.fullName   !== undefined) u.fullName   = changes.fullName;
  if (changes.role       !== undefined) u.role       = changes.role === 'admin' ? 'admin' : 'user';
  if (changes.department !== undefined) u.department = changes.department || 'General';
  if (changes.active     !== undefined) u.active     = !!changes.active;
  if (changes.password)                 u.passwordHash = bcrypt.hashSync(changes.password, 10);
  users[idx] = u;
  save(users);
  return strip(u);
}

function remove(id) {
  const users = load();
  const idx   = users.findIndex(u => u.id === id);
  if (idx === -1) throw new Error('User not found');
  users.splice(idx, 1);
  save(users);
}

module.exports = { findByUsername, findById, getAll, create, update, remove };
