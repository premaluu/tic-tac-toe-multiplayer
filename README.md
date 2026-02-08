# Tic Tac Toe Multiplayer

Realtime Tic Tac Toe with:
- Google Authentication (Firebase Auth)
- Multiplayer game state in Postgres (via Vercel API routes)
- Animated UI and round-based scoring

## Architecture

- Client auth: Firebase Web SDK (Google sign-in)
- Server auth verification: Firebase Identity Toolkit (`accounts:lookup`) using ID token
- Game state storage: Postgres table `game_rooms`
- Realtime update model: client polling (`/api/room?action=get`) every second

## Environment variables

Set these in Vercel (Production + Development) and in local `.env.local`:

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_DATABASE_URL`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `DATABASE_URL` (Postgres connection string)

## Local run

```bash
npm install
npx --yes vercel dev --listen 3200
```

Open:
- `http://localhost:3200`
- `http://localhost:3200/api/firebase-config`

## API endpoints

`/api/room`

Actions:
- `GET ?action=get&roomCode=XXXXXX`
- `POST ?action=create`
- `POST ?action=join`
- `POST ?action=move`
- `POST ?action=next-round`
- `POST ?action=leave`

All require `Authorization: Bearer <firebase_id_token>`.

## Deploy

```bash
npx --yes vercel --prod
```
