from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use('Agg')  # Set backend BEFORE importing pyplot to avoid threading issues
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.ticker import FuncFormatter
import numpy as np
import pandas as pd
from matplotlib.patches import Rectangle

from agents.confluence_agent import combine_signals
from agents.catalyst_context_agent import analyze_catalyst_context
from agents.financials_agent import analyze_financials
from agents.llm_reasoner import generate_batched_reasoning
from agents.llm_reasoner import llm_first_signal_decision
from agents.llm_usage import get_llm_usage_summary, reset_llm_usage
from agents.market_setup_agent import analyze_market_setup
from agents.market_sentiment_agent import analyze_market_sentiment
from agents.master_reasoning_agent import generate_master_reasoning
from agents.news_agent import analyze_news
from agents.pattern_agent import analyze_pattern
from agents.relative_strength_agent import analyze_relative_strength
from agents.risk_agent import analyze_risk
from agents.technical_agent import analyze_technical
from agents.trader_agent import analyze_trader_intel
from agents.trend_agent import analyze_trend
from agents.us_trend_agent import analyze_us_trend
from config import DEFAULT_FORECAST_BARS
from data_providers import fetch_india_market_context, fetch_ohlc, fetch_us_market_context
from utils import build_window, india_market_data_end_now, normalize_india_symbol


class IndiaSwingPipeline:
    def __init__(self, reports_dir: str = "reports"):
        self.reports_dir = Path(reports_dir)
        self.reports_dir.mkdir(parents=True, exist_ok=True)

    def _json_safe(self, obj: Any) -> Any:
        """Convert pandas/numpy/native objects into JSON-serializable Python values."""
        if obj is None or isinstance(obj, (str, int, float, bool)):
            return obj

        if isinstance(obj, (datetime, date, pd.Timestamp)):
            return obj.isoformat()

        if isinstance(obj, Path):
            return str(obj)

        if isinstance(obj, np.generic):
            return obj.item()

        if isinstance(obj, np.ndarray):
            return [self._json_safe(x) for x in obj.tolist()]

        if isinstance(obj, dict):
            return {str(k): self._json_safe(v) for k, v in obj.items()}

        if isinstance(obj, (list, tuple, set)):
            return [self._json_safe(x) for x in obj]

        # Fall back to string for other unknown objects (including pandas NA-like values).
        try:
            if pd.isna(obj):
                return None
        except Exception:
            pass

        return str(obj)

    def _generate_chart(self, symbol: str, df, report_id: str) -> str:
        if df.empty:
            return ""

        chart_df = df.copy()
        chart_df["Datetime"] = mdates.date2num(chart_df["Datetime"])
        opens = chart_df["Open"].astype(float).values
        highs = chart_df["High"].astype(float).values
        lows = chart_df["Low"].astype(float).values
        closes = chart_df["Close"].astype(float).values
        x_idx = np.arange(len(chart_df))

        support_coef = np.polyfit(x_idx, lows, 1)
        resist_coef = np.polyfit(x_idx, highs, 1)
        support = support_coef[0] * x_idx + support_coef[1]
        resistance = resist_coef[0] * x_idx + resist_coef[1]

        fig, ax = plt.subplots(figsize=(11, 4.8))

        candle_width = max(0.18, min(0.6, 12.0 / max(20.0, len(chart_df))))
        for dt_num, open_price, high_price, low_price, close_price in zip(
            chart_df["Datetime"].values,
            opens,
            highs,
            lows,
            closes,
        ):
            color = "#0f9d58" if close_price >= open_price else "#db4437"
            ax.vlines(dt_num, low_price, high_price, color=color, linewidth=1.0, alpha=0.9)
            body_low = min(open_price, close_price)
            body_height = max(abs(close_price - open_price), 0.01)
            rect = Rectangle(
                (dt_num - candle_width / 2, body_low),
                candle_width,
                body_height,
                facecolor=color,
                edgecolor=color,
                alpha=0.85,
            )
            ax.add_patch(rect)

        ax.plot(chart_df["Datetime"], support, label="Support Trend", color="#0f9d58", linestyle="--", linewidth=1.1)
        ax.plot(chart_df["Datetime"], resistance, label="Resistance Trend", color="#db4437", linestyle="--", linewidth=1.1)

        last_dt = chart_df["Datetime"].iloc[-1]
        last_open = opens[-1]
        last_high = highs[-1]
        last_low = lows[-1]
        last_close = closes[-1]
        ax.annotate(
            f"O:{last_open:.2f} H:{last_high:.2f} L:{last_low:.2f} C:{last_close:.2f}",
            xy=(last_dt, last_close),
            xytext=(10, 10),
            textcoords="offset points",
            fontsize=8,
            bbox={"boxstyle": "round,pad=0.25", "fc": "white", "ec": "#cccccc", "alpha": 0.9},
        )

        plt.title(f"{symbol} Swing Trend Snapshot")
        ax.set_xlabel("Datetime")
        ax.set_ylabel("Price")
        ax.grid(alpha=0.25)
        ax.legend()
        ax.xaxis_date()
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m-%d"))
        fig.autofmt_xdate()
        plt.tight_layout()

        out_path = self.reports_dir / f"{report_id}_trend.png"
        plt.savefig(out_path, dpi=140)
        plt.close()
        return str(out_path)

    def _generate_long_term_chart(self, symbol: str, long_term_df, report_id: str) -> str:
        """Generate a large 5-7 year price chart with 200DMA and volume."""
        if long_term_df is None or (hasattr(long_term_df, 'empty') and long_term_df.empty):
            return ""
        try:
            df = long_term_df.copy()
            if "Datetime" in df.columns:
                df["Datetime"] = pd.to_datetime(df["Datetime"], errors="coerce")
                df = df.dropna(subset=["Datetime"]).sort_values("Datetime")
            else:
                return ""

            close = pd.to_numeric(df["Close"], errors="coerce")
            open_px = pd.to_numeric(df.get("Open"), errors="coerce")
            if open_px is None:
                open_px = close.copy()
            valid_px = close.notna() & open_px.notna() & (close > 0)
            df = df.loc[valid_px].copy()
            if df.empty:
                return ""
            close = close.loc[valid_px]
            open_px = open_px.loc[valid_px]
            dates = df["Datetime"]

            fig, (ax1, ax2) = plt.subplots(
                2, 1, figsize=(14, 7), gridspec_kw={"height_ratios": [4, 1]}, sharex=True
            )

            # Price line
            ax1.plot(dates, close, color="#1a73e8", linewidth=1.2, label="Close")

            # SMA 50 and SMA 200
            if len(close) >= 50:
                sma50 = close.rolling(50).mean()
                ax1.plot(dates, sma50, color="#f9ab00", linewidth=0.9, linestyle="-", alpha=0.8, label="50 DMA")
            if len(close) >= 200:
                sma200 = close.rolling(200).mean()
                ax1.plot(dates, sma200, color="#e53935", linewidth=0.9, linestyle="--", alpha=0.8, label="200 DMA")

            # Shade bullish/bearish zones between SMA50 and SMA200
            if len(close) >= 200:
                ax1.fill_between(
                    dates, sma50, sma200,
                    where=(sma50 > sma200),
                    color="#0f9d58", alpha=0.08, label="Bullish Zone"
                )
                ax1.fill_between(
                    dates, sma50, sma200,
                    where=(sma50 <= sma200),
                    color="#db4437", alpha=0.08, label="Bearish Zone"
                )

            # Annotate current price
            last_close = float(close.iloc[-1])
            last_date = dates.iloc[-1]
            ax1.annotate(
                f"₹{last_close:,.2f}",
                xy=(last_date, last_close),
                xytext=(10, 10),
                textcoords="offset points",
                fontsize=9, fontweight="bold",
                bbox={"boxstyle": "round,pad=0.3", "fc": "white", "ec": "#1a73e8", "alpha": 0.9},
            )

            ax1.set_title(f"{symbol} — Long-Term Price Trend (5-7 Year)", fontsize=13, fontweight="bold")
            ax1.set_ylabel("Price (₹)", fontsize=10)

            # Keep y-axis readable and robust against single bad spikes in vendor history.
            p01 = float(close.quantile(0.01))
            p99 = float(close.quantile(0.99))
            if np.isfinite(p01) and np.isfinite(p99) and p99 > p01:
                pad = max((p99 - p01) * 0.08, 1e-6)
                ax1.set_ylim(max(0.0, p01 - pad), p99 + pad)

            ax1.ticklabel_format(axis="y", style="plain", useOffset=False)
            ax1.yaxis.set_major_formatter(
                FuncFormatter(lambda y, _: f"₹{y:,.0f}" if abs(y) >= 100 else f"₹{y:,.2f}")
            )
            ax1.legend(loc="upper left", fontsize=8, framealpha=0.9)
            ax1.grid(alpha=0.2)

            # Volume bars
            if "Volume" in df.columns:
                volume = pd.to_numeric(df["Volume"], errors="coerce").fillna(0)
                colors = ["#0f9d58" if c >= o else "#db4437"
                          for c, o in zip(close.astype(float), open_px.astype(float))]
                ax2.bar(dates, volume, color=colors, alpha=0.5, width=max(1.0, len(df) / 800.0))
                ax2.set_ylabel("Volume", fontsize=9)
                ax2.grid(alpha=0.15)

            ax1.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
            fig.autofmt_xdate()
            plt.tight_layout()

            out_path = self.reports_dir / f"{report_id}_long_term.png"
            plt.savefig(out_path, dpi=140)
            plt.close()
            return str(out_path)
        except Exception:
            return ""

    def _save_report(self, report_id: str, payload: dict[str, Any]) -> dict[str, str]:
        json_path = self.reports_dir / f"{report_id}.json"
        md_path = self.reports_dir / f"{report_id}.md"

        safe_payload = self._json_safe(payload)
        json_path.write_text(json.dumps(safe_payload, indent=2, ensure_ascii=False), encoding="utf-8")

        lines = [
            f"# {payload.get('symbol')} Swing Report",
            "",
            f"- Timeframe: {payload.get('timeframe')}",
            f"- End Timestamp: {payload.get('end_timestamp')}",
            f"- Final Signal: {payload.get('final_signal')}",
            f"- Confidence: {payload.get('confidence')}",
            "",
            "## Highlights",
            payload.get("rich_report", ""),
        ]
        md_path.write_text("\n".join(lines), encoding="utf-8")

        return {"json": str(json_path), "markdown": str(md_path)}

    def _build_final_conclusion(
        self,
        timeframe: str,
        confluence: dict[str, Any],
        risk: dict[str, Any],
        trend: dict[str, Any],
        technical: dict[str, Any] | None = None,
        financials: dict[str, Any] | None = None,
        trader_intel: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        signal = (trader_intel or {}).get("signal") or confluence.get("signal", "NO_TRADE")
        confidence = float((trader_intel or {}).get("confidence", confluence.get("confidence", 0.5)))
        trend_setup = (trend.get("detail", {}) or {}).get("setup", "trend context unavailable")
        trader_title = (trader_intel or {}).get("playbook_title")
        trader_thesis = (trader_intel or {}).get("thesis")
        trader_execution = (trader_intel or {}).get("execution_style")
        trader_risk_flag = (trader_intel or {}).get("risk_flag")
        trader_invalidation = (trader_intel or {}).get("invalidation")

        hold_map = {
            "1h": "2-4 trading days",
            "4h": "4-10 trading days",
            "1d": "2-6 weeks",
        }
        expected_holding_duration = hold_map.get(timeframe, "1-3 weeks")

        # Pull price levels from technical agent
        price_levels = (technical or {}).get("price_levels", {})
        r1 = price_levels.get("resistance_1")
        r2 = price_levels.get("resistance_2")
        r3 = price_levels.get("resistance_3")
        support = price_levels.get("support")
        breakdown = price_levels.get("breakdown_zone")

        # Pull analyst/52w data from financials
        price_52w = (financials or {}).get("price_52w", {})
        low_52w = price_52w.get("low")
        high_52w = price_52w.get("high")
        analyst_data = (financials or {}).get("analyst_consensus", {})
        analyst_target = analyst_data.get("target_price")
        analyst_upside_pct = analyst_data.get("implied_upside_pct")
        n_analysts = analyst_data.get("n_analysts")

        # ATR-based values from risk agent as fallback
        atr_stop = risk.get("stop_loss")
        atr_target = risk.get("target")

        def _fmt_price(p: float | None) -> str:
            return f"₹{p:.2f}" if p is not None else "N/A"

        # Build price-specific entry trigger and stop/targets
        if signal == "BUY":
            # Stop: below nearest support or 52w-low (more protective)
            if support and low_52w:
                stop = min(support, low_52w) * 0.99  # 1% buffer below
            elif support:
                stop = support * 0.99
            elif low_52w:
                stop = low_52w * 0.99
            else:
                stop = atr_stop

            # Targets: resistance levels or analyst target
            targets = [x for x in [r1, r2, r3] if x is not None]
            if analyst_target and analyst_target not in targets:
                targets.append(analyst_target)
            targets = targets[:3]

            if r1:
                entry_trigger = (
                    f"Wait for confirmed close above {_fmt_price(r1)} with above-average volume, "
                    f"or buy on a pullback to {_fmt_price(support or atr_stop)}."
                )
            else:
                entry_trigger = "Buy on pullback near support or on high-volume breakout above recent resistance."
            action_bias = "Actionable long setup"

        elif signal == "SELL":
            # Stop: above nearest resistance
            stop_sell = r1 * 1.01 if r1 else atr_stop

            # Targets: support levels below current price
            targets = [x for x in [support, breakdown] if x is not None][:2]

            if support:
                entry_trigger = (
                    f"Sell/short on failed bounce near {_fmt_price(r1 or atr_stop)}. "
                    f"Confirmed breakdown below {_fmt_price(support)} activates short targets."
                )
            else:
                entry_trigger = "Sell/short on failed bounce near resistance or decisive breakdown below support."
            stop = stop_sell
            action_bias = "Actionable short setup"

        else:  # NO_TRADE
            stop = None
            targets = []
            # Point to watch: if trend leans bearish, give entry conditions for both scenarios
            if r1 and support:
                entry_trigger = (
                    f"No trade now. Watch: bullish entry trigger = daily close above {_fmt_price(r1)} with rising volume "
                    f"(targets: {' → '.join(_fmt_price(t) for t in [r1, r2, r3] if t is not None)}). "
                    f"Stop if entering: {_fmt_price(low_52w or support)} (below {('52-week low' if low_52w else 'nearest support')})."
                )
            else:
                entry_trigger = "Do not enter now; wait for stronger confluence and clearer trend alignment."
            action_bias = "Wait / no-trade setup"

        if trader_intel and trader_intel.get("entry_trigger"):
            entry_trigger = str(trader_intel.get("entry_trigger"))

        # Build narrative
        target_str = " → ".join(_fmt_price(t) for t in targets) if targets else _fmt_price(atr_target)
        analyst_str = (
            f" | Analyst consensus: {n_analysts} analysts targeting {_fmt_price(analyst_target)} ({analyst_upside_pct:+.1f}%)"
            if analyst_target and analyst_upside_pct is not None
            else ""
        )

        narrative = (
            f"**FINAL CONCLUSION**\n"
            f"- Signal: {signal}\n"
            f"- Confidence: {confidence:.3f}\n"
            f"- Action Bias: {action_bias}\n"
            f"- Playbook: {trader_title or 'N/A'}\n"
            f"- Thesis: {trader_thesis or 'N/A'}\n"
            f"- When to Act: {entry_trigger}\n"
            f"- Execution Style: {trader_execution or 'N/A'}\n"
            f"- Invalidation: {trader_invalidation or 'N/A'}\n"
            f"- Expected Holding Duration: {expected_holding_duration}\n"
            f"- Context: {trend_setup}\n"
            f"- Risk Flag: {trader_risk_flag or 'N/A'}\n"
            f"- Stop-loss: {_fmt_price(stop)}\n"
            f"- Targets: {target_str}\n"
            f"- 52w Range: {_fmt_price(low_52w)} – {_fmt_price(high_52w)}{analyst_str}"
        )

        current_px = ((technical or {}).get("metrics") or {}).get("close")
        rr_note = "N/A"
        if signal in {"BUY", "SELL"} and isinstance(current_px, (float, int)) and isinstance(stop, float) and targets:
            first_target = float(targets[0])
            risk_per_share = abs(float(current_px) - float(stop))
            reward_per_share = abs(first_target - float(current_px))
            if risk_per_share > 1e-9:
                rr_note = f"{reward_per_share / risk_per_share:.2f}:1"

        teaching_note = (
            "Teaching note: prioritize process over prediction. Enter only after trigger confirmation, "
            "size by invalidation distance, and review whether the thesis is invalidated before averaging or adding."
        )
        narrative += (
            f"\n- Current Price Context: {_fmt_price(float(current_px)) if isinstance(current_px, (float, int)) else 'N/A'}"
            f"\n- Approx Risk:Reward to first target: {rr_note}"
            f"\n- {teaching_note}"
        )

        if signal == "BUY":
            simple_explanation = (
                "Simple view: Trend + setup are supportive, so this is a BUY idea only after confirmation. "
                "Do not enter early. Wait for trigger, keep stop fixed, and exit if invalidation happens."
            )
        elif signal == "SELL":
            simple_explanation = (
                "Simple view: Price structure is weak, so this is a SELL/AVOID idea unless strength returns. "
                "If taking a short setup, act only on trigger and exit quickly if resistance is reclaimed."
            )
        else:
            simple_explanation = (
                "Simple view: Signals are mixed, so capital protection is the priority. "
                "Wait for clear breakout or breakdown before taking a new position."
            )

        confidence_bucket = "High" if confidence >= 0.72 else ("Medium" if confidence >= 0.56 else "Low")
        first_target = (targets[0] if targets else atr_target)
        simple_entry = "Wait for a clear breakout/breakdown confirmation."
        if signal == "BUY":
            if isinstance(r1, (float, int)):
                simple_entry = f"Buy only after daily close above {_fmt_price(float(r1))}."
            elif isinstance(support, (float, int)):
                simple_entry = f"Buy near support around {_fmt_price(float(support))} only if price holds."
        elif signal == "SELL":
            if isinstance(support, (float, int)):
                simple_entry = f"Sell/avoid if daily close breaks below {_fmt_price(float(support))}."
            elif isinstance(r1, (float, int)):
                simple_entry = f"Sell on failed bounce near {_fmt_price(float(r1))}."
        else:
            if isinstance(r1, (float, int)) and isinstance(support, (float, int)):
                simple_entry = (
                    f"Wait. Buy trigger above {_fmt_price(float(r1))}; "
                    f"avoid if price falls below {_fmt_price(float(support))}."
                )

        # Build conditional levels for NO_TRADE watchlist cases to avoid N/A guidance.
        conditional_stop = None
        conditional_target = None
        if signal == "NO_TRADE":
            if isinstance(support, (float, int)):
                conditional_stop = float(support) * 0.99
            elif isinstance(low_52w, (float, int)):
                conditional_stop = float(low_52w) * 0.99

            if isinstance(r2, (float, int)):
                conditional_target = float(r2)
            elif isinstance(r1, (float, int)):
                conditional_target = float(r1) * 1.02
            elif isinstance(analyst_target, (float, int)):
                conditional_target = float(analyst_target)

        plan_stop_text = _fmt_price(stop)
        plan_target_text = (_fmt_price(targets[0]) if targets else _fmt_price(atr_target))
        if signal == "NO_TRADE":
            plan_stop_text = (
                f"{_fmt_price(conditional_stop)} (only after buy trigger confirms)"
                if isinstance(conditional_stop, (float, int))
                else "After trigger: keep stop about 1 ATR below entry."
            )
            plan_target_text = (
                f"{_fmt_price(conditional_target)} (only after buy trigger confirms)"
                if isinstance(conditional_target, (float, int))
                else "After trigger: keep first target at least 2x your risk."
            )

        simple_summary = (
            f"{signal}: {simple_explanation} Confidence is {confidence_bucket}. "
            f"Entry rule: {simple_entry}"
        )

        if signal == "NO_TRADE":
            normal_person_plan = [
                "What to do now: Wait, no trade now.",
                f"Entry: {simple_entry}",
                "Before market opens: set price alerts on trigger and invalidation levels.",
                f"Stop-loss plan: {plan_stop_text}",
                f"First target plan: {plan_target_text}",
                "Position sizing: risk only a small amount (around 1% of trading capital).",
                "If stop-loss is hit after entry, exit immediately. Do not average down.",
            ]
        else:
            normal_person_plan = [
                f"What to do now: {('Look for buy setup' if signal == 'BUY' else 'Stay cautious / avoid or short setup')}.",
                f"Entry: {simple_entry}",
                f"Stop-loss: {plan_stop_text}",
                f"First target: {plan_target_text}",
                "Position sizing: risk only a small amount (around 1% of trading capital).",
                "If stop-loss is hit, exit immediately. Do not average down.",
            ]

        beginner_plan = [
            f"Step 1: Direction = {signal}.",
            f"Step 2: Entry trigger = {entry_trigger}",
            f"Step 3: Stop-loss = {plan_stop_text}",
            f"Step 4: First target = {plan_target_text}",
            "Step 5: If trigger fails or invalidation happens, exit and wait.",
        ]

        return {
            "signal": signal,
            "confidence": round(confidence, 3),
            "when_to_buy": entry_trigger,
            "expected_holding_duration": expected_holding_duration,
            "stop_loss": round(stop, 2) if isinstance(stop, float) else stop,
            "targets": [round(t, 2) for t in targets] if targets else ([round(atr_target, 2)] if atr_target else []),
            "target": round(targets[0], 2) if targets else (round(atr_target, 2) if atr_target else None),
            "analyst_consensus": analyst_data,
            "price_52w": price_52w,
            "key_price_levels": (price_levels.get("levels") or []),
            "playbook_title": trader_title,
            "thesis": trader_thesis,
            "execution_style": trader_execution,
            "risk_flag": trader_risk_flag,
            "invalidation": trader_invalidation,
            "simple_summary": simple_summary,
            "simple_explanation": simple_explanation,
            "beginner_plan": beginner_plan,
            "normal_person_plan": normal_person_plan,
            "summary": narrative,
        }

    def _build_long_term_outlook(
        self,
        symbol: str,
        history_df: pd.DataFrame,
        news: dict[str, Any],
        financials: dict[str, Any],
        market_sentiment: dict[str, Any],
        us_trend: dict[str, Any],
        sector_name: str = "Unknown",
    ) -> dict[str, Any]:
        if history_df is None or history_df.empty:
            history_df = np.nan

        if isinstance(history_df, float):
            close = None
            dt_series = None
            history_days = 0
        else:
            work = history_df.copy()
            if "Datetime" in work.columns:
                work = work.sort_values("Datetime")
                dt_series = pd.to_datetime(work["Datetime"], errors="coerce")
            else:
                dt_series = None
            close = pd.to_numeric(work.get("Close"), errors="coerce")
            if close is not None:
                valid = close.notna()
                close = close[valid]
                if dt_series is not None:
                    dt_series = dt_series[valid]
            history_days = int(len(close) if close is not None else 0)

        def _ret_pct(days: int) -> float | None:
            if close is None or close.empty:
                return None
            # Require sufficient history for the stated horizon to avoid misleading labels.
            min_required = max(40, int(days * 0.70))
            if len(close) <= min_required:
                return None
            end_p = float(close.iloc[-1])
            idx = max(0, len(close) - 1 - days)
            start_p = float(close.iloc[idx])
            if start_p <= 0:
                return None
            return float((end_p / start_p - 1.0) * 100.0)

        def _cagr_from_days(days: int) -> float | None:
            if close is None or close.empty or len(close) < 2:
                return None
            min_required = max(60, int(days * 0.70))
            if len(close) <= min_required:
                return None
            idx = max(0, len(close) - 1 - days)
            start_p = float(close.iloc[idx])
            end_p = float(close.iloc[-1])
            effective_days = len(close) - 1 - idx
            if start_p <= 0 or end_p <= 0 or effective_days <= 0:
                return None
            years = max(0.15, effective_days / 252.0)
            return float(((end_p / start_p) ** (1.0 / years) - 1.0) * 100.0)

        sma_200 = close.rolling(200).mean() if close is not None else None
        price_vs_sma200 = None
        if close is not None and sma_200 is not None and not sma_200.dropna().empty:
            sma_last = float(sma_200.iloc[-1])
            if abs(sma_last) > 1e-9:
                price_vs_sma200 = float((float(close.iloc[-1]) / sma_last - 1.0) * 100.0)

        annualized_vol = None
        max_drawdown_5y = None
        if close is not None and len(close) > 30:
            rets = close.pct_change().dropna()
            if not rets.empty:
                annualized_vol = float(rets.std() * np.sqrt(252) * 100.0)
            roll_max = close.cummax()
            dd = (close / roll_max - 1.0) * 100.0
            if not dd.empty:
                max_drawdown_5y = float(dd.min())

        ret_1y = _ret_pct(252)
        ret_3y = _ret_pct(252 * 3)
        ret_5y = _ret_pct(252 * 5)
        ret_10y = _ret_pct(252 * 10)

        cagr_3y = _cagr_from_days(252 * 3)
        cagr_5y = _cagr_from_days(252 * 5)
        cagr_10y = _cagr_from_days(252 * 10)

        avg_sent = float(news.get("avg_sentiment", 0.0) or 0.0)
        stock_news_items = (news.get("top_news", []) or [])
        industry_news_items = (news.get("top_industry_news", []) or [])
        macro_news_items = (news.get("top_macro_news", []) or [])
        stock_news = int(len(stock_news_items))
        industry_news = int(len(industry_news_items))
        macro_news = int(len(macro_news_items))

        news_detail = news.get("detail", {}) or {}
        stock_avg_sent = news_detail.get("stock_avg_sentiment")
        industry_avg_sent = news_detail.get("industry_avg_sentiment")
        macro_avg_sent = news.get("macro_sentiment")

        stock_headlines = [str((x or {}).get("title", "")).strip() for x in stock_news_items[:5] if str((x or {}).get("title", "")).strip()]
        industry_headlines = [str((x or {}).get("title", "")).strip() for x in industry_news_items[:5] if str((x or {}).get("title", "")).strip()]
        macro_headlines = [str((x or {}).get("title", "")).strip() for x in macro_news_items[:5] if str((x or {}).get("title", "")).strip()]

        combined_news_preview = stock_headlines[:3] + industry_headlines[:3] + macro_headlines[:3]

        price_52w = financials.get("price_52w", {}) or {}
        analyst = financials.get("analyst_consensus", {}) or {}
        position_52w = price_52w.get("position_pct")
        one_year_change = price_52w.get("change_1y_pct")
        analyst_upside = analyst.get("implied_upside_pct")
        n_analysts = analyst.get("n_analysts")

        # Backfill key long-term context from price history when fundamentals API is sparse.
        if (position_52w is None or one_year_change is None) and close is not None and not close.empty:
            c_now = float(close.iloc[-1])
            # Only infer 52-week metrics when we have enough daily history.
            tail_52w = close.tail(252)
            if len(tail_52w) >= 200:
                hi_52w = float(tail_52w.max())
                lo_52w = float(tail_52w.min())
                if position_52w is None and hi_52w > lo_52w:
                    position_52w = ((c_now - lo_52w) / (hi_52w - lo_52w)) * 100.0
                if one_year_change is None:
                    if len(close) > 252:
                        one_year_change = ((c_now / float(close.iloc[-253])) - 1.0) * 100.0

        us_signal = (us_trend.get("signal") or "NO_TRADE").upper()
        india_signal = (market_sentiment.get("signal") or "NO_TRADE").upper()

        coverage_ratio = min(1.0, history_days / 756.0) if history_days > 0 else 0.0
        sparse_long_term = history_days < 160
        fundamentals_sparse = (analyst_upside is None and position_52w is None and one_year_change is None)

        # --- Extract quarterly financial trend factors ---
        fin_detail = financials.get("detail", {}) or {}
        statement_trends = fin_detail.get("statement_trends", {}) or {}
        rev_qoq = statement_trends.get("rev_qoq")
        ni_qoq = statement_trends.get("ni_qoq")
        ocf_qoq = statement_trends.get("ocf_qoq")

        # Extended fundamentals — dividend yield, institutional ownership, PEG, margins
        ext_fund = financials.get("extended_fundamentals", {}) or {}
        fin_metrics = financials.get("metrics", {}) or {}
        
        # Merge metrics and extended fundamentals for logger-clean lookup
        f_combined = {**ext_fund, **fin_metrics}
        
        dividend_yield = f_combined.get("dividend_yield")
        peg_ratio = f_combined.get("peg_ratio")
        operating_margins = f_combined.get("operating_margins")
        held_pct_institutions = f_combined.get("held_pct_institutions")

        # Promoter/institutional context
        promoter_data = financials.get("promoter_institutional", {}) or {}
        major_holders = promoter_data.get("major_holders", {}) or {}
        institutions_pct = major_holders.get("institutions_pct")

        # Dividend/splits data
        div_split_data = financials.get("dividends_splits", {}) or {}
        dividend_yield_trend = div_split_data.get("dividend_yield_trend")
        total_dividends_1y = div_split_data.get("total_dividends_1y", 0.0)

        # Sector/industry name for LLM context
        fin_metrics = financials.get("metrics", {}) or {}
        sector_name = fin_metrics.get("sector") or fin_metrics.get("industry") or "Unknown"

        # --- Scoring factors ---
        # Weights remain to indicate importance, but internal scaling is minimized
        factors: list[tuple[str, float, float]] = []  # (name, normalized_value, weight)

        # News sentiment
        factors.append(("news_sentiment", float(avg_sent or 0), 1.0))

        # 1Y return
        if isinstance(ret_1y, (float, int)):
            factors.append(("return_1y", float(ret_1y) / 100.0, 0.9))
        # 3Y return
        if isinstance(ret_3y, (float, int)):
            factors.append(("return_3y", float(ret_3y) / 100.0, 0.8))
        # 5Y return
        if isinstance(ret_5y, (float, int)):
            factors.append(("return_5y", float(ret_5y) / 100.0, 0.7))
        # CAGR 5Y
        if isinstance(cagr_5y, (float, int)):
            factors.append(("cagr_5y", float(cagr_5y) / 10.0, 0.9))
        # Price vs SMA200
        if isinstance(price_vs_sma200, (float, int)):
            factors.append(("sma200_position", float(price_vs_sma200) / 10.0, 0.5))
        # Max drawdown (negative signal)
        if isinstance(max_drawdown_5y, (float, int)):
            factors.append(("max_drawdown", float(max_drawdown_5y) / 100.0, 0.5))
        # Volatility (negative signal if high)
        if isinstance(annualized_vol, (float, int)):
            factors.append(("volatility", -float(annualized_vol) / 100.0, 0.4))
        # Analyst upside
        if isinstance(analyst_upside, (float, int)):
            factors.append(("analyst_upside", float(analyst_upside) / 100.0, 0.9))
        # 52-week position
        if isinstance(position_52w, (float, int)):
            factors.append(("52w_position", (float(position_52w) - 50.0) / 50.0, 0.3))
        # 1Y price change
        if isinstance(one_year_change, (float, int)):
            factors.append(("1y_change", float(one_year_change) / 100.0, 0.7))

        if isinstance(rev_qoq, (float, int)):
            factors.append(("rev_qoq", float(rev_qoq) / 100.0, 1.1))
        if isinstance(ni_qoq, (float, int)):
            factors.append(("ni_qoq", float(ni_qoq) / 100.0, 1.2))
        if isinstance(ocf_qoq, (float, int)):
            factors.append(("ocf_qoq", float(ocf_qoq) / 100.0, 1.0))

        if isinstance(dividend_yield, (float, int)):
            factors.append(("dividend_yield", float(dividend_yield) * 10.0, 0.4))

        # Extremely long-term secular growth (10Y CAGR)
        if isinstance(cagr_10y, (float, int)):
            factors.append(("cagr_10y", float(cagr_10y) / 10.0, 1.0))

        if isinstance(peg_ratio, (float, int)):
            factors.append(("peg_ratio", (2.0 - float(peg_ratio)) / 2.0, 0.5))

        if isinstance(operating_margins, (float, int)):
            factors.append(("operating_margins", float(operating_margins), 0.9))

        # Additional fundamentals to strengthen long-term financial weighting.
        roe = f_combined.get("return_on_equity")
        debt_to_equity = f_combined.get("debt_to_equity")
        trailing_pe = f_combined.get("trailing_pe")
        price_to_book = f_combined.get("price_to_book")
        gross_margins = f_combined.get("gross_margins")

        if isinstance(roe, (float, int)):
            factors.append(("roe", float(roe), 1.0))
        if isinstance(gross_margins, (float, int)):
            factors.append(("gross_margins", float(gross_margins), 0.7))
        if isinstance(debt_to_equity, (float, int)):
            factors.append(("debt_to_equity", -float(debt_to_equity) / 2.0, 0.9))
        if isinstance(trailing_pe, (float, int)) and trailing_pe > 0:
            factors.append(("trailing_pe", min(1.5, 20.0 / float(trailing_pe)) - 1.0, 0.5))
        if isinstance(price_to_book, (float, int)) and price_to_book > 0:
            factors.append(("price_to_book", min(1.5, 2.5 / float(price_to_book)) - 1.0, 0.5))

        # Macro overlay
        macro_weight = 0.35
        if us_signal == "BUY":
            factors.append(("us_macro", 1.0, macro_weight))
        elif us_signal == "SELL":
            factors.append(("us_macro", -1.0, macro_weight))
        if india_signal == "BUY":
            factors.append(("india_macro", 1.0, macro_weight))
        elif india_signal == "SELL":
            factors.append(("india_macro", -1.0, macro_weight))

        # Compute weighted score
        if factors:
            total_weight = sum(w for _, _, w in factors)
            raw_score = sum(v * w for _, v, w in factors)
            score = raw_score / max(total_weight, 1.0)
        else:
            score = 0.0

        # Dynamic stance based on score
        stance = "LONG_TERM_BULLISH" if score > 0.2 else ("LONG_TERM_BEARISH" if score < -0.2 else "LONG_TERM_NEUTRAL")
        confidence = min(0.92, max(0.44, 0.5 + 0.2 * abs(score)))

        lt_signal, lt_conf, lt_why = llm_first_signal_decision(
            agent_name="Long-Term Outlook Agent",
            instruction=(
                "Evaluate 1Y/3Y/5Y/10Y trend, CAGR, drawdown, volatility, 200DMA structure, analyst framing, and multi-stream news. "
                "Think like a position trader with multi-quarter/multi-year horizon. "
                "Provide a specific '3-5 Year Secular Forecast' segment in your reasoning based on the extremadamente long-term (10Y) data. "
                "Also consider quarterly financial trends (revenue/earnings acceleration vs deceleration), "
                "dividend yield and its trend, institutional ownership levels, PEG valuation, and operating margins. "
                "Be decisive when edge is moderate or better; use NO_TRADE only for truly mixed evidence. "
                "This system is educational, so reasoning must teach: include 1) core drivers, 2) key risks, "
                "3) what evidence would invalidate the secular thesis, and 4) a clear 3-5 year base/bull/bear path in concise language. "
                "Critically: use direct news evidence. Explicitly reference at least 2 company/industry headlines and 1 macro headline from the input, "
                "and explain whether they are transitory noise or durable catalysts. Prefer concrete, evidence-linked conclusions over generic statements."
            ),
            evidence={
                "symbol": symbol,
                "sector": sector_name,
                "returns_pct": {"1y": ret_1y, "3y": ret_3y, "5y": ret_5y},
                "cagr_pct": {"3y": cagr_3y, "5y": cagr_5y},
                "risk_profile": {
                    "max_drawdown_5y_pct": max_drawdown_5y,
                    "annualized_volatility_pct": annualized_vol,
                    "price_vs_sma200_pct": price_vs_sma200,
                },
                "quarterly_trends": {
                    "revenue_qoq_pct": rev_qoq,
                    "net_income_qoq_pct": ni_qoq,
                    "ocf_qoq_pct": ocf_qoq,
                },
                "valuation": {
                    "peg_ratio": peg_ratio,
                    "operating_margins": operating_margins,
                },
                "dividend": {
                    "yield": dividend_yield,
                    "yield_trend": dividend_yield_trend,
                    "total_1y": total_dividends_1y,
                },
                "ownership": {
                    "held_pct_institutions": held_pct_institutions,
                    "major_holders_institutions_pct": institutions_pct,
                },
                "news": {
                    "avg_sentiment": avg_sent,
                    "stock_avg_sentiment": stock_avg_sent,
                    "industry_avg_sentiment": industry_avg_sent,
                    "macro_avg_sentiment": macro_avg_sent,
                    "stock_news_count": stock_news,
                    "industry_news_count": industry_news,
                    "macro_news_count": macro_news,
                    "stock_headlines": stock_headlines,
                    "industry_headlines": industry_headlines,
                    "macro_headlines": macro_headlines,
                },
                "fundamentals": {
                    "analyst_upside_pct": analyst_upside,
                    "position_52w_pct": position_52w,
                    "one_year_change_pct": one_year_change,
                    "analyst_count": n_analysts,
                },
                "macro_overlay": {
                    "india_signal": india_signal,
                    "us_signal": us_signal,
                },
                "quant_score": score,
                "scoring_factors": [(name, round(val, 3), round(wt, 3)) for name, val, wt in factors] if factors else [],
                "history_days": history_days,
            },
            default_signal=("BUY" if stance == "LONG_TERM_BULLISH" else ("SELL" if stance == "LONG_TERM_BEARISH" else "NO_TRADE")),
            default_confidence=confidence,
            default_reasoning="Quant long-term composite fallback",
        )

        if lt_signal == "BUY":
            stance = "LONG_TERM_BULLISH"
        elif lt_signal == "SELL":
            stance = "LONG_TERM_BEARISH"
        else:
            stance = "LONG_TERM_NEUTRAL"
        confidence = min(0.92, max(0.44, float(lt_conf)))

        # Build detailed valuation snapshot
        _v = lambda x, fmt=".2f": f"{x:{fmt}}" if isinstance(x, (float, int)) else "N/A"
        _pct = lambda x: f"{float(x)*100:.1f}%" if isinstance(x, (float, int)) else "N/A"

        # Pull from metrics or ext_fund
        roe = fin_metrics.get("return_on_equity") or ext_fund.get("return_on_equity")
        d_e = fin_metrics.get("debt_to_equity") or ext_fund.get("debt_to_equity")
        p_b = fin_metrics.get("price_to_book") or ext_fund.get("price_to_book")

        valuation_block = (
            f"\n--- VALUATION SNAPSHOT ---\n"
            f"- P/E (trailing): {_v(f_combined.get('trailing_pe'))}\n"
            f"- PEG ratio: {_v(f_combined.get('peg_ratio'))}\n"
            f"- Price/Book: {_v(f_combined.get('price_to_book'))}\n"
            f"- ROE: {_pct(f_combined.get('return_on_equity'))}\n"
            f"- Debt/Equity: {_v(f_combined.get('debt_to_equity'))}\n"
            f"- EV/EBITDA: {_v(f_combined.get('enterprise_to_ebitda'))}\n"
            f"- EV/Revenue: {_v(f_combined.get('enterprise_to_revenue'))}\n"
            f"- Book value per share: {_v(f_combined.get('book_value'))}\n"
            f"- Enterprise value: {_v(f_combined.get('enterprise_value'), ',.0f')}\n"
            f"- Gross margins: {_pct(f_combined.get('gross_margins'))}\n"
            f"- Operating margins: {_pct(f_combined.get('operating_margins'))}\n"
            f"- EBITDA margins: {_pct(f_combined.get('ebitda_margins'))}\n"
            f"- Total revenue: {_v(f_combined.get('total_revenue'), ',.0f')}\n"
            f"- Total debt: {_v(f_combined.get('total_debt'), ',.0f')}\n"
            f"- Total cash: {_v(f_combined.get('total_cash'), ',.0f')}\n"
        )

        # Financial statement trends
        financial_trends_block = (
            f"\n--- QUARTERLY FINANCIAL TRENDS ---\n"
            f"- Revenue QoQ growth: {_pct(rev_qoq)}\n"
            f"- Net income QoQ growth: {_pct(ni_qoq)}\n"
            f"- Operating cash flow QoQ: {_pct(ocf_qoq)}\n"
        )

        # Dividend & ownership block
        div_ownership_block = (
            f"\n--- DIVIDEND & OWNERSHIP ---\n"
            f"- Dividend yield: {_pct(dividend_yield)}\n"
            f"- Dividend yield trend: {dividend_yield_trend or 'N/A'}\n"
            f"- Total dividends (1Y): ₹{total_dividends_1y:.2f}\n"
            f"- Institutional ownership: {_pct(held_pct_institutions)}\n"
            f"- Major holders (institutions): {_v(institutions_pct)}%\n"
        )

        # Factor scoring breakdown
        factor_lines = []
        for name, val, wt in (factors if factors else []):
            direction = "↑" if val > 0.1 else ("↓" if val < -0.1 else "→")
            factor_lines.append(f"  {direction} {name}: score={val:+.2f} × weight={wt:.2f}")
        factor_block = "\n--- SCORING FACTORS ---\n" + "\n".join(factor_lines[:20]) if factor_lines else ""

        def _headline_lines(items: list[str], label: str) -> str:
            if not items:
                return f"- {label}: N/A"
            clipped = items[:3]
            return "\n".join([f"- {label} {i+1}: {h}" for i, h in enumerate(clipped)])

        news_evidence_block = (
            "\n--- DIRECT NEWS EVIDENCE (Top Headlines Used) ---\n"
            + _headline_lines(stock_headlines, "Company")
            + "\n"
            + _headline_lines(industry_headlines, "Industry")
            + "\n"
            + _headline_lines(macro_headlines, "Macro")
        )

        summary = (
            f"LONG-TERM OUTLOOK (Based on News, Financials, and Price Data)\n"
            f"- Stance: {stance}\n"
            f"- Confidence: {confidence:.3f}\n"
            f"- Sector: {sector_name}\n"
            f"- Data coverage: {history_days} daily bars for long-term model.\n"
            f"- Price trend (1Y/3Y/5Y/10Y): {ret_1y if ret_1y is not None else 'N/A'}% / {ret_3y if ret_3y is not None else 'N/A'}% / {ret_5y if ret_5y is not None else 'N/A'}% / {ret_10y if ret_10y is not None else 'N/A'}%.\n"
            f"- Long-run quality: CAGR(3Y)={cagr_3y if cagr_3y is not None else 'N/A'}%, CAGR(5Y)={cagr_5y if cagr_5y is not None else 'N/A'}%, CAGR(10Y)={cagr_10y if cagr_10y is not None else 'N/A'}%,\n"
            f"  Max Drawdown(5Y)={max_drawdown_5y if max_drawdown_5y is not None else 'N/A'}%, Vol={annualized_vol if annualized_vol is not None else 'N/A'}%.\n"
            f"- Structural trend: price vs 200DMA={price_vs_sma200 if price_vs_sma200 is not None else 'N/A'}%.\n"
            f"- Note: N/A metrics indicate insufficient history for that exact horizon, not an implied negative value.\n"
            f"- News signal: avg sentiment={avg_sent:.2f} across stock/industry/macro streams "
            f"({stock_news}/{industry_news}/{macro_news} items).\n"
            f"- News decomposition: stock={stock_avg_sent if stock_avg_sent is not None else 'N/A'}, "
            f"industry={industry_avg_sent if industry_avg_sent is not None else 'N/A'}, "
            f"macro={macro_avg_sent if macro_avg_sent is not None else 'N/A'}.\n"
            f"- Fundamental location: 52w position={position_52w if position_52w is not None else 'N/A'}%, "
            f"1Y return={one_year_change if one_year_change is not None else 'N/A'}%.\n"
            f"- Street context: analyst upside={analyst_upside if analyst_upside is not None else 'N/A'}% "
            f"from {n_analysts if n_analysts is not None else 'N/A'} analysts.\n"
            f"- Macro overlay: India sentiment={india_signal}, US trend={us_signal}.\n"
            + valuation_block
            + financial_trends_block
            + div_ownership_block
            + factor_block
            + news_evidence_block
            + f"\n\n- Composite score: {score:.3f}\n"
            + f"- Secular Growth Forecast: {lt_why}\n"
        )

        return {
            "stance": stance,
            "confidence": round(confidence, 3),
            "score": round(score, 3),
            "summary": summary,
            "llm_reasoning": lt_why, # Surface as separate field for result.html card
            "evidence": {
                "history_bars": history_days,
                "history_start": str(dt_series.iloc[0]) if dt_series is not None and len(dt_series) > 0 else None,
                "history_end": str(dt_series.iloc[-1]) if dt_series is not None and len(dt_series) > 0 else None,
                "coverage_ratio": round(coverage_ratio, 3),
                "sparse_long_term": sparse_long_term,
                "fundamentals_sparse": fundamentals_sparse,
                "news_avg_sentiment": round(avg_sent, 3),
                "news_stock_avg_sentiment": round(float(stock_avg_sent), 3) if isinstance(stock_avg_sent, (float, int)) else None,
                "news_industry_avg_sentiment": round(float(industry_avg_sent), 3) if isinstance(industry_avg_sent, (float, int)) else None,
                "news_macro_avg_sentiment": round(float(macro_avg_sent), 3) if isinstance(macro_avg_sent, (float, int)) else None,
                "stock_news_count": stock_news,
                "industry_news_count": industry_news,
                "macro_news_count": macro_news,
                "headline_preview": combined_news_preview,
                "return_1y_pct": round(ret_1y, 2) if isinstance(ret_1y, (float, int)) else None,
                "return_3y_pct": round(ret_3y, 2) if isinstance(ret_3y, (float, int)) else None,
                "return_5y_pct": round(ret_5y, 2) if isinstance(ret_5y, (float, int)) else None,
                "return_10y_pct": round(ret_10y, 2) if isinstance(ret_10y, (float, int)) else None,
                "cagr_3y_pct": round(cagr_3y, 2) if isinstance(cagr_3y, (float, int)) else None,
                "cagr_5y_pct": round(cagr_5y, 2) if isinstance(cagr_5y, (float, int)) else None,
                "cagr_10y_pct": round(cagr_10y, 2) if isinstance(cagr_10y, (float, int)) else None,
                "price_vs_sma200_pct": round(price_vs_sma200, 2) if isinstance(price_vs_sma200, (float, int)) else None,
                "max_drawdown_5y_pct": round(max_drawdown_5y, 2) if isinstance(max_drawdown_5y, (float, int)) else None,
                "annualized_volatility_pct": round(annualized_vol, 2) if isinstance(annualized_vol, (float, int)) else None,
                "position_52w_pct": position_52w,
                "change_1y_pct": one_year_change,
                "analyst_upside_pct": analyst_upside,
                "analyst_count": n_analysts,
                "india_sentiment_signal": india_signal,
                "us_trend_signal": us_signal,
                "dividend_yield": dividend_yield,
                "dividend_yield_trend": dividend_yield_trend,
                "peg_ratio": peg_ratio,
                "operating_margins": operating_margins,
                "held_pct_institutions": held_pct_institutions,
                "institutions_pct": institutions_pct,
                "rev_qoq": rev_qoq,
                "ni_qoq": ni_qoq,
                "ocf_qoq": ocf_qoq,
                "sector": sector_name,
                "scoring_factors": [(name, round(val, 3), round(wt, 3)) for name, val, wt in factors] if factors else [],
            },
        }

    def analyze(
        self,
        stock_symbol: str,
        timeframe: str,
        start_timestamp: datetime | None = None,
        end_timestamp: datetime | None = None,
        bars: int = 120,
    ) -> dict[str, Any]:
        reset_llm_usage()
        ts_end = end_timestamp or india_market_data_end_now()
        symbol = normalize_india_symbol(stock_symbol)
        # Keep swing analysis window behavior fixed; ignore user-provided input timestamp.
        start, end = build_window(ts_end, timeframe, bars)

        if start >= end:
            raise ValueError("start_date must be earlier than current capped end time (15:30 IST)")

        stock_df = fetch_ohlc(symbol, timeframe, start, end)
        if stock_df.empty:
            raise ValueError(f"No OHLC data returned for {symbol}")

        # INCREASE HISTORY to 11 years (approx 2750 trading days) for Extremely Long-Term analysis
        long_term_start = end - timedelta(days=365 * 11)

        with ThreadPoolExecutor(max_workers=7) as ex:
            fut_market_ctx = ex.submit(fetch_india_market_context, end)
            fut_us_ctx = ex.submit(fetch_us_market_context, end)
            fut_news = ex.submit(analyze_news, stock_symbol)
            fut_technical = ex.submit(analyze_technical, stock_df)
            fut_pattern = ex.submit(analyze_pattern, stock_df)
            fut_trend = ex.submit(analyze_trend, stock_df)
            fut_financials = ex.submit(analyze_financials, symbol)
            fut_long_term_df = ex.submit(fetch_ohlc, symbol, "1d", long_term_start, end)

            market_ctx = fut_market_ctx.result()
            us_ctx = fut_us_ctx.result()
            news = fut_news.result()
            technical = fut_technical.result()
            pattern = fut_pattern.result()
            trend = fut_trend.result()
            financials = fut_financials.result()
            long_term_df = fut_long_term_df.result()

        # Safety fallback: if long-term history is unexpectedly sparse for an old listed stock,
        # refetch with a much wider window to avoid distorted multi-year metrics.
        if long_term_df is None or long_term_df.empty or len(long_term_df) < 120:
            long_term_df = fetch_ohlc(symbol, "1d", end - timedelta(days=365 * 15), end)

        nifty_df = market_ctx["nifty"]
        vix_df = market_ctx["india_vix"]

        with ThreadPoolExecutor(max_workers=3) as ex:
            fut_market_sentiment = ex.submit(analyze_market_sentiment, nifty_df, vix_df, news.get("avg_sentiment", 0.0))
            fut_relative = ex.submit(analyze_relative_strength, stock_df, nifty_df)
            fut_us_trend = ex.submit(analyze_us_trend, us_ctx)

            market_sentiment = fut_market_sentiment.result()
            relative_strength = fut_relative.result()
            us_trend = fut_us_trend.result()

        with ThreadPoolExecutor(max_workers=2) as ex:
            fut_market_setup = ex.submit(analyze_market_setup, stock_df, technical, pattern, trend, relative_strength)
            fut_catalyst_context = ex.submit(analyze_catalyst_context, symbol, financials, news, market_sentiment, us_trend)

            market_setup = fut_market_setup.result()
            catalyst_context = fut_catalyst_context.result()

        agent_outputs = {
            "technical": technical,
            "pattern": pattern,
            "trend": trend,
            "news": news,
            "market_sentiment": market_sentiment,
            "relative_strength": relative_strength,
            "us_trend": us_trend,
            "financials": financials,
            "market_setup": market_setup,
            "catalyst_context": catalyst_context,
        }

        confluence = combine_signals(agent_outputs)
        trader_intel = analyze_trader_intel(
            symbol=symbol,
            timeframe=timeframe,
            market_setup=market_setup,
            catalyst_context=catalyst_context,
            confluence=confluence,
            technical=technical,
            financials=financials,
            news=news,
        )
        final_signal = trader_intel.get("signal") or confluence["signal"]
        final_confidence = float(trader_intel.get("confidence", confluence["confidence"]))
        risk = analyze_risk(stock_df, final_signal)

        batched = generate_batched_reasoning(agent_outputs, confluence, risk)
        for key in agent_outputs:
            if key in agent_outputs:
                agent_outputs[key]["llm_reasoning"] = batched.get(key, agent_outputs[key].get("llm_reasoning", ""))
        confluence["llm_reasoning"] = batched.get("confluence", confluence.get("llm_reasoning", ""))
        risk["llm_reasoning"] = batched.get("risk", risk.get("llm_reasoning", ""))

        final_conclusion = self._build_final_conclusion(
            timeframe,
            confluence,
            risk,
            trend,
            technical=technical,
            financials=financials,
            trader_intel=trader_intel,
        )
        long_term_outlook = self._build_long_term_outlook(
            symbol=symbol,
            history_df=long_term_df,
            news=news,
            financials=financials,
            market_sentiment=market_sentiment,
            us_trend=us_trend,
            sector_name=financials.get("metrics", {}).get("sector") or "Unknown"
        )

        report_id = f"{symbol.replace('^', '').replace('.', '_')}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
        chart_path = self._generate_chart(symbol, stock_df.tail(90), report_id)
        long_term_chart_path = self._generate_long_term_chart(symbol, long_term_df, report_id)

        llm_reasoning_lines = ["", "Detailed Agent Reasoning:"]
        for key in list(agent_outputs.keys()) + ["trader_intel"]:
            item = trader_intel if key == "trader_intel" else agent_outputs.get(key, {})
            llm_text = (item.get("llm_reasoning") or "").strip()
            if llm_text:
                llm_reasoning_lines.append(f"- {key}: {llm_text}")

        conf_llm = (confluence.get("llm_reasoning") or "").strip()
        if conf_llm:
            llm_reasoning_lines.append(f"- confluence: {conf_llm}")
        risk_llm = (risk.get("llm_reasoning") or "").strip()
        if risk_llm:
            llm_reasoning_lines.append(f"- risk: {risk_llm}")

        rich_report = "\n".join([
            "Indian Swing Trading Multi-Agent Report",
            technical["summary"],
            pattern["summary"],
            trend["summary"],
            news["summary"],
            market_sentiment["summary"],
            relative_strength["summary"],
            us_trend["summary"],
            financials["summary"],
            market_setup["summary"],
            catalyst_context["summary"],
            trader_intel["summary"],
            confluence["summary"],
            risk["summary"],
            final_conclusion["summary"],
            "\n".join(llm_reasoning_lines),
        ])

        agent_guidance = {
            "indicator_prompt": technical.get("reasoning_prompt", ""),
            "pattern_prompt": pattern.get("reasoning_prompt", ""),
            "news_prompt": news.get("reasoning_prompt", ""),
            "trend_prompt": trend.get("reasoning_prompt", ""),
            "market_prompt": market_sentiment.get("reasoning_prompt", ""),
            "relative_strength_prompt": relative_strength.get("reasoning_prompt", ""),
            "us_trend_prompt": us_trend.get("reasoning_prompt", ""),
            "financials_prompt": financials.get("reasoning_prompt", ""),
            "market_setup_prompt": market_setup.get("reasoning_prompt", ""),
            "catalyst_context_prompt": catalyst_context.get("reasoning_prompt", ""),
            "trader_intel_prompt": trader_intel.get("reasoning_prompt", ""),
        }

        payload = {
            "report_id": report_id,
            "symbol": symbol,
            "timeframe": timeframe,
            "forecast_bars": DEFAULT_FORECAST_BARS,
            "start_timestamp": start.strftime("%Y-%m-%d %H:%M:%S"),
            "end_timestamp": end.strftime("%Y-%m-%d %H:%M:%S"),
            "final_signal": final_signal,
            "confidence": round(final_confidence, 3),
            "confluence_scores": confluence["scores"],
            "risk_plan": risk,
            "final_conclusion": final_conclusion,
            "long_term_outlook": long_term_outlook,
            "agent_outputs": agent_outputs,
            "agent_guidance": agent_guidance,
            "market_setup": market_setup,
            "catalyst_context": catalyst_context,
            "trader_intel": trader_intel,
            "risky_intraday_play": trader_intel.get("risky_intraday_play"),
            "top_news": news.get("top_news", []),
            "top_industry_news": news.get("top_industry_news", []),
            "top_macro_news": news.get("top_macro_news", []),
            "chart_path": chart_path,
            "long_term_chart_path": long_term_chart_path,
            "rich_report": rich_report,
            # Surface key analysis cards for the template
            "price_52w": financials.get("price_52w", {}),
            "analyst_consensus": financials.get("analyst_consensus", {}),
            "fundamental_signals": financials.get("fundamental_signals", []),
            "key_price_levels": (technical.get("price_levels", {}) or {}).get("levels", []),
            "momentum_score": technical.get("momentum_score"),
            "qualitative_labels": technical.get("qualitative_labels", {}),
            "valuation_snapshot": {
                "pe_trailing": financials.get("metrics", {}).get("trailing_pe") or (financials.get("extended_fundamentals", {}) or {}).get("trailing_pe"),
                "peg_ratio": (financials.get("extended_fundamentals", {}) or {}).get("peg_ratio") or financials.get("metrics", {}).get("peg_ratio"),
                "ev_to_ebitda": (financials.get("extended_fundamentals", {}) or {}).get("enterprise_to_ebitda") or financials.get("metrics", {}).get("enterprise_to_ebitda"),
                "ev_to_revenue": (financials.get("extended_fundamentals", {}) or {}).get("enterprise_to_revenue") or financials.get("metrics", {}).get("enterprise_to_revenue"),
                "gross_margins": (financials.get("extended_fundamentals", {}) or {}).get("gross_margins") or financials.get("metrics", {}).get("gross_margins"),
                "operating_margins": (financials.get("extended_fundamentals", {}) or {}).get("operating_margins") or financials.get("metrics", {}).get("operating_margins"),
                "ebitda_margins": (financials.get("extended_fundamentals", {}) or {}).get("ebitda_margins") or financials.get("metrics", {}).get("ebitda_margins"),
                "book_value": (financials.get("extended_fundamentals", {}) or {}).get("book_value") or financials.get("metrics", {}).get("book_value"),
                "dividend_yield": (financials.get("extended_fundamentals", {}) or {}).get("dividend_yield") or (financials.get("metrics", {}) or {}).get("dividend_yield"),
                "enterprise_value": (financials.get("extended_fundamentals", {}) or {}).get("enterprise_value") or financials.get("metrics", {}).get("enterprise_value"),
                "roe": financials.get("metrics", {}).get("return_on_equity") or (financials.get("extended_fundamentals", {}) or {}).get("return_on_equity"),
                "debt_to_equity": financials.get("metrics", {}).get("debt_to_equity") or (financials.get("extended_fundamentals", {}) or {}).get("debt_to_equity"),
                "price_to_book": financials.get("metrics", {}).get("price_to_book") or (financials.get("extended_fundamentals", {}) or {}).get("price_to_book"),
                "total_revenue": (financials.get("extended_fundamentals", {}) or {}).get("total_revenue") or financials.get("metrics", {}).get("total_revenue"),
                "total_debt": (financials.get("extended_fundamentals", {}) or {}).get("total_debt") or financials.get("metrics", {}).get("total_debt"),
                "total_cash": (financials.get("extended_fundamentals", {}) or {}).get("total_cash") or financials.get("metrics", {}).get("total_cash"),
            },
        }

        master_reasoning = generate_master_reasoning(payload)
        payload["master_reasoning"] = master_reasoning
        payload["rich_report"] = payload["rich_report"] + "\n\nGemini Master Reasoning:\n" + master_reasoning.get("text", "")

        llm_usage = get_llm_usage_summary()
        payload["llm_usage"] = llm_usage
        payload["rich_report"] = payload["rich_report"] + (
            "\n\nLLM Token Usage:\n"
            f"- Input tokens: {llm_usage.get('total_input_tokens', 0)}\n"
            f"- Output tokens: {llm_usage.get('total_output_tokens', 0)}\n"
            f"- Total tokens: {llm_usage.get('total_tokens', 0)}\n"
            f"- Estimated cost (USD): {((llm_usage.get('pricing') or {}).get('estimated_total_cost_usd', 0))}"
        )
        payload["rich_report"] = payload["rich_report"] + "\n\n" + long_term_outlook.get("summary", "")

        payload = self._json_safe(payload)
        saved = self._save_report(report_id, payload)
        payload["saved_files"] = saved
        return payload

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="India Swing Trading Pipeline")
    parser.add_argument("--symbol", type=str, help="Stock symbol (e.g. RELIANCE.NS)")
    parser.add_argument("--timeframe", type=str, default="1d", help="Timeframe (e.g. 1h, 1d)")
    parser.add_argument("--bars", type=int, default=120, help="Number of bars for swing analysis")
    args = parser.parse_args()

    if args.symbol:
        pipeline = IndiaSwingPipeline()
        results = pipeline.analyze(args.symbol, args.timeframe, bars=args.bars)
        print(f"\nFinal Signal for {args.symbol}: {results['final_signal']}")
        print(f"Confidence: {results['confidence']}")
        print(f"Report saved to: {results['saved_files']['markdown']}")
    else:
        parser.print_help()
