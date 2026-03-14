from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pandas as pd


IST = ZoneInfo("Asia/Kolkata")


def normalize_india_symbol(symbol: str) -> str:
    s = (symbol or "").strip().upper()
    if not s:
        raise ValueError("stock_symbol is required")
    if s.startswith("^"):
        return s
    if s.endswith(".NS") or s.endswith(".BO"):
        return s
    # Default to NSE ticker for Indian equities.
    return f"{s}.NS"


def parse_timestamp(value: str) -> datetime:
    patterns = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d",
    ]
    for p in patterns:
        try:
            return datetime.strptime(value, p)
        except ValueError:
            continue
    raise ValueError("timestamp must be in 'YYYY-MM-DD HH:MM[:SS]' or ISO format")


def timeframe_to_timedelta(timeframe: str) -> timedelta:
    tf = timeframe.strip().lower()
    if tf.endswith("m"):
        return timedelta(minutes=int(tf[:-1]))
    if tf.endswith("h"):
        return timedelta(hours=int(tf[:-1]))
    if tf.endswith("d"):
        return timedelta(days=int(tf[:-1]))
    if tf == "1w":
        return timedelta(weeks=1)
    raise ValueError(f"Unsupported timeframe: {timeframe}")


def build_window(end_ts: datetime, timeframe: str, bars: int) -> tuple[datetime, datetime]:
    step = timeframe_to_timedelta(timeframe)
    start = end_ts - (step * int(max(50, bars)))
    return start, end_ts


def india_market_data_end_now(now_utc: datetime | None = None) -> datetime:
    """Return current India market data cutoff in IST-naive time, capped at 15:30 and weekend-adjusted."""
    now_utc = now_utc or datetime.utcnow().replace(tzinfo=ZoneInfo("UTC"))
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=ZoneInfo("UTC"))

    now_ist = now_utc.astimezone(IST)
    end_ist = now_ist.replace(hour=15, minute=30, second=0, microsecond=0)
    if now_ist < end_ist:
        end_ist = now_ist

    # Move weekend requests to the most recent Friday close.
    while end_ist.weekday() >= 5:
        end_ist = (end_ist - timedelta(days=1)).replace(hour=15, minute=30, second=0, microsecond=0)

    return end_ist.replace(tzinfo=None)


def safe_last(series: pd.Series, default=0.0) -> float:
    if series is None or series.empty:
        return float(default)
    return float(series.iloc[-1])
