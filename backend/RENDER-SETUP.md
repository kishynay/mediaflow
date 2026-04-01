# MediaFlow Render Deployment (Backend) 

This file is specifically for deploying the MediaFlow backend on Render.

## 1. Choose service
- Render Dashboard → **New** → **Web Services**
- Service type: **Web Service** (Node.js)
- Repository: `kishynay/mediaflow`
- Branch: `main`

## 2. Configure service details
- **Name**: `mediaflow-backend` (or `mediaflow`)
- **Region**: select closest to users
- **Root Directory**: leave blank if app files are in repo root (`server.js` at root)
- **Build Command**: `npm install`
- **Start Command**: `node server.js`
- **Instance Type**: Free (for testing) or Starter/Standard for production

## 3. Environment variables
Add the following from Render UI Environment Variables section:

- `MONGODB_URI` = `mongodb+srv://<atlas_user>:<atlas_password>@<cluster>.mongodb.net/mediaflow?retryWrites=true&w=majority`
- `JWT_SECRET` = `<long-strong-secret>` (e.g. 32+ chars)
- `AUTH_ENABLED` = `true`
- `AUTH_USERNAME` = `kishan`
- `AUTH_PASSWORD` = `radhe@8374`
- `FRONTEND_URL` = `https://kishynay-mediaflow.vercel.app`
- `PORT` = `10000`

## 4. Health check
- `Health check path`: `/health`
- Test after deploy: `GET https://<your-service>.onrender.com/health` should respond with JSON OK.

## 5. In-code values (verify)
In `server.js`, confirm:
- `app.use(cors({ origin: API_ORIGIN, credentials: true }));`
- `API_ORIGIN = process.env.FRONTEND_URL || "*"`
- `authMiddleware` / `jwtMiddleware` handles `/api/auth/login` and protected routes
- `app.use(express.static(path.join(__dirname, 'public')));` for static assets

## 6. Full example .env for local and render parity
```
AUTH_USERNAME=kishan
AUTH_PASSWORD=radhe@8374
AUTH_ENABLED=true
JWT_SECRET=ULTR@-s3cuRE-KEY-1234567890-abcd
TOKEN_EXPIRY=3h
FRONTEND_URL=https://kishynay-mediaflow.vercel.app
PORT=3000
MONGODB_URI=mongodb+srv://<atlas_user>:<atlas_password>@<cluster>.mongodb.net/mediaflow?retryWrites=true&w=majority
```

> On Render, use Render dashboard env vars instead of .env file.

## 7. Deploy service
1. Click **Deploy Web Service**
2. Wait until status becomes **Live**
3. Open service URL: `https://<your-service>.onrender.com`

## 8. Verify API endpoints
- `GET /health` → 200 OK
- `POST /api/auth/login` with JSON body:
  - `{ "username":"kishan", "password":"radhe@8374" }`
- `GET /api/media` with `Authorization: Bearer <token>`
- `POST /api/upload` with `Authorization` header and form-data

## 9. Vercel frontend link
1. In Vercel (`public/` static site) set env var:
   - `BACKEND_URL=https://<your-render-service>.onrender.com`
2. In `public/app.js`, verify:
   - `const BACKEND_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://<your-render-service>.onrender.com';`
3. Deploy Vercel

## 10. Troubleshooting
- `401` → check `AUTH_ENABLED`, `JWT_SECRET`, login payload & token storage
- `500` from `/api/*` → check backend logs (Render dashboard Logs)
- `MongoParseError` → ensure `MONGODB_URI` format
- `CORS` → `FRONTEND_URL` mismatch; ensure exact domain

---

This file is the Render-only deployment reference for MediaFlow backend.
