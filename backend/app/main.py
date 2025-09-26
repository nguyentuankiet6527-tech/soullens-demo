from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import librosa
import numpy as np
import uvicorn
import os
import re

app = FastAPI()

# Cho phép frontend gọi API
origins = [
    "http://127.0.0.1:5500",
    "http://localhost:5500"
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----- Data Model -----
class TextIn(BaseModel):
    text: str

# Từ điển cảm xúc chi tiết hơn, giống frontend
EMOTION_DICT = {
    'happy': ['vui', 'tuyệt', 'tốt', 'hạnh phúc', 'yeah', 'ngon', 'sung sướng', 'thoải mái', 'haha', 'hehe', '😂', '=)))'],
    'sad': ['buồn', 'chán', 'mệt', 'tuyệt vọng', 'cô đơn', 'khóc', 'đau', 'stress', 'mệt mỏi', 'buồn bã', 'u ám', '😔'],
    'angry': ['giận', 'bực', 'phẫn nộ', 'tức', 'ghét', 'cáu', 'đáng ghét', '😡'],
    'anxious': ['lo', 'lo lắng', 'bồn chồn', 'hồi hộp', 'áp lực', 'bất an', 'căng thẳng', 'bất lực', '😟'],
    'curious': ['sao', 'tại sao', 'làm sao', 'thế nào', 'gì', '?', 'tìm hiểu', '🤔'],
    'calm': ['bình thường', 'êm', 'nhẹ nhàng', 'bình yên', 'ổn', '😌', '😐'],
}

# ----- API kiểm tra -----
@app.get("/health")
async def health():
    return {"status": "ok"}

# ----- Xử lý văn bản nâng cấp 5 cảm xúc -----
@app.post("/analyze_text")
async def analyze_text(payload: TextIn):
    text = payload.text.strip().lower()
    
    # Tính điểm cho từng cảm xúc dựa trên từ khóa
    mood_scores = {mood: 0 for mood in EMOTION_DICT}
    total_score = 0
    for mood, keywords in EMOTION_DICT.items():
        score = sum(1 for keyword in keywords if keyword in text)
        mood_scores[mood] = score
        total_score += score
    
    # Chọn cảm xúc có điểm cao nhất
    if total_score == 0:
        emotion = "neutral"
        confidence = 0.5
    else:
        top_mood = max(mood_scores, key=mood_scores.get)
        emotion = top_mood
        confidence = 0.5 + (mood_scores[top_mood] / total_score) * 0.5
        confidence = min(round(confidence, 2), 1.0) # giới hạn tối đa 1.0

    return {"emotion": emotion, "confidence": confidence}

# ----- Phân tích âm thanh -----
def compute_rms(y):
    return np.sqrt(np.mean(y**2))

def compute_zcr(y):
    return np.mean(librosa.zero_crossings(y))

@app.post("/analyze_audio")
async def analyze_audio(file: UploadFile = File(...)):
    try:
        path = f"temp_{file.filename}"
        with open(path, "wb") as f:
            f.write(await file.read())

        y, sr = librosa.load(path, sr=None)
        
        # Tính toán các đặc trưng giống frontend
        rms = compute_rms(y)
        zcr = compute_zcr(y)
        
        # Phân loại cảm xúc dựa trên đặc trưng
        if rms > 0.08:
            emotion = "energetic"
            confidence = 0.75
        elif rms < 0.02:
            emotion = "sad"
            confidence = 0.8
        elif zcr > 0.2:
            emotion = "agitated"
            confidence = 0.65
        else:
            emotion = "calm"
            confidence = 0.9

        os.remove(path)

        return {
            "filename": file.filename,
            "emotion": emotion,
            "confidence": confidence
        }

    except Exception as e:
        return {"error": str(e)}

# ----- Run server -----
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)