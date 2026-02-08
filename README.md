# Tic Tac Toe Multiplayer

Realtime Tic Tac Toe with:
- Google Authentication (Firebase Auth)
- Remote multiplayer rooms (Firebase Realtime Database)
- Animated UI and round-based scoring

## 1. Configure Firebase web app values (secure repo setup)

This project does not store Firebase config in Git.
Values are served from Vercel environment variables via `/api/firebase-config`.

1. Open Firebase Console -> Project settings -> Your apps -> Web app.
2. Copy SDK config values.
3. Add these variables in Vercel project settings:
- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_DATABASE_URL`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
4. Redeploy Vercel.

## 2. Enable Firebase Authentication

1. Go to Authentication -> Sign-in method.
2. Enable `Google`.
3. Go to Authentication -> Settings -> Authorized domains.
4. Add:
- `localhost`
- `tic-tac-toe-multiplayer-nu.vercel.app`
- any other Vercel/custom domain you use

## 3. Set Realtime Database rules

Publish rules from `/Users/amitvikram/Documents/New project/database.rules.json`.

If Firebase CLI is connected to your project:

```bash
npx --yes firebase-tools@latest deploy --only database --project <your-firebase-project-id>
```

## 4. Run locally

```bash
npx --yes serve .
```

Open the local URL and test:
- Sign in with Google
- Create room
- Open invite link in another browser/incognito session

## 5. Deploy to Vercel

```bash
npx --yes vercel --prod
```

## Multiplayer flow

1. Sign in with Google.
2. Click `Create Room`.
3. Copy invite link and send to a friend.
4. Friend signs in and opens the invite link.
5. Play turns in real time.
