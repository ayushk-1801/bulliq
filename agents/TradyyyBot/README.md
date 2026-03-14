# India Swing Trader

Specialized Indian-market swing trading pipeline inspired by QuantAgent.

## Agents
- Indicator Agent (Quant-style RSI, MACD, ROC, Stochastic, Williams %R, ATR, volume)
- Pattern Agent (breakout/breakdown + engulfing bar confirmation)
- Trend Agent (support/resistance channel slope + price position)
- News Agent (multi-source with spam filtering + trust-weighted scoring)
- Market Sentiment Agent (NIFTY + India VIX + curated news sentiment)
- Relative Strength Agent (stock alpha vs NIFTY)
- US Trend Agent (SPX/NDX/VIX/DXY macro regime context)
- Financials Agent (valuation, growth, profitability, leverage, liquidity)
- Confluence Agent (master committee-style weighted reasoning)
- Risk Agent (position sizing + stop/target)
- Gemini Master Reasoning (model: `gemini-3.1-flash-lite-preview`, fallback-safe)

## API Endpoints
- `POST /api/v1/analyze`
  - Input: `stock_symbol`, `timeframe`, `start_date` (optional)
  - Behavior: pulls data from `start_date` to current time capped at `15:30 IST` (weekends snap to last Friday close)
  - Output: full multi-agent JSON plus cross-platform asset links:
    - `asset_urls.chart_url`
    - `asset_urls.long_term_chart_url`
    - `asset_urls.report_json_url`
    - `asset_urls.report_markdown_url`
  - Includes file names in `asset_files.*` and local report files in `reports/`

  ### Separate API Files
  - `api_analyze.py` (port `5201`) -> analyze API only

## Website
- `GET /` for form-based UI
- Runs on `http://127.0.0.1:5200`

## Run

```bash
pip install -r requirements.txt
./run.sh
```

Optional env vars:

```bash
export GEMINI_API_KEY="your_key"
export GEMINI_MODEL="gemini-3.1-flash-lite-preview"
export NEWSAPI_KEY="..."
export FINNHUB_API_KEY="..."
export ALPHAVANTAGE_API_KEY="..."
```

Separate API servers:

```bash
python api_analyze.py
```

## Example Requests

```bash
curl -X POST http://127.0.0.1:5200/api/v1/analyze \
  -H "Content-Type: application/json" \
  -d '{"stock_symbol":"RELIANCE","timeframe":"1d","start_date":"2026-03-01 09:15"}'
```

## Demo API Call (Full JSON + Image Links)

Use analyze-only API (`5201`) and print key response fields:

```bash
curl -s -X POST http://127.0.0.1:5201/api/v1/analyze \
  -H "Content-Type: application/json" \
  -d '{"stock_symbol":"TATACONSUM","timeframe":"1d","start_date":"2026-02-01 09:15"}' | \
  python -m json.tool
```

Quickly view returned signals and cross-platform asset URLs:

```bash
curl -s -X POST http://127.0.0.1:5201/api/v1/analyze \
  -H "Content-Type: application/json" \
  -d '{"stock_symbol":"TATACONSUM","timeframe":"1d"}' | \
  python -c 'import json,sys; d=json.load(sys.stdin); print("final_signal:", d.get("final_signal")); print("confidence:", d.get("confidence")); print("chart_url:", (d.get("asset_urls") or {}).get("chart_url")); print("long_term_chart_url:", (d.get("asset_urls") or {}).get("long_term_chart_url")); print("report_json_url:", (d.get("asset_urls") or {}).get("report_json_url"))'
```
# TradyyyBot
