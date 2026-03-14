from __future__ import annotations

import math

from data_providers import fetch_financial_statements, fetch_extended_fundamentals, fetch_promoter_institutional_data, fetch_dividends_splits
from agents.llm_reasoner import generate_agent_reasoning
from config import CONFIDENCE_BOUNDS


def _latest_and_prev(series_dict: dict) -> tuple[float | None, float | None]:
    if not series_dict:
        return None, None
    items = sorted(series_dict.items(), key=lambda x: x[0], reverse=True)
    try:
        latest = float(items[0][1])
    except Exception:
        latest = None
    prev = None
    if len(items) > 1:
        try:
            prev = float(items[1][1])
        except Exception:
            prev = None
    return latest, prev


def _growth(latest: float | None, prev: float | None) -> float | None:
    if latest is None or prev is None or abs(prev) < 1e-9:
        return None
    return (latest / prev) - 1.0


def _clean_num(value: float | None) -> float | None:
    if value is None:
        return None
    try:
        v = float(value)
    except Exception:
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return v


def _fmt(value: float | None, pct: bool = False) -> str:
    v = _clean_num(value)
    if v is None:
        return "N/A"
    if pct:
        return f"{v*100:.2f}%"
    if abs(v) >= 1_000_000_000:
        return f"{v/1_000_000_000:.2f}B"
    if abs(v) >= 1_000_000:
        return f"{v/1_000_000:.2f}M"
    return f"{v:.3f}"


def _clip_score(value: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def analyze_financials(symbol: str) -> dict:
    data = fetch_financial_statements(symbol)
    ext_fund = fetch_extended_fundamentals(symbol)
    promoter_data = fetch_promoter_institutional_data(symbol)
    div_split_data = fetch_dividends_splits(symbol)
    m = data.get("metrics", {})
    derived = (data.get("quarterly", {}) or {}).get("derived", {}) or {}

    roe = m.get("return_on_equity")
    profit_margins = m.get("profit_margins")
    rev_growth = m.get("revenue_growth")
    earn_growth = m.get("earnings_growth")
    debt_to_equity = m.get("debt_to_equity")
    current_ratio = m.get("current_ratio")
    pe = m.get("trailing_pe")

    rev_latest, rev_prev = _latest_and_prev(derived.get("revenue_series", {}))
    ni_latest, ni_prev = _latest_and_prev(derived.get("net_income_series", {}))
    ocf_latest, ocf_prev = _latest_and_prev(derived.get("operating_cf_series", {}))
    capex_latest, _ = _latest_and_prev(derived.get("capex_series", {}))
    debt_latest, debt_prev = _latest_and_prev(derived.get("total_debt_series", {}))
    cash_latest, _ = _latest_and_prev(derived.get("cash_series", {}))

    rev_qoq = _growth(rev_latest, rev_prev)
    ni_qoq = _growth(ni_latest, ni_prev)
    ocf_qoq = _growth(ocf_latest, ocf_prev)
    debt_qoq = _growth(debt_latest, debt_prev)

    rev_qoq = _clean_num(rev_qoq)
    ni_qoq = _clean_num(ni_qoq)
    ocf_qoq = _clean_num(ocf_qoq)
    debt_qoq = _clean_num(debt_qoq)

    fcf_latest = None
    if ocf_latest is not None and capex_latest is not None:
        # Capex often negative in cashflow statements.
        fcf_latest = ocf_latest + capex_latest

    cash_to_debt = None
    if cash_latest is not None and debt_latest not in (None, 0):
        cash_to_debt = cash_latest / debt_latest
    cash_to_debt = _clean_num(cash_to_debt)

    bull = 0
    bear = 0
    score_total = 0.0

    def _add_score(metric_value: float | None, score_expr: float | None) -> None:
        nonlocal bull, bear, score_total
        if metric_value is None or score_expr is None:
            return
        s = _clip_score(score_expr)
        score_total += s
        if s > 0.2:
            bull += 1
        elif s < -0.2:
            bear += 1

    _add_score(roe, (roe - 0.10) / 0.10 if roe is not None else None)
    _add_score(profit_margins, (profit_margins - 0.08) / 0.08 if profit_margins is not None else None)
    _add_score(rev_growth, rev_growth / 0.12 if rev_growth is not None else None)
    _add_score(earn_growth, earn_growth / 0.15 if earn_growth is not None else None)
    _add_score(debt_to_equity, (100.0 - debt_to_equity) / 100.0 if debt_to_equity is not None else None)
    _add_score(current_ratio, (current_ratio - 1.0) / 0.6 if current_ratio is not None else None)
    _add_score(pe, (25.0 - pe) / 25.0 if pe is not None else None)
    _add_score(rev_qoq, rev_qoq / 0.08 if rev_qoq is not None else None)
    _add_score(ni_qoq, ni_qoq / 0.10 if ni_qoq is not None else None)
    _add_score(ocf_qoq, ocf_qoq / 0.10 if ocf_qoq is not None else None)
    _add_score(debt_qoq, -debt_qoq / 0.12 if debt_qoq is not None else None)
    _add_score(cash_to_debt, (cash_to_debt - 0.30) / 0.40 if cash_to_debt is not None else None)
    if fcf_latest is not None:
        _add_score(fcf_latest, 0.6 if fcf_latest > 0 else -0.6)

    # --- NEW: Extended fundamental scoring factors ---
    ext_dividend_yield = _clean_num(ext_fund.get("dividend_yield"))
    ext_peg_ratio = _clean_num(ext_fund.get("peg_ratio"))
    ext_operating_margins = _clean_num(ext_fund.get("operating_margins"))
    ext_gross_margins = _clean_num(ext_fund.get("gross_margins"))
    ext_ev_to_ebitda = _clean_num(ext_fund.get("enterprise_to_ebitda"))
    ext_held_pct_inst = _clean_num(ext_fund.get("held_pct_institutions"))

    # Dividend yield — consistent payers get a boost
    if ext_dividend_yield is not None and ext_dividend_yield > 0:
        _add_score(ext_dividend_yield, _clip_score((ext_dividend_yield - 0.005) / 0.03))  # 0.5%–3.5% range

    # PEG ratio — lower is more attractive (< 1 = undervalued growth)
    if ext_peg_ratio is not None and ext_peg_ratio > 0:
        _add_score(ext_peg_ratio, _clip_score((1.5 - ext_peg_ratio) / 1.5))

    # Operating margins — higher is better
    if ext_operating_margins is not None:
        _add_score(ext_operating_margins, _clip_score((ext_operating_margins - 0.10) / 0.15))

    # EV/EBITDA — lower is more attractive
    if ext_ev_to_ebitda is not None and ext_ev_to_ebitda > 0:
        _add_score(ext_ev_to_ebitda, _clip_score((15.0 - ext_ev_to_ebitda) / 15.0))

    # Institutional ownership — moderate to high is positive
    if ext_held_pct_inst is not None and ext_held_pct_inst > 0:
        _add_score(ext_held_pct_inst, _clip_score((ext_held_pct_inst - 0.15) / 0.30))

    data_fields = [
        roe,
        profit_margins,
        rev_growth,
        earn_growth,
        debt_to_equity,
        current_ratio,
        pe,
        rev_qoq,
        ni_qoq,
        ocf_qoq,
        debt_qoq,
        fcf_latest,
        cash_to_debt,
    ]
    available = sum(1 for x in data_fields if _clean_num(x) is not None)
    data_coverage = available / max(1, len(data_fields))

    # ── 52-week context ──────────────────────────────────────────────────
    high_52w = _clean_num(m.get("fifty_two_week_high"))
    low_52w = _clean_num(m.get("fifty_two_week_low"))
    current_price = _clean_num(m.get("current_price"))
    change_52w = _clean_num(m.get("fifty_two_week_change"))  # 1-year return as fraction

    pos_52w: float | None = None
    if high_52w and low_52w and current_price and high_52w > low_52w:
        pos_52w = (current_price - low_52w) / (high_52w - low_52w)

    # ── Analyst consensus ────────────────────────────────────────────────
    analyst_target = _clean_num(m.get("analyst_target_price"))
    n_analysts = m.get("number_of_analyst_opinions")
    analyst_upside: float | None = None
    if analyst_target and current_price and current_price > 0:
        analyst_upside = (analyst_target / current_price - 1.0) * 100.0

    # ── EPS context ──────────────────────────────────────────────────────
    trailing_eps = _clean_num(m.get("trailing_eps"))
    forward_eps = _clean_num(m.get("forward_eps"))
    earn_growth_val = _clean_num(earn_growth)
    earn_growth_pct = earn_growth_val * 100.0 if earn_growth_val is not None else None

    # ── Build fundamental signal bullets (like analyst card view) ────────
    fundamental_signals: list[dict] = []

    # EPS / earnings trend
    if earn_growth_pct is not None:
        if earn_growth_pct < -50.0:
            fundamental_signals.append({
                "type": "bearish",
                "text": f"Severe earnings decline — net profit down {earn_growth_pct:.1f}% YoY. Active institutional seller pressure expected.",
            })
        elif earn_growth_pct < -20.0:
            fundamental_signals.append({
                "type": "bearish",
                "text": f"Earnings decline — net profit down {earn_growth_pct:.1f}% YoY.",
            })
        elif earn_growth_pct > 20.0:
            fundamental_signals.append({
                "type": "bullish",
                "text": f"Strong earnings growth — net profit up {earn_growth_pct:.1f}% YoY.",
            })

    # Forward EPS context (analyst recovery / deterioration expectation)
    if trailing_eps and forward_eps:
        ratio = forward_eps / max(1e-9, abs(trailing_eps))
        if forward_eps > 0 and ratio >= 1.30:
            fundamental_signals.append({
                "type": "mixed",
                "text": f"Forward EPS ₹{forward_eps:.2f} vs trailing ₹{trailing_eps:.2f} — earnings recovery expected.",
            })
        elif trailing_eps > 0 and ratio <= 0.85:
            fundamental_signals.append({
                "type": "bearish",
                "text": f"Forward EPS ₹{forward_eps:.2f} below trailing ₹{trailing_eps:.2f} — further earnings contraction expected.",
            })

    # 52-week low proximity
    if pos_52w is not None:
        if pos_52w < 0.08:
            fundamental_signals.append({
                "type": "mixed",
                "text": (
                    f"Near 52-week low (₹{low_52w:.2f}–₹{current_price:.2f}) — historically strong demand zone. "
                    "Deep oversold bounces common, but confirm volume."
                ),
            })
        elif pos_52w > 0.92:
            fundamental_signals.append({
                "type": "mixed",
                "text": f"Near 52-week high (₹{high_52w:.2f}) — momentum strong but watch for distribution.",
            })

    # Analyst consensus
    if analyst_target and analyst_upside is not None:
        n_str = f"{int(n_analysts)} analyst{'s' if n_analysts and n_analysts > 1 else ''}" if n_analysts else "Analyst consensus"
        if analyst_upside > 20.0 and (not n_analysts or n_analysts >= 3):
            fundamental_signals.append({
                "type": "bullish",
                "text": f"Analyst target ₹{analyst_target:.2f} — {n_str} implying {analyst_upside:.0f}% upside.",
            })
        elif analyst_upside < -10.0:
            fundamental_signals.append({
                "type": "bearish",
                "text": f"Analyst target ₹{analyst_target:.2f} — {n_str} implying {analyst_upside:.0f}% (-ve).",
            })

    # Revenue trend
    if rev_qoq is not None:
        if rev_qoq > 0.03:
            fundamental_signals.append({
                "type": "bullish",
                "text": f"Revenue growing QoQ ({rev_qoq*100:.1f}% last quarter).",
            })
        elif rev_qoq < -0.03:
            fundamental_signals.append({
                "type": "bearish",
                "text": f"Revenue contracting QoQ ({rev_qoq*100:.1f}% last quarter).",
            })

    # Debt trend
    if ni_qoq is not None and ni_qoq < -0.075:
        fundamental_signals.append({
            "type": "bearish",
            "text": f"Net income declined sharply QoQ ({ni_qoq*100:.1f}%).",
        })

    analyst_consensus = {
        "target_price": round(analyst_target, 2) if analyst_target else None,
        "target_high": round(_clean_num(m.get("analyst_target_high")) or 0, 2) or None,
        "target_low": round(_clean_num(m.get("analyst_target_low")) or 0, 2) or None,
        "n_analysts": int(n_analysts) if n_analysts else None,
        "implied_upside_pct": round(analyst_upside, 1) if analyst_upside is not None else None,
    }

    price_52w = {
        "high": round(high_52w, 2) if high_52w else None,
        "low": round(low_52w, 2) if low_52w else None,
        "current": round(current_price, 2) if current_price else None,
        "position_pct": round(pos_52w * 100, 1) if pos_52w is not None else None,
        "change_1y_pct": round(change_52w * 100, 1) if change_52w is not None else None,
    }

    diff = bull - bear
    norm_score = score_total / max(1, available)
    if norm_score >= 0.18:
        signal = "BUY"
        conf = min(CONFIDENCE_BOUNDS["max"], CONFIDENCE_BOUNDS["trade_min"] + 0.28 * min(1.0, abs(norm_score) / 0.45) + 0.10 * data_coverage)
        stance = "Fundamentals supportive"
    elif norm_score <= -0.18:
        signal = "SELL"
        conf = min(CONFIDENCE_BOUNDS["max"], CONFIDENCE_BOUNDS["trade_min"] + 0.28 * min(1.0, abs(norm_score) / 0.45) + 0.10 * data_coverage)
        stance = "Fundamentals fragile"
    else:
        signal = "NO_TRADE"
        conf = max(CONFIDENCE_BOUNDS["neutral_min"], min(0.72, 0.44 + 0.20 * min(1.0, abs(norm_score) / 0.30) + 0.08 * data_coverage))
        stance = "Fundamentals mixed/neutral"

    summary = (
        f"Financials Signal: {signal} | {stance}. "
        f"Coverage={data_coverage:.0%}. "
        f"ROE={_fmt(roe, pct=True)}, Margin={_fmt(profit_margins, pct=True)}, RevGrowth={_fmt(rev_growth, pct=True)}, EarnGrowth={_fmt(earn_growth, pct=True)}, "
        f"D/E={_fmt(debt_to_equity)}, CurrentRatio={_fmt(current_ratio)}, PE={_fmt(pe)}. "
        f"Quarterly trends: RevQoQ={_fmt(rev_qoq, pct=True)}, NIQoQ={_fmt(ni_qoq, pct=True)}, OCFQoQ={_fmt(ocf_qoq, pct=True)}, DebtQoQ={_fmt(debt_qoq, pct=True)}, "
        f"FCF={_fmt(fcf_latest)}, Cash/Debt={_fmt(cash_to_debt)}. "
        f"Analyst target={_fmt(analyst_target)} ({_fmt(analyst_upside, pct=True) if analyst_upside is not None else 'N/A'} upside, {n_analysts or '?'} analysts). "
        f"52w Hi/Lo={_fmt(high_52w)}/{_fmt(low_52w)}, position={_fmt(pos_52w, pct=True) if pos_52w is not None else 'N/A'}."
    )

    reasoning_prompt = (
        "Financial statement reasoning protocol:\n"
        "1) Evaluate valuation (PE/PB) relative to profitability and growth quality.\n"
        "2) Score profitability and efficiency (ROE, margins).\n"
        "3) Validate growth durability using quarterly revenue and net-income trends.\n"
        "4) Check balance-sheet resilience (debt trend, liquidity, cash/debt).\n"
        "5) Check cash-flow quality (operating CF trend, free cash flow sign).\n"
        "6) If fundamentals conflict or are incomplete, default to conservative NO_TRADE bias."
    )

    trend_detail = {
        "revenue_qoq": rev_qoq,
        "net_income_qoq": ni_qoq,
        "operating_cf_qoq": ocf_qoq,
        "debt_qoq": debt_qoq,
        "free_cashflow_latest": fcf_latest,
        "cash_to_debt": cash_to_debt,
    }
    llm_reasoning = generate_agent_reasoning(
        agent_name="Financials Agent",
        deterministic_summary=summary,
        instruction=reasoning_prompt,
        evidence={
            "signal": signal,
            "confidence": conf,
            "data_coverage": data_coverage,
            "bull_points": bull,
            "bear_points": bear,
            "score_total": score_total,
            "score_norm": norm_score,
            "metrics": m,
            "statement_trends": trend_detail,
        },
    )

    return {
        "signal": signal,
        "confidence": conf,
        "summary": summary,
        "reasoning_prompt": reasoning_prompt,
        "llm_reasoning": llm_reasoning,
        "fundamental_signals": fundamental_signals,
        "analyst_consensus": analyst_consensus,
        "price_52w": price_52w,
        "extended_fundamentals": ext_fund,
        "promoter_institutional": promoter_data,
        "dividends_splits": div_split_data,
        "metrics": m,  # Surface at top level for swing_pipeline fallbacks
        "detail": {
            "stance": stance,
            "bull_points": bull,
            "bear_points": bear,
            "data_quality": {
                "coverage_ratio": data_coverage,
                "available_fields": available,
                "total_fields": len(data_fields),
            },
            "metrics": m,
            "metrics_extended": {
                "dividend_yield": ext_dividend_yield,
                "peg_ratio": ext_peg_ratio,
                "operating_margins": ext_operating_margins,
                "gross_margins": ext_gross_margins,
                "ev_to_ebitda": ext_ev_to_ebitda,
                "held_pct_institutions": ext_held_pct_inst,
            },
            "statement_trends": trend_detail,
        },
    }
