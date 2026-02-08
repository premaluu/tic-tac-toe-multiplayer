async function verifyUser(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return null;
  }

  const apiKey = (process.env.FIREBASE_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("FIREBASE_API_KEY is missing on server");
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    }
  );

  if (!response.ok) {
    return null;
  }

  const json = await response.json();
  const user = json?.users?.[0];
  if (!user?.localId) {
    return null;
  }

  return {
    uid: user.localId,
    name: user.displayName || user.email || "Player",
  };
}

module.exports = {
  verifyUser,
};
