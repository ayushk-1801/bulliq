from __future__ import annotations

from typing import Any

from agents.llm_reasoner import generate_agent_reasoning, llm_first_signal_decision


def analyze_catalyst_context(
    symbol: str,
    financials: dict[str, Any],
    news: dict[str, Any],
    market_sentiment: dict[str, Any],
    us_trend: dict[str, Any],
) -> dict[str, Any]:
    financial_signal = financials.get("signal", "NO_TRADE")
    news_signal = news.get("signal", "NO_TRADE")
    market_signal = market_sentiment.get("signal", "NO_TRADE")
    us_signal = us_trend.get("signal", "NO_TRADE")
    signals = [financial_signal, news_signal, market_signal, us_signal]
    buy_votes = sum(1 for signal in signals if signal == "BUY")
    sell_votes = sum(1 for signal in signals if signal == "SELL")

    avg_sentiment = float(news.get("avg_sentiment", 0.0) or 0.0)
    analyst_upside = ((financials.get("analyst_consensus") or {}).get("implied_upside_pct"))
    position_52w = ((financials.get("price_52w") or {}).get("position_pct"))
    fund_bullets = [item.get("text") for item in financials.get("fundamental_signals", [])[:4] if item.get("text")]

    if buy_votes >= 2 and sell_votes == 0:
        default_signal = "BUY"
        default_conf = min(0.86, 0.58 + 0.06 * buy_votes)
        catalyst_label = "Supportive re-rating backdrop"
    elif sell_votes >= 2 and buy_votes == 0:
        default_signal = "SELL"
        default_conf = min(0.86, 0.58 + 0.06 * sell_votes)
        catalyst_label = "Deteriorating backdrop"
    else:
        default_signal = "NO_TRADE"
        default_conf = 0.5
        if avg_sentiment > 0.15:
            catalyst_label = "Positive headlines, incomplete confirmation"
        elif avg_sentiment < -0.15:
            catalyst_label = "Headline pressure"
        else:
            catalyst_label = "Mixed catalyst tape"

    instruction = (
        "Think like a swing trader evaluating narrative and business context. "
        "Use financial quality, analyst expectations, company and sector headlines, Indian market tone, and US macro spillover together. "
        "Avoid reducing the decision to one ratio or one headline. Prefer NO_TRADE if the catalyst stack is mixed or speculative."
    )
    signal, confidence, llm_why = llm_first_signal_decision(
        agent_name="Catalyst Context Agent",
        instruction=instruction,
        evidence={
            "symbol": symbol,
            "financials": financials,
            "news": {
                "signal": news_signal,
                "confidence": news.get("confidence"),
                "avg_sentiment": avg_sentiment,
                "top_news": news.get("top_news", [])[:4],
                "top_industry_news": news.get("top_industry_news", [])[:4],
                "top_macro_news": news.get("top_macro_news", [])[:3],
            },
            "market_sentiment": market_sentiment,
            "us_trend": us_trend,
        },
        default_signal=default_signal,
        default_confidence=default_conf,
        default_reasoning=f"{catalyst_label}. Buy votes={buy_votes}, sell votes={sell_votes}, news sentiment={avg_sentiment:.2f}.",
    )

    summary = (
        f"Catalyst Context Signal: {signal} | {catalyst_label}. "
        f"Backdrop read: news sentiment={avg_sentiment:.2f}, analyst upside={analyst_upside}, 52w position={position_52w}. "
        f"Core read: {llm_why}"
    )
    reasoning_prompt = (
        "Catalyst context reasoning protocol:\n"
        "1) Identify whether the company narrative is improving, deteriorating, or simply noisy.\n"
        "2) Cross-check headlines against financial evidence and analyst expectations.\n"
        "3) Add macro and cross-market context only as a tailwind or headwind, not as the whole thesis.\n"
        "4) Distinguish between credible catalysts and speculative chatter.\n"
        "5) Prefer NO_TRADE when the story is interesting but not yet investable."
    )
    llm_reasoning = generate_agent_reasoning(
        agent_name="Catalyst Context Agent",
        deterministic_summary=summary,
        instruction=reasoning_prompt,
        evidence={
            "signal": signal,
            "confidence": confidence,
            "catalyst_label": catalyst_label,
            "buy_votes": buy_votes,
            "sell_votes": sell_votes,
            "avg_sentiment": avg_sentiment,
            "analyst_upside_pct": analyst_upside,
            "position_52w_pct": position_52w,
            "fundamental_signals": fund_bullets,
        },
    )

    return {
        "signal": signal,
        "confidence": round(confidence, 3),
        "summary": summary,
        "reasoning_prompt": reasoning_prompt,
        "llm_reasoning": llm_reasoning,
        "catalyst_label": catalyst_label,
        "detail": {
            "buy_votes": buy_votes,
            "sell_votes": sell_votes,
            "avg_sentiment": round(avg_sentiment, 3),
            "analyst_upside_pct": analyst_upside,
            "position_52w_pct": position_52w,
            "fundamental_signals": fund_bullets,
        },
    }