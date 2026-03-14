import yfinance as yf
import pandas as pd
import numpy as np

def debug_stock(symbol):
    print(f"--- Debugging {symbol} ---")
    t = yf.Ticker(symbol)
    
    print("\n[INFO]")
    info = t.info
    for k in ["currentPrice", "regularMarketPrice", "marketCap", "trailingPE", "returnOnEquity", "debtToEquity"]:
        print(f"  {k}: {info.get(k)}")
    
    print("\n[FAST_INFO]")
    try:
        print(f"  market_cap: {t.fast_info.market_cap}")
        print(f"  last_price: {t.fast_info.last_price}")
    except:
        print("  fast_info failed")

    print("\n[FINANCIALS]")
    fin = t.financials
    if fin is not None and not fin.empty:
        print(f"  Annual Financials Columns: {list(fin.columns)}")
        print(f"  Annual Financials Index: {list(fin.index[:10])}...")
    else:
        print("  Annual Financials EMPTY")

    print("\n[QUARTERLY_FINANCIALS]")
    qfin = t.quarterly_financials
    if qfin is not None and not qfin.empty:
        print(f"  Quarterly Financials Columns: {list(qfin.columns)}")
        print(f"  Quarterly Financials Index: {list(qfin.index[:10])}...")
    else:
        print("  Quarterly Financials EMPTY")

    print("\n[BALANCE_SHEET]")
    bs = t.balance_sheet
    if bs is not None and not bs.empty:
        print(f"  Annual Balance Sheet Columns: {list(bs.columns)}")
    else:
        print("  Annual Balance Sheet EMPTY")

    print("\n[QUARTERLY_BALANCE_SHEET]")
    qbs = t.quarterly_balance_sheet
    if qbs is not None and not qbs.empty:
        print(f"  Quarterly Balance Sheet Columns: {list(qbs.columns)}")
    else:
        print("  Quarterly Balance Sheet EMPTY")

if __name__ == "__main__":
    debug_stock("TATACONSUM.NS")
    debug_stock("RELIANCE.NS")
