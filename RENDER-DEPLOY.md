# MediaFlow Deployment Guide (Render + Vercel)

This file describes exact steps to deploy the MediaFlow app with zero errors.

## 1. Project structure (recommended split)

- `frontend/`
  - `index.html`
  - `styles.css`
  - `app.js`
- `backend/`
  - `server.js`
  - `config/database.js`
  - `models/Media.js`
  - `package.json`
- `.env.example`
- `.gitignore`
- `README.md`
- `vercel.json`

> For now, if you keep the current root structure, the backend runs from root and frontend from `public/`.

## 2. Backend configuration (Render)

### 2.1. Prepare `backend/server.js`
- Add `dotenv`, `cors`, `jsonwebtoken`, `mongoose`, `multer`, GridFS storage.
- Validate:
  - `API_ORIGIN = process.env.FRONTEND_URL || "*"`
  - `AUTH_ENABLED = process.env.AUTH_ENABLED !== "false"`
  - `JWT_SECRET = process.env.JWT_SECRET || "change-me"`
- Ensure routes:
  - `GET /health`
  - `POST /api/auth/login` (returns `{ token }`)
  - `GET /api/media`
  - `POST /api/upload`
  - `GET /api/media/:id/stream`
  - `GET /api/media/:id/download`
  - `DELETE /api/media/:id`

### 2.2. `backend/config/database.js`
```js
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mediaflow';
    await mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

module.exports = connectDB;
```

### 2.3. `backend/package.json`
- Dependencies:
  - express
  - mongoose
  - mongodb
  - multer
  - multer-gridfs-storage
  - mime-types
  - cors
  - dotenv
  - jsonwebtoken

- Script:
```json
"scripts": {
  "start": "node server.js"
}
```

### 2.4. `.env` for Render
```
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/mediaflow?retryWrites=true&w=majority
JWT_SECRET=<your-strong-secret>
AUTH_ENABLED=true
FRONTEND_URL=https://<your-vercel-domain>.vercel.app
PORT=10000
```

## 3. Frontend configuration (Vercel)

### 3.1. Fixed paths
- `public/app.js` constant:
```js
const BACKEND_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : 'https://<your-backend>.onrender.com';
```

### 3.2. Login/auth flow
- `POST ${BACKEND_URL}/api/auth/login` with JSON body `{ username, password }`.
- Store returned JWT:
  - `localStorage.setItem('mediaflow_jwt_token', token)`
- Propagate header:
  - `Authorization: Bearer <token>` on `/api/media`, `/api/upload`, `/api/media/:id`.

### 3.3. `public/index.html`
- Ensure `styles.css` link is correct: `<link rel="stylesheet" href="styles.css" />`
- Ensure login panel HTML exists as in final version.

### 3.4. Remove any old Basic Auth usage.
- `app.js` must use JWT; no `Basic` in fetch calls.

## 4. `.gitignore`
```
node_modules/
.vscode/
.env
media/
.DS_Store
*.log
```

## 5. Vercel settings

- Project root: your repo.
- Build command: none (static) if using `public`. or if using `frontend`, configure `dist` accordingly.
- Output directory: `public`
- Environment variables (optional):
  - `BACKEND_URL=https://<your-backend>.onrender.com`

## 6. Render setup steps

1. Go to Render dashboard.
2. `New` -> `Web Service`.
3. Connect repo.
4. Root directory: `.` (or `/backend` if split).
5. Branch: `main`.
6. Environment: set .env values (MONGODB_URI, JWT_SECRET, AUTH_ENABLED, FRONTEND_URL).
7. Start command: `npm start`.
8. Health check: `/health`.

## 7. Vercel setup steps

1. Go to Vercel dashboard.
2. `Import Project` -> GitHub repo.
3. Set framework to `Other` or `Static`.
4. Output directory: `public`.
5. Env variable (if needed): `BACKEND_URL`.
6. Deploy.

## 8. Troubleshooting

- 401 on `/api/media`:
  - verify JWT token saved and in header.
  - verify `AUTH_ENABLED=true` on backend.

- 500 on `styles.css`:
  - ensure `app.use(express.static(path.join(__dirname, 'public')))` in server.
  - ensure Vercel static file routing uses `public/` path.

- `MongoParseError`:
  - confirm `MONGODB_URI` starts with `mongodb://` or `mongodb+srv://`.

- CORS fails:
  - `FRONTEND_URL` must exactly match deployed Vercel URL.
  - `app.use(cors({ origin: API_ORIGIN, credentials: true }));`

## 9. Quick end-to-end test checklist

1. Visit backend `/health` returns `{ ok: true }`.
2. POST login returns `{ token }`.
3. `GET /api/media` with header returns empty list `items: []`.
4. Upload file works (`POST /api/upload`).
5. Media listing appears and streaming works.
6. No 401/500 on production flow.

---

This document is exact code + deploy commands that match your current MediaFlow rails when using Render + Vercel.
