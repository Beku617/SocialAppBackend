# Backend API (Express + Mongoose)

## 1) Install

```bash
npm install
```

## 2) Configure environment

Copy `.env.example` to `.env` and fill values:

- `MONGODB_URI`
- `JWT_SECRET`
- Optional: `REELS_UPLOAD_URL_TEMPLATE` (example: `https://storage.example.com/upload/{storageKey}?signature=...`)

## 3) Run

```bash
npm run dev
```

Server default URL: `http://localhost:4000`

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
- `POST /api/reels/:reelId/uploads/local` (Bearer token, base64 upload for local storage)
- `POST /api/reels/:reelId/uploads/complete` (Bearer token)
- `POST /api/reels/:reelId/ready` (Bearer token)
- `PATCH /api/reels/:reelId` (Bearer token)
- `DELETE /api/reels/:reelId` (Bearer token)
- `POST /api/reels/:reelId/like` (Bearer token)
- `POST /api/reels/:reelId/save` (Bearer token)
- `POST /api/reels/:reelId/view` (Bearer token)
