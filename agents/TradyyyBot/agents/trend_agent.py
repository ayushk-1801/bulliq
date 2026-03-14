from __future__ import annotations

import numpy as np
import pandas as pd

from agents.llm_reasoner import generate_agent_reasoning
from config import CONFIDENCE_BOUNDS


MIN_BARS = 35


def analyze_trend(df: pd.DataFrame) -> dict:
    if df.empty or len(df) < MIN_BARS:
        return {
            "signal": "NO_TRADE",
            "confidence": CONFIDENCE_BOUNDS["insufficient"],
            "summary": "Trend Agent: insufficient bars to estimate reliable support/resistance trend.",
            "metrics": {},
        }

    close = df["Close"].astype(float).to_numpy()
    high = df["High"].astype(float).to_numpy()
    low = df["Low"].astype(float).to_numpy()

    x = np.arange(len(close))
    support_coef = np.polyfit(x, low, 1)
    resist_coef = np.polyfit(x, high, 1)

    support_line = support_coef[0] * x + support_coef[1]
    resist_line = resist_coef[0] * x + resist_coef[1]

    last_close = float(close[-1])
    last_support = float(support_line[-1])
    last_resist = float(resist_line[-1])
    channel_width = max(1e-9, last_resist - last_support)
    position = (last_close - last_support) / channel_width

    slope_support = float(support_coef[0])
    slope_resist = float(resist_coef[0])
    slope_avg = 0.5 * (slope_support + slope_resist)
    slope_norm = abs(slope_avg) / max(1e-9, last_close)

    historical_pos = (close - support_line) / np.maximum(1e-9, resist_line - support_line)
    pos_series = pd.Series(historical_pos).replace([np.inf, -np.inf], np.nan).dropna().tail(80)
    low_zone = float(pos_series.quantile(0.35)) if not pos_series.empty else 0.35
    high_zone = float(pos_series.quantile(0.65)) if not pos_series.empty else 0.65

    close_ret_std = float(pd.Series(close).pct_change().dropna().tail(60).std())
    flat_threshold = max(0.0005, close_ret_std * 0.35)

    if slope_avg > 0 and position < low_zone:
        signal = "BUY"
        confidence = min(CONFIDENCE_BOUNDS["max"], 0.62 + 0.26 * min(1.0, slope_norm * 80.0))
        setup = "uptrend with pullback near support"
    elif slope_avg < 0 and position > high_zone:
        signal = "SELL"
        confidence = min(CONFIDENCE_BOUNDS["max"], 0.62 + 0.26 * min(1.0, slope_norm * 80.0))
        setup = "downtrend with bounce near resistance"
    elif slope_norm < flat_threshold:
        signal = "NO_TRADE"
        confidence = max(CONFIDENCE_BOUNDS["neutral_min"], 0.45 + 0.12 * (1.0 - min(1.0, slope_norm / flat_threshold)))
        setup = "sideways trend channel"
    elif slope_avg > 0:
        signal = "BUY"
        confidence = min(CONFIDENCE_BOUNDS["max"], 0.56 + 0.22 * min(1.0, slope_norm * 70.0))
        setup = "uptrend continuation"
    else:
        signal = "SELL"
        confidence = min(CONFIDENCE_BOUNDS["max"], 0.56 + 0.22 * min(1.0, slope_norm * 70.0))
        setup = "downtrend continuation"

    summary = (
        f"Trend Signal: {signal} | setup={setup}, "
        f"support slope={slope_support:.3f}, resistance slope={slope_resist:.3f}, "
        f"price position={position:.2f} in channel."
    )

    reasoning_prompt = (
        "Trend reasoning protocol:\n"
        "1) Fit support and resistance trendlines over the visible swing window.\n"
        "2) Estimate channel slope (regime direction) and channel width (trend quality).\n"
        "3) Locate current price in channel and prefer pullback entries aligned with slope.\n"
        "4) If slope is weak/flat, classify as sideways and favor NO_TRADE.\n"
        "5) Avoid chasing signals near channel extremes against risk-reward logic."
    )

    detail = {
        "setup": setup,
        "slope_avg": round(slope_avg, 4),
        "channel_width": round(channel_width, 4),
        "channel_position": round(position, 4),
    }
    metrics = {
        "support_slope": slope_support,
        "resistance_slope": slope_resist,
        "channel_position": round(position, 3),
        "last_support": round(last_support, 2),
        "last_resistance": round(last_resist, 2),
    }
    llm_reasoning = generate_agent_reasoning(
        agent_name="Trend Agent",
        deterministic_summary=summary,
        instruction=reasoning_prompt,
        evidence={"signal": signal, "confidence": confidence, "detail": detail, "metrics": metrics},
    )

    return {
        "signal": signal,
        "confidence": confidence,
        "summary": summary,
        "reasoning_prompt": reasoning_prompt,
        "llm_reasoning": llm_reasoning,
        "detail": detail,
        "metrics": metrics,
    }
