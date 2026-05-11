# Backend API (Express + Mongoose)

## 1) Installll

```bash
npm install
```

## 2) Configure environment

Copy `.env.example` to `.env` and fill values:

- `MONGODB_URI`
- `JWT_SECRET`
- Required for reel/video uploads: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- Optional for signed reel uploads: `CLOUDINARY_REELS_UPLOAD_PRESET`
- Optional: `REELS_UPLOAD_TIMEOUT_MS` (default: `120000`)
- Optional: `SERVER_TIMEOUT_MS` (default: `120000`)

## 3) Run

```bash
npm run dev
```

Server default URL: `http://localhost:4000`

Reel uploads:
- Recommended flow is signed direct upload (`client -> Cloudinary`) using `POST /api/reels/uploads/sign`.
- Server-side upload endpoint remains available as a fallback.

## Starter routes

- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` (Bearer token)
- `GET /api/posts`
- `POST /api/posts` (Bearer token)
- `POST /api/posts/:postId/like` (Bearer token)
- `POST /api/posts/:postId/comments` (Bearer token)
- `DELETE /api/posts/:postId` (Bearer token)
- `GET /api/reels?tab=reels|friends` (Bearer token)
- `GET /api/reels/mine` (Bearer token)
- `POST /api/reels/uploads/initiate` (Bearer token)
- `POST /api/reels/uploads/sign` (Bearer token)
- `POST /api/reels/:reelId/uploads/local` (Bearer token, uploads to Cloudinary)
- `POST /api/reels/:reelId/complete` (Bearer token)
- `POST /api/reels/:reelId/uploads/complete` (Bearer token, compatibility alias)
- `POST /api/reels/:reelId/ready` (Bearer token)
- `PATCH /api/reels/:reelId` (Bearer token)
- `DELETE /api/reels/:reelId` (Bearer token)
- `POST /api/reels/:reelId/like` (Bearer token)
- `POST /api/reels/:reelId/save` (Bearer token)
- `POST /api/reels/:reelId/view` (Bearer token)
