from __future__ import annotations

import pandas as pd

from agents.llm_reasoner import generate_agent_reasoning, llm_first_signal_decision
from config import CONFIDENCE_BOUNDS


def _ret(df: pd.DataFrame, bars: int) -> float:
    if df.empty or len(df) <= bars:
        return 0.0
    close = df["Close"].astype(float)
    return float((close.iloc[-1] / close.iloc[-bars - 1]) - 1.0)


def analyze_us_trend(us_ctx: dict[str, pd.DataFrame]) -> dict:
    spx = us_ctx.get("spx", pd.DataFrame())
    ndx = us_ctx.get("ndx", pd.DataFrame())
    vix = us_ctx.get("vix", pd.DataFrame())
    dxy = us_ctx.get("dxy", pd.DataFrame())

    short_window = 5
    medium_window = 20
    long_window = 60

    spx_5 = _ret(spx, short_window)
    spx_20 = _ret(spx, medium_window)
    ndx_5 = _ret(ndx, short_window)
    ndx_20 = _ret(ndx, medium_window)
    spx_60 = _ret(spx, long_window)
    ndx_60 = _ret(ndx, long_window)
    dxy_5 = _ret(dxy, short_window)
    dxy_20 = _ret(dxy, medium_window)

    vix_last = float(vix["Close"].astype(float).iloc[-1]) if not vix.empty else 18.0

    evidence = {
        "spx_ret_5": spx_5,
        "spx_ret_20": spx_20,
        "spx_ret_60": spx_60,
        "ndx_ret_5": ndx_5,
        "ndx_ret_20": ndx_20,
        "ndx_ret_60": ndx_60,
        "vix_last": vix_last,
        "dxy_ret_5": dxy_5,
        "dxy_ret_20": dxy_20,
        "spx_rows": int(len(spx)),
        "ndx_rows": int(len(ndx)),
        "vix_rows": int(len(vix)),
        "dxy_rows": int(len(dxy)),
    }

    decision_instruction = (
        "Classify US macro regime from raw SPX/NDX returns across short/medium/long horizons, VIX level, and DXY trend. "
        "Return BUY for risk-on backdrop, SELL for risk-off backdrop, otherwise NO_TRADE when mixed. "
        "This is contextual bias only for Indian swing setup."
    )
    macro_strength = min(
        abs(spx_20) + abs(ndx_20) + abs(dxy_20),
        0.18,
    )
    signal, confidence, llm_decision_why = llm_first_signal_decision(
        agent_name="US Trend Agent",
        instruction=decision_instruction,
        evidence=evidence,
        default_signal="NO_TRADE",
        default_confidence=max(CONFIDENCE_BOUNDS["neutral_min"], 0.44 + 1.1 * macro_strength),
        default_reasoning="Mixed or unavailable macro evidence",
    )

    if signal == "BUY":
        regime = "Global risk-on backdrop"
    elif signal == "SELL":
        regime = "Global risk-off backdrop"
    else:
        regime = "Mixed US macro trend"

    summary = (
        f"US Trend Signal: {signal} | {regime}. "
        f"SPX 5D/20D={spx_5*100:.2f}%/{spx_20*100:.2f}%, "
        f"NDX 5D/20D={ndx_5*100:.2f}%/{ndx_20*100:.2f}%, VIX={vix_last:.2f}, DXY 5D={dxy_5*100:.2f}%."
    )

    reasoning_prompt = (
        "US macro trend protocol:\n"
        "1) Evaluate SPX and NDX short/medium returns for global equity risk tone.\n"
        "2) Use VIX as stress filter (high VIX weakens risk-on conviction).\n"
        "3) Use DXY direction as liquidity/EM risk proxy for Indian equities.\n"
        "4) Classify regime as risk-on, risk-off, or mixed.\n"
        "5) Use this as contextual bias only; do not override local setup quality."
    )

    detail = {
        "regime": regime,
        "llm_decision_why": llm_decision_why,
        "spx_ret_5": spx_5,
        "spx_ret_20": spx_20,
        "ndx_ret_5": ndx_5,
        "ndx_ret_20": ndx_20,
        "vix_last": vix_last,
        "dxy_ret_5": dxy_5,
        "dxy_ret_20": dxy_20,
    }
    llm_reasoning = generate_agent_reasoning(
        agent_name="US Trend Agent",
        deterministic_summary=summary,
        instruction=reasoning_prompt,
        evidence={"signal": signal, "confidence": confidence, "detail": detail},
    )

    return {
        "signal": signal,
        "confidence": confidence,
        "summary": summary,
        "reasoning_prompt": reasoning_prompt,
        "llm_reasoning": llm_reasoning,
        "detail": detail,
    }
