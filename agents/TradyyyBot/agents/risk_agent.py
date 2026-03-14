from __future__ import annotations

import pandas as pd

from agents.llm_reasoner import generate_agent_reasoning


ATR_PERIOD = 14
ATR_FLOOR = 0.001
ONE_R_MULTIPLIER = 1.2
RISK_BUDGET_PCT = 0.01
TARGET_R_MULTIPLE = 1.8


def _atr(df: pd.DataFrame, period: int = 14) -> float:
    high = df["High"].astype(float)
    low = df["Low"].astype(float)
    close = df["Close"].astype(float)
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1)
    atr = tr.rolling(period).mean().iloc[-1]
    return float(atr) if pd.notna(atr) else float(tr.iloc[-1])


def analyze_risk(df: pd.DataFrame, final_signal: str, capital: float = 100000.0) -> dict:
    if df.empty:
        return {
            "summary": "Risk: unavailable due to missing OHLC data.",
            "position_size": 0,
            "stop_loss": None,
            "target": None,
            "risk_reward": "N/A",
        }

    last_close = float(df["Close"].astype(float).iloc[-1])
    capital = capital or 100000.0
    atr_val = max(ATR_FLOOR, _atr(df, ATR_PERIOD))
    one_risk = ONE_R_MULTIPLIER * atr_val

    # Conservative 1% risk per trade for swing.
    risk_budget = RISK_BUDGET_PCT * capital
    position_size = int(max(0, risk_budget / one_risk))

    if final_signal == "BUY":
        stop_loss = last_close - one_risk
        target = last_close + (TARGET_R_MULTIPLE * one_risk)
        rr = TARGET_R_MULTIPLE
    elif final_signal == "SELL":
        stop_loss = last_close + one_risk
        target = last_close - (TARGET_R_MULTIPLE * one_risk)
        rr = TARGET_R_MULTIPLE
    else:
        stop_loss = None
        target = None
        rr = "N/A"
        position_size = 0

    summary = (
        f"Risk Plan: size={position_size} shares, ATR={atr_val:.2f}, "
        f"stop={round(stop_loss, 2) if stop_loss else 'N/A'}, "
        f"target={round(target, 2) if target else 'N/A'}."
    )

    reasoning_prompt = (
        "Risk protocol:\n"
        "1) Estimate recent volatility using ATR.\n"
        "2) Define one-unit risk from ATR multiple and cap portfolio risk near 1% per trade.\n"
        "3) Convert risk budget into position size.\n"
        "4) Anchor stop to volatility-adjusted invalidation and target to asymmetric reward.\n"
        "5) Force size=0 when final signal is NO_TRADE."
    )

    detail = {
        "capital": capital,
        "risk_budget": risk_budget,
        "one_risk": one_risk,
        "atr": atr_val,
    }
    llm_reasoning = generate_agent_reasoning(
        agent_name="Risk Agent",
        deterministic_summary=summary,
        instruction=reasoning_prompt,
        evidence={
            "final_signal": final_signal,
            "position_size": position_size,
            "stop_loss": round(stop_loss, 2) if stop_loss else None,
            "target": round(target, 2) if target else None,
            "risk_reward": rr,
            "detail": detail,
        },
    )

    return {
        "summary": summary,
        "reasoning_prompt": reasoning_prompt,
        "llm_reasoning": llm_reasoning,
        "position_size": position_size,
        "stop_loss": round(stop_loss, 2) if stop_loss else None,
        "target": round(target, 2) if target else None,
        "risk_reward": rr,
        "detail": detail,
    }
