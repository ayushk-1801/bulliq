from __future__ import annotations

import json
from typing import Any

from config import AGENT_LLM_BATCH_REASONING, AGENT_LLM_MAX_INPUT_CHARS, AGENT_LLM_REASONING_ENABLED, GEMINI_API_KEY, GEMINI_MODEL
from agents.llm_usage import extract_usage, record_llm_event, record_llm_usage, wait_for_rate_limit_slot


def _compact_json(data: dict[str, Any]) -> str:
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    if len(text) > AGENT_LLM_MAX_INPUT_CHARS:
        return text[:AGENT_LLM_MAX_INPUT_CHARS] + "..."
    return text


def _normalize_signal(value: Any) -> str | None:
    s = str(value or "").strip().upper()
    if s in {"BUY", "SELL", "NO_TRADE"}:
        return s
    return None


def _extract_json_text(text: str) -> str:
    s = (text or "").strip()
    if s.startswith("```"):
        lines = s.splitlines()
        if len(lines) >= 3:
            # Remove opening/closing fences.
            s = "\n".join(lines[1:-1]).strip()
    return s


def _compact_evidence_for_batch(item: dict[str, Any]) -> dict[str, Any]:
    detail = (item or {}).get("detail") or {}
    metrics = (item or {}).get("metrics") or {}
    out = {
        "signal": (item or {}).get("signal"),
        "confidence": (item or {}).get("confidence"),
        "summary": (item or {}).get("summary"),
        "protocol": (item or {}).get("reasoning_prompt"),
    }

    # Keep compact but include numeric evidence so the model cannot claim missing data.
    if detail:
        out["detail"] = detail
    if metrics:
        out["metrics"] = metrics
    return out


def generate_agent_reasoning(
    agent_name: str,
    deterministic_summary: str,
    instruction: str,
    evidence: dict[str, Any],
) -> str:
    """Generate concise agent-level LLM reasoning with robust fallback."""
    if AGENT_LLM_BATCH_REASONING:
        # Batched reasoning is generated centrally in pipeline for efficiency.
        return f"{agent_name} fallback reasoning: {deterministic_summary}"

    if not AGENT_LLM_REASONING_ENABLED:
        record_llm_event(agent_name, GEMINI_MODEL, status="skipped", reason="reasoning_disabled")
        return f"{agent_name} fallback reasoning: {deterministic_summary}"
    if not GEMINI_API_KEY:
        record_llm_event(agent_name, GEMINI_MODEL, status="skipped", reason="missing_api_key")
        return f"{agent_name} fallback reasoning: {deterministic_summary}"

    try:
        from google import genai

        compact_json = _compact_json(evidence)

        prompt = (
            f"Role:{agent_name}. Output plain text, no emojis. Max 110 words. "
            "Include: directional bias, best evidence, main risk, confidence rationale. "
            "Be decisive when one side has a clear edge; use NO_TRADE only for genuinely balanced conflict.\n"
            f"Protocol:{instruction}\n"
            f"Summary:{deterministic_summary}\n"
            f"Evidence:{compact_json}"
        )

        client = genai.Client(api_key=GEMINI_API_KEY)
        wait_for_rate_limit_slot()
        resp = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
        text = (getattr(resp, "text", "") or "").strip()
        record_llm_usage(
            name=agent_name,
            model=GEMINI_MODEL,
            usage=extract_usage(resp),
            input_text=prompt,
            output_text=text,
            status="ok",
            reason="",
        )
        if text:
            return text
    except Exception as e:
        record_llm_event(agent_name, GEMINI_MODEL, status="error", reason=str(e))
        pass

    return f"{agent_name} fallback reasoning: {deterministic_summary}"


def llm_first_signal_decision(
    agent_name: str,
    instruction: str,
    evidence: dict[str, Any],
    default_signal: str,
    default_confidence: float,
    default_reasoning: str,
) -> tuple[str, float, str]:
    """Try LLM-first directional decision; fallback safely to deterministic outputs."""
    decision_name = f"{agent_name} decision"
    if not AGENT_LLM_REASONING_ENABLED:
        record_llm_event(decision_name, GEMINI_MODEL, status="skipped", reason="reasoning_disabled")
        return default_signal, default_confidence, default_reasoning
    if not GEMINI_API_KEY:
        record_llm_event(decision_name, GEMINI_MODEL, status="skipped", reason="missing_api_key")
        return default_signal, default_confidence, default_reasoning

    try:
        from google import genai

        compact_json = _compact_json(evidence)
        prompt = (
            f"You are {agent_name}. Decide signal first from evidence.\n"
            "Return STRICT JSON only with keys signal, confidence, why.\n"
            "signal must be BUY or SELL or NO_TRADE. confidence in [0,1]. why max 60 words.\n"
            "Decision policy: prefer BUY or SELL when directional edge is at least moderate (about 55:45 or stronger). "
            "Use NO_TRADE only when evidence is truly mixed/unclear.\n"
            f"Protocol:{instruction}\n"
            f"Evidence:{compact_json}"
        )
        client = genai.Client(api_key=GEMINI_API_KEY)
        wait_for_rate_limit_slot()
        resp = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
        text = (getattr(resp, "text", "") or "").strip()
        record_llm_usage(
            name=decision_name,
            model=GEMINI_MODEL,
            usage=extract_usage(resp),
            input_text=prompt,
            output_text=text,
            status="ok",
            reason="",
        )
        if not text:
            return default_signal, default_confidence, default_reasoning

        data = json.loads(_extract_json_text(text))
        signal = _normalize_signal(data.get("signal"))
        if not signal:
            return default_signal, default_confidence, default_reasoning
        try:
            conf = float(data.get("confidence", default_confidence))
        except Exception:
            conf = default_confidence
        conf = max(0.0, min(1.0, conf))
        why = str(data.get("why") or "").strip()
        if not why:
            why = default_reasoning
        return signal, conf, why
    except Exception as e:
        record_llm_event(decision_name, GEMINI_MODEL, status="error", reason=str(e))
        return default_signal, default_confidence, default_reasoning


def generate_structured_json(
    agent_name: str,
    instruction: str,
    evidence: dict[str, Any],
    schema_instruction: str,
    fallback: dict[str, Any],
) -> dict[str, Any]:
    """Return structured JSON from the model, with safe merge into fallback."""
    if not AGENT_LLM_REASONING_ENABLED:
        record_llm_event(agent_name, GEMINI_MODEL, status="skipped", reason="reasoning_disabled")
        return fallback
    if not GEMINI_API_KEY:
        record_llm_event(agent_name, GEMINI_MODEL, status="skipped", reason="missing_api_key")
        return fallback

    try:
        from google import genai

        compact_json = _compact_json(evidence)
        prompt = (
            f"You are {agent_name}. Return STRICT JSON only.\n"
            f"Instruction:{instruction}\n"
            f"Schema:{schema_instruction}\n"
            f"Evidence:{compact_json}"
        )

        client = genai.Client(api_key=GEMINI_API_KEY)
        wait_for_rate_limit_slot()
        resp = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
        text = (getattr(resp, "text", "") or "").strip()
        record_llm_usage(
            name=agent_name,
            model=GEMINI_MODEL,
            usage=extract_usage(resp),
            input_text=prompt,
            output_text=text,
            status="ok",
            reason="",
        )
        if not text:
            return fallback

        parsed = json.loads(_extract_json_text(text))
        result = dict(fallback)
        for key in fallback:
            if key in parsed and parsed[key] is not None:
                result[key] = parsed[key]

        if "signal" in result:
            norm_signal = _normalize_signal(result.get("signal"))
            result["signal"] = norm_signal or fallback.get("signal")
        if "confidence" in result:
            try:
                conf = float(result.get("confidence", fallback.get("confidence", 0.5)))
            except Exception:
                conf = float(fallback.get("confidence", 0.5))
            result["confidence"] = max(0.0, min(1.0, conf))
        return result
    except Exception as e:
        record_llm_event(agent_name, GEMINI_MODEL, status="error", reason=str(e))
        return fallback


def generate_batched_reasoning(
    agent_outputs: dict[str, Any],
    confluence: dict[str, Any],
    risk: dict[str, Any],
) -> dict[str, str]:
    """Generate concise reasoning for multiple agents in a single LLM call."""
    fallback: dict[str, str] = {}
    for k, v in agent_outputs.items():
        fallback[k] = f"{k} fallback reasoning: {(v or {}).get('summary', '')}"
    fallback["confluence"] = f"confluence fallback reasoning: {confluence.get('summary', '')}"
    fallback["risk"] = f"risk fallback reasoning: {risk.get('summary', '')}"

    if not AGENT_LLM_REASONING_ENABLED:
        record_llm_event("Batched Agent Reasoning", GEMINI_MODEL, status="skipped", reason="reasoning_disabled")
        return fallback
    if not GEMINI_API_KEY:
        record_llm_event("Batched Agent Reasoning", GEMINI_MODEL, status="skipped", reason="missing_api_key")
        return fallback

    try:
        from google import genai

        compact = {
            "agents": {
                k: _compact_evidence_for_batch(v or {})
                for k, v in agent_outputs.items()
            },
            "confluence": {
                "signal": confluence.get("signal"),
                "confidence": confluence.get("confidence"),
                "summary": confluence.get("summary"),
                "protocol": confluence.get("reasoning_prompt", ""),
            },
            "risk": {
                "summary": risk.get("summary"),
                "protocol": risk.get("reasoning_prompt", ""),
            },
        }
        compact_json = _compact_json(compact)
        required_keys = list(agent_outputs.keys()) + ["confluence", "risk"]
        prompt = (
            "Write concise reasoning per section in JSON only. "
            f"Keys required: {','.join(required_keys)}. "
            "Each value max 90 words, plain text, no emojis. "
            "Use concrete numeric evidence from DATA when available. "
            "Do NOT claim missing financial data if DATA.financials.detail or DATA.financials.metrics has values.\n"
            f"DATA:{compact_json}"
        )

        client = genai.Client(api_key=GEMINI_API_KEY)
        wait_for_rate_limit_slot()
        resp = client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
        text = (getattr(resp, "text", "") or "").strip()
        record_llm_usage(
            name="Batched Agent Reasoning",
            model=GEMINI_MODEL,
            usage=extract_usage(resp),
            input_text=prompt,
            output_text=text,
            status="ok",
            reason="",
        )
        if not text:
            return fallback

        parsed = json.loads(_extract_json_text(text))
        result: dict[str, str] = {}
        for key, fb in fallback.items():
            val = parsed.get(key)
            result[key] = str(val).strip() if val else fb
        return result
    except Exception as e:
        record_llm_event("Batched Agent Reasoning", GEMINI_MODEL, status="error", reason=str(e))
        return fallback
