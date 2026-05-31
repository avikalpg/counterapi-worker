# avikalp-counter

Self-hosted Cloudflare Worker replacing CounterAPI for avikalpg.github.io.

## Worker URL
`https://avikalp-counter.avikalp.workers.dev`

## Endpoints

### View counter (auto-increments on each GET)
```
GET /api/{namespace}/{type}/{key}
```
- `GET /api/avikalpg.github.io/views/blogview_{articleId}` → increments + returns `{ value, iconSvg }`
- `GET /api/avikalpg.github.io/vote/blogvote_{articleId}?readOnly=true` → reads without incrementing
- `GET /api/avikalpg.github.io/vote/blogvote_{articleId}` → increments likes

### Seed endpoint (one-time setup, token required)
```
POST /seed/{namespace}/{type}/{key}?value=N&token=SEED_TOKEN
```

### Debug endpoint (token required)
```
GET /debug/{namespace}/{type}/{key}?token=SEED_TOKEN
```

## Infrastructure
- **KV namespace:** `COUNTERS` (id: `c236ff7074354c23860ac5916c4e5b53`)
- **SEED_TOKEN:** stored in `~/.secrets/cloudflare.env`

## Initial seed values
- `blogview_20250301_ai_code_reviews_vs_code_review_interfaces`: 3500 views (HN day lower bound)
- All other articles: start from 0 (no reliable historical data)

## Adjusting seed values
If CounterAPI responds with actual data, re-seed:
```bash
source ~/.secrets/cloudflare.env
SEED_TOKEN=$(grep SEED_TOKEN ~/.secrets/cloudflare.env | cut -d= -f2)
curl -X POST "https://avikalp-counter.avikalp.workers.dev/seed/avikalpg.github.io/views/blogview_20250301_ai_code_reviews_vs_code_review_interfaces?value=ACTUAL_VALUE&token=$SEED_TOKEN"
```

## Redeploy
```bash
source ~/.secrets/cloudflare.env
export CLOUDFLARE_API_TOKEN=$CF_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID=$CF_ACCOUNT_ID
cd ~/projects/misc/avikalp-counter
npx wrangler deploy --var SEED_TOKEN:$(grep SEED_TOKEN ~/.secrets/cloudflare.env | cut -d= -f2)
```
