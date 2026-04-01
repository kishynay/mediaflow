# MediaFlow Deployment Instructions (Render + Vercel)

This guide lists the exact steps to deploy the MediaFlow app (frontend + backend), including env values, commands, and verification checks.

## 1. Status: Current project in repo
- Backend: `server.js`, `config/database.js`, `models/Media.js`
- Frontend: `public/index.html`, `public/styles.css`, `public/app.js`
- Auth: JWT (`POST /api/auth/login`)
- Database: MongoDB Atlas GridFS

## 2. .env contents (local development)
Create `e:\mediaflow\.env` with:

```env
AUTH_USERNAME=kishan
AUTH_PASSWORD=radhe@8374
AUTH_ENABLED=true
JWT_SECRET=ULTR@-s3cuRE-KEY-1234567890-abcd
TOKEN_EXPIRY=3h
FRONTEND_URL=https://kishynay-mediaflow.vercel.app
PORT=3000
MONGODB_URI=mongodb+srv://<atlas_user>:<atlas_password>@<cluster>.mongodb.net/mediaflow?retryWrites=true&w=majority
```

- Replace `<atlas_user>`, `<atlas_password>`, `<cluster>` with your Atlas values.
- Use a strong `JWT_SECRET`.

## 3. Render backend service (Web Service)

1. Create new service: **Web Services → New Web Service**
2. Git repo: `kishynay/mediaflow` branch `main`
3. Name: `mediaflow` (or `mediaflow-backend`)
4. Root directory: leave empty (repo root) or `backend` if split
5. Build command: `npm install`
6. Start command: `node server.js`
7. Instance: Free (for test) or Starter for better stability
8. Health check path: `/health`

### Render environment variables
- `MONGODB_URI` = your Atlas URI
- `JWT_SECRET` = strong secret
- `AUTH_ENABLED` = `true`
- `AUTH_USERNAME` = `kishan`
- `AUTH_PASSWORD` = `radhe@8374`
- `FRONTEND_URL` = `https://kishynay-mediaflow.vercel.app`
- `PORT` = `10000` (or Render default)

9. Deploy and ensure status becomes **Live**.

## 4. Vercel frontend service (Static Site)

1. Import the same repo into Vercel.
2. Project root: existing repo
3. Build command: none (static file mode)
4. Output directory: `public`
5. Set env var:
   - `BACKEND_URL` = `https://<your-render-backend>.onrender.com`
6. Deploy.

## 5. Frontend code updates
In `public/app.js`, set:

```js
const BACKEND_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : 'https://<your-render-backend>.onrender.com';
```

Ensure API calls use full endpoints:
- `fetch(`${BACKEND_URL}/api/media`, { headers: authHeaders() })`
- upload: `POST ${BACKEND_URL}/api/upload`
- delete: `DELETE ${BACKEND_URL}/api/media/${id}`

## 6. API authentication flow

1. Request login:
   - `POST /api/auth/login` body `{ username, password }`
2. Server responds `{ token }`.
3. Save token to localStorage:
   - `localStorage.setItem('mediaflow_jwt_token', token)`
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
