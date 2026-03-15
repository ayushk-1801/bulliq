import os

# API and model credentials.
NEWSAPI_KEY = os.getenv("NEWSAPI_KEY", "")
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY", "")
ALPHAVANTAGE_API_KEY = os.getenv("ALPHAVANTAGE_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite-preview")

# Runtime controls.
NEWS_MAX_ARTICLES = int(os.getenv("NEWS_MAX_ARTICLES", "80"))
NEWS_INDUSTRY_MAX_ARTICLES = int(os.getenv("NEWS_INDUSTRY_MAX_ARTICLES", "30"))
AGENT_LLM_REASONING_ENABLED = os.getenv("AGENT_LLM_REASONING_ENABLED", "1") == "1"
AGENT_LLM_MAX_INPUT_CHARS = int(os.getenv("AGENT_LLM_MAX_INPUT_CHARS", "5000"))
AGENT_LLM_BATCH_REASONING = os.getenv("AGENT_LLM_BATCH_REASONING", "1") == "1"
LLM_MAX_CALLS_PER_MINUTE = int(os.getenv("LLM_MAX_CALLS_PER_MINUTE", "15"))

# LLM usage and pricing controls.
GEMINI_INPUT_COST_PER_1M = float(os.getenv("GEMINI_INPUT_COST_PER_1M", "0"))
GEMINI_OUTPUT_COST_PER_1M = float(os.getenv("GEMINI_OUTPUT_COST_PER_1M", "0"))

# Core data defaults.
DEFAULT_LOOKBACK_BARS = int(os.getenv("DEFAULT_LOOKBACK_BARS", "120"))
DEFAULT_TIMEFRAME = os.getenv("DEFAULT_TIMEFRAME", "1d")
DEFAULT_FORECAST_BARS = int(os.getenv("DEFAULT_FORECAST_BARS", "3"))

# Global confidence policy used by adaptive agents.
CONFIDENCE_BOUNDS = {
    "insufficient": 0.30,
    "neutral_min": 0.36,
    "trade_min": 0.52,
    "max": 0.92,
}

# News quality controls.
BLOCKED_NEWS_DOMAINS = {
    "ndtvprofit.com",
    "reddit.com",
    "quora.com",
    "youtube.com",
    "instagram.com",
    "facebook.com",
    "x.com",
    "twitter.com",
    "whatsapp.com",
}

TRUSTED_NEWS_DOMAINS = {
    "reuters.com",
    "bloomberg.com",
    "moneycontrol.com",
    "livemint.com",
    "economictimes.indiatimes.com",
    "business-standard.com",
    "thehindu.com",
    "cnbctv18.com",
    "financialexpress.com",
    "wsj.com",
    "marketwatch.com",
}

BLOCKED_NEWS_TITLE_PATTERNS = {
    "stock picks today",
    "brokerages' radar",
    "brokerages radar",
    "top stocks to buy",
    "share tips",
    "hot stocks",
    "meyka",
    "scanx.trade",
    "price target",
    "market closed",
}

BLOCKED_NEWS_PUBLISHERS = {
    "meyka",
    "scanx.trade",
    "whalesbook",
    "niftytrader",
}

# NSE trading window in IST.
INDIA_MARKET_OPEN = (9, 15)
INDIA_MARKET_CLOSE = (15, 30)
