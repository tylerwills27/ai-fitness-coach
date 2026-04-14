import os
from dotenv import load_dotenv

# --- Force reload environment from backend/.env ---
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=True)
_key = os.getenv("OPENAI_API_KEY") or ""
print(f"🔑 Key prefix (api_server): {_key[:8]}")

from fastapi import FastAPI, Request, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# 🔧 Use local modules (from src/)
from src import rag_utils, ai_utils

import tempfile, traceback
from typing import List, Dict, Optional
from openai import OpenAI, APIError, APIConnectionError, RateLimitError, BadRequestError, AuthenticationError

client = OpenAI()  # used for Whisper transcription

app = FastAPI(title="AI Fitness Coach Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "AI Fitness Coach Backend is running"}


# ---------- Tone & Length ----------
TONE_PRESETS: Dict[str, str] = {
    "motivational": (
        "Role: High-energy, supportive fitness coach.\n"
        "Style: Very encouraging, action-oriented, short punchy lines (1–3 sentences per paragraph).\n"
        "Use strong verbs, hype the user up, and end with a single upbeat one-liner (<= 10 words).\n"
        "Never shame the user; always focus on progress and possibility."
    ),
    "friendly": (
        "Role: Friendly, conversational coach.\n"
        "Style: Warm, practical, approachable. Talk like a supportive friend who knows fitness.\n"
        "Use simple language, 1–3 short paragraphs, and optional light emojis (not too many)."
    ),
    "drill": (
        "Role: Tough-love coach (respectful, safety-first).\n"
        "Style: Ultra-brief, direct, no fluff. Use imperative sentences (Do this, Then that).\n"
        "If lists are needed, use max 3 bullets, 1 short line each.\n"
        "No emojis. No insults. Keep total answer under ~60 words."
    ),
    "educator": (
        "Role: Evidence-informed educator.\n"
        "Style: Calm, clear explanations. Briefly define key terms and explain the 'why' in plain English.\n"
        "Use 2–4 short paragraphs or 3 numbered steps when helpful.\n"
        "If the evidence is limited or not clearly supported by context, say that and keep advice conservative."
    ),
}

LENGTH_GUIDES: Dict[str, str] = {
    "short":  "Length: Keep it to about 1–2 sentences or under ~60 words.",
    "normal": "Length: Typical reply; concise but complete (3–6 sentences).",
    "long":   "Length: You may elaborate up to 6–9 sentences and include brief steps if useful.",
}

def _style_block(tone_key: Optional[str], response_length: Optional[str]) -> str:
    tone_key = (tone_key or "friendly").lower()
    length = (response_length or "normal").lower()
    tone = TONE_PRESETS.get(tone_key, TONE_PRESETS["friendly"])
    length_text = LENGTH_GUIDES.get(length, LENGTH_GUIDES["normal"])
    return f"{tone}\n{length_text}"

def inject_tone(user_message: str, tone_key: Optional[str], response_length: Optional[str]) -> str:
    """
    Build a styled prompt that tells the model exactly how to speak.

    This does NOT get sent to RAG; it's only used for the final LLM call
    so retrieval is based on the actual user question, not the style text.
    """
    style = _style_block(tone_key, response_length)
    return (
        f"{style}\n\n"
        f"Using the above coaching style and length, respond to the conversation below.\n"
        f"Conversation:\n"
        f"{user_message}\n"
        f"Coach:"
    )


# ---------- Chat ----------
@app.post("/chat")
async def chat_endpoint(request: Request):
    data = await request.json()
    user_message: str = data.get("message", "")
    history: List[Dict[str, str]] = data.get("history", []) or []
    tone: Optional[str] = data.get("tone")
    response_length: Optional[str] = data.get("responseLength")

    if not user_message:
        return {"response": "Please enter a valid question."}

    # Format short text conversation from history
    def _fmt(entry: Dict[str, str]) -> str:
        r = (entry.get("role") or "").strip().lower()
        c = (entry.get("content") or "").strip()
        if not c:
            return ""
        return f"Assistant: {c}" if r == "assistant" else f"User: {c}"

    trimmed = history[-12:]
    history_text = "\n".join(filter(None, map(_fmt, trimmed)))

    # This is the plain conversation text used for RAG
    combined_plain = f"{history_text}\nUser: {user_message}" if history_text else user_message

    print(f"\n[CHAT] message='{user_message[:80]}...' tone={tone} length={response_length}")

    # 1) Run RAG on the plain text (no style injected here)
    try:
        docs, _ = rag_utils.query_documents(combined_plain)
    except Exception as e:
        print("[CHAT] Error in query_documents:", e)
        docs = []

    # 2) Build a styled version of the conversation for the LLM
    message_with_tone = inject_tone(combined_plain, tone, response_length)

    # 3) Generate AI response (ai_utils expects: user_input, context_docs)
    try:
        ai_reply = ai_utils.generate_response(message_with_tone, docs)
    except Exception as e:
        print("[CHAT] Error in generate_response:", e)
        traceback.print_exc()
        return {"response": "Sorry—something went wrong generating a response."}

    return {"response": ai_reply}


# ---------- Transcribe (unchanged) ----------
from fastapi import HTTPException
from openai import APIError, APIConnectionError, RateLimitError, BadRequestError, AuthenticationError

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    try:
        filename = (file.filename or "audio.m4a").lower()
        allowed = (".m4a", ".mp3", ".wav", ".webm", ".mp4", ".mpeg")
        if not any(filename.endswith(ext) for ext in allowed):
            raise HTTPException(status_code=400, detail=f"Unsupported file type for '{filename}'. Use m4a/mp3/wav/webm.")

        data = await file.read()
        if not data or len(data) < 200:
            raise HTTPException(status_code=400, detail="Empty or too-small audio file. Try recording at least 1–2 seconds.")

        import tempfile
        fd, temp_path = tempfile.mkstemp(prefix="voice_", suffix=os.path.splitext(filename)[1] or ".m4a")
        try:
            with os.fdopen(fd, "wb") as tmp:
                tmp.write(data)
            with open(temp_path, "rb") as f:
                result = client.audio.transcriptions.create(model="whisper-1", file=f)
            text = getattr(result, "text", None) or ""
            return {"text": text}
        finally:
            try:
                os.remove(temp_path)
            except Exception:
                pass
    except AuthenticationError as e:
        raise HTTPException(status_code=401, detail=f"OpenAI auth failed: {e}") from e
    except RateLimitError as e:
        raise HTTPException(status_code=429, detail=f"OpenAI rate limit: {e}") from e
    except BadRequestError as e:
        raise HTTPException(status_code=400, detail=f"OpenAI bad request: {e}") from e
    except APIConnectionError as e:
        raise HTTPException(status_code=502, detail=f"OpenAI connection error: {e}") from e
    except APIError as e:
        raise HTTPException(status_code=502, detail=f"OpenAI API error: {e}") from e
    except HTTPException:
        raise
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")


# ---------- Plan endpoint (unchanged from your refined version) ----------
from pydantic import BaseModel, Field
from typing import Literal, List as TList, Optional as TOptional, Dict as TDict

Activity = Literal["sedentary", "light", "moderate", "active", "very_active"]
Goal = Literal["lose_weight", "maintain", "build_muscle"]

class PlanRequest(BaseModel):
    name: TOptional[str] = None
    age: int = Field(..., ge=10, le=100)
    height_cm: float = Field(..., gt=100, lt=250)
    weight_kg: float = Field(..., gt=30, lt=300)
    goal: Goal
    activity: Activity = "moderate"

class Meal(BaseModel):
    name: str
    items: TList[str]
    calories: int

class WorkoutBlock(BaseModel):
    day: str
    focus: str
    exercises: TList[str]

class PlanResponse(BaseModel):
    calories_target: int
    macros_g: TDict[str, int]
    rationale: str
    sample_meal_plan: TList[Meal]
    workout_plan: TList[WorkoutBlock]

def _activity_factor(level: Activity) -> float:
    return {"sedentary":1.2,"light":1.375,"moderate":1.55,"active":1.725,"very_active":1.9}[level]

def _estimate_bmr_mifflin(age:int, height_cm:float, weight_kg:float, male:bool=True)->float:
    return (10*weight_kg)+(6.25*height_cm)-(5*age)+(5 if male else -161)

def _target_calories(goal:Goal, tdee:float)->int:
    if goal=="lose_weight": return int(round(tdee*0.85))
    if goal=="build_muscle": return int(round(tdee*1.10))
    return int(round(tdee))

def _macros_for_goal(goal:Goal, weight_kg:float, calories:int)->dict:
    if goal=="build_muscle":
        protein_g=int(round(2.0*weight_kg)); fat_pct=0.25
    elif goal=="lose_weight":
        protein_g=int(round(1.6*weight_kg)); fat_pct=0.30
    else:
        protein_g=int(round(1.8*weight_kg)); fat_pct=0.28
    protein_kcal=protein_g*4
    fat_kcal=int(round(calories*fat_pct))
    fat_g=int(round(fat_kcal/9))
    carbs_kcal=max(calories-(protein_kcal+fat_kcal),0)
    carbs_g=int(round(carbs_kcal/4))
    return {"protein":protein_g,"carbs":carbs_g,"fat":fat_g}

def _sample_meals(calories:int, macros:dict)->TList[Meal]:
    b=int(round(calories*0.25)); l=int(round(calories*0.35)); d=int(round(calories*0.30)); s=calories-(b+l+d)
    return [
        Meal(name="Breakfast", items=["Greek yogurt + berries","Oats/whole-grain toast"], calories=b),
        Meal(name="Lunch", items=["Grilled chicken/tofu bowl","Rice/quinoa + veggies"], calories=l),
        Meal(name="Dinner", items=["Salmon/tempeh","Potatoes/pasta","Salad"], calories=d),
        Meal(name="Snack", items=["Protein shake or cottage cheese","Fruit or nuts"], calories=s),
    ]

def _workout_blocks(goal:Goal)->TList[WorkoutBlock]:
    if goal=="build_muscle":
        return [
            WorkoutBlock(day="Day 1", focus="Upper (Push)", exercises=["Bench Press 4x6–8","Overhead Press 3x8–10","Incline DB Press 3x10–12","Lateral Raises 3x12–15","Triceps Pushdowns 3x12–15"]),
            WorkoutBlock(day="Day 2", focus="Lower", exercises=["Back Squat 4x5–8","Romanian Deadlift 3x6–8","Leg Press 3x10–12","Calf Raises 3x12–15","Plank 3x45s"]),
            WorkoutBlock(day="Day 3", focus="Upper (Pull)", exercises=["Pull-ups/Lat Pulldown 4x6–10","Barbell Row 3x6–10","Face Pulls 3x12–15","DB Curls 3x10–12","Hammer Curls 2x12–15"]),
        ]
    if goal=="lose_weight":
        return [
            WorkoutBlock(day="Day 1", focus="Full-Body Strength (45m)", exercises=["Goblet Squat 3x10","Push-ups 3xAMRAP","DB Row 3x10","Hip Hinge 3x10","Brisk walk 20–30m"]),
            WorkoutBlock(day="Day 2", focus="Cardio/Intervals (30–40m)", exercises=["Warm-up 5m","10×(1m hard / 1m easy)","Cool-down 5m"]),
            WorkoutBlock(day="Day 3", focus="Full-Body + Core", exercises=["Split Squat 3x10/leg","DB Overhead Press 3x10","Lat Pulldown 3x10","Pallof Press 3x12/side","Walk 20m"]),
        ]
    return [
        WorkoutBlock(day="Day 1", focus="Upper", exercises=["Incline Press 3x8–10","Seated Row 3x8–10","DB Shoulder Press 3x10–12","Curls 2x12–15","Triceps Extensions 2x12–15"]),
        WorkoutBlock(day="Day 2", focus="Lower", exercises=["Squat 4x5–8","RDL 3x8–10","Lunges 3x10/leg","Calf Raises 3x12–15","Side Plank 3x30s/side"]),
        WorkoutBlock(day="Day 3", focus="Conditioning", exercises=["Zone-2 cardio 30–40m (bike/row/walk)","Mobility 10m"]),
    ]

from fastapi import Body
from fastapi import Response
from fastapi import status
from fastapi import Depends

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Dict

@app.post("/plan", response_model=PlanResponse)
async def generate_plan(pr: PlanRequest):
    bmr=_estimate_bmr_mifflin(pr.age, pr.height_cm, pr.weight_kg, male=True)
    tdee=bmr*_activity_factor(pr.activity)
    target_kcal=_target_calories(pr.goal, tdee)
    macros=_macros_for_goal(pr.goal, pr.weight_kg, target_kcal)
    rationale=(f"Mifflin–St Jeor BMR ≈ {int(bmr)} × activity {_activity_factor(pr.activity):.2f} "
               f"→ TDEE ≈ {int(tdee)}. Adjusted for goal '{pr.goal.replace('_',' ')}'. "
               f"Protein scaled to body weight; remaining kcal split to carbs/fat.")
    return PlanResponse(
        calories_target=target_kcal,
        macros_g=macros,
        rationale=rationale,
        sample_meal_plan=_sample_meals(target_kcal, macros),
        workout_plan=_workout_blocks(pr.goal),
    )
