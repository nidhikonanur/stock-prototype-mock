require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { recommendationFromCloses } = require('./recommend');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3001;
const MOCK = process.env.MOCK === 'true';

// Simple in-memory caches
let quoteCache = {};
let historyCache = {};

function cacheGet(cache, key, maxAgeMs) {
  const entry = cache[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > maxAgeMs) return null;
  return entry.value;
}

function cacheSet(cache, key, val) {
  cache[key] = { value: val, ts: Date.now() };
}

// ----------------------------
// HEALTH CHECK
// ----------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now(), mock: MOCK });
});

// ----------------------------
// QUOT
