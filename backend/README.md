AI Fitness Coach — README
Overview

The AI Fitness Coach is a mobile application that provides personalized workout and nutrition guidance using AI-powered chat, voice interaction, and customizable fitness plans. The backend uses a Retrieval-Augmented Generation (RAG) system to deliver accurate, evidence-based answers using indexed health and fitness research.

This project combines mobile development, backend engineering, and modern AI tools to create an interactive fitness assistant.

Tech Stack:

- Mobile App (Frontend)
- React Native (Expo)
- JavaScript
- Expo APIs
- Audio recording
- Notifications
- FileSystem
- SQLite
- Vector icons (Ionicons)

Backend:

- Python (FastAPI)
- OpenAI API (Chat + Whisper)
- ChromaDB (vector search)
- LangChain text splitting
- SQLite (profiles + chat history)

Getting Started
Install Dependencies
Backend:

cd backend
pip install -r requirements.txt

Mobile App:

cd ai-fitness-mobile
npm install

Backend:

cd backend
pip install -r requirements.txt
Add .env
(Optional) python scrape_and_load.py
uvicorn api_server:app --reload --port 8000

Cloudflare Tunnel (In a new terminal):
cloudflared tunnel --url http://localhost:8000

Copy and paste url given into api.js as API_BASE_URL.

Frontend (In a new terminal):

cd ai-fitness-mobile
npm install
npx expo start -c

Once all three terminals are running, scan QR code with phone to load Expo Go.

backend/
│
├── .env
├── requirements.txt
├── api_server.py
├── ai_utils.py
├── rag_utils.py
├── db_utils.py
├── scrape_and_load.py
│
├── data/
│   ├── chroma/               # Vector database folder
│   ├── scraped/              # Optional: raw scraped text
│   └── logs/                 # Backend logs (if enabled)
│
├── profiles.db               # SQLite (user profiles)
└── users.db                  # SQLite (chat history)

------------------------------------------------------------

ai-fitness-mobile/
│
├── App.js
├── index.js
├── package.json
├── babel.config.js
├── app.json
│
├── assets/
│   ├── icon.png
│   ├── splash.png
│   └── fonts/
│
├── screens/
│   ├── ChatbotScreen.js
│   ├── PlanScreen.js
│   ├── ProfilesScreen.js
│   ├── CreateProfileScreen.js
│   └── EditProfileScreen.js
│
├── utils/
│   ├── api.js
│   ├── api_server.js           
│   ├── chatStore.js
│   ├── db.js
│   ├── ics.js
│   ├── notify.js
│   ├── settings.js
│   ├── units.js
│   └── voice.js
│
├── database/
│   └── profiles.db
│
└── components/
    ├── CustomButton.js
    ├── InputField.js
    └── Header.js
