from __future__ import annotations

import numpy as np
import pandas as pd

from agents.llm_reasoner import generate_agent_reasoning
from config import CONFIDENCE_BOUNDS


MIN_BARS = 25


def _bullish_engulfing(df: pd.DataFrame) -> bool:
    if len(df) < 2:
        return False
    p = df.iloc[-2]
    c = df.iloc[-1]
    prev_bear = p["Close"] < p["Open"]
    curr_bull = c["Close"] > c["Open"]
    engulf = c["Close"] >= p["Open"] and c["Open"] <= p["Close"]
    return bool(prev_bear and curr_bull and engulf)


def _bearish_engulfing(df: pd.DataFrame) -> bool:
    if len(df) < 2:
        return False
    p = df.iloc[-2]
    c = df.iloc[-1]
    prev_bull = p["Close"] > p["Open"]
    curr_bear = c["Close"] < c["Open"]
    engulf = c["Open"] >= p["Close"] and c["Close"] <= p["Open"]
    return bool(prev_bull and curr_bear and engulf)


def analyze_pattern(df: pd.DataFrame) -> dict:
    if df.empty or len(df) < MIN_BARS:
        return {
            "signal": "NO_TRADE",
            "confidence": CONFIDENCE_BOUNDS["insufficient"],
            "summary": "Pattern Agent: Not enough data to infer swing pattern.",
        }

    closes = df["Close"].astype(float).to_numpy()
    highs = df["High"].astype(float).to_numpy()
    lows = df["Low"].astype(float).to_numpy()

    # Quant-style structure checks for swing bar setups.
    slope_window = int(np.clip(len(closes) // 8, 8, 14))
    vol_window = int(np.clip(len(closes) // 12, 6, 12))
    range_window = int(np.clip(len(closes) // 7, 10, 18))

    last10 = closes[-slope_window:]
    slope = np.polyfit(np.arange(len(last10)), last10, 1)[0]
    vol_recent = float(np.std(closes[-vol_window:]))

    breakout_up = closes[-1] > np.max(highs[-range_window:-1])
    breakdown = closes[-1] < np.min(lows[-range_window:-1])
    bull_engulf = _bullish_engulfing(df[["Open", "High", "Low", "Close"]])
    bear_engulf = _bearish_engulfing(df[["Open", "High", "Low", "Close"]])

    prompt_style_reasoning = (
        "Pattern reasoning protocol:\n"
        "1) Detect breakout/breakdown against prior 12-bar range, not single-candle spikes.\n"
        "2) Confirm direction with local slope and bar-structure continuation.\n"
        "3) Use engulfing patterns as confirmation, not standalone trigger.\n"
        "4) Treat flat-slope compression as NO_TRADE until expansion is confirmed.\n"
        "5) Down-rank weak breakouts lacking structure confirmation."
    )

    slope_scale = max(1e-9, np.std(np.diff(closes[-max(20, range_window):])) / max(1e-9, closes[-1]))
    slope_norm = abs(slope) / max(1e-9, closes[-1])
    breakout_span = max(1e-9, np.max(highs[-range_window:-1]) - np.min(lows[-range_window:-1]))
    breakout_strength = abs(closes[-1] - closes[-2]) / breakout_span

    if breakout_up and slope > 0 and bull_engulf:
        signal = "BUY"
        confidence = min(CONFIDENCE_BOUNDS["max"], 0.66 + 0.24 * min(1.0, breakout_strength + slope_norm * 8.0))
        setup = "confirmed bullish breakout + engulfing bar"
    elif breakdown and slope < 0 and bear_engulf:
        signal = "SELL"
        confidence = min(CONFIDENCE_BOUNDS["max"], 0.66 + 0.24 * min(1.0, breakout_strength + slope_norm * 8.0))
        setup = "confirmed bearish breakdown + engulfing bar"
    elif breakout_up and slope > 0:
        signal = "BUY"
        confidence = min(CONFIDENCE_BOUNDS["max"], 0.60 + 0.22 * min(1.0, breakout_strength + slope_norm * 7.0))
        setup = "range breakout with positive slope"
    elif breakdown and slope < 0:
        signal = "SELL"
        confidence = min(CONFIDENCE_BOUNDS["max"], 0.60 + 0.22 * min(1.0, breakout_strength + slope_norm * 7.0))
        setup = "range breakdown with negative slope"
    elif slope_norm < max(0.001, slope_scale * 0.5):
        signal = "NO_TRADE"
        confidence = max(CONFIDENCE_BOUNDS["neutral_min"], 0.48 + min(0.18, vol_recent / max(1.0, closes[-1])))
        setup = "sideways compression (wait for breakout candle)"
    elif slope > 0:
        signal = "BUY"
        confidence = min(CONFIDENCE_BOUNDS["max"], 0.56 + 0.20 * min(1.0, slope_norm * 10.0))
        setup = "gradual higher-high structure"
    else:
        signal = "SELL"
        confidence = min(CONFIDENCE_BOUNDS["max"], 0.56 + 0.20 * min(1.0, slope_norm * 10.0))
        setup = "gradual lower-high structure"

    summary = (
        f"Pattern Signal: {signal} | setup={setup}, slope={slope:.4f}, "
        f"breakout_up={bool(breakout_up)}, breakdown={bool(breakdown)}, "
        f"bull_engulf={bool(bull_engulf)}, bear_engulf={bool(bear_engulf)}."
    )
    detail = {
        "setup": setup,
        "slope": float(slope),
        "breakout_up": bool(breakout_up),
        "breakdown": bool(breakdown),
        "bullish_engulfing": bool(bull_engulf),
        "bearish_engulfing": bool(bear_engulf),
        "volatility_proxy": float(vol_recent),
    }

    llm_reasoning = generate_agent_reasoning(
        agent_name="Pattern Agent",
        deterministic_summary=summary,
        instruction=prompt_style_reasoning,
        evidence={"signal": signal, "confidence": confidence, "detail": detail},
    )

    return {
        "signal": signal,
        "confidence": confidence,
        "summary": summary,
        "reasoning_prompt": prompt_style_reasoning,
        "llm_reasoning": llm_reasoning,
        "detail": detail,
    }
