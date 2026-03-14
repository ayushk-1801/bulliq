from __future__ import annotations

import pandas as pd

from agents.llm_reasoner import generate_agent_reasoning
from config import CONFIDENCE_BOUNDS


MIN_BARS = 15


def analyze_relative_strength(stock_df: pd.DataFrame, nifty_df: pd.DataFrame) -> dict:
    if stock_df.empty or nifty_df.empty or len(stock_df) < MIN_BARS or len(nifty_df) < MIN_BARS:
        return {
            "signal": "NO_TRADE",
            "confidence": CONFIDENCE_BOUNDS["insufficient"],
            "summary": "Relative Strength: insufficient data.",
        }

    stock_close = stock_df["Close"].astype(float)
    nifty_close = nifty_df["Close"].astype(float)

    window = min(10, max(5, len(stock_close) // 12))
    stock_ret10 = float((stock_close.iloc[-1] / stock_close.iloc[-(window + 1)]) - 1.0)
    nifty_ret10 = float((nifty_close.iloc[-1] / nifty_close.iloc[-(window + 1)]) - 1.0)
    alpha = stock_ret10 - nifty_ret10

    stock_rets = stock_close.pct_change(window)
    nifty_rets = nifty_close.pct_change(window)
    alpha_hist = (stock_rets - nifty_rets).dropna().tail(100)
    alpha_band = max(0.006, float(alpha_hist.std()) * 0.75 if not alpha_hist.empty else 0.02)
    alpha_strength = min(1.0, abs(alpha) / max(alpha_band, 1e-9))

    if alpha > alpha_band:
        signal = "BUY"
        conf = min(CONFIDENCE_BOUNDS["max"], CONFIDENCE_BOUNDS["trade_min"] + 0.30 * alpha_strength)
    elif alpha < -alpha_band:
        signal = "SELL"
        conf = min(CONFIDENCE_BOUNDS["max"], CONFIDENCE_BOUNDS["trade_min"] + 0.30 * alpha_strength)
    else:
        signal = "NO_TRADE"
        conf = max(CONFIDENCE_BOUNDS["neutral_min"], 0.44 + 0.18 * min(1.0, alpha_strength))

    summary = (
        f"Relative Strength: {signal} | stock 10-bar return={stock_ret10*100:.2f}%, "
        f"NIFTY={nifty_ret10*100:.2f}%, alpha={alpha*100:.2f}%."
    )

    reasoning_prompt = (
        "Relative-strength protocol:\n"
        "1) Compare stock and NIFTY returns over same 10-bar window.\n"
        "2) Convert spread into alpha and classify persistent out/under-performance.\n"
        "3) Treat marginal alpha as noise and return NO_TRADE.\n"
        "4) Use relative strength as confirmation layer, not standalone trigger."
    )

    detail = {
        "stock_ret10": stock_ret10,
        "nifty_ret10": nifty_ret10,
        "alpha": alpha,
    }
    llm_reasoning = generate_agent_reasoning(
        agent_name="Relative Strength Agent",
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
