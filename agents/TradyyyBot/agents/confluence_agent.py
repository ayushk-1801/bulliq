from __future__ import annotations

from agents.llm_reasoner import generate_agent_reasoning
from config import CONFIDENCE_BOUNDS


# Tiered base weights — tape-reading agents get the most influence,
# mid-tier agents provide structural context, contextual agents add colour.
_AGENT_BASE_WEIGHTS: dict[str, float] = {
    "technical": 0.18,
    "market_setup": 0.18,
    "trend": 0.12,
    "pattern": 0.12,
    "financials": 0.12,
    "news": 0.08,
    "market_sentiment": 0.08,
    "relative_strength": 0.08,
    "us_trend": 0.08,
    "catalyst_context": 0.08,
}


def _derive_weights(agent_outputs: dict) -> dict[str, float]:
    active = list(agent_outputs.keys())
    if not active:
        return {}
    # Assign base weights (unknown agents get the mean weight)
    raw: dict[str, float] = {}
    default_w = sum(_AGENT_BASE_WEIGHTS.values()) / max(1, len(_AGENT_BASE_WEIGHTS))
    for name in active:
        raw[name] = _AGENT_BASE_WEIGHTS.get(name, default_w)
    # Re-normalize so weights sum to 1.0
    total = sum(raw.values())
    if total <= 0:
        total = 1.0
    return {name: w / total for name, w in raw.items()}


def combine_signals(agent_outputs: dict) -> dict:
    weighted_votes = {"BUY": 0.0, "SELL": 0.0, "NO_TRADE": 0.0}

    weights = _derive_weights(agent_outputs)

    for name, weight in weights.items():
        output = agent_outputs.get(name, {})
        signal = output.get("signal", "NO_TRADE")
        conf = float(output.get("confidence", 0.5))
        weighted_votes[signal] = weighted_votes.get(signal, 0.0) + weight * conf

    buy_score = weighted_votes.get("BUY", 0.0)
    sell_score = weighted_votes.get("SELL", 0.0)
    no_trade_score = weighted_votes.get("NO_TRADE", 0.0)

    # Balanced gate: avoid forced neutrality while still rejecting noisy conflicts.
    margin = abs(buy_score - sell_score)
    top_score = max(buy_score, sell_score)
    total_directional = max(1e-9, buy_score + sell_score)
    directional_balance = margin / total_directional
    participating = sum(1 for x in agent_outputs.values() if x.get("signal", "NO_TRADE") != "NO_TRADE")
    expected_weight = (1.0 / max(1, len(weights)))
    min_top_score = expected_weight * 1.20
    min_margin = expected_weight * 0.30
    min_participation = max(2, int(round(len(weights) * 0.20)))

    if (
        top_score < min_top_score
        or margin < min_margin
        or no_trade_score > (top_score * 1.25)
        or participating < min_participation
    ):
        final_signal = "NO_TRADE"
        confidence = max(CONFIDENCE_BOUNDS["neutral_min"], min(0.70, 0.40 + 0.20 * no_trade_score + 0.10 * directional_balance))
    elif buy_score > sell_score:
        final_signal = "BUY"
        confidence = min(CONFIDENCE_BOUNDS["max"], CONFIDENCE_BOUNDS["trade_min"] + 0.52 * margin + 0.16 * directional_balance)
    else:
        final_signal = "SELL"
        confidence = min(CONFIDENCE_BOUNDS["max"], CONFIDENCE_BOUNDS["trade_min"] + 0.52 * margin + 0.16 * directional_balance)

    support = [k for k, v in agent_outputs.items() if v.get("signal") == final_signal]
    opposing = [k for k, v in agent_outputs.items() if v.get("signal") not in (final_signal, "NO_TRADE")]
    neutral = [k for k, v in agent_outputs.items() if v.get("signal") == "NO_TRADE"]

    rationale = (
        f"Master Confluence Committee: BUY={buy_score:.3f}, SELL={sell_score:.3f}, NO_TRADE={no_trade_score:.3f}. "
        f"Final={final_signal}, confidence={confidence:.3f}. "
        f"Support={support if support else 'none'}; Opposing={opposing if opposing else 'none'}; "
        f"Neutral={neutral if neutral else 'none'}."
    )

    reasoning_prompt = (
        "Confluence reasoning protocol:\n"
        "1) Synthesize weighted signals from technical, structural, and contextual agents into a master bias.\n"
        "2) Measure directional conviction margin (BUY vs SELL) against NO_TRADE 'gravity'.\n"
        "3) Apply institutional-grade filters for participation, conflict level, and score robustness.\n"
        "4) Explicitly identify which specific agents are driving the consensus vs which are lagging or conflicting.\n"
        "5) Err on the side of NO_TRADE when 'committee conflict' is high or structural alignment is missing."
    )

    llm_reasoning = generate_agent_reasoning(
        agent_name="Confluence Agent",
        deterministic_summary=rationale,
        instruction=reasoning_prompt,
        evidence={
            "scores": {
                "buy": round(buy_score, 3),
                "sell": round(sell_score, 3),
                "no_trade": round(no_trade_score, 3),
            },
            "final_signal": final_signal,
            "confidence": round(confidence, 3),
            "supporting_agents": support,
            "opposing_agents": opposing,
            "neutral_agents": neutral,
            "participating_non_neutral": participating,
            "directional_balance": round(directional_balance, 3),
        },
    )

    return {
        "signal": final_signal,
        "confidence": round(confidence, 3),
        "scores": {
            "buy": round(buy_score, 3),
            "sell": round(sell_score, 3),
            "no_trade": round(no_trade_score, 3),
        },
        "summary": rationale,
        "reasoning_prompt": reasoning_prompt,
        "llm_reasoning": llm_reasoning,
        "detail": {
            "supporting_agents": support,
            "opposing_agents": opposing,
            "neutral_agents": neutral,
            "participating_non_neutral": participating,
            "directional_balance": round(directional_balance, 3),
        },
    }
