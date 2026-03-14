from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from urllib.parse import quote_plus
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

import pandas as pd
import requests
import yfinance as yf
from dateutil import parser as dt_parser
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config import (
    ALPHAVANTAGE_API_KEY,
    BLOCKED_NEWS_DOMAINS,
    BLOCKED_NEWS_PUBLISHERS,
    BLOCKED_NEWS_TITLE_PATTERNS,
    FINNHUB_API_KEY,
    NEWS_INDUSTRY_MAX_ARTICLES,
    NEWSAPI_KEY,
    NEWS_MAX_ARTICLES,
    TRUSTED_NEWS_DOMAINS,
)


def _http_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


def _to_ts(value: str) -> float:
    if not value:
        return 0.0
    try:
        return dt_parser.parse(value).timestamp()
    except Exception:
        return 0.0


def _flatten_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Flatten potential MultiIndex columns returned by yfinance."""
    if isinstance(df.columns, pd.MultiIndex):
        flat_cols = []
        for col in df.columns:
            parts = [str(p) for p in col if p not in (None, "")]
            flat_cols.append("_".join(parts))
        df.columns = flat_cols
    else:
        df.columns = [str(c) for c in df.columns]
    return df


def _pick_numeric_series(df: pd.DataFrame, base_name: str) -> pd.Series:
    """Pick the best matching numeric Series for a base OHLCV name."""
    exact = [c for c in df.columns if c == base_name]
    prefixed = [c for c in df.columns if c.startswith(f"{base_name}_")]
    candidates = exact + prefixed
    if not candidates:
        return pd.Series(dtype=float)

    for col in candidates:
        ser = pd.to_numeric(df[col], errors="coerce")
        if ser.notna().any():
            return ser
    return pd.to_numeric(df[candidates[0]], errors="coerce")


def fetch_ohlc(symbol: str, timeframe: str, start: datetime, end: datetime) -> pd.DataFrame:
    interval_map = {
        "1d": "1d",
        "4h": "1h",  # yfinance fallback; we downsample later.
        "1h": "1h",
        "30m": "30m",
        "15m": "15m",
    }
    interval = interval_map.get(timeframe, timeframe)
    df = yf.download(symbol, start=start, end=end, interval=interval, auto_adjust=True, progress=False)
    if df is None or df.empty:
        return pd.DataFrame()

    df = _flatten_columns(df)
    df = df.reset_index()

    datetime_col = None
    for candidate in ("Datetime", "Date", "datetime", "date"):
        if candidate in df.columns:
            datetime_col = candidate
            break
    if datetime_col is None:
        return pd.DataFrame()

    out = pd.DataFrame()
    out["Datetime"] = pd.to_datetime(df[datetime_col], errors="coerce")
    out["Open"] = _pick_numeric_series(df, "Open")
    out["High"] = _pick_numeric_series(df, "High")
    out["Low"] = _pick_numeric_series(df, "Low")
    out["Close"] = _pick_numeric_series(df, "Close")
    vol = _pick_numeric_series(df, "Volume")
    out["Volume"] = vol if not vol.empty else 0.0

    out = out.dropna(subset=["Datetime", "Open", "High", "Low", "Close"]).reset_index(drop=True)
    if out.empty:
        return pd.DataFrame()

    # Fallback for long-history requests where provider returns unexpectedly sparse bars.
    # This commonly happens for some symbols/date combinations despite valid long listing history.
    if timeframe == "1d" and len(out) < 120:
        try:
            df_period = yf.download(symbol, period="10y", interval="1d", auto_adjust=True, progress=False)
            if df_period is not None and not df_period.empty:
                df_period = _flatten_columns(df_period).reset_index()
                dt_col = None
                for candidate in ("Datetime", "Date", "datetime", "date"):
                    if candidate in df_period.columns:
                        dt_col = candidate
                        break
                if dt_col is not None:
                    out2 = pd.DataFrame()
                    out2["Datetime"] = pd.to_datetime(df_period[dt_col], errors="coerce")
                    out2["Open"] = _pick_numeric_series(df_period, "Open")
                    out2["High"] = _pick_numeric_series(df_period, "High")
                    out2["Low"] = _pick_numeric_series(df_period, "Low")
                    out2["Close"] = _pick_numeric_series(df_period, "Close")
                    vol2 = _pick_numeric_series(df_period, "Volume")
                    out2["Volume"] = vol2 if not vol2.empty else 0.0
                    out2 = out2.dropna(subset=["Datetime", "Open", "High", "Low", "Close"]).reset_index(drop=True)

                    if not out2.empty:
                        # Keep requested window after robust period fetch.
                        out2 = out2[(out2["Datetime"] >= pd.Timestamp(start)) & (out2["Datetime"] <= pd.Timestamp(end))].reset_index(drop=True)
                        if len(out2) > len(out):
                            out = out2
        except Exception:
            pass

    if timeframe == "4h" and not df.empty:
        out = (
            out.set_index("Datetime")
            .resample("4H")
            .agg({"Open": "first", "High": "max", "Low": "min", "Close": "last", "Volume": "sum"})
            .dropna()
            .reset_index()
        )

    return out


# --- Phrase-level sentiment patterns (higher weight) ---
_BULLISH_PHRASES = [
    ("margin expansion", 1.5), ("order book growth", 1.5), ("beat estimates", 2.0),
    ("record revenue", 2.0), ("record profit", 2.0), ("strong earnings", 1.5),
    ("all time high", 1.5), ("all-time high", 1.5), ("market share gain", 1.5),
    ("capacity expansion", 1.3), ("demand recovery", 1.3), ("price hike", 1.2),
    ("guidance raised", 2.0), ("raised guidance", 2.0), ("exceeds expectations", 2.0),
    ("above consensus", 1.8), ("volume growth", 1.3), ("robust demand", 1.3),
    ("fii buying", 1.5), ("fpi inflow", 1.5), ("dii buying", 1.3),
    ("promoter buying", 1.5), ("buyback", 1.4), ("share buyback", 1.5),
    ("special dividend", 1.4), ("stock split", 1.2), ("bonus issue", 1.2),
    ("debt reduction", 1.3), ("deleveraging", 1.3), ("order win", 1.5),
    ("new contract", 1.3), ("strategic partnership", 1.2), ("re-rating", 1.3),
    ("credit upgrade", 1.5), ("rating upgrade", 1.5),
]
_BEARISH_PHRASES = [
    ("margin compression", 1.5), ("margin pressure", 1.4), ("missed estimates", 2.0),
    ("below estimates", 2.0), ("guidance cut", 2.0), ("lowered guidance", 2.0),
    ("profit warning", 2.0), ("revenue decline", 1.5), ("earnings miss", 2.0),
    ("order cancellation", 1.5), ("demand slowdown", 1.3), ("pricing pressure", 1.3),
    ("fii selling", 1.5), ("fpi outflow", 1.5), ("dii selling", 1.3),
    ("promoter pledge", 1.8), ("promoter selling", 1.5), ("sebi ban", 2.0),
    ("sebi penalty", 1.8), ("sebi probe", 1.5), ("regulatory action", 1.3),
    ("debt concern", 1.4), ("credit downgrade", 1.5), ("rating downgrade", 1.5),
    ("rights issue", 1.2), ("dilution", 1.3), ("equity dilution", 1.4),
    ("management exit", 1.5), ("ceo resign", 1.5), ("auditor concern", 1.5),
    ("fraud allegation", 2.0), ("accounting irregularity", 2.0),
    ("supply disruption", 1.2), ("raw material cost", 1.2),
    ("all time low", 1.5), ("all-time low", 1.5), ("52 week low", 1.2),
]

# --- Single-word sentiment lists ---
_POSITIVE_WORDS = {
    "beat", "growth", "strong", "bullish", "upgrade", "profit", "record", "surge",
    "gain", "positive", "rally", "breakout", "outperform", "accelerate", "recovery",
    "rebound", "momentum", "expansion", "opportunity", "robust", "healthy",
    "uptrend", "upside", "optimistic", "improving", "innovation", "milestone",
    "acquisition", "approval", "turnaround", "overweight", "accumulate",
    "dividend", "buyback", "impressive", "exceeded", "boom", "soar", "jump",
    "spike", "climbed", "risen", "advances", "outpace", "stellar", "blockbuster",
}
_NEGATIVE_WORDS = {
    "miss", "weak", "bearish", "downgrade", "loss", "fraud", "probe", "fall",
    "drop", "negative", "crash", "plunge", "decline", "underperform", "slowdown",
    "recession", "default", "bankruptcy", "investigation", "scandal", "warning",
    "risk", "slump", "tumble", "volatility", "concern", "pressure", "contraction",
    "layoff", "restructuring", "impairment", "writedown", "writeoff", "penalty",
    "ban", "underweight", "reduce", "sell", "plummeted", "dragged", "sank",
    "eroded", "deteriorate", "exodus", "flee", "dump", "slash", "tank",
}


def _simple_sentiment_score(text: str) -> float:
    t = (text or "").lower()
    if not t:
        return 0.0

    score = 0.0
    # Phrase-level matching first (higher signal)
    for phrase, weight in _BULLISH_PHRASES:
        if phrase in t:
            score += weight
    for phrase, weight in _BEARISH_PHRASES:
        if phrase in t:
            score -= weight

    # Single-word matching
    words = set(t.replace("-", " ").replace("/", " ").split())
    score += sum(1.0 for w in words if w in _POSITIVE_WORDS)
    score -= sum(1.0 for w in words if w in _NEGATIVE_WORDS)

    return float(score)


def _domain_from_url(url: str) -> str:
    try:
        netloc = urlparse((url or "").strip()).netloc.lower()
        if netloc.startswith("www."):
            netloc = netloc[4:]
        return netloc
    except Exception:
        return ""


def _is_spam_news(title: str, url: str) -> bool:
    t = (title or "").strip().lower()
    d = _domain_from_url(url)

    publisher = ""
    if " - " in t:
        publisher = t.rsplit(" - ", 1)[-1].strip()

    if d in BLOCKED_NEWS_DOMAINS:
        return True
    if publisher and publisher in BLOCKED_NEWS_PUBLISHERS:
        return True
    if any(pat in t for pat in BLOCKED_NEWS_TITLE_PATTERNS):
        return True
    return False


def _build_news_queries(keyword: str) -> list[str]:
    base = (keyword or "").strip()
    base_clean = base.replace(".NS", "").replace(".BO", "")
    if not base_clean:
        return []
    return [
        f'"{base_clean}" India stock',
        f'"{base_clean}" earnings OR results OR guidance',
        f'"{base_clean}" quarterly results OR margin OR order book',
        f'"{base_clean}" NSE OR BSE analysis',
        f'"{base_clean}" management commentary OR concall',
        f'"{base_clean}" market share OR capex OR demand',
    ]


def fetch_company_context(keyword: str) -> dict[str, Any]:
    """Fetch company profile context for better company/industry news search."""
    base = (keyword or "").strip().upper()
    if not base:
        return {}

    symbols = [base]
    if not base.endswith(".NS") and not base.endswith(".BO") and not base.startswith("^"):
        symbols = [f"{base}.NS", f"{base}.BO", base]

    for sym in symbols:
        try:
            ticker = yf.Ticker(sym)
            info = ticker.info or {}
            if info:
                return {
                    "symbol": sym,
                    "company_name": (info.get("longName") or info.get("shortName") or "").strip(),
                    "sector": (info.get("sector") or "").strip(),
                    "industry": (info.get("industry") or "").strip(),
                    "business_summary": (info.get("longBusinessSummary") or "")[:600],
                }
        except Exception:
            continue
    return {}


def _build_company_industry_queries(keyword: str, company_ctx: dict[str, Any]) -> list[str]:
    base = (keyword or "").strip().replace(".NS", "").replace(".BO", "")
    name = (company_ctx.get("company_name") or "").strip()
    sector = (company_ctx.get("sector") or "").strip()
    industry = (company_ctx.get("industry") or "").strip()

    queries = []
    if name:
        queries.extend([
            f'"{name}" company strategy OR expansion OR capacity',
            f'"{name}" order book OR demand OR margin outlook',
            f'"{name}" competition OR market share OR guidance',
        ])
    if industry:
        queries.extend([
            f'"{industry}" India growth outlook',
            f'"{industry}" demand trend OR pricing cycle OR capacity',
            f'"{industry}" regulation OR policy impact India',
        ])
    if sector:
        queries.extend([
            f'"{sector}" India growth outlook',
            f'"{sector}" capex cycle OR demand recovery India',
        ])
    if base:
        queries.append(f'"{base}" sector trend OR industry trend')
    return queries


def _is_relevant_news(keyword: str, title: str, url: str) -> bool:
    kw = (keyword or "").strip().lower().replace(".ns", "").replace(".bo", "")
    t = (title or "").strip().lower()
    d = _domain_from_url(url)

    if not kw:
        return False
    if kw in t:
        return True

    # Symbol-like short keywords need stricter checks.
    if len(kw) <= 5:
        if any(token == kw for token in t.replace("-", " ").replace("/", " ").split()):
            return True
        # Sparse-news fallback: trusted sources with partial symbol mention.
        if d in TRUSTED_NEWS_DOMAINS and kw in t:
            return True
        return False

    # Trusted-domain fallback for partial company name overlap.
    if d in TRUSTED_NEWS_DOMAINS:
        kw_tokens = [x for x in kw.split() if len(x) > 2]
        hit = sum(tok in t for tok in kw_tokens)
        if hit >= 1:
            return True

    # Final relaxed fallback for sparse news: accept partial overlap for longer names.
    kw_tokens = [x for x in kw.split() if len(x) > 3]
    return sum(tok in t for tok in kw_tokens) >= 1


def _google_news(keyword: str, limit: int = 20) -> list[dict[str, Any]]:
    session = _http_session()
    items = []
    for q_text in _build_news_queries(keyword):
        q = quote_plus(q_text)
        url = f"https://news.google.com/rss/search?q={q}&hl=en-IN&gl=IN&ceid=IN:en"
        resp = session.get(url, timeout=12)
        resp.raise_for_status()

        root = ET.fromstring(resp.text)
        for item in root.findall("./channel/item"):
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            pub_date = (item.findtext("pubDate") or "").strip()
            if not _is_relevant_news(keyword, title, link):
                continue
            items.append(
                {
                    "source": "google_rss",
                    "title": title,
                    "url": link,
                    "published_at": pub_date,
                    "published_ts": _to_ts(pub_date),
                    "sentiment_score": _simple_sentiment_score(title),
                }
            )
            if len(items) >= limit:
                return items
    return items[:limit]


def _newsapi_news(keyword: str, limit: int = 25) -> list[dict[str, Any]]:
    if not NEWSAPI_KEY:
        return []
    url = "https://newsapi.org/v2/everything"
    rows = []
    for q_text in _build_news_queries(keyword):
        params = {
            "q": q_text,
            "sortBy": "publishedAt",
            "language": "en",
            "pageSize": min(30, limit),
            "apiKey": NEWSAPI_KEY,
        }
        resp = _http_session().get(url, params=params, timeout=12)
        resp.raise_for_status()
        data = resp.json()
        for art in data.get("articles", []):
            title = (art.get("title") or "").strip()
            desc = (art.get("description") or "").strip()
            link = art.get("url") or ""
            if not _is_relevant_news(keyword, title, link):
                continue
            rows.append(
                {
                    "source": "newsapi",
                    "title": title,
                    "url": link,
                    "published_at": art.get("publishedAt") or "",
                    "published_ts": _to_ts(art.get("publishedAt") or ""),
                    "sentiment_score": _simple_sentiment_score(f"{title} {desc}"),
                }
            )
            if len(rows) >= limit:
                return rows
    return rows


def _finnhub_news(keyword: str, limit: int = 20) -> list[dict[str, Any]]:
    if not FINNHUB_API_KEY:
        return []
    url = "https://finnhub.io/api/v1/news"
    params = {
        "category": "general",
        "token": FINNHUB_API_KEY,
    }
    resp = _http_session().get(url, params=params, timeout=12)
    resp.raise_for_status()
    data = resp.json()
    rows = []
    kw = keyword.lower()
    for art in data[: 4 * limit]:
        title = (art.get("headline") or "").strip()
        summary = (art.get("summary") or "").strip()
        text = f"{title} {summary}".lower()
        if not _is_relevant_news(keyword, title, art.get("url") or ""):
            continue
        rows.append(
            {
                "source": "finnhub",
                "title": title,
                "url": art.get("url") or "",
                "published_at": str(art.get("datetime") or ""),
                "published_ts": float(art.get("datetime") or 0),
                "sentiment_score": _simple_sentiment_score(f"{title} {summary}"),
            }
        )
        if len(rows) >= limit:
            break
    return rows


def _alphavantage_news(keyword: str, limit: int = 20) -> list[dict[str, Any]]:
    if not ALPHAVANTAGE_API_KEY:
        return []
    url = "https://www.alphavantage.co/query"
    params = {
        "function": "NEWS_SENTIMENT",
        "tickers": keyword,
        "limit": limit,
        "apikey": ALPHAVANTAGE_API_KEY,
    }
    resp = _http_session().get(url, params=params, timeout=12)
    resp.raise_for_status()
    data = resp.json()
    rows = []
    for item in data.get("feed", []):
        title = (item.get("title") or "").strip()
        link = item.get("url") or ""
        if not _is_relevant_news(keyword, title, link):
            continue
        score = item.get("overall_sentiment_score")
        rows.append(
            {
                "source": "alphavantage",
                "title": title,
                "url": link,
                "published_at": item.get("time_published") or "",
                "published_ts": _to_ts(item.get("time_published") or ""),
                "sentiment_score": float(score) if score is not None else _simple_sentiment_score(title),
            }
        )
    return rows


def _yahoo_ticker_news(keyword: str, limit: int = 20) -> list[dict[str, Any]]:
    base = (keyword or "").strip().upper()
    if not base:
        return []

    symbols = [base]
    if not base.endswith(".NS") and not base.endswith(".BO") and not base.startswith("^"):
        symbols = [f"{base}.NS", f"{base}.BO", base]

    rows: list[dict[str, Any]] = []
    seen = set()
    for sym in symbols:
        try:
            ticker = yf.Ticker(sym)
            news_items = getattr(ticker, "news", []) or []
            for art in news_items:
                title = (art.get("title") or "").strip()
                link = (art.get("link") or art.get("url") or "").strip()
                if not title or not link:
                    continue
                if not _is_relevant_news(keyword, title, link):
                    continue
                pub_ts = float(art.get("providerPublishTime") or 0.0)
                key = (title.lower(), link.lower())
                if key in seen:
                    continue
                seen.add(key)
                rows.append(
                    {
                        "source": "yahoo_news",
                        "title": title,
                        "url": link,
                        "published_at": str(pub_ts),
                        "published_ts": pub_ts,
                        "sentiment_score": _simple_sentiment_score(title),
                    }
                )
                if len(rows) >= limit:
                    return rows
        except Exception:
            continue
    return rows


def _bing_news(keyword: str, limit: int = 20) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    session = _http_session()
    for q_text in _build_news_queries(keyword):
        q = quote_plus(q_text)
        url = f"https://www.bing.com/news/search?q={q}&format=rss"
        resp = session.get(url, timeout=12)
        resp.raise_for_status()
        root = ET.fromstring(resp.text)
        for item in root.findall("./channel/item"):
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            pub_date = (item.findtext("pubDate") or "").strip()
            if not _is_relevant_news(keyword, title, link):
                continue
            rows.append(
                {
                    "source": "bing_rss",
                    "title": title,
                    "url": link,
                    "published_at": pub_date,
                    "published_ts": _to_ts(pub_date),
                    "sentiment_score": _simple_sentiment_score(title),
                }
            )
            if len(rows) >= limit:
                return rows
    return rows


def fetch_news_multi_source(keyword: str, limit: int = NEWS_MAX_ARTICLES) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for fn in (_google_news, _bing_news, _newsapi_news, _finnhub_news, _alphavantage_news, _yahoo_ticker_news):
        try:
            rows.extend(fn(keyword))
        except Exception:
            # Continue to other providers if one API fails.
            continue

    dedup: dict[str, dict[str, Any]] = {}
    for r in rows:
        if _is_spam_news(r.get("title") or "", r.get("url") or ""):
            continue
        title = (r.get("title") or "").strip().lower()
        url = (r.get("url") or "").strip().lower()
        key = f"{title}::{url}"
        if not key:
            continue
        if key not in dedup:
            r["domain"] = _domain_from_url(r.get("url") or "")
            r["domain_trust"] = "trusted" if r.get("domain") in TRUSTED_NEWS_DOMAINS else "unrated"
            dedup[key] = r

    def rank_key(item: dict[str, Any]) -> tuple[int, float]:
        domain = (item.get("domain") or "").lower()
        trusted = 1 if domain in TRUSTED_NEWS_DOMAINS else 0
        published = float(item.get("published_ts", 0.0) or 0.0)
        return (trusted, published)

    unique_rows = sorted(dedup.values(), key=rank_key, reverse=True)[:limit]
    return unique_rows


def fetch_company_industry_news(keyword: str, limit: int = NEWS_INDUSTRY_MAX_ARTICLES) -> list[dict[str, Any]]:
    """Fetch company and industry thematic news (growth, demand, competition, cycle)."""
    ctx = fetch_company_context(keyword)
    queries = _build_company_industry_queries(keyword, ctx)
    if not queries:
        return []

    rows: list[dict[str, Any]] = []
    session = _http_session()

    for q_text in queries:
        q = quote_plus(q_text)
        for source_name, source_url in [
            ("google_rss_industry", f"https://news.google.com/rss/search?q={q}&hl=en-IN&gl=IN&ceid=IN:en"),
            ("bing_rss_industry", f"https://www.bing.com/news/search?q={q}&format=rss"),
        ]:
            try:
                resp = session.get(source_url, timeout=12)
                resp.raise_for_status()
                root = ET.fromstring(resp.text)
                for item in root.findall("./channel/item"):
                    title = (item.findtext("title") or "").strip()
                    link = (item.findtext("link") or "").strip()
                    pub_date = (item.findtext("pubDate") or "").strip()
                    if not title or _is_spam_news(title, link):
                        continue
                    rows.append(
                        {
                            "source": source_name,
                            "title": title,
                            "url": link,
                            "published_at": pub_date,
                            "published_ts": _to_ts(pub_date),
                            "sentiment_score": _simple_sentiment_score(title),
                            "domain": _domain_from_url(link),
                        }
                    )
                    if len(rows) >= 3 * limit:
                        break
            except Exception:
                continue

    dedup: dict[str, dict[str, Any]] = {}
    for r in rows:
        title = (r.get("title") or "").strip().lower()
        url = (r.get("url") or "").strip().lower()
        if not title:
            continue
        key = f"{title}::{url}"
        if key not in dedup:
            d = r.get("domain") or _domain_from_url(r.get("url") or "")
            r["domain"] = d
            r["domain_trust"] = "trusted" if d in TRUSTED_NEWS_DOMAINS else "unrated"
            dedup[key] = r

    def rank_key(item: dict[str, Any]) -> tuple[int, float]:
        trusted = 1 if (item.get("domain") or "") in TRUSTED_NEWS_DOMAINS else 0
        published = float(item.get("published_ts", 0.0) or 0.0)
        return (trusted, published)

    out = sorted(dedup.values(), key=rank_key, reverse=True)[:limit]
    for item in out:
        item["company_name"] = ctx.get("company_name", "")
        item["sector"] = ctx.get("sector", "")
        item["industry"] = ctx.get("industry", "")
    return out


def fetch_global_macro_news(limit: int = 25) -> list[dict[str, Any]]:
    """Fetch broad market and macro headlines that can affect Indian equities."""
    rows: list[dict[str, Any]] = []
    queries = [
        "global markets risk sentiment",
        "US Fed rates inflation jobs",
        "crude oil dollar index yields",
        "India macro inflation rupee FII flows",
        "geopolitics middle east europe asia market impact",
        "US treasury yields recession growth outlook",
    ]

    # Google News RSS macro stream.
    try:
        session = _http_session()
        for q_text in queries:
            q = quote_plus(q_text)
            url = f"https://news.google.com/rss/search?q={q}&hl=en-IN&gl=IN&ceid=IN:en"
            resp = session.get(url, timeout=12)
            resp.raise_for_status()
            root = ET.fromstring(resp.text)
            for item in root.findall("./channel/item"):
                title = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                if _is_spam_news(title, link):
                    continue
                rows.append(
                    {
                        "source": "google_rss_macro",
                        "title": title,
                        "url": link,
                        "published_at": (item.findtext("pubDate") or "").strip(),
                        "published_ts": _to_ts((item.findtext("pubDate") or "").strip()),
                        "sentiment_score": _simple_sentiment_score(title),
                        "domain": _domain_from_url(link),
                    }
                )
                if len(rows) >= limit:
                    break
    except Exception:
        pass

    # Optional NewsAPI macro stream.
    if NEWSAPI_KEY:
        try:
            for q_text in queries:
                url = "https://newsapi.org/v2/everything"
                params = {
                    "q": q_text,
                    "sortBy": "publishedAt",
                    "language": "en",
                    "pageSize": 20,
                    "apiKey": NEWSAPI_KEY,
                }
                resp = _http_session().get(url, params=params, timeout=12)
                resp.raise_for_status()
                data = resp.json()
                for art in data.get("articles", []):
                    title = (art.get("title") or "").strip()
                    desc = (art.get("description") or "").strip()
                    link = art.get("url") or ""
                    if _is_spam_news(title, link):
                        continue
                    rows.append(
                        {
                            "source": "newsapi_macro",
                            "title": title,
                            "url": link,
                            "published_at": art.get("publishedAt") or "",
                            "published_ts": _to_ts(art.get("publishedAt") or ""),
                            "sentiment_score": _simple_sentiment_score(f"{title} {desc}"),
                            "domain": _domain_from_url(link),
                        }
                    )
                    if len(rows) >= 2 * limit:
                        break
        except Exception:
            pass

    # Bing RSS macro stream.
    try:
        session = _http_session()
        for q_text in queries:
            q = quote_plus(q_text)
            url = f"https://www.bing.com/news/search?q={q}&format=rss"
            resp = session.get(url, timeout=12)
            resp.raise_for_status()
            root = ET.fromstring(resp.text)
            for item in root.findall("./channel/item"):
                title = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                if _is_spam_news(title, link):
                    continue
                pub_date = (item.findtext("pubDate") or "").strip()
                rows.append(
                    {
                        "source": "bing_rss_macro",
                        "title": title,
                        "url": link,
                        "published_at": pub_date,
                        "published_ts": _to_ts(pub_date),
                        "sentiment_score": _simple_sentiment_score(title),
                        "domain": _domain_from_url(link),
                    }
                )
                if len(rows) >= 3 * limit:
                    break
    except Exception:
        pass

    dedup: dict[str, dict[str, Any]] = {}
    for r in rows:
        title = (r.get("title") or "").strip().lower()
        url = (r.get("url") or "").strip().lower()
        key = f"{title}::{url}"
        if not title:
            continue
        if key not in dedup:
            d = r.get("domain") or _domain_from_url(r.get("url") or "")
            r["domain"] = d
            r["domain_trust"] = "trusted" if d in TRUSTED_NEWS_DOMAINS else "unrated"
            dedup[key] = r

    def rank_key(item: dict[str, Any]) -> tuple[int, float]:
        trusted = 1 if (item.get("domain") or "") in TRUSTED_NEWS_DOMAINS else 0
        published = float(item.get("published_ts", 0.0) or 0.0)
        return (trusted, published)

    return sorted(dedup.values(), key=rank_key, reverse=True)[:limit]


def fetch_india_market_context(end_ts: datetime, lookback_days: int = 40) -> dict[str, pd.DataFrame]:
    start_ts = end_ts - timedelta(days=lookback_days)
    nifty = fetch_ohlc("^NSEI", "1d", start_ts, end_ts)
    india_vix = fetch_ohlc("^INDIAVIX", "1d", start_ts, end_ts)
    if india_vix.empty:
        india_vix = fetch_ohlc("^VIX", "1d", start_ts, end_ts)
    return {"nifty": nifty, "india_vix": india_vix}


def fetch_us_market_context(end_ts: datetime, lookback_days: int = 60) -> dict[str, pd.DataFrame]:
    start_ts = end_ts - timedelta(days=lookback_days)
    spx = fetch_ohlc("^GSPC", "1d", start_ts, end_ts)
    ndx = fetch_ohlc("^NDX", "1d", start_ts, end_ts)
    vix = fetch_ohlc("^VIX", "1d", start_ts, end_ts)
    dxy = fetch_ohlc("DX-Y.NYB", "1d", start_ts, end_ts)
    return {"spx": spx, "ndx": ndx, "vix": vix, "dxy": dxy}


def fetch_financial_statements(symbol: str) -> dict[str, Any]:
    """Fetch key financial statement snapshots using yfinance with robust fallbacks."""
    ticker = yf.Ticker(symbol)
    try:
        info = ticker.info or {}
    except Exception as e:
        info = {}

    # Fallback to fast_info if available (more reliable for some keys)
    fast_info = {}
    if ticker:
        try:
            fast_info = ticker.fast_info
        except Exception:
            pass

    def _get_metric(key: str, fast_key: str | None = None) -> Any:
        # Priority: info[key] -> fast_info[fast_key] -> None
        v = info.get(key)
        if v is None and fast_key and fast_info:
            try:
                v = getattr(fast_info, fast_key, None)
            except Exception:
                pass
        return v

    # Current price is critical for everything else
    def _is_invalid_price(v):
        if v is None: return True
        try:
            if isinstance(v, (float, np.float64, np.float32)) and np.isnan(v): return True
            if isinstance(v, (float, np.float64, np.float32)) and np.isinf(v): return True
        except: pass
        return False

    current_price = _get_metric("currentPrice", "last_price") or info.get("regularMarketPrice")
    
    if _is_invalid_price(current_price) and ticker:
        try:
            # Last ditch attempt: fetch 1d history
            h = ticker.history(period="1d")
            if not h.empty:
                current_price = float(h["Close"].iloc[-1])
        except Exception:
            pass

    if _is_invalid_price(current_price):
        # Fail-safe: use the pipeline's own fetch_ohlc
        try:
            now_f = datetime.now()
            df_f = fetch_ohlc(symbol, "1d", now_f - timedelta(days=5), now_f)
            if not df_f.empty:
                current_price = float(df_f["Close"].iloc[-1])
        except:
            pass

    metrics = {
        "market_cap": _get_metric("marketCap", "market_cap"),
        "trailing_pe": info.get("trailingPE"),
        "forward_pe": info.get("forwardPE"),
        "price_to_book": info.get("priceToBook"),
        "debt_to_equity": info.get("debtToEquity"),
        "return_on_equity": info.get("returnOnEquity"),
        "profit_margins": info.get("profitMargins"),
        "operating_margins": info.get("operatingMargins"),
        "gross_margins": info.get("grossMargins"),
        "ebitda_margins": info.get("ebitdaMargins"),
        "revenue_growth": info.get("revenueGrowth"),
        "earnings_growth": info.get("earningsGrowth"),
        "free_cashflow": info.get("freeCashflow"),
        "operating_cashflow": info.get("operatingCashflow"),
        "current_ratio": info.get("currentRatio"),
        "fifty_two_week_high": _get_metric("fiftyTwoWeekHigh", "year_high"),
        "fifty_two_week_low": _get_metric("fiftyTwoWeekLow", "year_low"),
        "fifty_two_week_change": info.get("52WeekChange") or info.get("52weekChange"),
        "dividend_yield": info.get("dividendYield"),
        "current_price": current_price,
        "analyst_target_price": info.get("targetMeanPrice"),
        "analyst_target_high": info.get("targetHighPrice"),
        "analyst_target_low": info.get("targetLowPrice"),
        "number_of_analyst_opinions": info.get("numberOfAnalystOpinions"),
        "trailing_eps": info.get("trailingEps"),
        "forward_eps": info.get("forwardEps"),
        "beta": _get_metric("beta", "beta"),
        "book_value": info.get("bookValue"),
        "enterprise_value": info.get("enterpriseValue"),
        "total_revenue": info.get("totalRevenue"),
        "total_debt": info.get("totalDebt"),
        "total_cash": info.get("totalCash"),
        "peg_ratio": info.get("pegRatio"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "company_name": (info.get("longName") or info.get("shortName") or "").strip(),
    }

    def _extract_series_from_table(table: pd.DataFrame, candidates: list[str]) -> dict[str, float]:
        if table is None or table.empty:
            return {}
        name_map = {str(idx).strip().lower(): idx for idx in table.index}
        row_key = None
        for c in candidates:
            c_l = c.lower()
            if c_l in name_map:
                row_key = name_map[c_l]
                break
            for k, original in name_map.items():
                if c_l in k:
                    row_key = original
                    break
            if row_key is not None:
                break
        if row_key is None:
            return {}
        row = table.loc[row_key]
        out = {}
        for col, val in row.items():
            try:
                out[str(col)] = float(val)
            except Exception:
                continue
        return out

    quarterly = {
        "income_statement": {},
        "balance_sheet": {},
        "cashflow": {},
        "derived": {},
    }
    if ticker is not None:
        try:
            q_fin = ticker.quarterly_financials
            if q_fin is not None and not q_fin.empty:
                quarterly["income_statement"] = q_fin.head(8).fillna(0).to_dict()
                quarterly["derived"]["revenue_series"] = _extract_series_from_table(
                    q_fin,
                    ["Total Revenue", "Revenue", "Operating Revenue"],
                )
                quarterly["derived"]["net_income_series"] = _extract_series_from_table(
                    q_fin,
                    ["Net Income", "Net Income Common Stockholders"],
                )
        except Exception:
            pass

        try:
            q_bs = ticker.quarterly_balance_sheet
            if q_bs is not None and not q_bs.empty:
                quarterly["balance_sheet"] = q_bs.head(8).fillna(0).to_dict()
                quarterly["derived"]["total_debt_series"] = _extract_series_from_table(
                    q_bs,
                    ["Total Debt", "Long Term Debt", "Current Debt"],
                )
                quarterly["derived"]["cash_series"] = _extract_series_from_table(
                    q_bs,
                    ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"],
                )
        except Exception:
            pass

        try:
            q_cf = ticker.quarterly_cashflow
            if q_cf is not None and not q_cf.empty:
                quarterly["cashflow"] = q_cf.head(8).fillna(0).to_dict()
                quarterly["derived"]["operating_cf_series"] = _extract_series_from_table(
                    q_cf,
                    ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"],
                )
                quarterly["derived"]["capex_series"] = _extract_series_from_table(
                    q_cf,
                    ["Capital Expenditure", "Capital Expenditures"],
                )
        except Exception:
            pass

    def _calculate_manual_metrics(t, current_m, price):
        """Deep fallback to calculate metrics from statements if info is sparse."""
        import pandas as pd
        import numpy as np

        def _is_invalid(v):
            if v is None: return True
            try:
                if isinstance(v, (float, np.float64, np.float32)) and np.isnan(v): return True
                if isinstance(v, (float, np.float64, np.float32)) and np.isinf(v): return True
            except: pass
            return False

        if not t or _is_invalid(price):
            return current_m
        
        def _get_val_robust(df, keys):
            if df is None or df.empty:
                return None
            for col in df.columns:
                series = df[col]
                for k in keys:
                    if k in series.index:
                        val = series[k]
                        if not _is_invalid(val) and val != 0:
                            return float(val)
                    for idx in series.index:
                        if k.lower() in str(idx).lower():
                            val = series[idx]
                            if not _is_invalid(val) and val != 0:
                                return float(val)
            return None

        try:
            mc = current_m.get("market_cap")
            if _is_invalid(mc) and hasattr(t, "fast_info"):
                try:
                    mc_val = getattr(t.fast_info, "market_cap", None)
                    if not _is_invalid(mc_val): 
                        mc = float(mc_val)
                        current_m["market_cap"] = mc
                except: pass

            income_stmt = getattr(t, "financials", None)
            if income_stmt is None or income_stmt.empty:
                income_stmt = getattr(t, "quarterly_financials", None)

            net_inc = None
            if income_stmt is not None and not income_stmt.empty:
                rev = _get_val_robust(income_stmt, ["Total Revenue", "Operating Revenue", "Revenue"])
                net_inc = _get_val_robust(income_stmt, ["Net Income", "Net Income Common Stockholders", "Net Profit"])
                op_inc = _get_val_robust(income_stmt, ["Operating Income", "Profit From Ordinary Activities Before Tax"])
                gross_prof = _get_val_robust(income_stmt, ["Gross Profit"])
                eps = _get_val_robust(income_stmt, ["Diluted EPS", "Basic EPS"])
                
                if _is_invalid(current_m.get("profit_margins")) and rev and net_inc:
                    current_m["profit_margins"] = float(net_inc / rev)
                if _is_invalid(current_m.get("operating_margins")) and rev and op_inc:
                    current_m["operating_margins"] = float(op_inc / rev)
                if _is_invalid(current_m.get("gross_margins")) and rev and gross_prof:
                    current_m["gross_margins"] = float(gross_prof / rev)

                if _is_invalid(current_m.get("trailing_pe")) and mc and net_inc and net_inc > 0:
                    current_m["trailing_pe"] = float(mc / net_inc)
                elif _is_invalid(current_m.get("trailing_pe")) and price and eps and eps > 0:
                    current_m["trailing_pe"] = float(price / eps)

                if _is_invalid(current_m.get("total_revenue")) and rev:
                    current_m["total_revenue"] = float(rev)

            bal_sheet = getattr(t, "balance_sheet", None)
            if bal_sheet is None or bal_sheet.empty:
                bal_sheet = getattr(t, "quarterly_balance_sheet", None)

            if bal_sheet is not None and not bal_sheet.empty:
                total_debt = _get_val_robust(bal_sheet, ["Total Debt", "Total Liabilities Net Minority Interest"])
                if total_debt is None:
                    lt_debt = _get_val_robust(bal_sheet, ["Long Term Debt"]) or 0
                    st_debt = _get_val_robust(bal_sheet, ["Short Term Debt", "Current Debt"]) or 0
                    total_debt = lt_debt + st_debt

                equity = _get_val_robust(bal_sheet, ["Stockholders Equity", "Total Equity", "Net Worth"])
                assets = _get_val_robust(bal_sheet, ["Total Assets"])
                liabilities = _get_val_robust(bal_sheet, ["Total Liabilities Net Minority Interest", "Total Liabilities"])
                
                if equity is None and assets and liabilities:
                    equity = assets - liabilities

                cash = _get_val_robust(bal_sheet, ["Cash And Cash Equivalents", "Cash Cash Equivalents And Short Term Investments"])
                
                if _is_invalid(current_m.get("debt_to_equity")) and equity and equity > 0 and total_debt is not None:
                    current_m["debt_to_equity"] = float(total_debt / equity)
                
                if _is_invalid(current_m.get("return_on_equity")) and equity and equity > 0:
                    if net_inc is None:
                        net_inc = _get_val_robust(income_stmt, ["Net Income"])
                    if net_inc:
                        current_m["return_on_equity"] = float(net_inc / equity)
                
                if _is_invalid(current_m.get("total_debt")) and total_debt is not None:
                    current_m["total_debt"] = float(total_debt)
                if _is_invalid(current_m.get("total_cash")) and cash is not None:
                    current_m["total_cash"] = float(cash)
                
                if _is_invalid(current_m.get("book_value")) and equity:
                    mc_val = current_m.get("market_cap")
                    if mc_val and price:
                        shares = mc_val / price
                        current_m["book_value"] = float(equity / shares)
                
                if _is_invalid(current_m.get("price_to_book")) and price and current_m.get("book_value"):
                    current_m["price_to_book"] = float(price / current_m["book_value"])

            if _is_invalid(current_m.get("dividend_yield")):
                divs = getattr(t, "dividends", None)
                if divs is not None and not divs.empty:
                    last_year = divs.tail(4).sum() 
                    current_m["dividend_yield"] = float(last_year / (price or 1.0))
            
            if not current_m.get("sector"):
                try:
                    inf = getattr(t, "info", {})
                    if inf and inf.get("sector"):
                        current_m["sector"] = inf.get("sector")
                        current_m["industry"] = inf.get("industry")
                except: pass

        except Exception as e:
            print(f"DEBUG: Error in _calculate_manual_metrics: {e}")
        return current_m

    # Annual financials for multi-year CAGR at data layer
    annual = {"income_statement": {}, "derived": {}}
    if ticker is not None:
        try:
            a_fin = ticker.financials
            if a_fin is not None and not a_fin.empty:
                annual["income_statement"] = a_fin.head(6).fillna(0).to_dict()
                annual["derived"]["annual_revenue_series"] = _extract_series_from_table(
                    a_fin,
                    ["Total Revenue", "Revenue", "Operating Revenue"],
                )
                annual["derived"]["annual_net_income_series"] = _extract_series_from_table(
                    a_fin,
                    ["Net Income", "Net Income Common Stockholders"],
                )
        except Exception:
            pass

    # Enrich metrics with manual calculation logic
    metrics = _calculate_manual_metrics(ticker, metrics, current_price)

    # Final top-level context cleanup
    if not metrics.get("sector") and fast_info:
        # Some info missing but fast_info might have some basics (unlikely for sector but worth a try)
        pass

    return {
        "symbol": symbol,
        "metrics": metrics,
        "quarterly": quarterly,
        "annual": annual,
    }


def fetch_extended_fundamentals(symbol: str) -> dict[str, Any]:
    """Extract extended fundamental data with deep manual calculation fallbacks."""
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}
    except Exception:
        info = {}
        ticker = None

    fast_info = {}
    if ticker:
        try:
            fast_info = ticker.fast_info
        except Exception:
            pass

    price = info.get("currentPrice") or info.get("regularMarketPrice")
    if price is None and ticker:
        try:
            h = ticker.history(period="1d")
            if not h.empty:
                price = float(h["Close"].iloc[-1])
        except Exception:
            pass
    if price is None and fast_info:
        price = getattr(fast_info, "last_price", None)

    # Initial data from info
    ext = {
        "symbol": symbol,
        "dividend_yield": info.get("dividendYield"),
        "dividend_rate": info.get("dividendRate"),
        "ex_dividend_date": info.get("exDividendDate"),
        "payout_ratio": info.get("payoutRatio"),
        "held_pct_insiders": info.get("heldPercentInsiders"),
        "held_pct_institutions": info.get("heldPercentInstitutions"),
        "book_value": info.get("bookValue"),
        "price_to_book": info.get("priceToBook"),
        "return_on_equity": info.get("returnOnEquity"),
        "debt_to_equity": info.get("debtToEquity"),
        "profit_margins": info.get("profitMargins"),
        "enterprise_value": info.get("enterpriseValue"),
        "enterprise_to_revenue": info.get("enterpriseToRevenue"),
        "enterprise_to_ebitda": info.get("enterpriseToEbitda"),
        "gross_margins": info.get("grossMargins"),
        "operating_margins": info.get("operatingMargins"),
        "ebitda_margins": info.get("ebitdaMargins"),
        "total_revenue": info.get("totalRevenue"),
        "total_debt": info.get("totalDebt"),
        "total_cash": info.get("totalCash"),
        "peg_ratio": info.get("pegRatio"),
        "trailing_pe": info.get("trailingPE"),
        "forward_pe": info.get("forwardPE"),
    }

    # Manual Fallbacks for missing info fields
    if ticker:
        try:
            mc = info.get("marketCap") or (getattr(fast_info, "market_cap", None) if fast_info else None)
            
            # Use shared manual metric logic
            ext = _calculate_manual_metrics(ticker, ext, price)
            
            # Derive EV if missing but components exist
            if ext.get("enterprise_value") is None and mc and ext.get("total_debt") is not None and ext.get("total_cash") is not None:
                ext["enterprise_value"] = mc + ext["total_debt"] - ext["total_cash"]
                
            # Derive EV Multiples
            if ext.get("enterprise_value") and ext.get("total_revenue") and ext.get("enterprise_to_revenue") is None:
                ext["enterprise_to_revenue"] = ext["enterprise_value"] / ext["total_revenue"]
                
        except Exception:
            pass

    return ext


def fetch_promoter_institutional_data(symbol: str) -> dict[str, Any]:
    """Extract promoter and institutional holder breakdown from yfinance."""
    result: dict[str, Any] = {"symbol": symbol, "major_holders": {}, "top_institutional": []}
    try:
        ticker = yf.Ticker(symbol)
    except Exception:
        return result

    try:
        mh = ticker.major_holders
        if mh is not None and not mh.empty:
            holders_map: dict[str, float] = {}
            for _, row in mh.iterrows():
                label = str(row.iloc[-1]).strip().lower() if len(row) > 1 else ""
                try:
                    val = float(str(row.iloc[0]).replace("%", "").strip())
                except Exception:
                    continue
                if "insider" in label:
                    holders_map["insiders_pct"] = val
                elif "institution" in label:
                    holders_map["institutions_pct"] = val
                elif "float" in label:
                    holders_map["float_pct"] = val
            result["major_holders"] = holders_map
    except Exception:
        pass

    try:
        ih = ticker.institutional_holders
        if ih is not None and not ih.empty:
            top: list[dict[str, Any]] = []
            for _, row in ih.head(10).iterrows():
                entry = {}
                for col in ih.columns:
                    entry[str(col)] = row[col]
                top.append(entry)
            result["top_institutional"] = top
    except Exception:
        pass

    return result


def fetch_dividends_splits(symbol: str) -> dict[str, Any]:
    """Extract dividend history and stock splits from yfinance."""
    result: dict[str, Any] = {
        "symbol": symbol,
        "recent_dividends": [],
        "recent_splits": [],
        "dividend_yield_trend": None,
        "total_dividends_1y": 0.0,
    }
    try:
        ticker = yf.Ticker(symbol)
    except Exception:
        return result

    try:
        divs = ticker.dividends
        if divs is not None and not divs.empty:
            recent = divs.tail(8)
            div_list: list[dict[str, Any]] = []
            for dt, val in recent.items():
                div_list.append({"date": str(dt), "amount": float(val)})
            result["recent_dividends"] = div_list

            # 1-year total
            now = pd.Timestamp.now(tz="UTC")
            one_year_ago = now - pd.Timedelta(days=365)
            divs_idx = divs.index
            if divs_idx.tz is None:
                divs_idx = divs_idx.tz_localize("UTC")
            recent_1y = divs[divs_idx >= one_year_ago]
            result["total_dividends_1y"] = float(recent_1y.sum()) if not recent_1y.empty else 0.0

            # Yield trend: compare last 4 dividends average vs previous 4
            if len(divs) >= 8:
                recent_avg = float(divs.tail(4).mean())
                prev_avg = float(divs.iloc[-8:-4].mean())
                if prev_avg > 0:
                    result["dividend_yield_trend"] = "rising" if recent_avg > prev_avg * 1.05 else (
                        "falling" if recent_avg < prev_avg * 0.95 else "stable"
                    )
    except Exception:
        pass

    try:
        splits = ticker.splits
        if splits is not None and not splits.empty:
            recent_s = splits.tail(5)
            split_list: list[dict[str, Any]] = []
            for dt, val in recent_s.items():
                split_list.append({"date": str(dt), "ratio": float(val)})
            result["recent_splits"] = split_list
    except Exception:
        pass

    return result
