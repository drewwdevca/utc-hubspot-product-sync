// ============================================================
// Shopify → HubSpot Product Sync (Nightly)
//
// - One HubSpot product per Shopify VARIANT (colour × size)
// - Bilingual FR/EN names via Google Translate (free)
// - Syncs: price, inventory, images, SKU, colour, size
// - Updates existing products, creates new ones
// - Matched by Shopify variant ID (reliable, unique)
// ============================================================

// ── ENV ─────────────────────────────────────────────────────
const SHOPIFY_STORE = 'uniformes-town-country.myshopify.com';
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;

const SHOPIFY_API_VERSION = '2026-04';
const SHOPIFY_API = `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}`;
const HUBSPOT_API = 'https://api.hubapi.com';

// ── HELPERS ──────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(emoji, msg) {
  console.log(`${emoji}  ${msg}`);
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── SHOPIFY API ──────────────────────────────────────────────
async function shopifyFetch(url) {
  const res = await fetch(url, {
    headers: { 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN },
  });

  if (res.status === 429) {
    const retryAfter = parseFloat(res.headers.get('retry-after') || '2');
    log('⏳', `Rate limited — waiting ${retryAfter}s`);
    await sleep(retryAfter * 1000);
    return shopifyFetch(url);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Shopify API error (${res.status}): ${err}`);
  }

  return { data: await res.json(), headers: res.headers };
}

// ── SHOPIFY: Fetch all products with variants ────────────────
async function fetchAllProducts() {
  let products = [];
  let url = `${SHOPIFY_API}/products.json?limit=250&fields=id,title,body_html,handle,variants,images,product_type,tags`;

  while (url) {
    const { data, headers } = await shopifyFetch(url);
    products = products.concat(data.products);

    const linkHeader = headers.get('link');
    const nextMatch = linkHeader?.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;

    log('📦', `Fetched ${products.length} products so far...`);
    await sleep(250);
  }

  return products;
}

// ── SHOPIFY: Fetch inventory levels ──────────────────────────
async function fetchInventoryLevels(inventoryItemIds) {
  const levels = {};
  const chunks = [];

  for (let i = 0; i < inventoryItemIds.length; i += 50) {
    chunks.push(inventoryItemIds.slice(i, i + 50));
  }

  for (const chunk of chunks) {
    const ids = chunk.join(',');
    const url = `${SHOPIFY_API}/inventory_levels.json?inventory_item_ids=${ids}&limit=250`;
    const { data } = await shopifyFetch(url);

    for (const level of data.inventory_levels) {
      const id = level.inventory_item_id;
      levels[id] = (levels[id] || 0) + (level.available || 0);
    }

    await sleep(300);
  }

  return levels;
}

// ── GOOGLE TRANSLATE (free, no API key) ──────────────────────
const translationCache = new Map();
let translate;

async function initTranslation() {
  const module = await import('google-translate-api-x');
  translate = module.default || module;
}

async function translateToEnglish(text) {
  if (!text || text.trim() === '') return '';

  const cacheKey = text.trim().toLowerCase();
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);

  try {
    const res = await translate(text, { from: 'fr', to: 'en' });
    const translated = res.text || text;
    translationCache.set(cacheKey, translated);
    return translated;
  } catch (err) {
    log('⚠️', `Translation failed: ${err.message} — using French as fallback`);
    return text;
  }
}

async function translateOption(value) {
  if (!value || value === 'Default Title') return '';
  return await translateToEnglish(value);
}

// ── HUBSPOT ──────────────────────────────────────────────────
async function hubspotFetch(path, options = {}) {
  const res = await fetch(`${HUBSPOT_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (res.status === 429) {
    const retryAfter = parseFloat(res.headers.get('retry-after') || '2');
    log('⏳', `HubSpot rate limited — waiting ${retryAfter}s`);
    await sleep(retryAfter * 1000);
    return hubspotFetch(path, options);
  }

  return res;
}

// ── HUBSPOT: Create custom properties if they don't exist ────
async function ensureCustomProperties() {
  log('🔧', 'Checking HubSpot custom properties...');

  const needed = [
    { name: 'shopify_variant_id', label: 'Shopify Variant ID', type: 'string', fieldType: 'text', description: 'Unique Shopify variant ID for sync matching' },
    { name: 'variant_color', label: 'Color / Couleur', type: 'string', fieldType: 'text', description: 'Product colour' },
    { name: 'variant_size', label: 'Size / Taille', type: 'string', fieldType: 'text', description: 'Product size' },
    { name: 'inventory_quantity', label: 'Inventory Quantity', type: 'number', fieldType: 'number', description: 'Total available inventory across all locations' },
    { name: 'shopify_product_id', label: 'Shopify Product ID', type: 'string', fieldType: 'text', description: 'Parent Shopify product ID' },
  ];

  for (const prop of needed) {
    const check = await hubspotFetch(`/crm/v3/properties/products/${prop.name}`);
    if (check.status === 200) {
      log('  ✓', `Property "${prop.name}" already exists`);
      continue;
    }

    const create = await hubspotFetch('/crm/v3/properties/products', {
      method: 'POST',
      body: JSON.stringify({
        name: prop.name,
        label: prop.label,
        type: prop.type,
        fieldType: prop.fieldType,
        description: prop.description,
        groupName: 'productinformation',
      }),
    });

    if (create.ok) {
      log('  +', `Created property "${prop.name}"`);
    } else {
      const err = await create.text();
      log('  ✗', `Failed to create "${prop.name}": ${err}`);
    }
  }
}

// ── HUBSPOT: Get existing products indexed by variant ID ─────
async function getExistingProducts() {
  log('📋', 'Loading existing HubSpot products...');
  const map = new Map();
  let after = undefined;

  while (true) {
    const params = new URLSearchParams({
      limit: '100',
      properties: 'hs_sku,shopify_variant_id,name,inventory_quantity,hs_price_cad,hs_images',
    });
    if (after) params.set('after', after);

    const res = await hubspotFetch(`/crm/v3/objects/products?${params}`);
    const data = await res.json();

    for (const product of (data.results || [])) {
      const variantId = product.properties?.shopify_variant_id;
      if (variantId) {
        map.set(variantId, {
          hubspotId: product.id,
          ...product.properties,
        });
      }
    }

    after = data.paging?.next?.after;
    if (!after) break;
  }

  log('  📊', `Found ${map.size} products with Shopify variant IDs`);
  return map;
}

// ── HUBSPOT: Create or update product ────────────────────────
async function upsertProduct(properties, existingId) {
  if (existingId) {
    const res = await hubspotFetch(`/crm/v3/objects/products/${existingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    });
    return res.ok ? 'updated' : 'error';
  } else {
    const res = await hubspotFetch('/crm/v3/objects/products', {
      method: 'POST',
      body: JSON.stringify({ properties }),
    });
    return res.ok ? 'created' : 'error';
  }
}

// ── MAIN SYNC ────────────────────────────────────────────────
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  SHOPIFY → HUBSPOT PRODUCT SYNC');
  console.log('  ' + new Date().toISOString());
  console.log('='.repeat(60) + '\n');

  // Validate env
  const missing = [];
  if (!SHOPIFY_ACCESS_TOKEN) missing.push('SHOPIFY_ACCESS_TOKEN');
  if (!HUBSPOT_TOKEN) missing.push('HUBSPOT_TOKEN');
  if (missing.length) {
    console.error(`❌ Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Step 1: Init translation
  log('🌐', 'Initializing Google Translate...');
  await initTranslation();

  // Step 2: Ensure HubSpot properties exist
  await ensureCustomProperties();

  // Step 3: Get existing HubSpot products
  const existingProducts = await getExistingProducts();

  // Step 4: Fetch Shopify products
  log('📦', 'Fetching Shopify product catalog...');
  const products = await fetchAllProducts();
  log('✅', `Loaded ${products.length} Shopify products\n`);

  // Step 5: Collect all inventory item IDs
  const allInventoryItemIds = [];
  for (const product of products) {
    for (const variant of product.variants) {
      if (variant.inventory_item_id) {
        allInventoryItemIds.push(variant.inventory_item_id);
      }
    }
  }

  // Step 6: Fetch inventory levels
  log('📊', `Fetching inventory levels for ${allInventoryItemIds.length} items...`);
  const inventoryLevels = await fetchInventoryLevels(allInventoryItemIds);
  log('✅', 'Inventory levels loaded\n');

  // Step 7: Process each product variant
  let stats = { created: 0, updated: 0, skipped: 0, errors: 0 };

  for (const product of products) {
    const frTitle = product.title || '';
    const frDesc = stripHtml(product.body_html);

    // Translate product title and description once per parent
    const enTitle = await translateToEnglish(frTitle);
    const enDesc = frDesc ? await translateToEnglish(frDesc) : '';

    // Get primary image for fallback
    const primaryImage = product.images?.[0]?.src || '';

    for (const variant of product.variants) {
      const sku = variant.sku;
      if (!sku) {
        log('⏭️', `Skipping variant ${variant.id} — no SKU`);
        stats.skipped++;
        continue;
      }

      const variantId = String(variant.id);

      // Parse option values (typically Couleur and Taille)
      const option1 = variant.option1 || '';
      const option2 = variant.option2 || '';
      const option3 = variant.option3 || '';

      // Translate option values
      const enOption1 = await translateOption(option1);
      const enOption2 = await translateOption(option2);
      const enOption3 = await translateOption(option3);

      // Build combined FR/EN name
      const frParts = [option1, option2, option3].filter(Boolean);
      const enParts = [enOption1, enOption2, enOption3].filter(Boolean);
      const suffixParts = frParts.map((fr, i) => {
        const en = enParts[i] || '';
        return fr.toLowerCase() === en.toLowerCase() ? fr : `${fr} / ${en}`;
      });
      const suffix = suffixParts.join(' — ');

      const combinedName = `${frTitle} / ${enTitle}${suffix ? ' — ' + suffix : ''}`;

      // Combined description
      const combinedDesc = frDesc && enDesc
        ? `${frDesc}\n\n---\n\n${enDesc}`
        : frDesc || enDesc || '';

      // Image: variant-specific or fallback to parent
      const variantImage = product.images?.find(img => img.id === variant.image_id);
      const imageUrl = variantImage?.src || primaryImage;

      // Inventory
      const inventoryQty = inventoryLevels[variant.inventory_item_id] ?? 0;

      // Determine color and size from options
      const color = option1 !== 'Default Title' ? (option1 || '') : '';
      const size = option2 || '';

      // Build HubSpot properties
      const properties = {
        name: combinedName,
        description: combinedDesc,
        hs_sku: sku,
        hs_price_cad: variant.price || '0',
        hs_product_type: 'inventory',
        hs_url: `https://tcuniforms.com/products/${product.handle}`,
        shopify_variant_id: variantId,
        shopify_product_id: String(product.id),
        variant_color: color,
        variant_size: size,
        inventory_quantity: String(inventoryQty),
        ...(imageUrl && { hs_images: imageUrl }),
      };

      // Check if variant already exists in HubSpot
      const existing = existingProducts.get(variantId);
      const result = await upsertProduct(properties, existing?.hubspotId);

      if (result === 'created') {
        stats.created++;
        log('  ✓', `Created: ${combinedName} (SKU: ${sku})`);
      } else if (result === 'updated') {
        stats.updated++;
        if (existing?.inventory_quantity !== String(inventoryQty)) {
          log('  ↻', `Updated: ${sku} — inventory ${existing?.inventory_quantity ?? '?'} → ${inventoryQty}`);
        }
      } else {
        stats.errors++;
        log('  ✗', `Error: ${combinedName} (SKU: ${sku})`);
      }

      await sleep(120); // HubSpot rate limit safety
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('  SYNC COMPLETE');
  console.log('='.repeat(60));
  console.log(`  ✓ Created:  ${stats.created}`);
  console.log(`  ↻ Updated:  ${stats.updated}`);
  console.log(`  ⏭️ Skipped:  ${stats.skipped}`);
  console.log(`  ✗ Errors:   ${stats.errors}`);
  console.log('='.repeat(60) + '\n');

  if (stats.errors > 0) process.exit(1);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
