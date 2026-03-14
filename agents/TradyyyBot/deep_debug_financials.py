import yfinance as yf
import pandas as pd
import numpy as np

def debug_stock(symbol):
    print(f"\n{'='*40}")
    print(f"DEBUGGING: {symbol}")
    print(f"{'='*40}")
    t = yf.Ticker(symbol)
    
    print("\n[INFO]")
    try:
        info = t.info
        if not info:
            print("  info is EMPTY")
        else:
            important_keys = [
                "currentPrice", "regularMarketPrice", "marketCap", 
                "trailingPE", "forwardPE", "trailingEps",
                "returnOnEquity", "debtToEquity", "totalRevenue",
                "grossMargins", "operatingMargins", "ebitdaMargins"
            ]
            for k in important_keys:
                print(f"  {k}: {info.get(k)}")
    except Exception as e:
        print(f"  info failed: {e}")
    
    print("\n[FAST_INFO]")
    try:
        fi = t.fast_info
        print(f"  market_cap: {fi.get('market_cap')}")
        print(f"  last_price: {fi.get('last_price')}")
    except Exception as e:
        print(f"  fast_info failed: {e}")

    print("\n[STATEMENTS AVAILABILITY]")
    print(f"  financials: {not t.financials.empty if t.financials is not None else False}")
    print(f"  quarterly_financials: {not t.quarterly_financials.empty if t.quarterly_financials is not None else False}")
    print(f"  balance_sheet: {not t.balance_sheet.empty if t.balance_sheet is not None else False}")
    print(f"  quarterly_balance_sheet: {not t.quarterly_balance_sheet.empty if t.quarterly_balance_sheet is not None else False}")

    if t.financials is not None and not t.financials.empty:
        print("\n[FINANCIALS INDEX (LATEST)]")
        print(t.financials.index.tolist())

if __name__ == "__main__":
    for sym in ["TATACONSUM.NS", "VIKRAMSOLR.NS", "RELIANCE.NS"]:
        debug_stock(sym)
