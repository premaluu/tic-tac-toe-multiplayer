module.exports = (req, res) => {
  const clean = (value) => String(value || "").trim();

  const firebaseConfig = {
    apiKey: clean(process.env.FIREBASE_API_KEY),
    authDomain: clean(process.env.FIREBASE_AUTH_DOMAIN),
    databaseURL: clean(process.env.FIREBASE_DATABASE_URL),
    projectId: clean(process.env.FIREBASE_PROJECT_ID),
    storageBucket: clean(process.env.FIREBASE_STORAGE_BUCKET),
    messagingSenderId: clean(process.env.FIREBASE_MESSAGING_SENDER_ID),
    appId: clean(process.env.FIREBASE_APP_ID),
  };

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(firebaseConfig);
};
