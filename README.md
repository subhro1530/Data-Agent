# AI Data Agent — Intelligent File Normalization & Summarization Service

Quickstart:

- Node.js >= 18
- Create .env from .env.example
- Install: npm install
- Run: npm start (or npm run dev)

Environment:

- PORT
- GEMINI_API_KEY
- NEON_DB_URL (Neon connection string; SSL required)

API:

- POST /api/upload (form-data: file=<yourfile>)
- GET /api/logs
- GET /api/logs/:id

Render.com:

- Build command: npm install
- Start command: npm start
- Add env vars in dashboard
