# Production Deployment Configuration Guide

## Backend Environment Variables

Set these in your Render dashboard (Settings > Environment):

### Database Connection
```
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/mediaflow?retryWrites=true&w=majority
```

### CORS Configuration (CRITICAL FIX)
```
CORS_ORIGINS=https://your-app.vercel.app
```
Replace `your-app` with your actual Vercel deployment name.

For multiple domains:
```
CORS_ORIGINS=https://app.production.com,https://app-staging.vercel.app,http://localhost:3000
```

### Authentication
```
AUTH_ENABLED=true
AUTH_USERNAME=admin
AUTH_PASSWORD=<generate-strong-password>
JWT_SECRET=<generate-strong-secret>
TOKEN_EXPIRY=24h
```

Generate secure secrets:
```bash
# On Mac/Linux
openssl rand -base64 32

# On Windows (PowerShell)
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

### Optional
```
PORT=3000
SERVE_FRONTEND=true
```

---

## Render Deployment Steps

1. Connect GitHub repo to Render
2. Create new Web Service
3. Select branch: `main` (or your production branch)
4. Build Command: `cd backend && npm install`
5. Start Command: `cd backend && npm start`
6. Add environment variables (see above)
7. Deploy

---

## Frontend (Vercel) Configuration

Update your frontend API endpoint to your Render backend:

```javascript
// frontend/app.js
const API_BASE = process.env.VITE_API_URL || 
                 'https://your-backend.onrender.com/api';
```

In Vercel dashboard (Settings > Environment Variables):
```
VITE_API_URL=https://your-backend.onrender.com/api
```

---

## Verification Checklist

- [ ] Health endpoint responds: `curl https://your-backend.onrender.com/health`
- [ ] CORS preflight works: Test from browser console
- [ ] Upload endpoint reachable: `curl -F "media=@test.txt" https://your-backend.onrender.com/api/upload`
- [ ] Environment variables set in Render
- [ ] MongoDB Atlas allows Render IP (0.0.0.0/0 for flexibility)
- [ ] Frontend deployment updated with correct backend URL

---

## Troubleshooting

### CORS Still Failing?
```bash
# Check what origins are configured
echo $CORS_ORIGINS

# Test preflight response
curl -X OPTIONS https://your-backend.onrender.com/api/upload \
  -H "Origin: https://your-app.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -i

# Should see:
# HTTP/1.1 204 No Content
# Access-Control-Allow-Origin: https://your-app.vercel.app
```

### Upload Failing?
```bash
# Check MongoDB connection
curl https://your-backend.onrender.com/health

# Should return:
# {"ok":true,"database":"connected","timestamp":"..."}
```

### GridFS Errors?
- Verify MongoDB Atlas collection exists
- Check network access is allowed from Render
- Ensure `MONGODB_URI` includes correct credentials
