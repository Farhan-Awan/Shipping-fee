// server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();

// ---------- CONFIG ----------
const SHOPIFY_DOMAIN = 'play-farhan.myshopify.com';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;
const API_VERSION = '2025-07';
const PROTECTION_VARIANT_DYNAMIC = '45626932789401';
const PROTECTION_THRESHOLD = 100;
const PROTECTION_PERCENT = 0.03;
const PROTECTION_BASE_INCREMENT = 0.01;

app.use(cors());
app.use(bodyParser.json());

// ---------- Lock Mechanism ----------
const locks = new Map();
async function withLock(key, fn) {
  while (locks.get(key)) {
    await new Promise((r) => setTimeout(r, 50));
  }
  locks.set(key, true);
  try {
    return await fn();
  } finally {
    locks.delete(key);
  }
}

// ---------- Fetch Helper ----------
async function getFetch() {
  if (typeof global.fetch === 'function') {
    return global.fetch;
  }
  const mod = await import('node-fetch');
  return mod.default;
}

// ---------- Shopify API: Update Price ----------
async function updateVariantPrice(variantId, newPrice) {
  const fetchFn = await getFetch();
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/variants/${variantId}.json`;
  const body = {
    variant: {
      id: Number(variantId),
      price: newPrice.toFixed(2),
    },
  };

  console.log(`[Server] Sending PUT to Shopify → Variant ${variantId}, Price: $${newPrice.toFixed(2)}`);

  const res = await fetchFn(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': ADMIN_API_TOKEN,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API error: ${res.status} ${res.statusText} - ${text}`);
  }

  const json = await res.json();
  return json.variant;
}

// ---------- API: Health Check ----------
app.get('/health', (req, res) => {
  console.log('[Server] Health check ping received');
  res.json({ ok: true });
});

// ---------- API: Get Calculated Price ----------
app.get('/protection/price', (req, res) => {
  const subtotal = parseFloat(req.query.subtotal);
  console.log(`[Server] Price check request → Subtotal: $${subtotal}`);

  if (isNaN(subtotal) || subtotal < 0) {
    return res.status(400).json({ error: 'Invalid subtotal' });
  }

  let price;
  if (subtotal < PROTECTION_THRESHOLD) {
    price = 2.17;
  } else {
    price = parseFloat((subtotal * PROTECTION_PERCENT + PROTECTION_BASE_INCREMENT).toFixed(2));
  }

  console.log(`[Server] Calculated price: $${price}`);
  res.json({ price });
});

// ---------- API: Update Price ----------
app.post('/protection/update', async (req, res) => {
  const subtotal = req.body.subtotal;
  console.log(`[Server] Update request received → Subtotal: $${subtotal}`);

  if (typeof subtotal !== 'number' || subtotal < 0) {
    return res.status(400).json({ error: 'Invalid subtotal' });
  }

  let targetPrice;
  if (subtotal < PROTECTION_THRESHOLD) {
    targetPrice = 2.17;
    console.log(`[Server] Subtotal below threshold → Fixed price $${targetPrice}`);
  } else {
    targetPrice = parseFloat((subtotal * PROTECTION_PERCENT + PROTECTION_BASE_INCREMENT).toFixed(2));
    console.log(`[Server] Subtotal above threshold → Dynamic price $${targetPrice}`);
  }

  try {
    const updatedVariant = await withLock(PROTECTION_VARIANT_DYNAMIC, async () => {
      return await updateVariantPrice(PROTECTION_VARIANT_DYNAMIC, targetPrice);
    });

    console.log(`[Server] Shopify updated successfully → New price $${updatedVariant.price}`);

    res.json({
      updated: true,
      price: parseFloat(updatedVariant.price),
    });
  } catch (err) {
    console.error('[Server] Error updating price:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Server] Protection server running on port ${PORT}`);
});
