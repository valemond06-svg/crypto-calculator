# CryptoCalc — Crypto Position Size Calculator

Free, client-side calculator for crypto traders.
Calculates position size, Risk/Reward ratio and estimated liquidation price.
No backend. No database. No external dependencies.

## Live Features

- **Position Size** — how many units to buy/sell given your risk budget
- **Risk Amount** — exact dollar amount at risk per trade
- **Risk/Reward Ratio** — with colour-coded quality rating (Good / Acceptable / Below target)
- **Breakeven Win Rate** — minimum win % to be profitable at that R:R
- **Potential Profit** — if take profit is hit
- **Liquidation Price Estimate** — for leveraged futures positions

---

## Deploy on GitHub Pages (step by step)

### 1. Create the repository

```bash
cd crypto-calculator
git init
git add .
git commit -m "feat: initial release"
```

Create a new repo on GitHub (e.g. `crypto-calculator`), then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/crypto-calculator.git
git branch -M main
git push -u origin main
```

### 2. Enable GitHub Pages

1. Go to your repo → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` / `/ (root)`
4. Click **Save**

Your site will be live at:
`https://YOUR-USERNAME.github.io/crypto-calculator/`

### 3. (Optional) Custom domain

Add a `CNAME` file to the project root with your domain:

```
cryptocalc.xyz
```

Then point your domain's DNS to GitHub Pages IPs:
- `185.199.108.153`
- `185.199.109.153`
- `185.199.110.153`
- `185.199.111.153`

---

## Before Going Live: Update Placeholders

### A. Replace affiliate links

Search for `YOUR_BINANCE_REF`, `YOUR_BYBIT_REF`, `YOUR_OKX_REF` in `index.html` and replace with your actual ref codes.

| Exchange | Affiliate Program URL | Ref format |
|----------|----------------------|------------|
| Binance  | https://www.binance.com/en/activity/referral | `?ref=XXXXXXXX` |
| Bybit    | https://www.bybit.com/en/affiliate-program/  | `?ref=XXXXXX` |
| OKX      | https://www.okx.com/affiliate                | `/join/XXXXXX` |

After registering, update the 5 occurrences in `index.html`:
- 3 CTA buttons (`.cta-section`)
- 2 FAQ anchor links

### B. Update your domain

Replace all occurrences of `YOUR-DOMAIN-HERE` with your actual domain in:
- `index.html` (canonical, OG, schema — 4 places)
- `robots.txt`
- `sitemap.xml`

```bash
# Quick replace (Linux/Mac):
grep -rl "YOUR-DOMAIN-HERE" . | xargs sed -i 's/YOUR-DOMAIN-HERE/cryptocalc.xyz/g'

# PowerShell:
Get-ChildItem -Recurse -Include *.html,*.txt,*.xml | ForEach-Object {
  (Get-Content $_.FullName) -replace 'YOUR-DOMAIN-HERE','cryptocalc.xyz' | Set-Content $_.FullName
}
```

### C. Submit to Google Search Console

1. Go to https://search.google.com/search-console
2. Add your domain
3. Submit `https://YOUR-DOMAIN/sitemap.xml`

---

## File Structure

```
crypto-calculator/
├── index.html          # Main page (calculator + FAQ + SEO)
├── css/
│   └── style.css       # Dark theme, mobile-first
├── js/
│   └── calculator.js   # All calculation logic (client-side)
├── favicon.svg         # SVG favicon
├── robots.txt          # Search engine crawl rules
├── sitemap.xml         # Single-page sitemap
├── .nojekyll           # Disables Jekyll on GitHub Pages
└── README.md           # This file
```

---

## How Calculations Work

**Position Size**
```
risk_amount  = account_balance × (risk_pct / 100)
stop_distance = |entry_price − stop_loss|
position_size = risk_amount / stop_distance
```

**Risk/Reward Ratio**
```
rr_ratio      = |take_profit − entry| / stop_distance
breakeven_win = 1 / (1 + rr_ratio) × 100
```

**Liquidation Price (simplified isolated margin)**
```
Long:  entry × (1 − 1/leverage + maintenance_margin_rate)
Short: entry × (1 + 1/leverage − maintenance_margin_rate)
maintenance_margin_rate = 0.005 (0.5%, conservative baseline)
```

---

## Maintenance

**Required:** near zero — formulas are mathematical constants.

**What may need updating:**
- Affiliate link ref codes (if you switch programs)
- Domain in `index.html`, `robots.txt`, `sitemap.xml` (one-time)
- `sitemap.xml` `<lastmod>` date (optional, low SEO impact)

---

## License

MIT — use freely, no attribution required.
