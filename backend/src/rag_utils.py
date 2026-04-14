import os
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import Chroma

# --- Load environment variables ---
load_dotenv(override=True)

# --- Retrieve and validate key ---
api_key = os.getenv("OPENAI_API_KEY")
if not api_key or api_key.startswith("your_api"):
    raise ValueError("❌ Invalid or missing OpenAI API key. Check your .env file!")

print(f"🔑 OpenAI Key loaded in rag_utils: {bool(api_key)}")
print(f"🔍 Key prefix: {api_key[:8]}")

# --- Define ChromaDB path ---
BASE_DIR = os.path.dirname(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "chroma")

# --- Initialize embeddings + Chroma ---
embeddings = OpenAIEmbeddings(
    model="text-embedding-3-small",  # Smaller + faster, still high quality
    api_key=api_key
)
db = Chroma(persist_directory=DB_PATH, embedding_function=embeddings)
print(f"✅ Connected to Chroma DB at: {DB_PATH}")

def query_documents(query, n_results=8, min_score=0.15):
    """
    Retrieve the most relevant document chunks for a given query.

    Args:
        query (str): User's input question.
        n_results (int): Number of chunks to retrieve.
        min_score (float): Minimum cosine similarity score (higher = stricter).

    Returns:
        (docs, metadatas): Filtered document texts + metadata.
    """
    try:
        # Expand the query slightly for better matching
        expanded_query = f"{query} (nutrition, health, exercise, fitness, wellness)"
        results = db.similarity_search_with_score(expanded_query, k=10)
        filtered = [(doc, score) for doc, score in results if score >= 0.1]


        docs = [doc.page_content for doc, _ in filtered]
        metadatas = [doc.metadata for doc, _ in filtered]

        # Handle case where all scores are below threshold
        if not docs and results:
            best_doc, _ = results[0]
            docs = [best_doc.page_content]
            metadatas = [best_doc.metadata]
            print(f"⚠️ Using top chunk anyway (no strong matches above {min_score}).")

        print(f"🔍 Retrieved {len(docs)} relevant chunks (threshold: {min_score})")
        return docs, metadatas

    except Exception as e:
        print(f"❌ Query failed: {e}")
        return [], []
