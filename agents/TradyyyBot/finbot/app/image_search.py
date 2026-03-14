"""
Image Search — Google Custom Search API
Free tier: 100 queries/day

Setup:
1. Go to https://programmablesearchengine.google.com → Create engine
2. Enable "Search the entire web"
3. Get your Search Engine ID (cx)
4. Get API key from https://console.cloud.google.com → Custom Search API

Add to .env:
GOOGLE_SEARCH_API_KEY=your_key
GOOGLE_SEARCH_CX=your_cx_id
"""

import os
import requests


class ImageSearch:
    def __init__(self):
        self.api_key = os.getenv("GOOGLE_SEARCH_API_KEY", "")
        self.cx = os.getenv("GOOGLE_SEARCH_CX", "")
        self.enabled = bool(self.api_key and self.cx)

    def search_images(self, query: str, num: int = 3) -> list[dict]:
        """
        Search for images using Google Custom Search API
        Returns list of {url, title, thumbnail}
        """
        if not self.enabled:
            return []

        try:
            response = requests.get(
                "https://www.googleapis.com/customsearch/v1",
                params={
                    "key": self.api_key,
                    "cx": self.cx,
                    "q": query,
                    "searchType": "image",
                    "num": num,
                    "safe": "active",
                    "imgType": "photo",
                },
                timeout=5
            )
            data = response.json()

            results = []
            for item in data.get("items", []):
                results.append({
                    "url": item.get("link"),
                    "title": item.get("title"),
                    "thumbnail": item.get("image", {}).get("thumbnailLink"),
                    "context_url": item.get("image", {}).get("contextLink"),
                })
            return results

        except Exception as e:
            print(f"Image search error: {e}")
            return []

    def get_chart_image(self, stock_or_query: str) -> str | None:
        """Get first chart image URL for a stock"""
        query = f"{stock_or_query} stock price chart 2024"
        results = self.search_images(query, num=1)
        return results[0]["url"] if results else None

    def get_finance_image(self, topic: str) -> str | None:
        """Get a relevant finance image"""
        results = self.search_images(f"{topic} India finance infographic", num=1)
        return results[0]["url"] if results else None

    def search_news_images(self, query: str) -> list[dict]:
        """Search for finance news related images"""
        return self.search_images(f"{query} India financial news 2024", num=3)


# ─────────────────────────────────────────────────────────
# Twilio MMS helper — sends image over WhatsApp
# ─────────────────────────────────────────────────────────

def build_twilio_response_with_image(text: str, image_url: str | None) -> str:
    """Build TwiML response with optional image attachment"""
    from twilio.twiml.messaging_response import MessagingResponse

    resp = MessagingResponse()

    if image_url:
        msg = resp.message(text)
        msg.media(image_url)
    else:
        resp.message(text)

    return str(resp)
