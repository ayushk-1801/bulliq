from __future__ import annotations

import pandas as pd

from agents.llm_reasoner import generate_agent_reasoning
from config import CONFIDENCE_BOUNDS


def _safe_ret(series: pd.Series, window: int) -> float:
    if series.empty or len(series) <= window:
        return 0.0
    return float((series.iloc[-1] / series.iloc[-(window + 1)]) - 1.0)


def analyze_market_sentiment(nifty_df: pd.DataFrame, vix_df: pd.DataFrame, news_avg_sentiment: float) -> dict:
    if nifty_df.empty:
        return {
            "signal": "NO_TRADE",
            "confidence": CONFIDENCE_BOUNDS["insufficient"],
            "summary": "Market Sentiment: NIFTY context unavailable.",
        }

    nifty_close = nifty_df["Close"].astype(float)

    # Multi-window momentum
    nifty_ret5 = _safe_ret(nifty_close, 5)
    nifty_ret10 = _safe_ret(nifty_close, 10)
    nifty_ret20 = _safe_ret(nifty_close, 20)

    # Nifty SMA structure — is price above or below the 20DMA?
    sma20 = float(nifty_close.rolling(20).mean().iloc[-1]) if len(nifty_close) >= 20 else float(nifty_close.mean())
    last_nifty = float(nifty_close.iloc[-1])
    above_sma20 = last_nifty > sma20
    sma_gap_pct = ((last_nifty / max(sma20, 1.0)) - 1.0) * 100.0

    nifty_rets = nifty_close.pct_change(5).dropna().tail(120)
    nifty_bullish = float(nifty_rets.quantile(0.65)) if not nifty_rets.empty else 0.01
    nifty_bearish = float(nifty_rets.quantile(0.35)) if not nifty_rets.empty else -0.01

    vix_level = None
    vix_change_5d = None
    vix_low = 15.0
    vix_high = 20.0
    if not vix_df.empty:
        vix_close = vix_df["Close"].astype(float)
        vix_level = float(vix_close.iloc[-1])
        hist = vix_close.tail(120)
        if not hist.empty:
            vix_low = float(hist.quantile(0.35))
            vix_high = float(hist.quantile(0.65))
        # VIX change rate — rising VIX = increasing fear
        if len(vix_close) > 5:
            vix_5d_ago = float(vix_close.iloc[-6])
            vix_change_5d = vix_level - vix_5d_ago

    bullish = 0
    bearish = 0

    # --- 5-day momentum vote ---
    if nifty_ret5 > nifty_bullish:
        bullish += 1
    elif nifty_ret5 < nifty_bearish:
        bearish += 1

    # --- 20-day momentum vote (trend confirmation) ---
    if nifty_ret20 > 0.02:
        bullish += 1
    elif nifty_ret20 < -0.02:
        bearish += 1

    # --- SMA structure vote ---
    if above_sma20 and sma_gap_pct > 0.5:
        bullish += 1
    elif not above_sma20 and sma_gap_pct < -0.5:
        bearish += 1

    # --- VIX level vote ---
    if vix_level is not None:
        if vix_level < vix_low:
            bullish += 1
        elif vix_level > vix_high:
            bearish += 1

    # --- VIX change rate vote (rising VIX = fear increasing) ---
    if vix_change_5d is not None:
        if vix_change_5d < -1.5:
            bullish += 1  # VIX declining = complacency building
        elif vix_change_5d > 2.0:
            bearish += 1  # VIX spiking = fear increasing

    # --- News sentiment vote ---
    news_threshold = max(0.12, min(0.30, 1.5 * abs(float(news_avg_sentiment))))
    if news_avg_sentiment > news_threshold:
        bullish += 1
    elif news_avg_sentiment < -news_threshold:
        bearish += 1

    diff = bullish - bearish
    total_votes = bullish + bearish
    if diff == 0:
        signal = "NO_TRADE"
        factor_strength = min(1.0, abs(nifty_ret5) * 40.0 + abs(news_avg_sentiment) * 2.0)
        conf = max(CONFIDENCE_BOUNDS["neutral_min"], 0.45 + 0.18 * factor_strength)
    elif diff > 0:
        signal = "BUY"
        vote_ratio = bullish / max(1, total_votes)
        conf = min(CONFIDENCE_BOUNDS["max"], CONFIDENCE_BOUNDS["trade_min"] + 0.10 * min(diff, 5) + 0.06 * vote_ratio)
    else:
        signal = "SELL"
        vote_ratio = bearish / max(1, total_votes)
        conf = min(CONFIDENCE_BOUNDS["max"], CONFIDENCE_BOUNDS["trade_min"] + 0.10 * min(abs(diff), 5) + 0.06 * vote_ratio)

    summary = (
        f"Market Sentiment: {signal} | NIFTY 5D={nifty_ret5*100:.2f}%, 10D={nifty_ret10*100:.2f}%, "
        f"20D={nifty_ret20*100:.2f}%, SMA20 gap={sma_gap_pct:.1f}% ({'above' if above_sma20 else 'below'}). "
        f"India VIX={vix_level if vix_level is not None else 'N/A'}"
        f"{f', 5D chg={vix_change_5d:+.1f}' if vix_change_5d is not None else ''}, "
        f"news sentiment={news_avg_sentiment:.2f}. "
        f"Votes: bull={bullish}, bear={bearish}."
    )

    reasoning_prompt = (
        "Market sentiment protocol:\n"
        "1) Evaluate NIFTY multi-window momentum (5/10/20-bar returns) for domestic risk appetite.\n"
        "2) Check Nifty SMA20 structure — price above 20DMA = constructive, below = cautious.\n"
        "3) Evaluate India VIX regime as stress filter (low=constructive, high=defensive).\n"
        "4) Factor VIX change rate — rising VIX signals increasing fear even if level is moderate.\n"
        "5) Blend with cleaned multi-source news sentiment (stock + macro blend).\n"
        "6) Count bullish/bearish votes and avoid directional call under conflict.\n"
        "7) Prefer NO_TRADE when index momentum and volatility regime diverge."
    )

    detail = {
        "nifty_ret5": nifty_ret5,
        "nifty_ret10": nifty_ret10,
        "nifty_ret20": nifty_ret20,
        "above_sma20": above_sma20,
        "sma_gap_pct": round(sma_gap_pct, 2),
        "vix_level": vix_level,
        "vix_change_5d": round(vix_change_5d, 2) if vix_change_5d is not None else None,
        "news_avg_sentiment": news_avg_sentiment,
        "bullish_votes": bullish,
        "bearish_votes": bearish,
    }
    llm_reasoning = generate_agent_reasoning(
        agent_name="Market Sentiment Agent",
        deterministic_summary=summary,
        instruction=reasoning_prompt,
        evidence={"signal": signal, "confidence": conf, "detail": detail},
    )

    return {
        "signal": signal,
        "confidence": conf,
        "summary": summary,
        "reasoning_prompt": reasoning_prompt,
        "llm_reasoning": llm_reasoning,
        "detail": detail,
    }
