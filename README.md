# Media Server Website

A simple local media server with:
- Media upload (video, audio, image)
- Media library listing
- In-browser streaming/playback with range requests

## Run

1. Install dependencies:
   ```bash
   npm ci --omit=dev
   ```
2. Start server:
   ```bash
   AUTH_USERNAME=admin AUTH_PASSWORD=yourStrongPassword MEDIA_DIR=./media npm start
   ```
3. Open:
   `http://localhost:3000`

Uploaded files are stored in the `media/` folder.

## Linux Deploy

```bash
git clone <your-repo-url>
cd mediaflow
npm ci --omit=dev
mkdir -p /var/mediaflow/media
PORT=3000 AUTH_USERNAME=admin AUTH_PASSWORD=yourStrongPassword MEDIA_DIR=/var/mediaflow/media npm start
```

Notes:
- App is password-protected with HTTP Basic Auth.
- `/health` is public for uptime checks.
- Set a strong `AUTH_PASSWORD` in production.

## API Endpoints

- `GET /api/media` -> list media files
- `POST /api/upload` -> upload file (`multipart/form-data`, field name: `media`)
- `GET /media/:id` -> stream media file
