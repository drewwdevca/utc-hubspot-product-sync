# UTC — Shopify → HubSpot Product Sync

Nightly sync of Uniformes Town & Country's full Shopify product catalog into HubSpot CRM products.

## What it does

- Creates **one HubSpot product per Shopify variant** (each colour × size combo gets its own entry)
- **Bilingual names**: auto-translates French → English via DeepL, displays as `FR / EN — Colour — Size`
- Syncs **price, SKU, images, inventory quantity, colour, size**
- **Updates existing** products and **creates new** ones — matched by Shopify variant ID
- Runs **every night at 2:00 AM Eastern** via GitHub Actions
- Zero dependencies — uses only Node.js built-in `fetch`

## Setup (one-time)

### 1. Create a private GitHub repo

```bash
gh repo create utc-hubspot-product-sync --private
git clone <your-repo-url>
```

Copy `sync.js`, `package.json`, and the `.github/` folder into the repo.

### 2. Add GitHub Secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

Add these four secrets:

| Secret name             | Where to get it                                                                    |
|-------------------------|------------------------------------------------------------------------------------|
| `SHOPIFY_CLIENT_ID`     | [Dev Dashboard](https://dev.shopify.com/dashboard) → UTC HubSpot Product Sync → Settings → Client ID |
| `SHOPIFY_CLIENT_SECRET` | Same page → Client secret                                                         |
| `HUBSPOT_TOKEN`         | HubSpot → Settings → Integrations → Private Apps → Create one (see below)         |
| `DEEPL_API_KEY`         | [deepl.com/pro](https://www.deepl.com/pro#developer) → sign up for free tier → API Keys |

### 3. Create HubSpot Private App

1. Go to **HubSpot → Settings → Integrations → Private Apps**
2. Click **Create a private app**
3. Name it "Shopify Product Sync"
4. Under **Scopes**, enable:
   - `crm.objects.custom.write`
   - `crm.objects.custom.read`
   - `crm.schemas.custom.read`
5. Click **Create app** and copy the access token

### 4. Get a DeepL API Key

1. Go to [deepl.com/pro#developer](https://www.deepl.com/pro#developer)
2. Sign up for the **free tier** (500,000 characters/month — more than enough)
3. Go to your account → API Keys → copy the key

### 5. Push and test

```bash
git add .
git commit -m "Initial sync setup"
git push
```

Then go to **Actions** tab in GitHub → **Nightly Shopify → HubSpot Sync** → **Run workflow** to test manually.

## Running locally

```bash
export SHOPIFY_CLIENT_ID="your-client-id"
export SHOPIFY_CLIENT_SECRET="your-client-secret"
export HUBSPOT_TOKEN="your-hubspot-token"
export DEEPL_API_KEY="your-deepl-key"

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

The sync runs nightly at 2:00 AM Eastern via GitHub Actions cron. You can also trigger it manually from the Actions tab at any time.

## Notes

- **No hosted server needed** — runs entirely on GitHub Actions (free)
- **Safe to re-run** — matches by variant ID, never creates duplicates
- **DeepL free tier** handles ~500K chars/month — first run will use the most, subsequent runs are incremental
- **Rate limited** — respects both Shopify and HubSpot API limits automatically
