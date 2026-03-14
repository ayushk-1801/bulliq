"""FinBot India v4 — Terminal Test"""
import asyncio, os
from dotenv import load_dotenv
load_dotenv()

from app.agents import run_agents
from app.memory import ConversationMemory

memory = ConversationMemory()
USER_ID = "test_user"

async def main():
    print("=" * 55)
    print(f"🤖 FinBot India v4 — Master Agent")
    print("'quit' to exit | 'clear' to reset history")
    print("=" * 55)
    print()
    print("Try: 'trend of Reliance last 6 months, buy sell or hold?'")
    print("Try: 'tax on 12 lakh income'")
    print("Try: 'SIP 5000 per month for 20 years'")
    print()

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n👋 Bye!"); break

        if not user_input: continue
        if user_input.lower() == "quit": break
        if user_input.lower() == "clear":
            memory.clear(USER_ID)
            print("🗑️ Cleared\n"); continue

        history = memory.get_history(USER_ID)
        result = await run_agents(USER_ID, user_input, history)
        memory.add_turn(USER_ID, user_input, result["reply"])

        live = "🟢 live" if result["had_live_data"] else "🔴 knowledge only"
        print(f"\n🤖 FinBot [{'/'.join(result['intents'])}] {live}:")
        print(result["reply"])
        if result.get("image_url"):
            print(f"\n🖼️  {result['image_url']}")
        print()

if __name__ == "__main__":
    asyncio.run(main())
