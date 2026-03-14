"""
FinBot India - WhatsApp Finance Chatbot
Stack: FastAPI + Groq (Llama 3.1 70B) + yfinance + AMFI API
"""

from fastapi import FastAPI, Form, Request
from fastapi.responses import PlainTextResponse
from twilio.twiml.messaging_response import MessagingResponse
import uvicorn

from .agents import run_agents
from .memory import ConversationMemory
from .image_search import build_twilio_response_with_image

app = FastAPI(title="FinBot India", version="2.0.0")
memory = ConversationMemory()


@app.get("/")
async def root():
    return {"status": "FinBot India v2 running 🚀 (Multi-Agent)", "version": "2.0.0"}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/webhook/whatsapp")
async def whatsapp_webhook(
    From: str = Form(...),
    Body: str = Form(...),
    NumMedia: int = Form(default=0)
):
    """Main WhatsApp webhook — routes to specialist agents"""
    user_id = From
    message = Body.strip()
    print(f"[{user_id}] → {message}")

    history = memory.get_history(user_id)
    result = await run_agents(user_id=user_id, message=message, history=history)

    reply = result["reply"]
    image_url = result.get("image_url")
    memory.add_turn(user_id, message, reply)

    print(f"[{result['agent']}] ← {reply[:80]}...")

    twiml = build_twilio_response_with_image(reply, image_url)
    return PlainTextResponse(twiml, media_type="text/xml")


@app.post("/chat")
async def chat_endpoint(request: Request):
    """REST endpoint for testing without WhatsApp"""
    body = await request.json()
    user_id = body.get("user_id", "test_user")
    message = body.get("message", "")

    history = memory.get_history(user_id)
    result = await run_agents(user_id=user_id, message=message, history=history)
    memory.add_turn(user_id, message, result["reply"])

    return {
        "reply": result["reply"],
        "agent_used": result["agent"],
        "has_image": bool(result.get("image_url")),
        "user_id": user_id,
    }


@app.delete("/chat/{user_id}/history")
async def clear_history(user_id: str):
    """Clear conversation history for a user"""
    memory.clear(user_id)
    return {"status": "cleared", "user_id": user_id}


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8002, reload=True)
