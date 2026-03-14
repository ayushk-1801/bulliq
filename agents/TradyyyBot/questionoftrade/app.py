from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from google import genai
from ddgs import DDGS
import re
import urllib.parse
import time
import requests
import os
import glob
import random
import base64

GEMINI_API_KEY = "AIzaSyDeC5RdJKz0XY90k9uymqiUWKv_tZd9Itk"
client = genai.Client(api_key=GEMINI_API_KEY)
MODEL_ID = 'gemini-3.1-flash-lite-preview'

app = FastAPI(title="AI Stock Tutor API")

app.mount("/images", StaticFiles(directory="images"), name="images")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class QuestionRequest(BaseModel):
    previously_asked: list[str] = []

class GradeRequest(BaseModel):
    qa_pairs: str

GUARANTEED_IMAGES = {
    "head and shoulders": "http://127.0.0.1:8001/images/head_and_shoulders.png",
    "double bottom": "http://127.0.0.1:8001/images/double_bottom.png",
    "double top": "http://127.0.0.1:8001/images/double_top.png",
    "bull flag": "http://127.0.0.1:8001/images/bull_flag.png",
    "bear flag": "http://127.0.0.1:8001/images/bear_flag.png",
    "cup and handle": "http://127.0.0.1:8001/images/cup_and_handle.png",
    "ascending triangle": "http://127.0.0.1:8001/images/ascending_triangle.png",
    "descending triangle": "http://127.0.0.1:8001/images/descending_triangle.png",
    "pennant": "http://127.0.0.1:8001/images/pennant.png",
    "wedge": "http://127.0.0.1:8001/images/wedge.png",
    "doji": "http://127.0.0.1:8001/images/doji.png",
    "hammer": "http://127.0.0.1:8001/images/hammer.png",
    "shooting star": "http://127.0.0.1:8001/images/shooting_star.png",
    "engulfing": "http://127.0.0.1:8001/images/engulfing.png",
    "morning star": "http://127.0.0.1:8001/images/morning_star.png",
    "rsi": "http://127.0.0.1:8001/images/rsi.png",
    "macd": "http://127.0.0.1:8001/images/macd.png",
    "bollinger bands": "http://127.0.0.1:8001/images/bollinger_bands.png",
    "golden cross": "http://127.0.0.1:8001/images/golden_cross.png",
    "support and resistance": "http://127.0.0.1:8001/images/support_and_resistance.png"
}

REMOTE_IMAGES = {
    "head and shoulders": "https://www.investopedia.com/thmb/9W6-VbB2aE_EwA4Q3B0E5xM_I5Y=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/HeadAndShoulders-96865239e3ec4f458e3ea3d63b2229fd.png",
    "double bottom": "https://www.investopedia.com/thmb/Y-9k-Yw-8W7Y-6-8-0-0/double-bottom-5bfc2f6fc9e77c005167570d.png",
    "double top": "https://www.investopedia.com/thmb/Y-9k-Yw-8W7Y-6-8-0-1/double-top-5bfc2f6fc9e77c005167570e.png",
    "bull flag": "https://www.investopedia.com/thmb/9W6-VbB2aE_EwA4Q3B0E5xM_I5Y=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/BullFlag-f32a5df679ec46058e3ea3d63b2229fd.png",
    "bear flag": "https://www.investopedia.com/thmb/9W6-VbB2aE_EwA4Q3B0E5xM_I5Y=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/BearFlag-f32a5df679ec46058e3ea3d63b2229fd.png",
    "cup and handle": "https://www.investopedia.com/thmb/9W6-VbB2aE_EwA4Q3B0E5xM_I5Y=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/CupAndHandle-f32a5df679ec46058e3ea3d63b2229fd.png",
    "ascending triangle": "https://www.investopedia.com/thmb/9W6-VbB2aE_EwA4Q3B0E5xM_I5Y=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/AscendingTriangle-f32a5df679ec46058e3ea3d63b2229fd.png",
    "descending triangle": "https://www.investopedia.com/thmb/9W6-VbB2aE_EwA4Q3B0E5xM_I5Y=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/DescendingTriangle-f32a5df679ec46058e3ea3d63b2229fd.png",
    "pennant": "https://www.investopedia.com/thmb/9W6-VbB2aE_EwA4Q3B0E5xM_I5Y=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/Pennant-f32a5df679ec46058e3ea3d63b2229fd.png",
    "wedge": "https://www.investopedia.com/thmb/9W6-VbB2aE_EwA4Q3B0E5xM_I5Y=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/Wedge-f32a5df679ec46058e3ea3d63b2229fd.png",
    "doji": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Candlestick_doji.svg/300px-Candlestick_doji.svg.png",
    "hammer": "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/Candlestick_hammer.svg/300px-Candlestick_hammer.svg.png",
    "shooting star": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Candlestick_shooting_star.svg/300px-Candlestick_shooting_star.svg.png",
    "engulfing": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Candlestick_engulfing.svg/300px-Candlestick_engulfing.svg.png",
    "morning star": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Morning_star_pattern.png/300px-Morning_star_pattern.png",
    "rsi": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/RSI_divergence.png/400px-RSI_divergence.png",
    "macd": "https://www.investopedia.com/thmb/9W6-VbB2aE_EwA4Q3B0E5xM_I5Y=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/MACD-f32a5df679ec46058e3ea3d63b2229fd.png",
    "bollinger bands": "https://www.investopedia.com/thmb/9W6-VbB2aE_EwA4Q3B0E5xM_I5Y=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/BollingerBands-f32a5df679ec46058e3ea3d63b2229fd.png",
    "golden cross": "https://www.investopedia.com/thmb/9W6-VbB2aE_EwA4Q3B0E5xM_I5Y=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/GoldenCross-f32a5df679ec46058e3ea3d63b2229fd.png",
    "support and resistance": "https://www.investopedia.com/thmb/9W6-VbB2aE_EwA4Q3B0E5xM_I5Y=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/SupportAndResistance-f32a5df679ec46058e3ea3d63b2229fd.png"
}

def get_available_patterns():
    if not os.path.exists("images"):
        return []
    pattern_files = glob.glob("images/*.png")
    patterns = []
    for f in pattern_files:
        name = os.path.basename(f).replace('.png', '').replace('_', ' ')
        name = re.sub(r'\b(a|an|the|pattern|candlestick)\b', '', name).strip()
        name = re.sub(r'\s+', ' ', name)
        name_lower = name.lower()
        if 'bearish engulfing' in name_lower or 'engulfing' in name_lower:
            patterns.append('engulfing')
        elif 'bull flag' in name_lower:
            patterns.append('bull flag')
        elif 'double bottom' in name_lower:
            patterns.append('double bottom')
        elif 'head and shoulders' in name_lower or 'head shoulders' in name_lower:
            patterns.append('head and shoulders')
        elif 'ascending triangle' in name_lower:
            patterns.append('ascending triangle')
        elif 'double top' in name_lower:
            patterns.append('double top')
    return list(set(patterns))

@app.post("/generate_questions")
def generate_questions(req: QuestionRequest):
    available = get_available_patterns()
    if available:
        selected = random.sample(available, min(5, len(available)))
        pattern_list = ', '.join(selected)
    else:
        selected = []
        pattern_list = "various trading patterns"
    
    prompt = f"""
    You are an expert financial tutor. Generate exactly 10 questions.
    RULES:
    - Q1 to Q5: Text-based trading theory questions.
    - Q6 to Q10: Each starts with [Image of X] where X is one of these patterns: {pattern_list}, followed by a question about trading strategy, psychology, or stop-loss placement based on that image.
    Previously asked: {req.previously_asked}
    Output ONLY 10 lines. No numbers.
    """
    try:
        response = client.models.generate_content(model=MODEL_ID, contents=prompt)
        raw_lines = response.text.strip().split('\n')
        raw_questions = [re.sub(r'^\d+[\.\)]\s*', '', line.strip()) for line in raw_lines if line.strip()][:10]
        
        structured_questions = []
        ddgs = DDGS()
        
        for q in raw_questions:
            image_match = re.search(r'\[Image of (.*?)\]', q, re.IGNORECASE)
            if image_match:
                pattern_name = image_match.group(1).strip()
                pattern_lower = pattern_name.lower()
                clean_text = re.sub(r'\[Image of .*?\]', '', q, flags=re.IGNORECASE).strip()
                dynamic_url = None

                # Tier 1: Local images
                available = get_available_patterns()
                for pat in available:
                    if pat in pattern_lower:
                        for f in glob.glob("images/*.png"):
                            fname = os.path.basename(f).lower()
                            if pat.replace(' ', '_') in fname or all(word in fname for word in pat.split()):
                                dynamic_url = f"http://127.0.0.1:8001/{f}"
                                break
                        if dynamic_url:
                            break
                
                # Tier 2: Search
                if not dynamic_url:
                    try:
                        results = ddgs.images(f"{pattern_name} stock chart", max_results=1)
                        for r in results:
                            remote_url = r.get('image')
                            if remote_url:
                                try:
                                    response = requests.get(remote_url, timeout=5)
                                    if response.status_code == 200:
                                        filename = f"images/{pattern_lower.replace(' ', '_')}.png"
                                        with open(filename, 'wb') as f:
                                            f.write(response.content)
                                        dynamic_url = f"http://127.0.0.1:8001/{filename}"
                                except:
                                    pass
                            break
                    except: pass
                    time.sleep(1.0) 

                if not dynamic_url:
                    safe_name = urllib.parse.quote_plus(pattern_name)
                    dynamic_url = f"https://placehold.co/600x400/1e293b/f8fafc?text={safe_name}"
                
                if dynamic_url.startswith("http://127.0.0.1:8001/"):
                    image_path = dynamic_url.replace("http://127.0.0.1:8001/", "")
                    if os.path.exists(image_path):
                        with open(image_path, 'rb') as f:
                            image_bytes = f.read()
                        image_data = base64.b64encode(image_bytes).decode('utf-8')
                        structured_questions.append({"text": clean_text, "image_data": image_data})
                    else:
                        structured_questions.append({"text": clean_text, "image_data": None})
                else:
                    structured_questions.append({"text": clean_text, "image_url": dynamic_url})
            else:
                structured_questions.append({"text": q, "image_data": None})
                
        return {"questions": structured_questions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/grade_test")
def grade_test(req: GradeRequest):
    prompt = f"Grade these trading answers. Give feedback and final score: \n{req.qa_pairs}\nEnd with 'FINAL_SCORE: X/10'"
    try:
        response = client.models.generate_content(model=MODEL_ID, contents=prompt)
        score_match = re.search(r'FINAL_SCORE:\s*(\d+)', response.text)
        return {"score": int(score_match.group(1)) if score_match else 0, "feedback": response.text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))