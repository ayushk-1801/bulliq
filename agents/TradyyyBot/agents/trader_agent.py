from __future__ import annotations

from typing import Any

from agents.llm_reasoner import generate_structured_json


def analyze_trader_intel(
    symbol: str,
    timeframe: str,
    market_setup: dict[str, Any],
    catalyst_context: dict[str, Any],
    confluence: dict[str, Any],
    technical: dict[str, Any],
    financials: dict[str, Any],
    news: dict[str, Any],
) -> dict[str, Any]:
    setup_signal = market_setup.get("signal", "NO_TRADE")
    catalyst_signal = catalyst_context.get("signal", "NO_TRADE")
    confluence_signal = confluence.get("signal", "NO_TRADE")
    aligned = [setup_signal, catalyst_signal, confluence_signal]
    buy_votes = sum(1 for signal in aligned if signal == "BUY")
    sell_votes = sum(1 for signal in aligned if signal == "SELL")
    avg_conf = (
        float(market_setup.get("confidence", 0.5))
        + float(catalyst_context.get("confidence", 0.5))
        + float(confluence.get("confidence", 0.5))
    ) / 3.0

    price_levels = technical.get("price_levels") or {}
    analyst = financials.get("analyst_consensus") or {}

    if buy_votes >= 2 and sell_votes == 0:
        fallback = {
            "signal": "BUY",
            "confidence": min(0.9, max(0.6, avg_conf + 0.04)),
            "verdict_label": "Buy/Hold",
            "playbook_title": market_setup.get("setup_label") or "Constructive setup",
            "thesis": "Setup quality and catalyst quality are aligned enough for a swing-long bias.",
            "execution_style": "Buy strength through trigger or accumulate on controlled pullbacks.",
            "risk_flag": "Respect invalidation if the breakout fails.",
            "entry_trigger": "Act only on confirmation around nearby resistance or a clean support retest.",
            "invalidation": "Exit if price loses the nearest support and volume expands on the downside.",
            "why_now": catalyst_context.get("catalyst_label") or "Catalyst stack is constructive.",
            "why_not_now": "Do not chase if price is already extended far above the trigger.",
        }
    elif sell_votes >= 2 and buy_votes == 0:
        fallback = {
            "signal": "SELL",
            "confidence": min(0.9, max(0.6, avg_conf + 0.04)),
            "verdict_label": "Avoid/Short",
            "playbook_title": market_setup.get("setup_label") or "Weak tape",
            "thesis": "Weak structure and weak catalyst backdrop are aligned enough for a bearish swing bias.",
            "execution_style": "Sell failed bounces or breakdowns instead of forcing entries mid-range.",
            "risk_flag": "Short only if liquidity and borrow conditions are acceptable.",
            "entry_trigger": "Act on failed rebounds into resistance or a decisive breakdown below support.",
            "invalidation": "Cover if price reclaims resistance with improving momentum.",
            "why_now": catalyst_context.get("catalyst_label") or "Catalyst stack is deteriorating.",
            "why_not_now": "Do not press if downside is already stretched and support is near.",
        }
    elif buy_votes > sell_votes and confluence_signal == "BUY":
        fallback = {
            "signal": "BUY",
            "confidence": min(0.82, max(0.54, avg_conf + 0.02)),
            "verdict_label": "Buy/Hold",
            "playbook_title": market_setup.get("setup_label") or "Constructive setup",
            "thesis": "Directional edge exists but with partial disagreement; favor measured long exposure.",
            "execution_style": "Staggered entries near support or confirmed breakouts.",
            "risk_flag": "Size smaller than full conviction setups.",
            "entry_trigger": "Act on support hold or breakout confirmation with volume.",
            "invalidation": "Exit on decisive support loss.",
            "why_now": catalyst_context.get("catalyst_label") or "Bias is constructive.",
            "why_not_now": "Partial disagreement remains; avoid oversized risk.",
        }
    elif sell_votes > buy_votes and confluence_signal == "SELL":
        fallback = {
            "signal": "SELL",
            "confidence": min(0.82, max(0.54, avg_conf + 0.02)),
            "verdict_label": "Avoid/Short",
            "playbook_title": market_setup.get("setup_label") or "Weak setup",
            "thesis": "Directional downside edge exists but with partial disagreement; favor measured bearish posture.",
            "execution_style": "Sell failed rebounds or confirmed breakdowns.",
            "risk_flag": "Size smaller than full conviction setups.",
            "entry_trigger": "Act on failed reclaim or support breakdown confirmation.",
            "invalidation": "Cover on strong reclaim above resistance.",
            "why_now": catalyst_context.get("catalyst_label") or "Bias is deteriorating.",
            "why_not_now": "Partial disagreement remains; avoid oversized risk.",
        }
    else:
        fallback = {
            "signal": "NO_TRADE",
            "confidence": min(0.72, max(0.42, avg_conf - 0.02)),
            "verdict_label": "Watchlist",
            "playbook_title": market_setup.get("setup_label") or "Needs confirmation",
            "thesis": "Interesting idea, but setup quality and catalyst quality are not aligned enough yet.",
            "execution_style": "Stay patient and wait for confirmation rather than predicting the next move.",
            "risk_flag": "Avoid dead capital and false breakouts in mixed conditions.",
            "entry_trigger": "Wait for a clean break above resistance or a high-quality support reclaim with volume.",
            "invalidation": "Drop the idea if price breaks support and the catalyst tape worsens.",
            "why_now": catalyst_context.get("catalyst_label") or "Story is forming but not mature.",
            "why_not_now": "Signal disagreement is still too high for fresh risk.",
        }

    instruction = (
        "Think like a battle-hardened Indian discretionary trader and teacher. Judge structural setup quality, sector leadership, "
        "institutional flow cues (FII/DII logic), crowd positioning, and execution patience. Reference specific Indian market nuances "
        "like Nifty/BankNifty confluence when relevant. Avoid basic indicator-threshold language. "
        "Output should be concise but instructive: explain why setup quality is high/low, where edge comes from, and what invalidates the idea. "
        "Also provide 1-2 risky intraday scalp ideas with exact trigger and invalidation only when tape is volatile enough; otherwise state why not. "
        "Prefer NO_TRADE when the idea is merely 'interesting' rather than high-probability and actionable."
    )
    schema_instruction = (
        "JSON object with keys signal, confidence, verdict_label, playbook_title, thesis, execution_style, risk_flag, "
        "entry_trigger, invalidation, why_now, why_not_now, risky_intraday_play (optional string). "
        "signal must be BUY or SELL or NO_TRADE. confidence must be 0 to 1. "
        "All other fields short plain text strings."
    )
    result = generate_structured_json(
        agent_name="Trader Intel Agent",
        instruction=instruction,
        evidence={
            "symbol": symbol,
            "timeframe": timeframe,
            "market_setup": market_setup,
            "catalyst_context": catalyst_context,
            "confluence": confluence,
            "technical_snapshot": {
                "momentum_score": technical.get("momentum_score"),
                "qualitative_labels": technical.get("qualitative_labels"),
                "price_levels": price_levels,
            },
            "financial_snapshot": {
                "price_52w": financials.get("price_52w"),
                "analyst_consensus": analyst,
                "fundamental_signals": financials.get("fundamental_signals", [])[:5],
            },
            "news_snapshot": {
                "signal": news.get("signal"),
                "avg_sentiment": news.get("avg_sentiment"),
                "top_news": news.get("top_news", [])[:4],
            },
        },
        schema_instruction=schema_instruction,
        fallback=fallback,
    )

    # Ensure a concrete risky intraday suggestion is always available for users who opt into high risk.
    if not result.get("risky_intraday_play"):
        levels = (price_levels or {}).get("levels") or []
        metrics = (technical.get("metrics") or {})

        def _level_price(keyword: str) -> float | None:
            for lvl in levels:
                if keyword in str((lvl or {}).get("label", "")).lower():
                    px = (lvl or {}).get("price")
                    if isinstance(px, (float, int)):
                        return float(px)
            return None

        r1 = price_levels.get("resistance_1")
        support = price_levels.get("support")
        if not isinstance(r1, (float, int)):
            r1 = _level_price("resistance")
        if not isinstance(support, (float, int)):
            support = _level_price("support")

        close_px = metrics.get("close")
        atr = metrics.get("atr14")
        if not isinstance(atr, (float, int)):
            atr = 0.0

        long_trigger = (float(r1) + 0.001 * float(r1)) if isinstance(r1, (float, int)) else None
        long_stop = (float(r1) - max(0.4 * float(atr), 0.004 * float(r1))) if isinstance(r1, (float, int)) else None
        short_trigger = (float(support) - 0.001 * float(support)) if isinstance(support, (float, int)) else None
        short_stop = (float(support) + max(0.4 * float(atr), 0.004 * float(support))) if isinstance(support, (float, int)) else None

        if isinstance(long_trigger, (float, int)) and isinstance(short_trigger, (float, int)):
            result["risky_intraday_play"] = (
                "Aggressive scalp ideas (high risk): "
                f"Long only if price reclaims {long_trigger:.2f} with volume expansion; invalidate below {long_stop:.2f}. "
                f"Short only if price breaks {short_trigger:.2f} decisively; invalidate above {short_stop:.2f}. "
                "Avoid taking both in the same session."
            )
        elif isinstance(close_px, (float, int)) and isinstance(atr, (float, int)) and atr > 0:
            up_trigger = float(close_px) + 0.3 * float(atr)
            dn_trigger = float(close_px) - 0.3 * float(atr)
            result["risky_intraday_play"] = (
                "Aggressive scalp ideas (high risk): "
                f"Momentum long above {up_trigger:.2f} with a tight stop back inside range. "
                f"Momentum short below {dn_trigger:.2f} with strict invalidation on reclaim. "
                "Use reduced size and exit quickly if momentum stalls."
            )
        else:
            result["risky_intraday_play"] = (
                "Risky intraday setup unavailable due to insufficient level/volatility clarity. "
                "Wait for first 15-minute range break with strong volume before considering a scalp."
            )

    # Build a direct risky recommendation (not a step-by-step plan), as requested by UI users.
    levels = (price_levels or {}).get("levels") or []

    def _level_price(keyword: str) -> float | None:
        for lvl in levels:
            if keyword in str((lvl or {}).get("label", "")).lower():
                px = (lvl or {}).get("price")
                if isinstance(px, (float, int)):
                    return float(px)
        return None

    r1 = price_levels.get("resistance_1")
    support = price_levels.get("support")
    if not isinstance(r1, (float, int)):
        r1 = _level_price("resistance")
    if not isinstance(support, (float, int)):
        support = _level_price("support")

    rec_signal = str(result.get("signal") or "NO_TRADE")
    rec_conf = float(result.get("confidence", fallback["confidence"]))

    # Risky mode: force directional bias even when base model says NO_TRADE.
    if rec_signal == "NO_TRADE":
        metrics = (technical.get("metrics") or {})
        close_px = metrics.get("close")
        macd_hist = metrics.get("macd_hist")
        rsi14 = metrics.get("rsi14")
        if isinstance(close_px, (float, int)) and isinstance(r1, (float, int)) and isinstance(support, (float, int)) and r1 != support:
            midpoint = (float(r1) + float(support)) / 2.0
            rec_signal = "BUY" if float(close_px) >= midpoint else "SELL"
        elif isinstance(macd_hist, (float, int)):
            rec_signal = "BUY" if float(macd_hist) >= 0 else "SELL"
        elif isinstance(rsi14, (float, int)):
            rec_signal = "BUY" if float(rsi14) >= 50 else "SELL"
        else:
            rec_signal = "BUY"
        rec_conf = max(0.58, min(0.78, rec_conf + 0.08))
    if isinstance(r1, (float, int)) and isinstance(support, (float, int)):
        if rec_signal == "BUY":
            rec_text = (
                f"Risky intraday recommendation: AGGRESSIVE BUY above {float(r1):.2f}. "
                f"If price falls below {float(support):.2f}, immediately flip bias to SELL."
            )
        elif rec_signal == "SELL":
            rec_text = (
                f"Risky intraday recommendation: AGGRESSIVE SELL below {float(support):.2f}. "
                f"If price reclaims {float(r1):.2f}, immediately flip bias to BUY."
            )
        else:
            rec_text = (
                f"Risky intraday recommendation: NO_TRADE until breakout above {float(r1):.2f} (BUY) "
                f"or breakdown below {float(support):.2f} (SELL)."
            )
    else:
        rec_text = (
            f"Risky intraday recommendation: {rec_signal}. "
            "Levels are unclear; trade only on strong breakout or breakdown with volume."
        )

    result["risky_prediction"] = {
        "signal": rec_signal,
        "confidence": round(rec_conf, 3),
        "text": rec_text,
    }
    # Keep legacy key so existing templates/API consumers continue to render content.
    result["risky_intraday_play"] = rec_text

    easy_intraday_plan = []
    risky_text = str(result.get("risky_intraday_play") or "")
    signal = str(result.get("signal") or "NO_TRADE")
    if signal in {"BUY", "SELL"}:
        easy_intraday_plan = [
            f"Bias: {signal} only. Avoid opposite-side trades in the same session.",
            "Entry: Take trade only when trigger price is crossed with strong volume.",
            "Stop: Place stop immediately after entry at the invalidation level.",
            "Exit: Book partial profits quickly at first move; trail remaining quantity.",
            "Discipline: If setup does not trigger in time, skip the trade.",
        ]
    elif "unavailable" in risky_text.lower():
        easy_intraday_plan = [
            "No clear intraday edge right now.",
            "Wait for first 15-minute range breakout/breakdown with strong volume.",
            "Only trade in breakout direction and keep a tight stop.",
            "If volume is weak, do not trade.",
        ]
    else:
        easy_intraday_plan = [
            "Treat this as high risk; use smaller position size.",
            "Enter only on trigger, never in the middle of range.",
            "Keep fixed stop-loss from the start.",
            "Exit quickly if momentum stalls.",
        ]

    if result.get("signal") == "BUY":
        intraday_easy_one_liner = "Intraday simple rule: buy only after breakout trigger, keep tight stop, book partial profits fast."
    elif result.get("signal") == "SELL":
        intraday_easy_one_liner = "Intraday simple rule: sell only after breakdown trigger, keep tight stop, cover quickly on bounce."
    else:
        intraday_easy_one_liner = "Intraday simple rule: no clear edge now, so skip trade and wait for strong breakout with volume."

    result["confidence"] = round(float(result.get("confidence", fallback["confidence"])), 3)
    result["summary"] = (
        f"Trader Intel: {result['signal']} | {result['verdict_label']} | {result['playbook_title']}. "
        f"Thesis: {result['thesis']} Why now: {result['why_now']} Why not now: {result['why_not_now']}"
    )
    result["intraday_execution_easy"] = easy_intraday_plan
    result["intraday_easy_one_liner"] = intraday_easy_one_liner
    result["reasoning_prompt"] = instruction
    return result