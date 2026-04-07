# UTC — Shopify → HubSpot Product Sync

Nightly sync of Uniformes Town & Country's full Shopify product catalog into HubSpot CRM products.

## What it does

- Creates **one HubSpot product per Shopify variant** (each colour × size combo gets its own entry)
- **Bilingual names**: auto-translates French → English via Google Translate (free, no API key), displays as `FR / EN — Colour — Size`
- Syncs **price, SKU, images, inventory quantity, colour, size**
- **Updates existing** products and **creates new** ones — matched by Shopify variant ID
- Runs **every night at 2:00 AM Eastern** via GitHub Actions
- Zero external API keys for translation — uses Google Translate directly (free, unlimited)

## Setup (one-time)

### 1. GitHub Secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

Add these three secrets:

| Secret name             | Where to get it                                                                    |
|-------------------------|------------------------------------------------------------------------------------|
| `SHOPIFY_CLIENT_ID`     | [Dev Dashboard](https://dev.shopify.com/dashboard) → UTC HubSpot Product Sync → Settings → Client ID |
| `SHOPIFY_CLIENT_SECRET` | Same page → Client secret                                                         |
| `HUBSPOT_TOKEN`         | HubSpot → Settings → Integrations → Private Apps → Create one (see below)         |

### 2. Create HubSpot Private App

1. Go to **HubSpot → Settings → Integrations → Private Apps**
2. Click **Create a private app**
3. Name it "Shopify Product Sync"
4. Under **Scopes**, enable:
   - `crm.objects.custom.write`
   - `crm.objects.custom.read`
   - `crm.schemas.custom.read`
5. Click **Create app** and copy the access token

### 3. Test

Go to your repo → **Actions** tab → **Nightly Shopify → HubSpot Sync** → **Run workflow**

## GitHub Pages

The `docs/` folder serves a placeholder page for Shopify's App URL requirement. GitHub Pages must be enabled:

> Repo → Settings → Pages → Source: Deploy from a branch → Branch: main → Folder: /docs

## Running locally

```bash
export SHOPIFY_CLIENT_ID="your-client-id"
export SHOPIFY_CLIENT_SECRET="your-client-secret"
export HUBSPOT_TOKEN="your-hubspot-token"

npm install
node sync.js
```

## HubSpot custom properties

The script automatically creates these properties on first run:

| Property              | Description                           |
|-----------------------|---------------------------------------|
| `shopify_variant_id`  | Shopify variant ID (used for matching)|
| `shopify_product_id`  | Parent Shopify product ID             |
| `variant_color`       | Product colour                        |
| `variant_size`        | Product size                          |
| `inventory_quantity`  | Total stock across all locations      |

## Schedule

Runs nightly at 2:00 AM Eastern via GitHub Actions cron. Trigger manually anytime from the Actions tab.

## Notes

- **No hosted server needed** — runs entirely on GitHub Actions (free)
- **Safe to re-run** — matches by variant ID, never creates duplicates
- **Free translation** — uses Google Translate directly, no API key or account needed
- **Rate limited** — respects both Shopify and HubSpot API limits automatically
