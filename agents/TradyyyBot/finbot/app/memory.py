"""
Conversation Memory Manager
In-memory for hackathon. Swap with Redis for production.
"""

from datetime import datetime
from collections import defaultdict


class ConversationMemory:
    def __init__(self, max_turns: int = 15):
        self.store = defaultdict(list)
        self.max_turns = max_turns
        self.timestamps = defaultdict(list)

    def get_history(self, user_id: str) -> list:
        """Get conversation history for a user"""
        return self.store.get(user_id, [])

    def add_turn(self, user_id: str, user_message: str, assistant_reply: str):
        """Add a conversation turn"""
        self.store[user_id].append({
            "user": user_message,
            "assistant": assistant_reply,
            "timestamp": datetime.now().isoformat()
        })
        self.timestamps[user_id].append(datetime.now())

        # Keep only last N turns
        if len(self.store[user_id]) > self.max_turns:
            self.store[user_id] = self.store[user_id][-self.max_turns:]

    def clear(self, user_id: str):
        """Clear history for a user"""
        self.store[user_id] = []
        self.timestamps[user_id] = []

    def get_stats(self, user_id: str) -> dict:
        """Get usage stats for a user"""
        history = self.store.get(user_id, [])
        return {
            "user_id": user_id,
            "total_turns": len(history),
            "first_message": self.timestamps[user_id][0].isoformat() if self.timestamps[user_id] else None,
        }

    def all_users(self) -> list:
        return list(self.store.keys())


# ────────────────────────────────────────────────
# Redis-based memory (uncomment for production)
# ────────────────────────────────────────────────
# import redis, json
# class RedisMemory:
#     def __init__(self, url="redis://localhost:6379", ttl=86400):
#         self.r = redis.from_url(url)
#         self.ttl = ttl  # 24h expiry
#
#     def get_history(self, user_id):
#         data = self.r.get(f"finbot:{user_id}")
#         return json.loads(data) if data else []
#
#     def add_turn(self, user_id, user_msg, bot_reply):
#         history = self.get_history(user_id)
#         history.append({"user": user_msg, "assistant": bot_reply})
#         history = history[-15:]  # keep last 15
#         self.r.setex(f"finbot:{user_id}", self.ttl, json.dumps(history))
#
#     def clear(self, user_id):
#         self.r.delete(f"finbot:{user_id}")
