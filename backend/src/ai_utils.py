import os
from dotenv import load_dotenv
from openai import OpenAI

# --- Force reload environment from backend/.env ---
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"), override=True)
_key = os.getenv("OPENAI_API_KEY") or ""
print(f"🔑 Key prefix (ai_utils): {_key[:8]}")

# Initialize OpenAI client
client = OpenAI(api_key=_key)


def generate_response(user_input, context_docs):
    """
    Use OpenAI GPT model to generate an AI response with RAG context.
    """
    # Join all context chunks into one string (may be empty)
    context_docs = context_docs or []
    context_text = "\n\n".join(context_docs)

    # Debugging
    print("📝 Context being sent to GPT:\n", context_text[:1000])  # show first 1000 chars

    system_prompt = """
You are a helpful fitness and nutrition assistant.

Use the provided context below when it is relevant. If the context seems only loosely related,
you may still answer using general evidence-informed fitness and nutrition knowledge.

Avoid guessing wildly. Prioritize safety, clarity, and realistic advice.
If the question is clearly outside exercise, physical activity, health, or nutrition,
briefly say that it is outside your scope instead of inventing an answer.
"""

    # Build structured messages for GPT
    messages = [
        {
            "role": "system",
            "content": system_prompt,
        },
        {
            "role": "user",
            "content": (
                f"User question:\n{user_input}\n\n"
                f"Relevant context (may be partial or noisy):\n"
                f"{context_text or '[no retrieved context]'}"
            ),
        },
    ]

    # Call OpenAI
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        temperature=0.1,   # low for stability, still allows a bit of style
        top_p=1.0,
        max_tokens=400,
    )

    return response.choices[0].message.content.strip()
