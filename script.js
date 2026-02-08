import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  getAuth,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

const statusEl = document.getElementById("status");
const roundEl = document.getElementById("round");
const scoreXEl = document.getElementById("score-x");
const scoreOEl = document.getElementById("score-o");
const scoreDrawEl = document.getElementById("score-draw");
const labelXEl = document.getElementById("label-x");
const labelOEl = document.getElementById("label-o");
const roomCodeEl = document.getElementById("room-code");
const participantsEl = document.getElementById("participants");
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

let auth;
let currentUser = null;
let currentRoomCode = null;
let currentRoomState = null;
let pollTimer = null;

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
    return value.length > 0;
  });
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
  winLineEl.style.setProperty("--line-angle", `${angle}deg`);
  winLineEl.style.transform = `rotate(${angle}deg) scaleX(0)`;
  winLineEl.classList.remove("show");
  void winLineEl.offsetHeight;
  winLineEl.classList.add("show");
}

function hideWinLine() {
  winLineEl.classList.remove("show");
  winLineEl.style.opacity = "0";
}

function getMyRole(room) {
  if (!room || !currentUser) {
    return null;
  }
  if (room.players?.X?.uid === currentUser.uid) {
    return "X";
  }
  if (room.players?.O?.uid === currentUser.uid) {
    return "O";
  }
  return null;
}

function renderBoard(room) {
  const board = room?.board || Array(9).fill("");
  const myRole = getMyRole(room);
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

  const localWinnerLine = Array.isArray(room?.winnerLine) ? room.winnerLine : getWinningLine(board);
  if (localWinnerLine) {
    localWinnerLine.forEach((i) => cells[i].classList.add("winning"));
    drawWinLine(localWinnerLine);
  } else {
    hideWinLine();
  }
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

  if (participantsEl) {
    participantsEl.textContent = `X: ${room?.players?.X?.name || "waiting"} | O: ${room?.players?.O?.name || "waiting"}`;
  }
}

function updateStatus(room) {
  if (!currentUser) {
    statusEl.textContent = "Sign in with Google to start.";
    return;
  }
  if (!room) {
    statusEl.textContent = "Create a room or join a friend's room.";
    return;
  }

  const myRole = getMyRole(room);
  if (!myRole) {
    statusEl.textContent = "Room full. You are watching as spectator.";
    return;
  }

  if (room.status === "waiting") {
    statusEl.textContent = "Waiting for second player to join.";
    return;
  }

  if (room.status === "playing") {
    statusEl.textContent = room.currentTurn === myRole ? `Your turn (${myRole}).` : `Opponent's turn (${room.currentTurn}).`;
    return;
  }

  if (room.winner === "draw") {
    statusEl.textContent = `Round ${room.round} ended in a draw.`;
    return;
  }

  statusEl.textContent = room.winner === myRole ? `You won round ${room.round}. Click Next Round.` : `You lost round ${room.round}. Click Next Round.`;
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

function renderRoom(room) {
  currentRoomState = room;
  if (room) {
    roomCodeEl.textContent = room.roomCode || currentRoomCode || "-";
  } else {
    roomCodeEl.textContent = "-";
  }
  updateScoreboard(room);
  updateStatus(room);
  renderBoard(room);
  const myRole = getMyRole(room);
  nextRoundBtn.disabled = !(room?.status === "finished" && myRole);
}

function setAuthErrorStatus(error) {
  const code = error?.code || "unknown";
  const message = error?.message || "No details";
  if (code === "auth/unauthorized-domain") {
    statusEl.textContent = "Google auth blocked: add this domain in Firebase Auth authorized domains.";
    return;
  }
  if (code === "auth/operation-not-allowed") {
    statusEl.textContent = "Google provider is disabled in Firebase Auth.";
    return;
  }
  statusEl.textContent = `Google sign-in failed: ${code}. ${message}`;
}

async function loadFirebaseConfig() {
  const response = await fetch("/api/firebase-config", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("firebase_config_unavailable");
  }
  return response.json();
}

async function apiRequest(action, payload = null, method = "POST") {
  if (!currentUser) {
    throw new Error("Not authenticated");
  }

  const token = await currentUser.getIdToken();
  const url = new URL("/api/room", window.location.origin);
  url.searchParams.set("action", action);

  if (method === "GET" && payload?.roomCode) {
    url.searchParams.set("roomCode", payload.roomCode);
  }

  const response = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: method === "POST" ? JSON.stringify(payload || {}) : undefined,
  });

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_error) {
    throw new Error(`API ${action} failed: expected JSON, got: ${text.slice(0, 120)}`);
  }

  if (!response.ok) {
    throw new Error(json?.error || "Request failed");
  }
  return json;
}

async function pollRoom() {
  if (!currentRoomCode || !currentUser) {
    return;
  }
  try {
    const result = await apiRequest("get", { roomCode: currentRoomCode }, "GET");
    renderRoom(result.room);
  } catch (error) {
    statusEl.textContent = String(error.message || "Failed to refresh room");
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    pollRoom();
  }, 1000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function createRoom() {
  const result = await apiRequest("create", {});
  const roomCode = result.room.roomCode;
  currentRoomCode = roomCode;
  history.replaceState({}, "", `${window.location.pathname}?room=${roomCode}`);
  updateUiState();
  renderRoom(result.room);
  startPolling();
}

async function joinRoom(inputCode) {
  const roomCode = String(inputCode || "").trim().toUpperCase();
  if (!roomCode) {
    statusEl.textContent = "Enter a valid room code.";
    return;
  }

  const result = await apiRequest("join", { roomCode });
  currentRoomCode = roomCode;
  history.replaceState({}, "", `${window.location.pathname}?room=${roomCode}`);
  updateUiState();
  renderRoom(result.room);
  if (result.spectator) {
    statusEl.textContent = "Room full. You joined as spectator.";
  }
  startPolling();
}

async function leaveRoom() {
  if (!currentRoomCode) {
    return;
  }
  await apiRequest("leave", { roomCode: currentRoomCode });
  stopPolling();
  currentRoomCode = null;
  currentRoomState = null;
  history.replaceState({}, "", window.location.pathname);
  updateUiState();
  renderRoom(null);
}

async function handleCellClick(event) {
  if (!currentRoomCode) {
    return;
  }
  const index = Number(event.currentTarget.dataset.index);
  const result = await apiRequest("move", { roomCode: currentRoomCode, index });
  renderRoom(result.room);
}

async function nextRound() {
  if (!currentRoomCode) {
    return;
  }
  const result = await apiRequest("next-round", { roomCode: currentRoomCode });
  renderRoom(result.room);
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
      statusEl.textContent = "Redirecting to Google sign-in...";
      await signInWithRedirect(auth, provider);
      return;
    }
    throw error;
  }
}

async function boot() {
  const firebaseConfig = await loadFirebaseConfig();
  if (!hasConfiguredFirebase(firebaseConfig)) {
    statusEl.textContent = "Firebase config missing in environment.";
    signInBtn.disabled = true;
    return;
  }

  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);

  await setPersistence(auth, browserLocalPersistence);
  await getRedirectResult(auth).catch((error) => setAuthErrorStatus(error));

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    updateUiState();

    if (!user) {
      stopPolling();
      currentRoomCode = null;
      currentRoomState = null;
      renderRoom(null);
      return;
    }

    const urlRoom = new URLSearchParams(window.location.search).get("room");
    if (urlRoom && !currentRoomCode) {
      try {
        await joinRoom(urlRoom);
      } catch (error) {
        statusEl.textContent = String(error.message || "Could not join room");
      }
      return;
    }

    updateStatus(currentRoomState);
  });
}

signInBtn.addEventListener("click", () => {
  statusEl.textContent = "Starting Google sign-in...";
  signIn().catch((error) => setAuthErrorStatus(error));
});

signOutBtn.addEventListener("click", () => {
  signOut(auth).catch(() => {
    statusEl.textContent = "Sign-out failed.";
  });
});

createRoomBtn.addEventListener("click", () => {
  createRoom().catch((error) => {
    statusEl.textContent = String(error.message || "Could not create room.");
  });
});

joinRoomBtn.addEventListener("click", () => {
  joinRoom(roomInputEl.value).catch((error) => {
    statusEl.textContent = String(error.message || "Could not join room.");
  });
});

roomInputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinRoom(roomInputEl.value).catch((error) => {
      statusEl.textContent = String(error.message || "Could not join room.");
    });
  }
});

copyLinkBtn.addEventListener("click", () => {
  copyInviteLink();
});

leaveRoomBtn.addEventListener("click", () => {
  leaveRoom().catch((error) => {
    statusEl.textContent = String(error.message || "Could not leave room.");
  });
});

nextRoundBtn.addEventListener("click", () => {
  nextRound().catch((error) => {
    statusEl.textContent = String(error.message || "Could not start next round.");
  });
});

cells.forEach((cell) => {
  cell.addEventListener("click", handleCellClick);
});

updateUiState();
renderRoom(null);
boot().catch((error) => {
  statusEl.textContent = `Failed to initialize app: ${error.message || "unknown"}`;
});
