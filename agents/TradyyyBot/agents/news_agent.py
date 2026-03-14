from __future__ import annotations

import math
from statistics import mean
from time import time

from data_providers import fetch_company_industry_news, fetch_company_context, fetch_global_macro_news, fetch_news_multi_source
from agents.llm_reasoner import generate_agent_reasoning, llm_first_signal_decision
from config import CONFIDENCE_BOUNDS


MACRO_LIMIT = 30
TOP_STOCK_LIMIT = 15
TOP_INDUSTRY_LIMIT = 12
TOP_MACRO_LIMIT = 10
LLM_PREVIEW_LIMIT = 10
LLM_REASONING_PREVIEW_LIMIT = 12


def _exponential_recency_weight(pub_ts: float, now_ts: float) -> float:
    """Continuous exponential freshness decay with half-life ~48 hours."""
    if pub_ts <= 0:
        return 0.5
    hours_old = max(0.0, (now_ts - pub_ts) / 3600.0)
    # exp(-hours/48) gives: 0h→1.0, 24h→0.61, 48h→0.37, 72h→0.22
    raw = math.exp(-hours_old / 48.0)
    return max(0.35, min(1.0, raw))


def _jaccard_title_similarity(title_a: str, title_b: str) -> float:
    """Normalized Jaccard overlap on word tokens for near-duplicate detection."""
    words_a = set(title_a.lower().split())
    words_b = set(title_b.lower().split())
    if not words_a or not words_b:
        return 0.0
    intersection = len(words_a & words_b)
    union = len(words_a | words_b)
    return intersection / max(1, union)


def _content_dedup(rows: list[dict], similarity_threshold: float = 0.70) -> list[dict]:
    """Remove near-duplicate headlines by Jaccard title similarity."""
    if not rows:
        return rows
    deduped: list[dict] = []
    seen_titles: list[str] = []
    for row in rows:
        title = (row.get("title") or "").strip()
        if not title:
            continue
        is_dup = False
        for prev in seen_titles:
            if _jaccard_title_similarity(title, prev) >= similarity_threshold:
                is_dup = True
                break
        if not is_dup:
            deduped.append(row)
            seen_titles.append(title)
    return deduped


def _enrich_news_item(row: dict, description: str = "") -> dict:
    """Add description field for LLM context if available."""
    enriched = dict(row)
    if description and description.strip():
        enriched["description"] = description.strip()[:300]
    return enriched


def analyze_news(stock_keyword: str) -> dict:
    stock_news_rows = fetch_news_multi_source(stock_keyword)
    industry_news_rows = fetch_company_industry_news(stock_keyword)
    macro_news_rows = fetch_global_macro_news(limit=MACRO_LIMIT)
    company_ctx = fetch_company_context(stock_keyword)

    # Apply content-similarity dedup on top of URL-based dedup
    stock_news_rows = _content_dedup(stock_news_rows)
    industry_news_rows = _content_dedup(industry_news_rows)
    macro_news_rows = _content_dedup(macro_news_rows)

    if not stock_news_rows and not industry_news_rows and not macro_news_rows:
        return {
            "signal": "NO_TRADE",
            "confidence": CONFIDENCE_BOUNDS["insufficient"],
            "summary": "News Agent: No high-confidence recent and relevant news found across configured APIs.",
            "top_news": [],
            "top_industry_news": [],
            "top_macro_news": [],
            "avg_sentiment": 0.0,
            "macro_sentiment": 0.0,
        }

    source_weight = {
        "alphavantage": 1.10,
        "newsapi": 1.05,
        "finnhub": 1.0,
        "google_rss": 0.95,
        "bing_rss": 0.9,
        "yahoo_news": 1.05,
    }

    kw = (stock_keyword or "").strip().lower()
    now_ts = time()
    weighted_stock = []
    for row in stock_news_rows:
        sent = float(row.get("sentiment_score", 0.0))
        src = row.get("source", "")
        base_w = source_weight.get(src, 1.0)

        title = (row.get("title") or "").lower()
        relevance_w = 1.12 if kw and kw in title else 0.95

        pub_ts = float(row.get("published_ts", 0.0) or 0.0)
        recency_w = _exponential_recency_weight(pub_ts, now_ts)

        # Trusted domain bonus
        trust_w = 1.08 if row.get("domain_trust") == "trusted" else 1.0

        weighted_stock.append(sent * base_w * relevance_w * recency_w * trust_w)

    weighted_macro = []
    for row in macro_news_rows:
        sent = float(row.get("sentiment_score", 0.0))
        src = row.get("source", "")
        base_w = source_weight.get(src.replace("_macro", ""), 0.95)
        pub_ts = float(row.get("published_ts", 0.0) or 0.0)
        recency_w = _exponential_recency_weight(pub_ts, now_ts)
        trust_w = 1.08 if row.get("domain_trust") == "trusted" else 1.0
        weighted_macro.append(sent * base_w * recency_w * trust_w)

    weighted_industry = []
    for row in industry_news_rows:
        sent = float(row.get("sentiment_score", 0.0))
        src = row.get("source", "")
        base_w = source_weight.get(src.replace("_industry", ""), 0.95)
        pub_ts = float(row.get("published_ts", 0.0) or 0.0)
        recency_w = _exponential_recency_weight(pub_ts, now_ts)
        trust_w = 1.08 if row.get("domain_trust") == "trusted" else 1.0
        weighted_industry.append(sent * base_w * recency_w * trust_w)

    stock_avg_sent = mean(weighted_stock) if weighted_stock else 0.0
    macro_avg_sent = mean(weighted_macro) if weighted_macro else 0.0
    industry_avg_sent = mean(weighted_industry) if weighted_industry else 0.0
    avg_sent = (0.55 * stock_avg_sent) + (0.28 * industry_avg_sent) + (0.17 * macro_avg_sent)

    signal = "NO_TRADE"
    conf = max(CONFIDENCE_BOUNDS["neutral_min"], 0.56)

    top_news = stock_news_rows[:TOP_STOCK_LIMIT]
    top_industry_news = industry_news_rows[:TOP_INDUSTRY_LIMIT]
    top_macro_news = macro_news_rows[:TOP_MACRO_LIMIT]
    trusted_count = sum(1 for r in stock_news_rows if r.get("domain_trust") == "trusted")
    trusted_industry = sum(1 for r in industry_news_rows if r.get("domain_trust") == "trusted")
    fallback_count = sum(1 for r in stock_news_rows if r.get("domain_trust") == "unrated")
    trusted_macro = sum(1 for r in macro_news_rows if r.get("domain_trust") == "trusted")

    # Compute sentiment polarity strength for better threshold
    abs_stock_sent = abs(stock_avg_sent)
    abs_industry_sent = abs(industry_avg_sent)
    sentiment_strength = max(abs_stock_sent, abs_industry_sent, abs(avg_sent))

    decision_instruction = (
        "Infer directional news bias for the stock from three streams: company-specific, industry/sector thematic, and global macro. "
        "Penalize if evidence comes from low-trust sources or contradictory headlines. "
        "Consider recency: very recent news (< 24h) should dominate older articles. "
        "Be decisive: return BUY or SELL when the evidence has a moderate edge; use NO_TRADE only if conflict is truly balanced."
    )
    signal, conf, llm_decision_why = llm_first_signal_decision(
        agent_name="News Agent",
        instruction=decision_instruction,
        evidence={
            "company_context": company_ctx,
            "stock_stats": {
                "count": len(stock_news_rows),
                "trusted": trusted_count,
                "unrated": fallback_count,
                "avg_sent": stock_avg_sent,
                "sentiment_strength": abs_stock_sent,
            },
            "industry_stats": {
                "count": len(industry_news_rows),
                "trusted": trusted_industry,
                "avg_sent": industry_avg_sent,
            },
            "macro_stats": {
                "count": len(macro_news_rows),
                "trusted": trusted_macro,
                "avg_sent": macro_avg_sent,
            },
            "blended_sentiment": avg_sent,
            "sentiment_strength": sentiment_strength,
            "top_stock_news": top_news[:LLM_PREVIEW_LIMIT],
            "top_industry_news": top_industry_news[:LLM_PREVIEW_LIMIT],
            "top_macro_news": top_macro_news[:LLM_PREVIEW_LIMIT],
        },
        default_signal=("BUY" if avg_sent > 0.20 else ("SELL" if avg_sent < -0.20 else "NO_TRADE")),
        default_confidence=(min(CONFIDENCE_BOUNDS["max"], CONFIDENCE_BOUNDS["trade_min"] + min(0.28, abs(avg_sent) * 0.42)) if abs(avg_sent) > 0.20 else max(CONFIDENCE_BOUNDS["neutral_min"], 0.48)),
        default_reasoning="Deterministic blended sentiment fallback",
    )

    summary = (
        f"News Signal: {signal} | combined sentiment={avg_sent:.2f} (stock={stock_avg_sent:.2f}, industry={industry_avg_sent:.2f}, macro={macro_avg_sent:.2f}). "
        f"Stock articles={len(stock_news_rows)} (trusted={trusted_count}, unrated={fallback_count}); "
        f"Industry articles={len(industry_news_rows)} (trusted={trusted_industry}); "
        f"Macro articles={len(macro_news_rows)} (trusted={trusted_macro}). "
        f"Sentiment strength={sentiment_strength:.2f}. "
        f"Inference={llm_decision_why}."
    )

    prompt_style_reasoning = (
        "News reasoning protocol:\n"
        "1) Collect company-specific headlines across multiple providers using diversified queries.\n"
        "2) Filter spam/listicle/noise domains and low-relevance stories.\n"
        "3) Build a global macro stream (rates, inflation, oil, USD, broad risk sentiment).\n"
        "4) Build industry/sector thematic stream (demand cycle, market share, regulation, capacity, pricing).\n"
        "5) Weight sentiment by source quality, exponential recency decay, and relevance confidence.\n"
        "6) Apply content-similarity dedup to remove near-duplicate headlines.\n"
        "7) Use LLM to infer final bias from company + industry + macro evidence and return NO_TRADE under conflict."
    )

    detail = {
        "company_context": company_ctx,
        "stock_article_count": len(stock_news_rows),
        "industry_article_count": len(industry_news_rows),
        "macro_article_count": len(macro_news_rows),
        "trusted_count": trusted_count,
        "trusted_industry_count": trusted_industry,
        "unrated_count": fallback_count,
        "trusted_macro_count": trusted_macro,
        "industry_avg_sentiment": industry_avg_sent,
        "sentiment_strength": sentiment_strength,
        "llm_decision_why": llm_decision_why,
    }
    llm_reasoning = generate_agent_reasoning(
        agent_name="News Agent",
        deterministic_summary=summary,
        instruction=prompt_style_reasoning,
        evidence={
            "signal": signal,
            "confidence": conf,
            "avg_sentiment": avg_sent,
            "stock_avg_sentiment": stock_avg_sent,
            "industry_avg_sentiment": industry_avg_sent,
            "macro_avg_sentiment": macro_avg_sent,
            "sentiment_strength": sentiment_strength,
            "detail": detail,
            "top_news": top_news[:LLM_REASONING_PREVIEW_LIMIT],
            "top_industry_news": top_industry_news[:LLM_REASONING_PREVIEW_LIMIT],
            "top_macro_news": top_macro_news[:LLM_PREVIEW_LIMIT],
        },
    )

    return {
        "signal": signal,
        "confidence": conf,
        "summary": summary,
        "reasoning_prompt": prompt_style_reasoning,
        "llm_reasoning": llm_reasoning,
        "detail": detail,
        "top_news": top_news,
        "top_industry_news": top_industry_news,
        "top_macro_news": top_macro_news,
        "avg_sentiment": avg_sent,
        "macro_sentiment": macro_avg_sent,
    }
