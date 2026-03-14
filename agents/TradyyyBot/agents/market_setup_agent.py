from __future__ import annotations

from typing import Any

import pandas as pd

from agents.llm_reasoner import generate_agent_reasoning, llm_first_signal_decision


def _recent_candle_tape(df: pd.DataFrame, bars: int = 6) -> list[dict[str, float]]:
    tape: list[dict[str, float]] = []
    tail = df.tail(bars)
    for _, row in tail.iterrows():
        tape.append(
            {
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": round(float(row.get("Volume", 0) or 0), 2),
            }
        )
    return tape


def analyze_market_setup(
    df: pd.DataFrame,
    technical: dict[str, Any],
    pattern: dict[str, Any],
    trend: dict[str, Any],
    relative_strength: dict[str, Any],
) -> dict[str, Any]:
    close = df["Close"].astype(float)
    volume = pd.to_numeric(df.get("Volume", 0), errors="coerce").fillna(0)
    last_close = float(close.iloc[-1])
    ret_5 = ((last_close / float(close.iloc[-6])) - 1.0) * 100.0 if len(close) > 5 else 0.0
    ret_20 = ((last_close / float(close.iloc[-21])) - 1.0) * 100.0 if len(close) > 20 else ret_5
    vol_5 = float(volume.tail(5).mean()) if len(volume) >= 5 else float(volume.mean())
    vol_20 = float(volume.tail(20).mean()) if len(volume) >= 20 else max(vol_5, 1.0)
    volume_ratio = vol_5 / max(vol_20, 1.0)
    price_levels = (technical.get("price_levels") or {})
    nearest_support = price_levels.get("nearest_support") or price_levels.get("support")
    nearest_resistance = price_levels.get("nearest_resistance") or price_levels.get("resistance_1")
    momentum_score = technical.get("momentum_score")

    distance_to_support = None
    if nearest_support:
        distance_to_support = ((last_close / nearest_support) - 1.0) * 100.0
    distance_to_resistance = None
    if nearest_resistance:
        distance_to_resistance = ((nearest_resistance / last_close) - 1.0) * 100.0

    votes = [technical.get("signal"), pattern.get("signal"), trend.get("signal"), relative_strength.get("signal")]
    buy_votes = sum(1 for vote in votes if vote == "BUY")
    sell_votes = sum(1 for vote in votes if vote == "SELL")
    aligned_conf = [
        float(item.get("confidence", 0.5))
        for item in [technical, pattern, trend, relative_strength]
        if item.get("signal") in {"BUY", "SELL"}
    ]
    base_conf = sum(aligned_conf) / len(aligned_conf) if aligned_conf else 0.5

    if buy_votes >= 3 and ret_20 > -0.3:
        default_signal = "BUY"
        default_conf = min(0.87, max(0.58, base_conf + 0.05))
        setup_label = "Momentum continuation"
    elif sell_votes >= 3 and ret_20 < 0.3:
        default_signal = "SELL"
        default_conf = min(0.87, max(0.58, base_conf + 0.05))
        setup_label = "Breakdown pressure"
    elif buy_votes >= 2 and sell_votes == 0 and ret_5 >= -0.6 and (ret_20 >= -1.5 or (distance_to_support is not None and distance_to_support <= 4.0)):
        default_signal = "BUY"
        default_conf = min(0.82, max(0.56, base_conf + 0.03))
        setup_label = "Early bullish alignment"
    elif sell_votes >= 2 and buy_votes == 0 and ret_5 <= 0.6 and (ret_20 <= 1.5 or (distance_to_resistance is not None and distance_to_resistance <= 4.0)):
        default_signal = "SELL"
        default_conf = min(0.82, max(0.56, base_conf + 0.03))
        setup_label = "Early bearish alignment"
    else:
        default_signal = "NO_TRADE"
        default_conf = min(0.68, max(0.40, 0.42 + abs(buy_votes - sell_votes) * 0.03))
        if ret_5 > 0 and distance_to_resistance and distance_to_resistance < 3.0:
            setup_label = "Breakout watch"
        elif ret_5 < 0 and distance_to_support and distance_to_support < 3.0:
            setup_label = "Support test"
        else:
            setup_label = "Range negotiation"

    instruction = (
        "Think like a discretionary swing trader reading tape and structure, not like an indicator checklist. "
        "Use trend, pattern, relative strength, recent candles, nearby support and resistance, and volume behaviour together. "
        "Prefer BUY only when the setup looks executable, SELL only when breakdown risk is real, otherwise NO_TRADE. "
        "Avoid generic statements and focus on whether this chart is early, extended, coiling, or failing."
    )
    signal, confidence, llm_why = llm_first_signal_decision(
        agent_name="Market Setup Agent",
        instruction=instruction,
        evidence={
            "recent_returns_pct": {"5d": round(ret_5, 2), "20d": round(ret_20, 2)},
            "volume_ratio_5d_vs_20d": round(volume_ratio, 2),
            "last_close": round(last_close, 2),
            "distance_to_support_pct": round(distance_to_support, 2) if distance_to_support is not None else None,
            "distance_to_resistance_pct": round(distance_to_resistance, 2) if distance_to_resistance is not None else None,
            "momentum_score": momentum_score,
            "technical": technical,
            "pattern": pattern,
            "trend": trend,
            "relative_strength": relative_strength,
            "recent_candles": _recent_candle_tape(df),
        },
        default_signal=default_signal,
        default_confidence=default_conf,
        default_reasoning=f"{setup_label}. Buy votes={buy_votes}, sell votes={sell_votes}, 5d return={ret_5:.1f}%, 20d return={ret_20:.1f}%, volume ratio={volume_ratio:.2f}.",
    )

    summary = (
        f"Market Setup Signal: {signal} | {setup_label}. "
        f"Tape read: 5d={ret_5:+.1f}%, 20d={ret_20:+.1f}%, volume ratio={volume_ratio:.2f}, momentum={momentum_score}. "
        f"Support gap={(f'{distance_to_support:.1f}%' if distance_to_support is not None else 'N/A')} "
        f"and resistance gap={(f'{distance_to_resistance:.1f}%' if distance_to_resistance is not None else 'N/A')}. "
        f"Trader read: {llm_why}"
    )
    reasoning_prompt = (
        "Market setup reasoning protocol:\n"
        "1) Read the recent tape first: velocity, pullback quality, closes, and volume.\n"
        "2) Judge whether price is near actionable support, trapped below resistance, or already extended.\n"
        "3) Use pattern, trend, and relative strength as context, not as isolated votes.\n"
        "4) Prefer patience when price is between levels or when momentum is late-stage.\n"
        "5) Only output BUY or SELL if the setup is executable with a clean invalidation."
    )
    llm_reasoning = generate_agent_reasoning(
        agent_name="Market Setup Agent",
        deterministic_summary=summary,
        instruction=reasoning_prompt,
        evidence={
            "signal": signal,
            "confidence": confidence,
            "setup_label": setup_label,
            "buy_votes": buy_votes,
            "sell_votes": sell_votes,
            "recent_returns_pct": {"5d": round(ret_5, 2), "20d": round(ret_20, 2)},
            "volume_ratio_5d_vs_20d": round(volume_ratio, 2),
            "distance_to_support_pct": round(distance_to_support, 2) if distance_to_support is not None else None,
            "distance_to_resistance_pct": round(distance_to_resistance, 2) if distance_to_resistance is not None else None,
            "momentum_score": momentum_score,
        },
    )

    return {
        "signal": signal,
        "confidence": round(confidence, 3),
        "summary": summary,
        "reasoning_prompt": reasoning_prompt,
        "llm_reasoning": llm_reasoning,
        "setup_label": setup_label,
        "detail": {
            "recent_return_5d_pct": round(ret_5, 2),
            "recent_return_20d_pct": round(ret_20, 2),
            "volume_ratio_5d_vs_20d": round(volume_ratio, 2),
            "distance_to_support_pct": round(distance_to_support, 2) if distance_to_support is not None else None,
            "distance_to_resistance_pct": round(distance_to_resistance, 2) if distance_to_resistance is not None else None,
            "momentum_score": momentum_score,
            "buy_votes": buy_votes,
            "sell_votes": sell_votes,
        },
    }