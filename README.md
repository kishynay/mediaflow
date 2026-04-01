# Mediaflow - Media Server with MongoDB Atlas & Vercel

A modern media server with:
- Media upload (video, audio, image)
- Media library listing
- In-browser streaming/playback with range requests
- MongoDB Atlas database storage
- Vercel serverless deployment

## Features

- **File Upload**: Support for video, audio, and image files
- **Streaming**: Range request support for efficient video/audio streaming
- **Database Storage**: Files stored in MongoDB Atlas using GridFS
- **Authentication**: HTTP Basic Auth protection
- **Serverless**: Deployable on Vercel
- **Responsive UI**: Modern web interface

## Local Development

1. **Clone and install dependencies:**
   ```bash
   git clone <your-repo-url>
   cd mediaflow
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your MongoDB Atlas connection string
   ```

3. **Start the server:**
   ```bash
   npm run dev
   ```

4. **Open in browser:**
   `http://localhost:3000`

## MongoDB Atlas Setup

1. **Create MongoDB Atlas Account:**
   - Go to [MongoDB Atlas](https://www.mongodb.com/atlas)
   - Create a free cluster

2. **Get Connection String:**
   - Go to Clusters → Connect → Connect your application
   - Copy the connection string
   - Replace `<username>`, `<password>`, and `<database>` in your `.env`

3. **Whitelist IP Addresses:**
   - For local development: Add `0.0.0.0/0` (allow all)
   - For Vercel: Add `0.0.0.0/0` or specific Vercel IP ranges

## Vercel Deployment

1. **Connect Repository:**
   - Import your GitHub repository to Vercel
   - Vercel will automatically detect the `vercel.json` configuration

2. **Set Environment Variables in Vercel:**
   ```
   AUTH_ENABLED=false
   JWT_SECRET=your_super_secret
   FRONTEND_URL=https://<your-vercel-app>.vercel.app
   MONGODB_URI=your_mongodb_atlas_connection_string
   
   # This is for the backend app on Render/Railway
   BACKEND_URL=https://<your-backend>.onrender.com
   ```

3. **Set Base URL in Frontend:**
   - In `public/app.js`, change `BACKEND_URL` to your backend URL:
   ```js
   const BACKEND_URL = window.location.hostname === "localhost" ? "http://localhost:3000" : "https://<your-backend>.onrender.com";
   ```

4. **Deploy:**
   - Vercel redeploys on push; open your app URL.

---

## Render Deployment (Backend)

1. **Create project:**
   - In Render, click "New -> Web Service".
   - Connect GitHub repository.
   - Select root directory `.` (or a `/backend` folder if you split).

2. **Environment variables:**
   - `MONGODB_URI` (Atlas connection string)
   - `JWT_SECRET` (strong secret)
   - `AUTH_ENABLED=true`
   - `FRONTEND_URL=https://<your-vercel-app>.vercel.app`
   - `PORT=10000` (or Render default)

3. **Build command:**
   - `npm install`
   - `npm run start`

4. **Health check path:** `/health`

5. **Once deployed:**
   - Backend URL becomes `https://<your-project>.onrender.com`
   - Set `BACKEND_URL` in frontend accordingly

---

## Frontend / Backend split

Current repo uses:
- frontend files in `public/`
- backend server in `server.js`

For strict split, move frontend to `/frontend`:
- `frontend/index.html`
- `frontend/styles.css`
- `frontend/app.js`

Move backend to `/backend`:
- `backend/server.js`
- `backend/config/database.js`
- `backend/models/Media.js`
- `backend/package.json` (copy existing + `start`) 

Then adjust the render deploy path accordingly.


3. **Deploy:**
   - Vercel will build and deploy automatically
   - Your app will be available at `https://your-project.vercel.app`

## API Endpoints

### Media Management
- `GET /api/media` → List all media files
- `POST /api/upload` → Upload file (multipart/form-data, field: `media`)
- `GET /api/media/:id/stream` → Stream media file
- `GET /api/media/:id/download` → Download media file
- `DELETE /api/media/:id` → Delete media file

### Utility
- `GET /health` → Health check (public endpoint)
- `GET /media-list` → Legacy media list endpoint

## Security Notes

- **Authentication**: All endpoints except `/health` require HTTP Basic Auth
- **File Storage**: Files are stored securely in MongoDB GridFS
- **Environment Variables**: Never commit sensitive data to version control
- **Production Password**: Use a strong, unique password in production

## File Size Limits

- **Vercel**: 4.5MB for serverless functions (GridFS handles large files)
- **MongoDB Atlas**: Free tier has 512MB storage limit
- **Uploads**: No specific size limit (handled by GridFS chunking)

## Troubleshooting

### Connection Issues
- Verify MongoDB Atlas IP whitelist includes `0.0.0.0/0`
- Check connection string format and credentials
- Ensure database user has read/write permissions

### Upload Issues
- Check file size limits
- Verify GridFS bucket configuration
- Check server logs for detailed error messages

### Vercel Deployment Issues
- Ensure all dependencies are in `package.json`
- Check Vercel function logs for runtime errors
- Verify environment variables are set correctly
