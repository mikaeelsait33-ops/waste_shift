# Firebase Setup

WasteShift reads menu items from Firestore and mirrors waste entries there when Firebase env vars are configured.

## 1. Create Firebase Project

In Firebase Console:

1. Create or open a project.
2. Add a Web app.
3. Copy the Web app config values.
4. Enable Firestore Database.
5. Enable Authentication > Sign-in method > Anonymous.

## 2. Add Local Env Vars

Copy `.env.firebase.example` into `.env.local`, or add these keys to your existing `.env.local`:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Restart the Vite dev server after changing env vars.

## 3. Firestore Collections

Menu items are stored in `menuItems`:

```json
{
  "name": "Salmon Benedict",
  "totalCost": 85,
  "components": [
    { "name": "Salmon", "cost": 45 },
    { "name": "English Muffin", "cost": 8 },
    { "name": "Hollandaise", "cost": 12 },
    { "name": "Poached Egg", "cost": 10 }
  ]
}
```

Waste entries are created in `wasteEntries`.

## 4. Deploy Rules

Install/login to Firebase CLI if needed:

```sh
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore
```

For Firebase Hosting:

```sh
npm run build
firebase deploy --only hosting
```

## Security Note

The app signs users into Firebase anonymously so Firestore rules can require `request.auth != null`.
For stricter production controls, use Firebase Auth roles/custom claims or route Firestore writes through a server endpoint.
