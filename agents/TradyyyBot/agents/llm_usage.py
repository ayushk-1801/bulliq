from __future__ import annotations

import time
from collections import deque
from typing import Any

from config import GEMINI_API_KEY, GEMINI_INPUT_COST_PER_1M, GEMINI_OUTPUT_COST_PER_1M, LLM_MAX_CALLS_PER_MINUTE

_USAGE_STATE: dict[str, Any] = {
    "calls": [],
    "total_input_tokens": 0,
    "total_output_tokens": 0,
    "total_tokens": 0,
    "skipped_calls": 0,
    "error_calls": 0,
}

_CALL_TIMESTAMPS: deque[float] = deque()


def reset_llm_usage() -> None:
    _USAGE_STATE["calls"] = []
    _USAGE_STATE["total_input_tokens"] = 0
    _USAGE_STATE["total_output_tokens"] = 0
    _USAGE_STATE["total_tokens"] = 0
    _USAGE_STATE["skipped_calls"] = 0
    _USAGE_STATE["error_calls"] = 0


def wait_for_rate_limit_slot() -> None:
    """Block until a call slot is available under the configured per-minute cap."""
    cap = max(1, int(LLM_MAX_CALLS_PER_MINUTE))
    now = time.time()

    while _CALL_TIMESTAMPS and (now - _CALL_TIMESTAMPS[0]) >= 60.0:
        _CALL_TIMESTAMPS.popleft()

    if len(_CALL_TIMESTAMPS) >= cap:
        wait_seconds = max(0.0, 60.0 - (now - _CALL_TIMESTAMPS[0]))
        if wait_seconds > 0:
            time.sleep(wait_seconds)
        now = time.time()
        while _CALL_TIMESTAMPS and (now - _CALL_TIMESTAMPS[0]) >= 60.0:
            _CALL_TIMESTAMPS.popleft()

    _CALL_TIMESTAMPS.append(time.time())


def _as_int(value: Any) -> int:
    try:
        return int(value)
    except Exception:
        return 0


def _estimate_tokens(text: str) -> int:
    # Lightweight approximation when provider token metadata is missing.
    return max(0, int(len(text or "") / 4))


def extract_usage(response: Any) -> dict[str, int]:
    usage = getattr(response, "usage_metadata", None)
    if usage is None:
        usage = {}

    in_tokens = _as_int(getattr(usage, "prompt_token_count", None) or usage.get("prompt_token_count"))
    out_tokens = _as_int(
        getattr(usage, "candidates_token_count", None) or usage.get("candidates_token_count")
    )
    total_tokens = _as_int(getattr(usage, "total_token_count", None) or usage.get("total_token_count"))
    if total_tokens <= 0:
        total_tokens = in_tokens + out_tokens

    return {
        "input_tokens": in_tokens,
        "output_tokens": out_tokens,
        "total_tokens": total_tokens,
    }


def record_llm_usage(
    name: str,
    model: str,
    usage: dict[str, int],
    input_text: str = "",
    output_text: str = "",
    status: str = "ok",
    reason: str = "",
) -> None:
    in_tokens = _as_int(usage.get("input_tokens"))
    out_tokens = _as_int(usage.get("output_tokens"))
    total_tokens = _as_int(usage.get("total_tokens"))

    if in_tokens <= 0 and input_text:
        in_tokens = _estimate_tokens(input_text)
    if out_tokens <= 0 and output_text:
        out_tokens = _estimate_tokens(output_text)
    if total_tokens <= 0:
        total_tokens = in_tokens + out_tokens

    _USAGE_STATE["calls"].append(
        {
            "name": name,
            "model": model,
            "status": status,
            "reason": reason,
            "input_tokens": in_tokens,
            "output_tokens": out_tokens,
            "total_tokens": total_tokens,
        }
    )

    if status == "skipped":
        _USAGE_STATE["skipped_calls"] += 1
    if status == "error":
        _USAGE_STATE["error_calls"] += 1

    _USAGE_STATE["total_input_tokens"] += in_tokens
    _USAGE_STATE["total_output_tokens"] += out_tokens
    _USAGE_STATE["total_tokens"] += total_tokens


def record_llm_event(name: str, model: str, status: str, reason: str = "") -> None:
    record_llm_usage(
        name=name,
        model=model,
        usage={"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
        status=status,
        reason=reason,
    )


def get_llm_usage_summary() -> dict[str, Any]:
    total_in = int(_USAGE_STATE["total_input_tokens"])
    total_out = int(_USAGE_STATE["total_output_tokens"])
    est_cost = ((total_in / 1_000_000.0) * GEMINI_INPUT_COST_PER_1M) + ((total_out / 1_000_000.0) * GEMINI_OUTPUT_COST_PER_1M)

    return {
        "calls": list(_USAGE_STATE["calls"]),
        "llm_enabled": bool(GEMINI_API_KEY),
        "skipped_calls": int(_USAGE_STATE["skipped_calls"]),
        "error_calls": int(_USAGE_STATE["error_calls"]),
        "total_input_tokens": total_in,
        "total_output_tokens": total_out,
        "total_tokens": int(_USAGE_STATE["total_tokens"]),
        "pricing": {
            "input_cost_per_1m": GEMINI_INPUT_COST_PER_1M,
            "output_cost_per_1m": GEMINI_OUTPUT_COST_PER_1M,
            "estimated_total_cost_usd": round(est_cost, 8),
        },
    }
