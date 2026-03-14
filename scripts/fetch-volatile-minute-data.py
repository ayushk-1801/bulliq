#!/usr/bin/env python3

import argparse
import csv
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple


@dataclass
class MinuteRow:
    dt: datetime
    open_price: float
    high: float
    low: float
    close: float
    volume: int


@dataclass
class DaySummary:
    symbol: str
    trade_date: str
    volatility_pct: float
    open_price: float
    high: float
    low: float
    close: float
    total_volume: int
    drastic_change_time: str
    drastic_change_pct: float
    action: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Find most volatile trading days from 1-minute candle CSV files and export "
            "full-day data plus drastic-change moments."
        )
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path("src/server/kite_data"),
        help="Directory that contains per-symbol CSV files.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("scripts/output"),
        help="Directory to save generated CSV outputs.",
    )
    parser.add_argument(
        "--top-n",
        type=int,
        default=25,
        help="Number of most volatile symbol-days to keep.",
    )
    return parser.parse_args()


def read_symbol_rows(csv_path: Path) -> Dict[str, List[MinuteRow]]:
    rows_by_day: Dict[str, List[MinuteRow]] = {}

    with csv_path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                dt = datetime.fromisoformat(row["Datetime"])
                open_price = float(row["Open"])
                high = float(row["High"])
                low = float(row["Low"])
                close = float(row["Close"])
                volume = int(float(row["Volume"]))
            except (KeyError, TypeError, ValueError):
                continue

            trade_date = dt.date().isoformat()
            rows_by_day.setdefault(trade_date, []).append(
                MinuteRow(
                    dt=dt,
                    open_price=open_price,
                    high=high,
                    low=low,
                    close=close,
                    volume=volume,
                )
            )

    for trade_date in rows_by_day:
        rows_by_day[trade_date].sort(key=lambda r: r.dt)

    return rows_by_day


def classify_setups(rows: List[MinuteRow]) -> Dict[str, Tuple[float, int, float, float]]:
    best_setups = {
        "buy": (-float('inf'), -1, 0.0, 0.0),
        "sell": (-float('inf'), -1, 0.0, 0.0),
        "hold": (-float('inf'), -1, 0.0, 0.0)
    }

    indices = []
    for i, r in enumerate(rows):
        tm = r.dt.time()
        # 10:15 to 14:00
        if (tm.hour > 10 or (tm.hour == 10 and tm.minute >= 15)) and (tm.hour < 14):
            indices.append(i)

    if not indices:
        return best_setups

    for i in indices:
        entry = rows[i].close
        if entry <= 0: continue
        
        end_idx = min(len(rows), i + 60)
        if end_idx - i < 10: continue

        max_up = 0.0
        max_down = 0.0
        
        for j in range(i+1, end_idx):
            up = (rows[j].high - entry) / entry * 100
            down = (entry - rows[j].low) / entry * 100
            max_up = max(max_up, up)
            max_down = max(max_down, down)
            
        b_score = max_up - max_down * 2.5
        s_score = max_down - max_up * 2.5
        h_score = -(max_up + max_down)

        if b_score > best_setups["buy"][0]:
            best_setups["buy"] = (b_score, i, max_up, max_down)
        if s_score > best_setups["sell"][0]:
            best_setups["sell"] = (s_score, i, max_down, max_up)
        if h_score > best_setups["hold"][0]:
            best_setups["hold"] = (h_score, i, max_up, max_down)

    return best_setups


def summarize_day(symbol: str, trade_date: str, rows: List[MinuteRow], action: str, best_idx: int, max_favorable: float) -> Optional[DaySummary]:
    if not rows or best_idx == -1:
        return None

    open_price = rows[0].open_price
    if open_price <= 0:
        return None

    day_high = max(r.high for r in rows)
    day_low = min(r.low for r in rows)
    close_price = rows[-1].close
    total_volume = sum(r.volume for r in rows)
    volatility_pct = ((day_high - day_low) / open_price) * 100

    drastic_change_time = rows[best_idx].dt.isoformat()
    drastic_change_pct = max_favorable
    if action == "sell":
        drastic_change_pct = -max_favorable
    elif action == "hold":
        drastic_change_pct = 0.0

    return DaySummary(
        symbol=symbol,
        trade_date=trade_date,
        volatility_pct=volatility_pct,
        open_price=open_price,
        high=day_high,
        low=day_low,
        close=close_price,
        total_volume=total_volume,
        drastic_change_time=drastic_change_time,
        drastic_change_pct=drastic_change_pct,
        action=action
    )


def minute_change_pct(rows: List[MinuteRow], idx: int) -> Optional[float]:
    if idx == 0:
        return None
    prev_close = rows[idx - 1].close
    curr_close = rows[idx].close
    if prev_close <= 0:
        return None
    return ((curr_close - prev_close) / prev_close) * 100


def write_outputs(
    output_dir: Path,
    selected: List[Tuple[DaySummary, List[MinuteRow]]],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    summary_path = output_dir / "volatile_days_summary.csv"
    with summary_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "Symbol",
                "TradeDate",
                "VolatilityPct",
                "Open",
                "High",
                "Low",
                "Close",
                "TotalVolume",
                "DrasticChangeTime",
                "DrasticChangePct",
                "Action",
            ]
        )
        for summary, _ in selected:
            writer.writerow(
                [
                    summary.symbol,
                    summary.trade_date,
                    f"{summary.volatility_pct:.6f}",
                    f"{summary.open_price:.6f}",
                    f"{summary.high:.6f}",
                    f"{summary.low:.6f}",
                    f"{summary.close:.6f}",
                    summary.total_volume,
                    summary.drastic_change_time,
                    f"{summary.drastic_change_pct:.6f}",
                    summary.action,
                ]
            )

    drastic_path = output_dir / "drastic_change_moments.csv"
    with drastic_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "Symbol",
                "TradeDate",
                "DrasticChangeTime",
                "DrasticChangePct",
                "VolatilityPct",
                "Action",
            ]
        )
        for summary, _ in selected:
            writer.writerow(
                [
                    summary.symbol,
                    summary.trade_date,
                    summary.drastic_change_time,
                    f"{summary.drastic_change_pct:.6f}",
                    f"{summary.volatility_pct:.6f}",
                    summary.action,
                ]
            )

    intraday_path = output_dir / "volatile_days_intraday_data.csv"
    with intraday_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "Symbol",
                "TradeDate",
                "Datetime",
                "Open",
                "High",
                "Low",
                "Close",
                "Volume",
                "MinuteChangePct",
                "IsDrasticMoment",
            ]
        )

        for summary, rows in selected:
            for idx, row in enumerate(rows):
                change_pct = minute_change_pct(rows, idx)
                writer.writerow(
                    [
                        summary.symbol,
                        summary.trade_date,
                        row.dt.isoformat(),
                        f"{row.open_price:.6f}",
                        f"{row.high:.6f}",
                        f"{row.low:.6f}",
                        f"{row.close:.6f}",
                        row.volume,
                        "" if change_pct is None else f"{change_pct:.6f}",
                        "true" if row.dt.isoformat() == summary.drastic_change_time else "false",
                    ]
                )


def main() -> int:
    args = parse_args()

    csv_files = sorted(args.data_dir.glob("*.csv"))
    if not csv_files:
        print(f"No CSV files found in: {args.data_dir}")
        return 1

    all_days = []

    for csv_file in csv_files:
        symbol = csv_file.stem
        rows_by_day = read_symbol_rows(csv_file)
        for trade_date, rows in rows_by_day.items():
            if not rows: continue
            setups = classify_setups(rows)
            # Add to full list
            if setups["buy"][1] != -1:
                all_days.append((setups["buy"][0], "buy", symbol, trade_date, rows, setups["buy"]))
            if setups["sell"][1] != -1:
                all_days.append((setups["sell"][0], "sell", symbol, trade_date, rows, setups["sell"]))
            if setups["hold"][1] != -1:
                all_days.append((setups["hold"][0], "hold", symbol, trade_date, rows, setups["hold"]))

    target_buy = int(max(1, args.top_n * 0.4))
    target_sell = int(max(1, args.top_n * 0.4))
    target_hold = max(1, args.top_n - target_buy - target_sell)
    
    buy_candidates = [d for d in all_days if d[1] == "buy"]
    sell_candidates = [d for d in all_days if d[1] == "sell"]
    hold_candidates = [d for d in all_days if d[1] == "hold"]

    buy_candidates.sort(key=lambda x: x[0], reverse=True)
    sell_candidates.sort(key=lambda x: x[0], reverse=True)
    hold_candidates.sort(key=lambda x: x[0], reverse=True)

    selected = []
    used_days = set()

    def add_candidates(candidates, target):
        count = 0
        for score, action, sym, td, rows, (sc, idx, mx_fav, mx_adv) in candidates:
            if count >= target: break
            key = (sym, td)
            if key not in used_days:
                used_days.add(key)
                summary = summarize_day(sym, td, rows, action, idx, mx_fav)
                if summary:
                    selected.append((summary, rows))
                    count += 1
    
    add_candidates(buy_candidates, target_buy)
    add_candidates(sell_candidates, target_sell)
    add_candidates(hold_candidates, target_hold)

    if not selected:
        print("No valid trading-day rows found to process.")
        return 1

    write_outputs(args.output_dir, selected)

    print(f"Processed files: {len(csv_files)}")
    print(f"Selected volatile days: {len(selected)} (Target: {args.top_n})")
    print(f"Output directory: {args.output_dir}")
    print(f"Summary: {args.output_dir / 'volatile_days_summary.csv'}")
    print(f"Drastic moments: {args.output_dir / 'drastic_change_moments.csv'}")
    print(f"Intraday rows: {args.output_dir / 'volatile_days_intraday_data.csv'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
