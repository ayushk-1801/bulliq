from __future__ import annotations

import numpy as np
import pandas as pd

from agents.llm_reasoner import generate_agent_reasoning
from config import CONFIDENCE_BOUNDS


MIN_BARS = 30


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, 1e-9)
    return 100 - (100 / (1 + rs))


def _atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high = df["High"].astype(float)
    low = df["Low"].astype(float)
    close = df["Close"].astype(float)
    tr = pd.concat(
        [
            high - low,
            (high - close.shift()).abs(),
            (low - close.shift()).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.rolling(period).mean()


def _stochastic(df: pd.DataFrame, period: int = 14) -> tuple[pd.Series, pd.Series]:
    high_n = df["High"].astype(float).rolling(period).max()
    low_n = df["Low"].astype(float).rolling(period).min()
    close = df["Close"].astype(float)
    k = 100 * (close - low_n) / (high_n - low_n).replace(0, 1e-9)
    d = k.rolling(3).mean()
    return k, d


def _williams_r(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high_n = df["High"].astype(float).rolling(period).max()
    low_n = df["Low"].astype(float).rolling(period).min()
    close = df["Close"].astype(float)
    wr = -100 * (high_n - close) / (high_n - low_n).replace(0, 1e-9)
    return wr


def _compute_momentum_score(
    rsi: float,
    stoch_k: float,
    willr: float,
    macd_hist: float,
    macd_hist_range: float,
    roc10: float,
) -> float:
    """Return a 0–100 composite momentum health score (50 = neutral)."""
    weights = {
        "rsi": 0.25,
        "stoch": 0.20,
        "willr": 0.20,
        "macd_hist": 0.20,
        "roc": 0.15,
    }
    # Normalise each indicator to 0–1 space
    rsi_score = max(0.0, min(1.0, rsi / 100.0))
    stoch_score = max(0.0, min(1.0, stoch_k / 100.0))
    willr_score = max(0.0, min(1.0, (willr + 100.0) / 100.0))
    # MACD hist: normalise by recent range; positive = > 0.5
    if macd_hist_range > 1e-9:
        macd_score = max(0.0, min(1.0, 0.5 + macd_hist / (2.0 * macd_hist_range)))
    else:
        macd_score = 0.5 if macd_hist >= 0 else 0.5
    # ROC10: sigmoid-like clamp at ±10% → maps to 0–1
    roc_score = max(0.0, min(1.0, 0.5 + roc10 / 20.0))

    composite = (
        weights["rsi"] * rsi_score
        + weights["stoch"] * stoch_score
        + weights["willr"] * willr_score
        + weights["macd_hist"] * macd_score
        + weights["roc"] * roc_score
    )
    return round(composite * 100.0, 1)


def _get_qualitative_labels(
    last_close: float,
    last_sma20: float,
    last_sma50: float,
    last_rsi: float,
    last_macd: float,
    last_macd_signal: float,
    last_macd_hist: float,
    sma20_slope: float,
    beta: float | None = None,
) -> dict:
    """Return human-readable qualitative labels for each technical dimension."""
    # Moving averages
    if last_close > last_sma20 and last_sma20 > last_sma50:
        ma_label = "Buy"
    elif last_close < last_sma20 and last_sma20 < last_sma50:
        ma_label = "Sell"
    else:
        ma_label = "Mixed"

    # Trend channel direction
    if sma20_slope > 0.001:
        trend_label = "Rising"
    elif sma20_slope < -0.001:
        trend_label = "Falling"
    else:
        trend_label = "Sideways"

    # RSI
    if last_rsi < 30:
        rsi_label = "Oversold"
    elif last_rsi < 40:
        rsi_label = "Near oversold"
    elif last_rsi > 70:
        rsi_label = "Overbought"
    elif last_rsi > 60:
        rsi_label = "Near overbought"
    else:
        rsi_label = "Neutral"

    # MACD
    if last_macd > last_macd_signal and last_macd_hist > 0:
        macd_label = "Bullish"
    elif last_macd < last_macd_signal and last_macd_hist < 0:
        macd_label = "Bearish"
    else:
        macd_label = "Mixed"

    labels = {
        "moving_averages": ma_label,
        "trend_channel": trend_label,
        "rsi": rsi_label,
        "macd": macd_label,
    }
    if beta is not None:
        b = round(float(beta), 2)
        if b > 1.5:
            labels["beta"] = f"{b} (high)"
        elif b > 1.0:
            labels["beta"] = f"{b} (moderate)"
        else:
            labels["beta"] = f"{b} (low)"
    return labels


def _compute_key_price_levels(df: pd.DataFrame) -> dict:
    """Identify swing-high/low pivot levels and return labeled price zones."""
    pivot_n = 3
    min_gap_pct = 0.005
    top_n_resistance = 3
    top_n_support = 2
    cluster_pct = 0.008
    n = pivot_n
    highs = df["High"].astype(float).values
    lows = df["Low"].astype(float).values
    close = float(df["Close"].iloc[-1])

    # Detect pivot highs and lows using n-bar confirmation each side.
    pivot_highs: list[float] = []
    pivot_lows: list[float] = []
    for i in range(n, len(highs) - n):
        window_h = [highs[i - j] for j in range(1, n + 1)] + [highs[i + j] for j in range(1, n + 1)]
        if all(highs[i] >= h for h in window_h):
            pivot_highs.append(highs[i])
        window_l = [lows[i - j] for j in range(1, n + 1)] + [lows[i + j] for j in range(1, n + 1)]
        if all(lows[i] <= l for l in window_l):
            pivot_lows.append(lows[i])

    def _cluster(values: list[float], descending: bool) -> list[float]:
        """Merge values within cluster_pct of each other, keep the median."""
        if not values:
            return []
        sorted_vals = sorted(values, reverse=descending)
        merged: list[float] = []
        for v in sorted_vals:
            if merged and abs(v - merged[-1]) / max(1e-9, merged[-1]) < cluster_pct:
                merged[-1] = (merged[-1] + v) / 2.0  # average cluster
            else:
                merged.append(v)
        return merged

    # Resistances: clustered pivot highs above current price (nearest first)
    resistances = _cluster([h for h in pivot_highs if h > close * (1 + min_gap_pct)], descending=False)
    # Supports: clustered pivot lows below current price (nearest first = highest)
    supports = _cluster([l for l in pivot_lows if l < close * (1 - min_gap_pct)], descending=True)

    levels: list[dict] = []
    for i, r in enumerate(resistances[:top_n_resistance]):
        labels_map = {0: "Resistance 1", 1: "Resistance 2", 2: "Resistance 3"}
        levels.append({"label": labels_map.get(i, f"Resistance {i+1}"), "price": round(r, 2), "type": "resistance"})

    levels.append({"label": "Current", "price": round(close, 2), "type": "current"})

    for i, s in enumerate(supports[:top_n_support]):
        label = "Support" if i == 0 else "Breakdown Zone"
        levels.append({"label": label, "price": round(s, 2), "type": "support" if i == 0 else "breakdown"})

    out: dict = {
        "levels": levels,
        "nearest_resistance": round(resistances[0], 2) if resistances else None,
        "nearest_support": round(supports[0], 2) if supports else None,
    }
    for i in range(top_n_resistance):
        key = f"resistance_{i + 1}"
        out[key] = round(resistances[i], 2) if len(resistances) > i else None
    out["support"] = round(supports[0], 2) if supports else None
    out["breakdown_zone"] = round(supports[1], 2) if len(supports) > 1 else None
    return out


def analyze_technical(df: pd.DataFrame) -> dict:
    if df.empty or len(df) < MIN_BARS:
        return {
            "signal": "NO_TRADE",
            "confidence": CONFIDENCE_BOUNDS["insufficient"],
            "summary": "Not enough candles for reliable swing analysis.",
            "metrics": {},
        }

    close = df["Close"].astype(float)
    volume = pd.to_numeric(df.get("Volume", 0), errors="coerce").fillna(0)

    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    macd_signal = macd.ewm(span=9, adjust=False).mean()
    macd_hist = macd - macd_signal
    rsi14 = _rsi(close, 14)
    sma20 = close.rolling(20).mean()
    sma50 = close.rolling(50).mean()
    roc10 = (close / close.shift(10) - 1.0) * 100
    atr14 = _atr(df, 14)
    stoch_k, stoch_d = _stochastic(df, 14)
    willr14 = _williams_r(df, 14)
    vol_sma20 = volume.rolling(20).mean()

    last_close = float(close.iloc[-1])
    last_rsi = float(rsi14.iloc[-1]) if not rsi14.empty else 50.0
    last_macd = float(macd.iloc[-1])
    last_macd_signal = float(macd_signal.iloc[-1])
    last_macd_hist = float(macd_hist.iloc[-1])
    last_sma20 = float(sma20.iloc[-1]) if not sma20.empty else last_close
    last_sma50 = float(sma50.iloc[-1]) if not sma50.empty else last_close
    last_roc10 = float(roc10.iloc[-1]) if not roc10.empty else 0.0
    last_atr14 = float(atr14.iloc[-1]) if not atr14.empty else 0.0
    last_stoch_k = float(stoch_k.iloc[-1]) if not stoch_k.empty else 50.0
    last_stoch_d = float(stoch_d.iloc[-1]) if not stoch_d.empty else 50.0
    last_willr14 = float(willr14.iloc[-1]) if not willr14.empty else -50.0
    rsi_hist = rsi14.dropna().tail(80)
    rsi_bullish = float(np.clip(rsi_hist.quantile(0.65), 52.0, 65.0)) if not rsi_hist.empty else 58.0
    rsi_bearish = float(np.clip(rsi_hist.quantile(0.35), 35.0, 48.0)) if not rsi_hist.empty else 42.0
    stoch_hist = stoch_k.dropna().tail(80)
    stoch_bullish = float(np.clip(stoch_hist.quantile(0.65), 52.0, 75.0)) if not stoch_hist.empty else 56.0
    stoch_bearish = float(np.clip(stoch_hist.quantile(0.35), 25.0, 48.0)) if not stoch_hist.empty else 44.0
    willr_hist = willr14.dropna().tail(80)
    willr_bullish = float(np.clip(willr_hist.quantile(0.65), -45.0, -20.0)) if not willr_hist.empty else -35.0
    willr_bearish = float(np.clip(willr_hist.quantile(0.35), -80.0, -55.0)) if not willr_hist.empty else -65.0

    last_vol = float(volume.iloc[-1]) if not volume.empty else 0.0
    last_vol_sma20 = float(vol_sma20.iloc[-1]) if not vol_sma20.empty else max(1.0, last_vol)

    # SMA20 slope (normalised per price unit to detect direction)
    sma20_vals = sma20.dropna()
    if len(sma20_vals) >= 5:
        sma20_slope = float(sma20_vals.iloc[-1] - sma20_vals.iloc[-5]) / max(1e-9, last_close)
    else:
        sma20_slope = 0.0

    # MACD histogram range over recent 20 bars (for normalisation)
    macd_hist_range = float(macd_hist.tail(20).abs().max()) if not macd_hist.empty else 1.0

    # 52-week position from the available OHLC data
    high_all = float(df["High"].max())
    low_all = float(df["Low"].min())
    pos_in_range = (last_close - low_all) / max(1e-9, high_all - low_all)

    # Momentum score (0–100 composite)
    momentum_score = _compute_momentum_score(
        rsi=last_rsi,
        stoch_k=last_stoch_k,
        willr=last_willr14,
        macd_hist=last_macd_hist,
        macd_hist_range=macd_hist_range,
        roc10=last_roc10,
    )

    # Qualitative labels
    qual_labels = _get_qualitative_labels(
        last_close=last_close,
        last_sma20=last_sma20,
        last_sma50=last_sma50,
        last_rsi=last_rsi,
        last_macd=last_macd,
        last_macd_signal=last_macd_signal,
        last_macd_hist=last_macd_hist,
        sma20_slope=sma20_slope,
    )

    # Key price levels (swing highs/lows)
    price_levels = _compute_key_price_levels(df)

    bullish_points = 0
    bearish_points = 0

    if last_close > last_sma20:
        bullish_points += 1
    else:
        bearish_points += 1

    if last_sma20 > last_sma50:
        bullish_points += 1
    else:
        bearish_points += 1

    if last_macd > last_macd_signal:
        bullish_points += 1
    else:
        bearish_points += 1

    if last_macd_hist > 0:
        bullish_points += 1
    else:
        bearish_points += 1

    if last_rsi > rsi_bullish:
        bullish_points += 1
    elif last_rsi < rsi_bearish:
        bearish_points += 1

    if last_roc10 > 0:
        bullish_points += 1
    elif last_roc10 < 0:
        bearish_points += 1

    if last_stoch_k > last_stoch_d and last_stoch_k > stoch_bullish:
        bullish_points += 1
    elif last_stoch_k < last_stoch_d and last_stoch_k < stoch_bearish:
        bearish_points += 1

    if last_willr14 > willr_bullish:
        bullish_points += 1
    elif last_willr14 < willr_bearish:
        bearish_points += 1

    vol_hist = volume.dropna().tail(60)
    vol_confirm_threshold = max(last_vol_sma20, float(vol_hist.quantile(0.6)) if not vol_hist.empty else last_vol_sma20)
    if last_vol > vol_confirm_threshold:
        if bullish_points > bearish_points:
            bullish_points += 1
        elif bearish_points > bullish_points:
            bearish_points += 1

    delta = bullish_points - bearish_points
    total_points = max(1, bullish_points + bearish_points)
    directional_strength = abs(delta) / total_points
    if directional_strength < 0.22:
        signal = "NO_TRADE"
        alignment = max(bullish_points, bearish_points) / total_points
        confidence = max(
            CONFIDENCE_BOUNDS["neutral_min"],
            min(0.72, 0.42 + 0.20 * alignment - 0.10 * directional_strength),
        )
    elif delta > 0:
        signal = "BUY"
        confidence = min(CONFIDENCE_BOUNDS["max"], CONFIDENCE_BOUNDS["trade_min"] + 0.32 * directional_strength)
    else:
        signal = "SELL"
        confidence = min(CONFIDENCE_BOUNDS["max"], CONFIDENCE_BOUNDS["trade_min"] + 0.32 * directional_strength)

    if last_atr14 > 0:
        atr_pct = 100 * (last_atr14 / max(1e-9, last_close))
        atr_hist = (100 * (atr14 / close.replace(0, np.nan))).replace([np.inf, -np.inf], np.nan).dropna().tail(60)
        atr_high = float(atr_hist.quantile(0.8)) if not atr_hist.empty else 4.0
        if atr_pct > atr_high and signal != "NO_TRADE":
            # High volatility regime -> reduce conviction for swing entries.
            confidence = max(CONFIDENCE_BOUNDS["trade_min"], confidence - 0.08)

    prompt_style_reasoning = (
        "Indicator reasoning protocol:\n"
        "1) Map structural trend using relative price location vs SMA20/50/200 and slope analysis.\n"
        "2) Decode momentum quality using MACD histogram acceleration/deceleration and ROC10-ROC20 comparisons.\n"
        "3) Assess oscillator behavior (RSI/Stoch/WillR) for range-specific exhaustion vs strong trend continuation.\n"
        "4) Verify professional participation via volume-over-average filters and spread analysis.\n"
        "5) Filter noise using ATR-based volatility regimes (reduce conviction in 'wide and loose' tape).\n"
        "6) Enforce strict confluence: if trend and momentum disagree without a reclaim setup, maintain NO_TRADE posture."
    )

    summary = (
        f"Indicator Signal: {signal} | "
        f"Trend: close={last_close:.2f}, SMA20={last_sma20:.2f}, SMA50={last_sma50:.2f}. "
        f"Momentum: MACD={last_macd:.3f}, Signal={last_macd_signal:.3f}, Hist={last_macd_hist:.3f}, ROC10={last_roc10:.2f}%. "
        f"Oscillators: RSI14={last_rsi:.1f}, StochK/D={last_stoch_k:.1f}/{last_stoch_d:.1f}, Williams%R={last_willr14:.1f}. "
        f"Risk: ATR14={last_atr14:.2f}, Volume={last_vol:.0f} vs VolSMA20={last_vol_sma20:.0f}. "
        f"Momentum Score={momentum_score}/100 | MA={qual_labels['moving_averages']}, Trend={qual_labels['trend_channel']}, RSI={qual_labels['rsi']}, MACD={qual_labels['macd']}."
    )

    detail = {
        "bullish_points": bullish_points,
        "bearish_points": bearish_points,
        "delta": delta,
        "rules": {
            "trend_alignment": bool(last_close > last_sma20 and last_sma20 > last_sma50),
            "macd_alignment": bool(last_macd > last_macd_signal and last_macd_hist > 0),
            "rsi_bias": "bullish" if last_rsi > rsi_bullish else ("bearish" if last_rsi < rsi_bearish else "neutral"),
            "stoch_alignment": bool(last_stoch_k > last_stoch_d),
            "willr_bias": "bullish" if last_willr14 > willr_bullish else ("bearish" if last_willr14 < willr_bearish else "neutral"),
            "volume_confirmation": bool(last_vol > vol_confirm_threshold),
        },
    }

    llm_reasoning = generate_agent_reasoning(
        agent_name="Technical Agent",
        deterministic_summary=summary,
        instruction=prompt_style_reasoning,
        evidence={"metrics": {
            "close": last_close,
            "sma20": last_sma20,
            "sma50": last_sma50,
            "macd": last_macd,
            "macd_signal": last_macd_signal,
            "macd_hist": last_macd_hist,
            "rsi14": last_rsi,
            "roc10": last_roc10,
            "atr14": last_atr14,
            "stoch_k": last_stoch_k,
            "stoch_d": last_stoch_d,
            "willr14": last_willr14,
            "volume": last_vol,
            "volume_sma20": last_vol_sma20,
        }, "detail": detail, "signal": signal, "confidence": confidence},
    )

    return {
        "signal": signal,
        "confidence": confidence,
        "summary": summary,
        "reasoning_prompt": prompt_style_reasoning,
        "llm_reasoning": llm_reasoning,
        "detail": detail,
        "price_levels": price_levels,
        "momentum_score": momentum_score,
        "qualitative_labels": qual_labels,
        "price_range": {
            "high": round(high_all, 2),
            "low": round(low_all, 2),
            "position_pct": round(pos_in_range * 100.0, 1),
        },
        "metrics": {
            "close": last_close,
            "rsi14": last_rsi,
            "macd": last_macd,
            "macd_signal": last_macd_signal,
            "macd_hist": last_macd_hist,
            "sma20": last_sma20,
            "sma50": last_sma50,
            "roc10": last_roc10,
            "atr14": last_atr14,
            "stoch_k": last_stoch_k,
            "stoch_d": last_stoch_d,
            "willr14": last_willr14,
            "volume": last_vol,
            "volume_sma20": last_vol_sma20,
        },
    }
