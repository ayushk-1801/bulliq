"""
Finance Tools v3
================
Data fetching with 3-layer fallback:
  Layer 1: yfinance with curl_cffi (bypasses Cloudflare)
  Layer 2: Direct Yahoo Finance JSON API via requests (no yfinance wrapper)
  Layer 3: Clear failure — LLM told explicitly, no hallucination

Also provides: SIP calculator, Tax calculator, 6-month trend analysis
"""

import requests
import json
from datetime import datetime, timedelta


class DataResult:
    def __init__(self, success: bool, data: str, raw: dict = None):
        self.success = success
        self.data = data
        self.raw = raw or {}   # raw numbers for LLM to reason about

    def __str__(self):
        return self.data


# ─────────────────────────────────────────────────────────────
# LAYER 2: Direct Yahoo Finance HTTP (no yfinance, no Cloudflare issue)
# ─────────────────────────────────────────────────────────────

YAHOO_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json,text/html,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://finance.yahoo.com/",
}

def _yahoo_quote(ticker: str) -> dict | None:
    """Direct Yahoo Finance v8 API — bypasses yfinance wrapper"""
    try:
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        params = {"interval": "1d", "range": "6mo"}
        resp = requests.get(url, headers=YAHOO_HEADERS, params=params, timeout=8)
        if resp.status_code != 200:
            # Try alternate endpoint
            url2 = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}"
            resp = requests.get(url2, headers=YAHOO_HEADERS, params=params, timeout=8)
        if resp.status_code != 200:
            return None
        data = resp.json()
        result = data.get("chart", {}).get("result", [])
        return result[0] if result else None
    except Exception as e:
        print(f"[Yahoo direct] {ticker}: {e}")
        return None


def _yahoo_quote_v7(ticker: str) -> dict | None:
    """Yahoo Finance v7 quote endpoint — simpler, different URL"""
    try:
        url = "https://query1.finance.yahoo.com/v7/finance/quote"
        params = {"symbols": ticker, "fields": "regularMarketPrice,regularMarketChange,regularMarketChangePercent,fiftyTwoWeekHigh,fiftyTwoWeekLow,regularMarketDayHigh,regularMarketDayLow,trailingPE,marketCap"}
        resp = requests.get(url, headers=YAHOO_HEADERS, params=params, timeout=8)
        if resp.status_code == 200:
            result = resp.json().get("quoteResponse", {}).get("result", [])
            return result[0] if result else None
        return None
    except Exception as e:
        print(f"[Yahoo v7] {ticker}: {e}")
        return None


def _try_yfinance(ticker: str, period: str = "6mo") -> dict | None:
    """Try yfinance — works if curl_cffi is installed"""
    try:
        import yfinance as yf
        stock = yf.Ticker(ticker)
        hist = stock.history(period=period)
        if hist.empty:
            return None
        info = {}
        try:
            info = stock.info
        except:
            pass
        return {"history": hist, "info": info}
    except Exception as e:
        print(f"[yfinance] {ticker}: {e}")
        return None


# ─────────────────────────────────────────────────────────────
# MAIN TOOLS CLASS
# ─────────────────────────────────────────────────────────────

class FinanceTools:

    def get_stock_full(self, ticker: str, name: str = "") -> DataResult:
        """
        Fetch current price + 6-month history + 52w range.
        Tries yfinance → Yahoo direct v8 → Yahoo v7 → fail clearly.
        """
        display_name = name or ticker.replace(".NS", "").replace(".BO", "")

        # ── Layer 1: yfinance (best data, needs curl_cffi) ──
        yf_data = _try_yfinance(ticker, "6mo")
        if yf_data:
            hist = yf_data["history"]
            info = yf_data["info"]
            return self._build_full_result(hist, info, display_name)

        # ── Layer 2: Yahoo direct v8 (6-month chart data) ──
        chart = _yahoo_quote(ticker)
        if chart:
            return self._build_result_from_chart(chart, display_name)

        # ── Layer 3: Yahoo v7 (quote only, no history) ──
        quote = _yahoo_quote_v7(ticker)
        if quote:
            price = quote.get("regularMarketPrice", 0)
            change = quote.get("regularMarketChange", 0)
            pct = quote.get("regularMarketChangePercent", 0)
            high52 = quote.get("fiftyTwoWeekHigh", 0)
            low52 = quote.get("fiftyTwoWeekLow", 0)
            arrow = "📈" if change >= 0 else "📉"
            sign = "+" if change >= 0 else ""

            summary = (
                f"{arrow} *{display_name}*\n"
                f"Current: ₹{price:,.2f} ({sign}{change:.2f}, {sign}{pct:.2f}%)\n"
                f"52W High: ₹{high52:,.2f} | 52W Low: ₹{low52:,.2f}\n"
                f"Position vs 52W: {((price-low52)/(high52-low52)*100):.0f}% above low"
            )
            raw = {"price": price, "change_pct": pct, "high52": high52, "low52": low52}
            return DataResult(True, summary, raw)

        # ── All failed ──
        return DataResult(
            False,
            f"⚠️ Live price unavailable for {display_name} right now. "
            f"Check NSE/BSE directly or try after market hours.",
            {}
        )

    def _build_full_result(self, hist, info: dict, name: str) -> DataResult:
        """Build rich result from yfinance history DataFrame"""
        import pandas as pd

        current = float(hist['Close'].iloc[-1])
        ago_6m = float(hist['Close'].iloc[0])
        high_6m = float(hist['High'].max())
        low_6m = float(hist['Low'].min())
        prev = float(hist['Close'].iloc[-2]) if len(hist) > 1 else current

        change_day = current - prev
        change_day_pct = (change_day / prev) * 100
        change_6m_pct = ((current - ago_6m) / ago_6m) * 100

        high52 = info.get("fiftyTwoWeekHigh", high_6m)
        low52 = info.get("fiftyTwoWeekLow", low_6m)
        pe = info.get("trailingPE")
        mktcap = info.get("marketCap")

        # Simple trend: compare first half vs second half of 6mo
        mid = len(hist) // 2
        first_half_avg = float(hist['Close'].iloc[:mid].mean())
        second_half_avg = float(hist['Close'].iloc[mid:].mean())
        trend = "uptrend 📈" if second_half_avg > first_half_avg * 1.02 else \
                "downtrend 📉" if second_half_avg < first_half_avg * 0.98 else \
                "sideways/consolidating ↔️"

        arrow = "📈" if change_day >= 0 else "📉"
        sign = "+" if change_day >= 0 else ""
        s6 = "+" if change_6m_pct >= 0 else ""

        now = datetime.now().strftime("%d %b %Y")

        summary = (
            f"{arrow} *{name}* (as of {now})\n"
            f"Price: ₹{current:,.2f} ({sign}{change_day:.2f}, {sign}{change_day_pct:.2f}% today)\n"
            f"6-Month Return: {s6}{change_6m_pct:.2f}% (from ₹{ago_6m:,.2f})\n"
            f"6M High: ₹{high_6m:,.2f} | 6M Low: ₹{low_6m:,.2f}\n"
            f"52W High: ₹{high52:,.2f} | 52W Low: ₹{low52:,.2f}\n"
            f"6-Month Trend: {trend}\n"
            f"Distance from 52W High: {((high52-current)/high52*100):.1f}% below peak"
        )
        if pe:
            summary += f"\nP/E Ratio: {pe:.1f}x"
        if mktcap:
            summary += f" | Mkt Cap: ₹{mktcap/1e12:.2f}T"

        raw = {
            "price": current, "change_6m_pct": change_6m_pct,
            "high52": high52, "low52": low52,
            "high_6m": high_6m, "low_6m": low_6m,
            "trend": trend, "pe": pe,
            "pct_from_52w_high": ((high52 - current) / high52 * 100),
            "pct_above_52w_low": ((current - low52) / low52 * 100),
        }
        return DataResult(True, summary, raw)

    def _build_result_from_chart(self, chart: dict, name: str) -> DataResult:
        """Build result from Yahoo v8 chart response"""
        try:
            meta = chart.get("meta", {})
            current = meta.get("regularMarketPrice", 0)
            prev = meta.get("chartPreviousClose", current)
            high52 = meta.get("fiftyTwoWeekHigh", 0)
            low52 = meta.get("fiftyTwoWeekLow", 0)

            # Get 6-month historical closes
            timestamps = chart.get("timestamp", [])
            closes = chart.get("indicators", {}).get("quote", [{}])[0].get("close", [])
            closes = [c for c in closes if c is not None]

            change_6m_pct = 0
            ago_6m_price = current
            high_6m = current
            low_6m = current
            trend = "sideways ↔️"

            if closes and len(closes) > 10:
                ago_6m_price = closes[0]
                high_6m = max(closes)
                low_6m = min(closes)
                change_6m_pct = ((current - ago_6m_price) / ago_6m_price) * 100
                mid = len(closes) // 2
                first_avg = sum(closes[:mid]) / mid
                second_avg = sum(closes[mid:]) / (len(closes) - mid)
                trend = "uptrend 📈" if second_avg > first_avg * 1.02 else \
                        "downtrend 📉" if second_avg < first_avg * 0.98 else \
                        "sideways/consolidating ↔️"

            change_day = current - prev
            change_pct = (change_day / prev * 100) if prev else 0
            arrow = "📈" if change_day >= 0 else "📉"
            sign = "+" if change_day >= 0 else ""
            s6 = "+" if change_6m_pct >= 0 else ""
            now = datetime.now().strftime("%d %b %Y")

            summary = (
                f"{arrow} *{name}* (as of {now})\n"
                f"Price: ₹{current:,.2f} ({sign}{change_day:.2f}, {sign}{change_pct:.2f}% today)\n"
                f"6-Month Return: {s6}{change_6m_pct:.2f}% (from ₹{ago_6m_price:,.2f})\n"
                f"6M High: ₹{high_6m:,.2f} | 6M Low: ₹{low_6m:,.2f}\n"
                f"52W High: ₹{high52:,.2f} | 52W Low: ₹{low52:,.2f}\n"
                f"6-Month Trend: {trend}"
            )
            raw = {
                "price": current, "change_6m_pct": change_6m_pct,
                "high52": high52, "low52": low52,
                "high_6m": high_6m, "low_6m": low_6m,
                "trend": trend,
                "pct_from_52w_high": ((high52 - current) / high52 * 100) if high52 else 0,
            }
            return DataResult(True, summary, raw)
        except Exception as e:
            return DataResult(False, f"Chart parse error: {e}", {})

    def get_stock_price(self, ticker: str) -> DataResult:
        """Quick current price only"""
        return self.get_stock_full(ticker)

    def get_nifty50(self) -> DataResult:
        return self.get_stock_full("^NSEI", "Nifty 50")

    def get_sensex(self) -> DataResult:
        return self.get_stock_full("^BSESN", "Sensex")

    # ─────────────────────────────────────────────────────────
    # MUTUAL FUNDS
    # ─────────────────────────────────────────────────────────

    def get_mf_nav(self, query: str) -> DataResult:
        try:
            resp = requests.get("https://api.mfapi.in/mf/search",
                                params={"q": query}, timeout=5)
            data = resp.json()
            if not data:
                return DataResult(False, f"No fund found for '{query}'")
            code = data[0]['schemeCode']
            name = data[0]['schemeName']
            nav_resp = requests.get(f"https://api.mfapi.in/mf/{code}/latest", timeout=5)
            item = nav_resp.json()['data'][0]
            return DataResult(True, f"💰 *{name}*\nNAV: ₹{item['nav']} (as of {item['date']})")
        except Exception as e:
            return DataResult(False, f"MF fetch failed: {str(e)[:60]}")

    # ─────────────────────────────────────────────────────────
    # CALCULATORS
    # ─────────────────────────────────────────────────────────

    def calculate_sip(self, monthly: float, years: int, rate: float = 12.0) -> DataResult:
        months = years * 12
        r = rate / 100 / 12
        fv = monthly * (((1 + r) ** months - 1) / r) * (1 + r)
        invested = monthly * months
        return DataResult(True, (
            f"📊 *SIP Calculator*\n"
            f"₹{monthly:,.0f}/month × {years} years @ {rate}% CAGR\n"
            f"──────────────────────\n"
            f"Invested: ₹{invested:,.0f}\n"
            f"Gains: ₹{fv-invested:,.0f}\n"
            f"*Corpus: ₹{fv:,.0f}*\n"
            f"⚠️ Assumed {rate}% returns. Actual varies."
        ))

    def calculate_tax(self, income: float, regime: str = "new") -> DataResult:
        if regime == "new":
            taxable = max(0, income - 75000)
            slabs = [(300000,.0),(400000,.05),(300000,.10),(200000,.15),(300000,.20),(float('inf'),.30)]
        else:
            taxable = income
            slabs = [(250000,.0),(250000,.05),(500000,.20),(float('inf'),.30)]
        tax = rem = 0
        rem = taxable
        for slab, rate in slabs:
            if rem <= 0: break
            tax += min(rem, slab) * rate
            rem -= slab
        cess = tax * 0.04
        total = tax + cess
        if regime == "new" and income <= 700000:
            total = tax = cess = 0
        label = "New" if regime == "new" else "Old"
        return DataResult(True, (
            f"🧾 *{label} Regime (FY 2024-25)*\n"
            f"Income: ₹{income:,.0f}"
            f"{' (-₹75K std ded)' if regime=='new' else ''}\n"
            f"Tax: ₹{tax:,.0f} + Cess: ₹{cess:,.0f}\n"
            f"*Total: ₹{total:,.0f}* ({total/income*100:.1f}%)"
        ))
