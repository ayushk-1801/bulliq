"""
FinBot v4 — Master Agent
========================
One smart agent that:
- Detects ALL intents in a query (multi-intent)
- Fetches live data via 3-layer fallback (no more hallucination)
- Gives specific, data-driven advice using actual numbers
- Knows today's date (critical fix)
- Never invents price tables from training memory
"""

import os
from datetime import datetime
from dotenv import load_dotenv
load_dotenv()
from groq import Groq
from .tools import FinanceTools
from .image_search import ImageSearch

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
tools = FinanceTools()
image_search = ImageSearch()
MODEL = "llama-3.3-70b-versatile"
TODAY = datetime.now().strftime("%d %B %Y")  # e.g. "14 March 2026"


# ─────────────────────────────────────────────────────────────
# STOCK MAP — exhaustive, no regex matching on random words
# ─────────────────────────────────────────────────────────────

STOCK_MAP = {
    "reliance": ("RELIANCE.NS", "Reliance Industries"),
    "tcs": ("TCS.NS", "Tata Consultancy Services"),
    "tata consultancy": ("TCS.NS", "TCS"),
    "infosys": ("INFY.NS", "Infosys"),
    "infy": ("INFY.NS", "Infosys"),
    "hdfc bank": ("HDFCBANK.NS", "HDFC Bank"),
    "hdfcbank": ("HDFCBANK.NS", "HDFC Bank"),
    "icici bank": ("ICICIBANK.NS", "ICICI Bank"),
    "icici": ("ICICIBANK.NS", "ICICI Bank"),
    "sbi": ("SBIN.NS", "SBI"),
    "state bank": ("SBIN.NS", "SBI"),
    "wipro": ("WIPRO.NS", "Wipro"),
    "bajaj finance": ("BAJFINANCE.NS", "Bajaj Finance"),
    "bajaj finserv": ("BAJAJFINSV.NS", "Bajaj Finserv"),
    "kotak": ("KOTAKBANK.NS", "Kotak Mahindra Bank"),
    "itc": ("ITC.NS", "ITC"),
    "hul": ("HINDUNILVR.NS", "Hindustan Unilever"),
    "hindustan unilever": ("HINDUNILVR.NS", "HUL"),
    "maruti": ("MARUTI.NS", "Maruti Suzuki"),
    "tata motors": ("TATAMOTORS.NS", "Tata Motors"),
    "airtel": ("BHARTIARTL.NS", "Bharti Airtel"),
    "bharti airtel": ("BHARTIARTL.NS", "Bharti Airtel"),
    "adani enterprises": ("ADANIENT.NS", "Adani Enterprises"),
    "adani ports": ("ADANIPORTS.NS", "Adani Ports"),
    "adani green": ("ADANIGREEN.NS", "Adani Green"),
    "ongc": ("ONGC.NS", "ONGC"),
    "ntpc": ("NTPC.NS", "NTPC"),
    "power grid": ("POWERGRID.NS", "Power Grid"),
    "l&t": ("LT.NS", "L&T"),
    "larsen": ("LT.NS", "L&T"),
    "sun pharma": ("SUNPHARMA.NS", "Sun Pharma"),
    "dr reddy": ("DRREDDY.NS", "Dr Reddys"),
    "asian paints": ("ASIANPAINT.NS", "Asian Paints"),
    "titan": ("TITAN.NS", "Titan"),
    "nestle": ("NESTLEIND.NS", "Nestle India"),
    "zomato": ("ZOMATO.NS", "Zomato"),
    "paytm": ("PAYTM.NS", "Paytm"),
    "axis bank": ("AXISBANK.NS", "Axis Bank"),
    "tata steel": ("TATASTEEL.NS", "Tata Steel"),
    "jsw steel": ("JSWSTEEL.NS", "JSW Steel"),
    "hindalco": ("HINDALCO.NS", "Hindalco"),
}


# ─────────────────────────────────────────────────────────────
# MASTER SYSTEM PROMPT — with today's date + no-hallucination rule
# ─────────────────────────────────────────────────────────────

def build_system_prompt() -> str:
    return f"""You are *FinBot India* 🇮🇳 — a sharp, expert financial advisor on WhatsApp.
Today's date: *{TODAY}*

━━━━━━━━━━━━━━━━━━
CRITICAL RULES
━━━━━━━━━━━━━━━━━━
1. LIVE DATA: When you see [LIVE DATA] section, use THOSE EXACT numbers. Do not change them.
2. NO HALLUCINATION: If live data is NOT provided for a stock price/trend, say "I couldn't fetch live prices right now. Check NSE/BSE directly." Do NOT invent price tables or historical figures from your training data.
3. TODAY IS {TODAY}. Never reference 2022 or 2023 as "recent" — your training data is outdated for prices.
4. SPECIFIC ADVICE: When you have live data with trend + 52W position, give specific buy/sell/hold with REASONS from the actual numbers. Not generic disclaimers.
5. FORMAT: WhatsApp markdown. *bold* for key numbers. Keep under 300 words.
6. ALWAYS add: ⚠️ Not SEBI-registered advice — at the end of any buy/sell/hold recommendation.

━━━━━━━━━━━━━━━━━━
KNOWLEDGE BASE
━━━━━━━━━━━━━━━━━━
TAX FY 2024-25 (New): 0-3L=0%, 3-7L=5%, 7-10L=10%, 10-12L=15%, 12-15L=20%, >15L=30%
Std deduction ₹75K | 87A rebate: zero tax if ≤₹7L | STCG=20% | LTCG=12.5% above ₹1.25L
Old regime: 80C ₹1.5L | 80D ₹25K | 80CCD(1B) ₹50K | HRA | Home loan ₹2L

SAFE INVESTMENTS: PPF 7.1%(EEE) | NPS ~10-12% | SCSS 8.2% | NSC 7.7% | SGB 2.5%+gold | FD ~7%
MUTUAL FUNDS: Index > active long-term | Direct > regular plans | SIP > timing | ELSS=80C+equity
FIRE: corpus = expenses×25 | Emergency = 6mo expenses in liquid fund | Term insurance = 10-15× income

━━━━━━━━━━━━━━━━━━
HOW TO GIVE STOCK ADVICE (when live data present)
━━━━━━━━━━━━━━━━━━
Use these signals from [LIVE DATA]:
- Trend (uptrend/downtrend/sideways) → momentum signal
- 6-Month Return → strength of move
- % from 52W High → near high = caution; near low = potential value
- P/E ratio → compare to sector average (Nifty avg ~22x)

Example of GOOD advice (specific):
"Reliance is in an uptrend with +8% over 6 months. Currently 12% below its 52W high at ₹2,856.
At P/E of 26x vs Nifty avg 22x, it's slightly premium-priced.
Hold if you own it. New buyers could wait for a dip to ₹2,400-2,450 range.
⚠️ Not SEBI-registered advice."

Example of BAD advice (generic — never do this):
"It depends on your risk tolerance. You should consult a financial advisor."
"""


# ─────────────────────────────────────────────────────────────
# INTENT DETECTION
# ─────────────────────────────────────────────────────────────

async def detect_intents(message: str) -> list[str]:
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": (
            f'Classify this finance query into categories. Output ONLY comma-separated values from:\n'
            f'STOCK, TAX, MF, INVEST, CALCULATE_SIP, CALCULATE_TAX, GENERAL\n\n'
            f'Rules:\n'
            f'- STOCK: any mention of stocks, shares, Nifty, Sensex, market trend, buy/sell/hold\n'
            f'- CALCULATE_TAX: "how much tax", "tax on X lakh", "tax for"\n'
            f'- CALCULATE_SIP: "SIP of X", "invest X per month", "corpus in Y years"\n'
            f'- Multiple categories OK for hybrid questions\n\n'
            f'Query: "{message}"\n\nOutput:'
        )}],
        max_tokens=20,
        temperature=0,
    )
    raw = resp.choices[0].message.content.strip().upper()
    valid = {"STOCK", "TAX", "MF", "INVEST", "GENERAL", "CALCULATE_SIP", "CALCULATE_TAX"}
    intents = [i.strip() for i in raw.split(",") if i.strip() in valid]
    return intents or ["GENERAL"]


# ─────────────────────────────────────────────────────────────
# DATA GATHERING
# ─────────────────────────────────────────────────────────────

def _extract_amount(text: str):
    import re
    t = text.lower().replace(",", "")
    c = re.search(r'(\d+(?:\.\d+)?)\s*(?:crore|cr\b)', t)
    l = re.search(r'(\d+(?:\.\d+)?)\s*(?:lakh|lac|l\b)', t)
    p = re.search(r'(\d{4,})', t)
    if c: return float(c.group(1)) * 1e7
    if l: return float(l.group(1)) * 1e5
    if p: return float(p.group(1))
    return None

def _extract_years(text: str):
    import re
    m = re.search(r'(\d+)\s*(?:year|yr)', text.lower())
    return int(m.group(1)) if m else None

async def gather_live_data(message: str, intents: list[str]) -> tuple[str, str | None]:
    msg = message.lower()
    data_parts = []
    fail_parts = []
    image_url = None

    # ── STOCK / INDEX ──
    if "STOCK" in intents:
        fetched = False

        if any(k in msg for k in ["nifty", "nifty 50"]):
            r = tools.get_nifty50()
            (data_parts if r.success else fail_parts).append(r.data)
            fetched = fetched or r.success

        if any(k in msg for k in ["sensex", "bse index"]):
            r = tools.get_sensex()
            (data_parts if r.success else fail_parts).append(r.data)
            fetched = fetched or r.success

        # Only match from known map — no regex on random words
        for name, (ticker, display) in STOCK_MAP.items():
            if name in msg:
                r = tools.get_stock_full(ticker, display)
                (data_parts if r.success else fail_parts).append(r.data)
                fetched = fetched or r.success
                if r.success and not image_url:
                    image_url = image_search.get_chart_image(f"{display} NSE stock chart 2025")
                break  # one stock per query to avoid spam

    # ── TAX CALC ──
    if "CALCULATE_TAX" in intents:
        amt = _extract_amount(message)
        if amt:
            data_parts.append(tools.calculate_tax(amt, "new").data)
            data_parts.append(tools.calculate_tax(amt, "old").data)

    # ── SIP CALC ──
    if "CALCULATE_SIP" in intents:
        amt = _extract_amount(message)
        yrs = _extract_years(message)
        if amt and yrs:
            data_parts.append(tools.calculate_sip(amt, yrs).data)

    # ── MF NAV ──
    if "MF" in intents:
        for trigger in ["nav of", "nav for"]:
            if trigger in msg:
                fund = msg.split(trigger)[-1].strip()
                r = tools.get_mf_nav(fund)
                (data_parts if r.success else fail_parts).append(r.data)
                break

    # Build context
    context = ""
    if data_parts:
        context += f"[LIVE DATA — use these exact numbers, today is {TODAY}]:\n"
        context += "\n\n".join(data_parts)
    if fail_parts:
        context += "\n\n[FETCH FAILED — do NOT invent prices, say data is unavailable]:\n"
        context += "\n".join(fail_parts)

    return context, image_url


# ─────────────────────────────────────────────────────────────
# MASTER ORCHESTRATOR
# ─────────────────────────────────────────────────────────────

async def run_agents(user_id: str, message: str, history: list) -> dict:
    intents = await detect_intents(message)
    print(f"[Master] Intents: {intents}")

    live_context, image_url = await gather_live_data(message, intents)
    had_live = "[LIVE DATA" in live_context

    print(f"[Master] Live data: {'✓' if had_live else '✗ failed/not needed'}")

    full_message = f"{message}\n\n{live_context}" if live_context else message

    msgs = []
    for turn in history[-6:]:
        msgs.append({"role": "user", "content": turn["user"]})
        msgs.append({"role": "assistant", "content": turn["assistant"]})
    msgs.append({"role": "user", "content": full_message})

    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "system", "content": build_system_prompt()}] + msgs,
        max_tokens=700,
        temperature=0.3,
    )

    return {
        "reply": resp.choices[0].message.content,
        "agent": intents[0] if intents else "GENERAL",
        "intents": intents,
        "image_url": image_url,
        "had_live_data": had_live,
    }
