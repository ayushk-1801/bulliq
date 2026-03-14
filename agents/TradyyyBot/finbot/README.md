# 🤖 FinBot India — WhatsApp Finance Chatbot

A free, production-ready AI chatbot for personal finance, taxes, stocks, and investments — deployable on WhatsApp.

**Stack:** FastAPI + Groq (Llama 3.3 70B) + yfinance + AMFI India API + Twilio

---

## ✨ Features

- 💰 **Live stock prices** (NSE/BSE via yfinance)
- 📊 **Mutual fund NAVs** (AMFI India free API)
- 🧾 **Tax calculator** (New & Old regime, FY 2024-25)
- 📈 **SIP calculator** with corpus projection
- 📚 **Deep finance knowledge** (PPF, NPS, ELSS, FDs, etc.)
- 💬 **Conversation memory** per WhatsApp user
- ⚡ **Groq (free tier)** for ultra-fast responses
- 🔁 **Gemini Flash fallback** (optional)

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone <your-repo>
cd finbot
pip install -r requirements.txt
```

### 2. Set API Keys

```bash
cp .env.example .env
# Edit .env with your keys
```

**Get free API keys:**
| Service | Link | Cost |
|---------|------|------|
| Groq | [console.groq.com](https://console.groq.com) | FREE |
| Gemini | [aistudio.google.com](https://aistudio.google.com) | FREE |
| Twilio | [twilio.com](https://twilio.com) | Free sandbox |

### 3. Test Without WhatsApp

```bash
python test_bot.py
```

### 4. Run the Server

```bash
uvicorn app.main:app --reload --port 8002
```

### 5. Connect to WhatsApp (Twilio Sandbox)

```bash
# Expose local server
ngrok http 8002

# Copy the https URL e.g: https://abc123.ngrok.io
# Go to Twilio Console → Messaging → WhatsApp Sandbox
# Set webhook URL to: https://abc123.ngrok.io/webhook/whatsapp
```

Then WhatsApp the Twilio sandbox number to start!

---

## 📁 Project Structure

```
finbot/
├── app/
│   ├── main.py        # FastAPI routes & webhook
│   ├── agent.py       # LLM agent (Groq + Gemini)
│   ├── tools.py       # Live data (stocks, MF, calculators)
│   ├── knowledge.py   # Finance knowledge base + system prompt
│   └── memory.py      # Conversation memory (in-memory / Redis)
├── test_bot.py        # CLI test (no WhatsApp needed)
├── requirements.txt
└── .env.example
```

---

## 🧪 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Health check |
| `POST` | `/webhook/whatsapp` | Twilio WhatsApp webhook |
| `POST` | `/chat` | REST chat (testing) |
| `DELETE` | `/chat/{user_id}/history` | Clear user history |

### Test via REST:

```bash
curl -X POST http://localhost:8002/chat \
  -H "Content-Type: application/json" \
  -d '{"user_id": "user1", "message": "What is PPF?"}'
```

---

## 🔧 Example Conversations

```
You: What is my tax if I earn 12 lakh?
Bot: 🧾 Tax Calculator (New Regime)
     Gross Income: ₹12,00,000
     ─────────────────
     Income Tax: ₹83,200
     Cess (4%): ₹3,328
     Total Tax: ₹86,528
     Effective Rate: 7.2%

You: What's the price of Reliance?
Bot: 📈 RELIANCE: ₹2,847.30 (+12.50, +0.44%)

You: If I do SIP of 5000/month for 20 years?
Bot: 📊 SIP Calculator
     Monthly: ₹5,000
     Duration: 20 years
     Expected Return: 12% p.a.
     ─────────────────
     Total Invested: ₹12,00,000
     Est. Returns: ₹37,59,743
     Total Corpus: ₹49,59,743
```

---

## 🏆 Hackathon Upgrades

| Feature | How to Add |
|---------|------------|
| **Persistent memory** | Swap `ConversationMemory` with `RedisMemory` |
| **More stocks** | Expand `stock_map` in `agent.py` |
| **RAG** | Add ChromaDB + LlamaIndex with SEBI/RBI docs |
| **Voice** | Add Whisper for voice note transcription |
| **Portfolio tracker** | Add user portfolio storage in DB |
| **Market news** | Add NewsAPI or RSS feed integration |

---

## 📝 Disclaimer

FinBot is for educational purposes only. It is NOT a SEBI-registered investment advisor. Always consult a certified financial planner for actual investment decisions.
