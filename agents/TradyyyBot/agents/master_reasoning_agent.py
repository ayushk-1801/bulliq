from __future__ import annotations

import json
from typing import Any

from config import GEMINI_API_KEY, GEMINI_MODEL
from agents.llm_usage import extract_usage, record_llm_event, record_llm_usage, wait_for_rate_limit_slot


def generate_master_reasoning(payload: dict[str, Any]) -> dict[str, Any]:
    """Generate a detailed master narrative using Gemini Flash Lite, with safe fallback."""
    fallback = (
        "Master reasoning fallback: Final signal is based on weighted confluence of indicator, pattern, trend, "
        "news quality, market sentiment, relative strength, US macro trend, and financial statements. "
        "Use NO_TRADE when agreement is weak and prioritize risk discipline."
    )

    if not GEMINI_API_KEY:
        record_llm_event("Master Reasoning", GEMINI_MODEL, status="skipped", reason="missing_api_key")
        return {"model": "rule-fallback", "text": fallback}

    try:
        from google import genai

        client = genai.Client(api_key=GEMINI_API_KEY)
        agent_outputs = payload.get("agent_outputs") or {}
        compact_agents = {
            name: {
                "signal": (item or {}).get("signal"),
                "confidence": (item or {}).get("confidence"),
                "summary": (item or {}).get("summary"),
            }
            for name, item in agent_outputs.items()
        }
        compact = {
            "symbol": payload.get("symbol"),
            "timeframe": payload.get("timeframe"),
            "final_signal": payload.get("final_signal"),
            "confidence": payload.get("confidence"),
            "confluence_scores": payload.get("confluence_scores"),
            "risk_plan": payload.get("risk_plan"),
            "final_conclusion": payload.get("final_conclusion"),
            "market_setup": payload.get("market_setup"),
            "catalyst_context": payload.get("catalyst_context"),
            "trader_intel": payload.get("trader_intel"),
            "agents": compact_agents,
        }
        compact_json = json.dumps(compact, ensure_ascii=False, separators=(",", ":"))

        prompt = (
            "Role: senior Indian swing trader writing a teaching desk note for developing traders. "
            "Output plain text, no emojis, 450-700 words.\n"
            "Sections (exact headings): Setup | Catalyst | Friction | Execution Plan | Risk Protocol | Teaching Notes | Verdict.\n"
            "In each section, explain not only what but why, using evidence from confluence, risk plan, and market context.\n"
            "Think in terms of location, trigger quality, invalidation, position sizing discipline, and patience.\n"
            "Include at least one explicit if-then scenario and one explicit invalidation condition.\n"
            "Be conservative under conflict and explicitly say wait/no-trade when edge is weak.\n"
            f"DATA:{compact_json}"
        )

        wait_for_rate_limit_slot()
        resp = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
        text = (getattr(resp, "text", "") or "").strip()
        record_llm_usage(
            name="Master Reasoning",
            model=GEMINI_MODEL,
            usage=extract_usage(resp),
            input_text=prompt,
            output_text=text,
            status="ok",
            reason="",
        )
        if not text:
            text = fallback
        return {"model": GEMINI_MODEL, "text": text}
    except Exception as e:
        record_llm_event("Master Reasoning", GEMINI_MODEL, status="error", reason=str(e))
        return {"model": "rule-fallback", "text": f"{fallback} (LLM unavailable: {e})"}
