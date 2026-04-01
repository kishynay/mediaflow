# MediaFlow Deployment Instructions (Render + Vercel) — PRODUCTION READY

## 📁 Current Project Structure
```
/mediaflow (repo root)
  /frontend → deployed on Vercel (static)
    index.html
    app.js
    styles.css
    vercel.json
  /backend → deployed on Render (Node.js server)
    server.js
    package.json
    config/database.js
    models/Media.js
    .env
  README.md
  package.json (optional)
```

## 1. Status: Production-Ready Fixes Applied
- ✅ **CORS**: Dynamic multi-origin validation (`CORS_ORIGINS` env list)
- ✅ **JWT**: Middleware skips OPTIONS preflight + /api/auth
- ✅ **Upload**: Memory storage + manual GridFS (no crashes)
- ✅ **Auth**: Token stored in localStorage, sent with all requests
- ✅ **Frontend**: Correct FormData field (`"media"`) + auth headers

## 2. Backend `.env` (Render)
Create/update `backend/.env`:

```env
AUTH_USERNAME=kishan
AUTH_PASSWORD=radhe@8374
AUTH_ENABLED=true
JWT_SECRET=ULTR@-s3cuRE-KEY-1234567890-abcd
TOKEN_EXPIRY=3h
PORT=3000

MONGODB_URI=mongodb+srv://Vercel-Admin-radhe:nkILBjirRUiAXo5D@radhe.d14unaf.mongodb.net/mediaflow?retryWrites=true&w=majority

# CORS: Accept requests from multiple Vercel deployments (comma-separated, no spaces)
CORS_ORIGINS=https://kishynay-mediaflow.vercel.app,https://mediaflow-one.vercel.app

SERVE_FRONTEND=false
```

**Key:** `CORS_ORIGINS` must list ALL frontend origins exactly as they appear in browser.

## 3. Render Backend Deployment

1. Go to [Render Dashboard](https://dashboard.render.com)
2. **Create → Web Service**
3. **Connect repo:** `kishynay/mediaflow`
4. **Configuration:**
   - **Name:** `mediaflow-backend` (or `mediaflow`)
   - **Build Command:** `cd backend && npm install`
   - **Start Command:** `cd backend && node server.js`
   - **Root Directory:** `/` (leave empty, Render will build from root)

5. **Environment Variables** (set in Render dashboard):
   ```
   MONGODB_URI=mongodb+srv://Vercel-Admin-radhe:nkILBjirRUiAXo5D@radhe.d14unaf.mongodb.net/mediaflow?retryWrites=true&w=majority
   JWT_SECRET=ULTR@-s3cuRE-KEY-1234567890-abcd
   AUTH_ENABLED=true
   AUTH_USERNAME=kishan
   AUTH_PASSWORD=radhe@8374
   TOKEN_EXPIRY=3h
   CORS_ORIGINS=https://kishynay-mediaflow.vercel.app,https://mediaflow-one.vercel.app
   SERVE_FRONTEND=false
   ```

6. Click **Deploy**. Wait for status → **Live** (green).
7. Copy the Render URL (e.g., `https://mediaflow-backend-z17a.onrender.com`)

## 4. Vercel Frontend Deployment

1. Go to [Vercel Dashboard](https://vercel.com)
2. **Add New → Project**
3. **Import Git Repository:** `kishynay/mediaflow`
4. **Configuration:**
   - **Project Name:** any (e.g., `mediaflow-frontend`)
   - **Root Directory:** Use `frontend/`

5. **Build settings** (should auto-detect):
   - **Build Command:** (leave empty for static)
   - **Output Directory:** (leave empty)
   - **Install Command:** (leave empty)

6. Click **Deploy**. Vercel will build static frontend.
7. Copy the Vercel URL (e.g., `https://kishynay-mediaflow.vercel.app`)

## 5. Frontend URL Configuration

Frontend code (`frontend/app.js`) automatically detects:
```js
const BACKEND_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : 'https://mediaflow-backend-z17a.onrender.com';
```

**Update this to match your actual Render backend URL** if different.

## 6. Verification Checklist

### Local Testing
```bash
cd backend
npm install
npm start
# Should start on http://localhost:3000
```

Then open `http://localhost:3000` (frontend served from backend) or serve frontend locally:
```bash
cd frontend
npx http-server -p 8000 # or any simple HTTP server
# Open http://localhost:8000
```

### Production Testing
1. Go to `https://kishynay-mediaflow.vercel.app`
2. **Login** with:
   - Username: `kishan`
   - Password: `radhe@8374`
3. **Check browser DevTools (F12):**
   - `localStorage.mediaflow_jwt_token` should exist
   - Network tab: `Authorization: Bearer <token>` headers present
   - No `CORS` errors in console

4. **Upload a file** and verify:
   - No 401/403 errors
   - File appears in library
   - `GET /api/media/*/stream` works

5. **Render logs** should show:
   ```
   POST /api/upload 201 ✓
   GET /api/media 200 ✓
   ```

## 7. Multiple Frontend URLs (Staging)
4. Set header on every API call:
   - `Authorization: Bearer ${token}`

## 7. CORS and static file handling

- In `server.js`:
  - `app.use(cors({ origin: API_ORIGIN, credentials: true }));`
  - `app.use(express.static(path.join(__dirname, 'public')));`
- `styles.css` path in `index.html` is correct: `<link rel="stylesheet" href="styles.css" />`

## 8. Verification checklist

- `GET /health` returns 200 JSON `ok`.
- `POST /api/auth/login` returns token.
- `GET /api/media` with `Bearer` token returns `items`.
- Upload+stream+delete works.
- Frontend page loads and no 401.

## 9. Quick commands (local)

```powershell
cd e:\mediaflow
npm install
node server.js
your browser: http://localhost:3000
```

## 10. Common error fixes

- `401` → `AUTH_ENABLED=true`, accept token path, and `token` header set.
- `500` styles → static directory / base path issue.
- `MongoParseError` → bad `MONGODB_URI`
- `No auth` -> set `AUTH_ENABLED=false` temporarily for debug.

---

Keep this file as canonical setup instructions for your project.
