import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  getAuth,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getDatabase,
  onValue,
  ref,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-database.js";

const WINNING_COMBOS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const statusEl = document.getElementById("status");
const roundEl = document.getElementById("round");
const scoreXEl = document.getElementById("score-x");
const scoreOEl = document.getElementById("score-o");
const scoreDrawEl = document.getElementById("score-draw");
const labelXEl = document.getElementById("label-x");
const labelOEl = document.getElementById("label-o");
const roomCodeEl = document.getElementById("room-code");
const roomInputEl = document.getElementById("room-input");
const signInBtn = document.getElementById("google-signin");
const signOutBtn = document.getElementById("signout");
const createRoomBtn = document.getElementById("create-room");
const joinRoomBtn = document.getElementById("join-room");
const copyLinkBtn = document.getElementById("copy-link");
const leaveRoomBtn = document.getElementById("leave-room");
const nextRoundBtn = document.getElementById("next-round");
const userInfoEl = document.getElementById("user-info");
const userPhotoEl = document.getElementById("user-photo");
const userNameEl = document.getElementById("user-name");
const lobbyEl = document.getElementById("lobby");
const roomPanelEl = document.getElementById("room-panel");
const boardEl = document.querySelector(".board");
const winLineEl = document.getElementById("win-line");
const cells = Array.from(document.querySelectorAll(".cell"));

let auth;
let database;
let currentUser = null;
let currentRoomCode = null;
let currentRoomState = null;
let roomUnsubscribe = null;

function setAuthErrorStatus(error) {
  const code = error?.code || "unknown";
  const message = error?.message || "No additional details from Firebase.";

  if (code === "auth/unauthorized-domain") {
    statusEl.textContent =
      "Google auth blocked: add this domain in Firebase Auth -> Settings -> Authorized domains.";
    return;
  }
  if (code === "auth/operation-not-allowed") {
    statusEl.textContent = "Google provider is disabled in Firebase Auth -> Sign-in method.";
    return;
  }
  if (code === "auth/popup-closed-by-user") {
    statusEl.textContent = "Sign-in popup was closed before completing login.";
    return;
  }
  if (code === "auth/invalid-api-key") {
    statusEl.textContent = "Firebase API key is invalid. Check Vercel FIREBASE_API_KEY.";
    return;
  }
  if (code === "auth/network-request-failed") {
    statusEl.textContent = "Network error during sign-in. Check browser network/ad-blocker settings.";
    return;
  }

  statusEl.textContent = `Google sign-in failed: ${code}. Check console for details.`;
  console.error("Firebase auth error:", { code, message, error });
}

function hasConfiguredFirebase(firebaseConfig) {
  const requiredKeys = [
    "apiKey",
    "authDomain",
    "databaseURL",
    "projectId",
    "storageBucket",
    "messagingSenderId",
    "appId",
  ];

  return requiredKeys.every((key) => {
    const value = String(firebaseConfig?.[key] || "");
    return value.length > 0 && !value.startsWith("YOUR_FIREBASE_");
  });
}

async function loadFirebaseConfig() {
  const response = await fetch("/api/firebase-config", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("firebase_config_unavailable");
  }
  return response.json();
}

function emptyBoard() {
  return Array(9).fill("");
}

function getWinningLine(board) {
  for (const combo of WINNING_COMBOS) {
    const [a, b, c] = combo;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return combo;
    }
  }
  return null;
}

function getRoleForUser(room, uid) {
  if (!room?.players || !uid) {
    return null;
  }
  if (room.players.X?.uid === uid) {
    return "X";
  }
  if (room.players.O?.uid === uid) {
    return "O";
  }
  return null;
}

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function drawWinLine(combo) {
  const [startIndex, , endIndex] = combo;
  const startRect = cells[startIndex].getBoundingClientRect();
  const endRect = cells[endIndex].getBoundingClientRect();
  const boardRect = boardEl.getBoundingClientRect();

  const x1 = startRect.left + startRect.width / 2 - boardRect.left;
  const y1 = startRect.top + startRect.height / 2 - boardRect.top;
  const x2 = endRect.left + endRect.width / 2 - boardRect.left;
  const y2 = endRect.top + endRect.height / 2 - boardRect.top;

  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;

  winLineEl.style.left = `${x1}px`;
  winLineEl.style.top = `${y1 - 3}px`;
  winLineEl.style.width = `${length}px`;
  winLineEl.style.opacity = "1";
  winLineEl.style.transform = `rotate(${angle}deg) scaleX(0)`;
  winLineEl.classList.remove("show");
  void winLineEl.offsetHeight;
  winLineEl.classList.add("show");
}

function hideWinLine() {
  winLineEl.classList.remove("show");
  winLineEl.style.opacity = "0";
}

function renderBoard(room, myRole) {
  const board = room?.board || emptyBoard();
  const canPlay = room?.status === "playing" && myRole && room.currentTurn === myRole;

  cells.forEach((cell, index) => {
    const value = board[index] || "";
    cell.textContent = value;
    cell.disabled = !canPlay || Boolean(value);
    cell.classList.remove("x", "o", "winning");
    if (value === "X") {
      cell.classList.add("x");
    }
    if (value === "O") {
      cell.classList.add("o");
    }
  });

  if (Array.isArray(room?.winnerLine)) {
    room.winnerLine.forEach((i) => cells[i].classList.add("winning"));
    drawWinLine(room.winnerLine);
  } else {
    hideWinLine();
  }
}

function updateStatus(room, myRole) {
  if (!currentUser) {
    statusEl.textContent = "Sign in with Google to start.";
    return;
  }
  if (!room) {
    statusEl.textContent = "Create a room or join a friend's room.";
    return;
  }
  if (!myRole) {
    statusEl.textContent = "Room full. You are watching as spectator.";
    return;
  }
  if (room.status === "waiting") {
    statusEl.textContent = "Waiting for second player to join.";
    return;
  }
  if (room.status === "playing") {
    if (room.currentTurn === myRole) {
      statusEl.textContent = `Your turn (${myRole}).`;
    } else {
      statusEl.textContent = `Opponent's turn (${room.currentTurn}).`;
    }
    return;
  }
  if (room.winner === "draw") {
    statusEl.textContent = `Round ${room.round} ended in a draw.`;
    return;
  }
  if (room.winner === myRole) {
    statusEl.textContent = `You won round ${room.round}. Click Next Round to continue.`;
    return;
  }
  statusEl.textContent = `You lost round ${room.round}. Click Next Round to continue.`;
}

function updateScoreboard(room) {
  const xName = room?.players?.X?.name || "Player X";
  const oName = room?.players?.O?.name || "Player O";
  const scores = room?.scores || { X: 0, O: 0, draw: 0 };
  labelXEl.textContent = `${xName} (X)`;
  labelOEl.textContent = `${oName} (O)`;
  scoreXEl.textContent = String(scores.X || 0);
  scoreOEl.textContent = String(scores.O || 0);
  scoreDrawEl.textContent = String(scores.draw || 0);
  roundEl.textContent = `Round ${room?.round || 1}`;
}

function updateUiState() {
  const signedIn = Boolean(currentUser);
  userInfoEl.classList.toggle("hidden", !signedIn);
  signInBtn.classList.toggle("hidden", signedIn);
  signOutBtn.classList.toggle("hidden", !signedIn);

  if (signedIn) {
    userPhotoEl.src = currentUser.photoURL || "";
    userNameEl.textContent = currentUser.displayName || "Signed In";
  }

  lobbyEl.classList.toggle("hidden", !signedIn || Boolean(currentRoomCode));
  roomPanelEl.classList.toggle("hidden", !currentRoomCode);
}

function attachRoomListener(roomCode) {
  if (roomUnsubscribe) {
    roomUnsubscribe();
    roomUnsubscribe = null;
  }

  roomUnsubscribe = onValue(ref(database, `rooms/${roomCode}`), (snapshot) => {
    if (!snapshot.exists()) {
      currentRoomState = null;
      currentRoomCode = null;
      roomCodeEl.textContent = "-";
      updateUiState();
      updateStatus(null, null);
      updateScoreboard(null);
      renderBoard(null, null);
      return;
    }

    const room = snapshot.val();
    currentRoomState = room;
    currentRoomCode = roomCode;
    roomCodeEl.textContent = roomCode;

    const myRole = getRoleForUser(room, currentUser?.uid || null);
    updateUiState();
    updateStatus(room, myRole);
    updateScoreboard(room);
    renderBoard(room, myRole);
    nextRoundBtn.disabled = !(room.status === "finished" && Boolean(myRole));
  });
}

async function createRoom() {
  if (!currentUser) {
    return;
  }

  let code = makeRoomCode();
  let retries = 0;
  while (retries < 5) {
    const roomRef = ref(database, `rooms/${code}`);
    const payload = {
      board: emptyBoard(),
      currentTurn: "X",
      status: "waiting",
      round: 1,
      winner: null,
      winnerLine: null,
      scores: { X: 0, O: 0, draw: 0 },
      players: {
        X: {
          uid: currentUser.uid,
          name: currentUser.displayName || "Player X",
        },
        O: null,
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      const result = await runTransaction(roomRef, (room) => {
        if (room) {
          return;
        }
        return payload;
      });
      if (!result.committed) {
        retries += 1;
        code = makeRoomCode();
        continue;
      }
      history.replaceState({}, "", `${window.location.pathname}?room=${code}`);
      attachRoomListener(code);
      return;
    } catch (_error) {
      retries += 1;
      code = makeRoomCode();
    }
  }

  statusEl.textContent = "Failed to create room. Please try again.";
}

async function joinRoom(code) {
  if (!currentUser || !code) {
    return;
  }

  const roomCode = code.trim().toUpperCase();
  const roomRef = ref(database, `rooms/${roomCode}`);

  const transactionResult = await runTransaction(roomRef, (room) => {
    if (!room) {
      return;
    }
    if (!room.players) {
      room.players = { X: null, O: null };
    }

    const isX = room.players.X?.uid === currentUser.uid;
    const isO = room.players.O?.uid === currentUser.uid;
    if (isX || isO) {
      if (room.players.X && room.players.O) {
        room.status = "playing";
      }
      room.updatedAt = Date.now();
      return room;
    }

    if (!room.players.O) {
      room.players.O = {
        uid: currentUser.uid,
        name: currentUser.displayName || "Player O",
      };
      room.status = room.players.X ? "playing" : "waiting";
      room.updatedAt = Date.now();
      return room;
    }

    return;
  });

  if (!transactionResult.committed) {
    statusEl.textContent = "Unable to join room. It may be full or missing.";
    return;
  }

  history.replaceState({}, "", `${window.location.pathname}?room=${roomCode}`);
  attachRoomListener(roomCode);
}

async function leaveRoom() {
  if (!currentUser || !currentRoomCode) {
    return;
  }
  const roomRef = ref(database, `rooms/${currentRoomCode}`);

  await runTransaction(roomRef, (room) => {
    if (!room?.players) {
      return room;
    }

    if (room.players.X?.uid === currentUser.uid) {
      room.players.X = null;
    }
    if (room.players.O?.uid === currentUser.uid) {
      room.players.O = null;
    }

    if (!room.players.X && !room.players.O) {
      return null;
    }

    room.board = emptyBoard();
    room.round = 1;
    room.currentTurn = room.players.X ? "X" : "O";
    room.status = "waiting";
    room.winner = null;
    room.winnerLine = null;
    room.scores = { X: 0, O: 0, draw: 0 };
    room.updatedAt = Date.now();
    return room;
  });

  if (roomUnsubscribe) {
    roomUnsubscribe();
    roomUnsubscribe = null;
  }

  currentRoomCode = null;
  currentRoomState = null;
  history.replaceState({}, "", window.location.pathname);
  updateUiState();
  updateStatus(null, null);
  updateScoreboard(null);
  renderBoard(null, null);
}

async function handleCellClick(event) {
  if (!currentUser || !currentRoomCode) {
    return;
  }
  const index = Number(event.currentTarget.dataset.index);
  const roomRef = ref(database, `rooms/${currentRoomCode}`);

  await runTransaction(roomRef, (room) => {
    if (!room || room.status !== "playing" || !Array.isArray(room.board)) {
      return room;
    }

    const role = getRoleForUser(room, currentUser.uid);
    if (!role || room.currentTurn !== role || room.board[index]) {
      return room;
    }

    room.board[index] = role;
    const winnerLine = getWinningLine(room.board);

    if (winnerLine) {
      room.status = "finished";
      room.winner = role;
      room.winnerLine = winnerLine;
      if (!room.scores) {
        room.scores = { X: 0, O: 0, draw: 0 };
      }
      room.scores[role] = (room.scores[role] || 0) + 1;
    } else if (room.board.every((value) => value !== "")) {
      room.status = "finished";
      room.winner = "draw";
      room.winnerLine = null;
      if (!room.scores) {
        room.scores = { X: 0, O: 0, draw: 0 };
      }
      room.scores.draw = (room.scores.draw || 0) + 1;
    } else {
      room.currentTurn = role === "X" ? "O" : "X";
    }

    room.updatedAt = Date.now();
    return room;
  });
}

async function nextRound() {
  if (!currentRoomCode) {
    return;
  }
  const roomRef = ref(database, `rooms/${currentRoomCode}`);
  await runTransaction(roomRef, (room) => {
    if (!room || room.status !== "finished") {
      return room;
    }
    const role = getRoleForUser(room, currentUser?.uid || null);
    if (!role) {
      return room;
    }
    room.round = (room.round || 1) + 1;
    room.board = emptyBoard();
    room.winner = null;
    room.winnerLine = null;
    room.status = room.players?.X && room.players?.O ? "playing" : "waiting";
    room.currentTurn = room.round % 2 === 0 ? "O" : "X";
    room.updatedAt = Date.now();
    return room;
  });
}

async function copyInviteLink() {
  if (!currentRoomCode) {
    return;
  }
  const url = `${window.location.origin}${window.location.pathname}?room=${currentRoomCode}`;
  try {
    await navigator.clipboard.writeText(url);
    statusEl.textContent = "Invite link copied to clipboard.";
  } catch (_error) {
    statusEl.textContent = url;
  }
}

async function signIn() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (error?.code === "auth/popup-blocked" || error?.code === "auth/cancelled-popup-request") {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw error;
  }
}

async function boot() {
  let firebaseConfig;
  try {
    firebaseConfig = await loadFirebaseConfig();
  } catch (_error) {
    statusEl.textContent =
      "Firebase config endpoint unavailable. Ensure Vercel env vars are set and redeploy.";
    signInBtn.disabled = true;
    createRoomBtn.disabled = true;
    joinRoomBtn.disabled = true;
    nextRoundBtn.disabled = true;
    return;
  }

  if (!hasConfiguredFirebase(firebaseConfig)) {
    statusEl.textContent =
      "Firebase config missing in environment. Set Vercel FIREBASE_* vars and redeploy.";
    signInBtn.disabled = true;
    createRoomBtn.disabled = true;
    joinRoomBtn.disabled = true;
    nextRoundBtn.disabled = true;
    return;
  }

  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  database = getDatabase(app);

  getRedirectResult(auth).catch((error) => {
    setAuthErrorStatus(error);
  });

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    updateUiState();

    if (!user) {
      if (roomUnsubscribe) {
        roomUnsubscribe();
        roomUnsubscribe = null;
      }
      currentRoomCode = null;
      currentRoomState = null;
      updateStatus(null, null);
      updateScoreboard(null);
      renderBoard(null, null);
      return;
    }

    const urlRoom = new URLSearchParams(window.location.search).get("room");
    if (urlRoom && !currentRoomCode) {
      await joinRoom(urlRoom.toUpperCase());
      return;
    }

    updateStatus(currentRoomState, getRoleForUser(currentRoomState, user.uid));
  });
}

signInBtn.addEventListener("click", () => {
  signIn().catch((error) => {
    setAuthErrorStatus(error);
  });
});

signOutBtn.addEventListener("click", () => {
  signOut(auth).catch(() => {
    statusEl.textContent = "Sign-out failed.";
  });
});

createRoomBtn.addEventListener("click", () => {
  createRoom().catch((error) => {
    if (error?.code === "PERMISSION_DENIED") {
      statusEl.textContent = "Database permission denied. Publish database.rules.json in Firebase.";
      return;
    }
    statusEl.textContent = "Could not create room.";
  });
});

joinRoomBtn.addEventListener("click", () => {
  joinRoom(roomInputEl.value).catch((error) => {
    if (error?.code === "PERMISSION_DENIED") {
      statusEl.textContent = "Database permission denied. Publish database.rules.json in Firebase.";
      return;
    }
    statusEl.textContent = "Could not join room.";
  });
});

roomInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinRoom(roomInputEl.value).catch((error) => {
      if (error?.code === "PERMISSION_DENIED") {
        statusEl.textContent = "Database permission denied. Publish database.rules.json in Firebase.";
        return;
      }
      statusEl.textContent = "Could not join room.";
    });
  }
});

copyLinkBtn.addEventListener("click", () => {
  copyInviteLink();
});

leaveRoomBtn.addEventListener("click", () => {
  leaveRoom().catch(() => {
    statusEl.textContent = "Could not leave room.";
  });
});

nextRoundBtn.addEventListener("click", () => {
  nextRound().catch(() => {
    statusEl.textContent = "Could not start next round.";
  });
});

cells.forEach((cell) => {
  cell.addEventListener("click", handleCellClick);
});

updateUiState();
updateScoreboard(null);
renderBoard(null, null);
boot().catch(() => {
  statusEl.textContent = "Failed to initialize app.";
});
