from __future__ import annotations

import base64
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request, send_file

from swing_pipeline import IndiaSwingPipeline
from utils import parse_timestamp

app = Flask(__name__)
pipeline = IndiaSwingPipeline(reports_dir="reports")
REPORTS_DIR = Path("reports")


def _default_bars_for_timeframe(timeframe: str) -> int:
    tf = (timeframe or "1d").strip().lower()
    if tf in {"1m", "2m", "3m", "5m"}:
        return 150
    if tf in {"10m", "15m"}:
        return 130
    if tf in {"30m", "45m"}:
        return 120
    if tf in {"60m", "1h", "90m"}:
        return 100
    if tf in {"4h"}:
        return 120
    return 120


def _safe_bars(payload: dict[str, Any], timeframe: str) -> int:
    raw = payload.get("bars")
    if raw is None:
        return _default_bars_for_timeframe(timeframe)
    try:
        value = int(raw)
        return value if value > 0 else _default_bars_for_timeframe(timeframe)
    except Exception:
        return _default_bars_for_timeframe(timeframe)


def _file_base64(file_path: str | None) -> str | None:
    if not file_path:
        return None
    path = Path(file_path)
    if not path.exists() or not path.is_file():
        return None
    return base64.b64encode(path.read_bytes()).decode("ascii")


def _report_url(base_url: str, file_path: str | None) -> str | None:
    if not file_path:
        return None
    file_name = Path(file_path).name
    return f"{base_url}reports/{file_name}"


def _enrich_api_payload(result: dict[str, Any]) -> dict[str, Any]:
    base_url = request.host_url
    chart_path = result.get("chart_path")
    long_term_chart_path = result.get("long_term_chart_path")
    saved_files = result.get("saved_files") or {}
    json_path = saved_files.get("json")
    md_path = saved_files.get("markdown")

    result["asset_urls"] = {
        "chart_url": _report_url(base_url, chart_path),
        "long_term_chart_url": _report_url(base_url, long_term_chart_path),
        "report_json_url": _report_url(base_url, json_path),
        "report_markdown_url": _report_url(base_url, md_path),
    }
    result["asset_files"] = {
        "chart_file": Path(chart_path).name if chart_path else None,
        "long_term_chart_file": Path(long_term_chart_path).name if long_term_chart_path else None,
        "report_json_file": Path(json_path).name if json_path else None,
        "report_markdown_file": Path(md_path).name if md_path else None,
    }
    result["asset_bytes_base64"] = {
        "chart_png": _file_base64(chart_path),
        "long_term_chart_png": _file_base64(long_term_chart_path),
    }
    result["asset_mime_types"] = {
        "chart_png": "image/png",
        "long_term_chart_png": "image/png",
    }
    return result


def _strip_prompts_and_urls(obj: Any) -> Any:
    if isinstance(obj, dict):
        cleaned: dict[str, Any] = {}
        for k, v in obj.items():
            key_l = str(k).lower()
            if "prompt" in key_l or "url" in key_l:
                continue
            cleaned[k] = _strip_prompts_and_urls(v)
        return cleaned
    if isinstance(obj, list):
        return [_strip_prompts_and_urls(x) for x in obj]
    return obj


def _save_api_output(cleaned_result: dict[str, Any]) -> dict[str, Any]:
    report_id = cleaned_result.get("report_id") or datetime.utcnow().strftime("api_%Y%m%d_%H%M%S")
    out_path = REPORTS_DIR / f"{report_id}_api.json"
    out_path.write_text(json.dumps(cleaned_result, indent=2, ensure_ascii=False), encoding="utf-8")
    saved_files = cleaned_result.get("saved_files")
    if not isinstance(saved_files, dict):
        saved_files = {}
    saved_files["api_json"] = str(out_path)
    cleaned_result["saved_files"] = saved_files
    return cleaned_result


def _parse_ts_or_now(value: str | None) -> datetime:
    if value and value.strip():
        return parse_timestamp(value)
    return datetime.utcnow()


@app.get("/")
def home() -> Any:
    return render_template("index.html", error_message="", form_data={})


@app.post("/run-analyze")
def run_analyze_page() -> Any:
    symbol = request.form.get("stock_symbol", "")
    timeframe = request.form.get("timeframe", "1d")
    start_date_raw = request.form.get("start_date")
    try:
        result = pipeline.analyze(stock_symbol=symbol, timeframe=timeframe)
        return render_template("result.html", mode="analyze", result=result)
    except Exception as e:
        return render_template(
            "index.html",
            error_message=f"Analysis failed: {str(e)}",
            form_data={
                "stock_symbol": symbol,
                "timeframe": timeframe,
                "start_date": start_date_raw or "",
            },
        ), 400


@app.get("/reports/<path:filename>")
def report_file(filename: str) -> Any:
    file_path = REPORTS_DIR / filename
    if not file_path.exists() or not file_path.is_file():
        return jsonify({"error": "Report file not found"}), 404
    return send_file(file_path)


@app.post("/api/v1/analyze")
def api_analyze() -> Any:
    try:
        payload = request.get_json() or {}
        symbol = payload.get("stock_symbol", "")
        timeframe = payload.get("timeframe", "1d")
        start_date_raw = payload.get("start_date") or payload.get("timestamp")
        start_ts = parse_timestamp(start_date_raw) if start_date_raw else None
        bars = _safe_bars(payload, timeframe)
        result = pipeline.analyze(stock_symbol=symbol, timeframe=timeframe, start_timestamp=start_ts, bars=bars)
        result = _enrich_api_payload(result)
        result = _strip_prompts_and_urls(result)
        result = _save_api_output(result)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.get("/health")
def health() -> Any:
    return jsonify({"ok": True, "service": "india-swing-trader"})


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8000)