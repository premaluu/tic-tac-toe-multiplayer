const { ensureSchema, rowToRoom, getSql } = require("./_lib/db.js");
const { verifyUser } = require("./_lib/auth.js");

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

function send(res, status, payload) {
  res.status(status).json(payload);
}

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getRole(row, uid) {
  if (!uid || !row) {
    return null;
  }
  if (row.x_uid === uid) {
    return "X";
  }
  if (row.o_uid === uid) {
    return "O";
  }
  return null;
}

function boardFromString(board) {
  return (board || "---------").split("").map((v) => (v === "-" ? "" : v));
}

function boardToString(board) {
  return board.map((v) => (v ? v : "-")).join("");
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

async function getRoom(code) {
  const sql = getSql();
  const rows = await sql`select * from game_rooms where room_code = ${code}`;
  return rows[0] || null;
}

async function createRoom(user) {
  const sql = getSql();
  for (let i = 0; i < 8; i += 1) {
    const roomCode = makeRoomCode();
    const result = await sql`
      insert into game_rooms (
        room_code, board, current_turn, status, round, winner, winner_line,
        score_x, score_o, score_draw,
        x_uid, x_name, o_uid, o_name
      )
      values (
        ${roomCode}, ${"---------"}, ${"X"}, ${"waiting"}, ${1}, ${null}, ${null},
        ${0}, ${0}, ${0},
        ${user.uid}, ${user.name}, ${null}, ${null}
      )
      on conflict (room_code) do nothing
      returning *
    `;

    if (result[0]) {
      return result[0];
    }
  }
  return null;
}

async function joinRoom(user, roomCode) {
  const sql = getSql();
  return sql.begin(async (tx) => {
    const rows = await tx`select * from game_rooms where room_code = ${roomCode} for update`;
    const room = rows[0];
    if (!room) {
      return { notFound: true };
    }

    const role = getRole(room, user.uid);
    if (role) {
      return { row: room, role };
    }

    if (room.status === "playing" && room.o_uid) {
      return { row: room, role: null, spectator: true };
    }

    const updated = await tx`
      update game_rooms
      set o_uid = ${user.uid},
          o_name = ${user.name},
          status = ${"playing"},
          updated_at = now()
      where room_code = ${roomCode}
      returning *
    `;

    return { row: updated[0], role: "O" };
  });
}

async function move(user, roomCode, index) {
  const sql = getSql();
  return sql.begin(async (tx) => {
    const rows = await tx`select * from game_rooms where room_code = ${roomCode} for update`;
    const row = rows[0];
    if (!row) {
      return { notFound: true };
    }

    if (row.status !== "playing") {
      return { row };
    }

    const role = getRole(row, user.uid);
    if (!role || role !== row.current_turn) {
      return { row };
    }

    const board = boardFromString(row.board);
    if (index < 0 || index > 8 || board[index]) {
      return { row };
    }

    board[index] = role;
    let status = row.status;
    let winner = null;
    let winnerLine = null;
    let currentTurn = row.current_turn === "X" ? "O" : "X";
    let scoreX = row.score_x;
    let scoreO = row.score_o;
    let scoreDraw = row.score_draw;

    const line = getWinningLine(board);
    if (line) {
      status = "finished";
      winner = role;
      winnerLine = line.join(",");
      currentTurn = row.current_turn;
      if (role === "X") {
        scoreX += 1;
      } else {
        scoreO += 1;
      }
    } else if (board.every((c) => c)) {
      status = "finished";
      winner = "draw";
      winnerLine = null;
      currentTurn = row.current_turn;
      scoreDraw += 1;
    }

    const updated = await tx`
      update game_rooms
      set board = ${boardToString(board)},
          current_turn = ${currentTurn},
          status = ${status},
          winner = ${winner},
          winner_line = ${winnerLine},
          score_x = ${scoreX},
          score_o = ${scoreO},
          score_draw = ${scoreDraw},
          updated_at = now()
      where room_code = ${roomCode}
      returning *
    `;

    return { row: updated[0] };
  });
}

async function nextRound(user, roomCode) {
  const sql = getSql();
  return sql.begin(async (tx) => {
    const rows = await tx`select * from game_rooms where room_code = ${roomCode} for update`;
    const row = rows[0];
    if (!row) {
      return { notFound: true };
    }

    const role = getRole(row, user.uid);
    if (!role || row.status !== "finished") {
      return { row };
    }

    const nextRoundNum = row.round + 1;
    const nextTurn = nextRoundNum % 2 === 0 ? "O" : "X";

    const updated = await tx`
      update game_rooms
      set board = ${"---------"},
          round = ${nextRoundNum},
          current_turn = ${nextTurn},
          status = ${row.x_uid && row.o_uid ? "playing" : "waiting"},
          winner = ${null},
          winner_line = ${null},
          updated_at = now()
      where room_code = ${roomCode}
      returning *
    `;

    return { row: updated[0] };
  });
}

async function leaveRoom(user, roomCode) {
  const sql = getSql();
  return sql.begin(async (tx) => {
    const rows = await tx`select * from game_rooms where room_code = ${roomCode} for update`;
    const row = rows[0];
    if (!row) {
      return { notFound: true };
    }

    const role = getRole(row, user.uid);
    if (!role) {
      return { row };
    }

    if (role === "X" && row.o_uid) {
      const updated = await tx`
        update game_rooms
        set x_uid = ${row.o_uid},
            x_name = ${row.o_name || "Player X"},
            o_uid = ${null},
            o_name = ${null},
            board = ${"---------"},
            status = ${"waiting"},
            current_turn = ${"X"},
            round = ${1},
            winner = ${null},
            winner_line = ${null},
            score_x = ${0},
            score_o = ${0},
            score_draw = ${0},
            updated_at = now()
        where room_code = ${roomCode}
        returning *
      `;
      return { row: updated[0] };
    }

    if (role === "X" && !row.o_uid) {
      await tx`delete from game_rooms where room_code = ${roomCode}`;
      return { deleted: true };
    }

    const updated = await tx`
      update game_rooms
      set o_uid = ${null},
          o_name = ${null},
          board = ${"---------"},
          status = ${"waiting"},
          current_turn = ${"X"},
          round = ${1},
          winner = ${null},
          winner_line = ${null},
          score_x = ${0},
          score_o = ${0},
          score_draw = ${0},
          updated_at = now()
      where room_code = ${roomCode}
      returning *
    `;

    return { row: updated[0] };
  });
}

module.exports = async (req, res) => {
  try {
    await ensureSchema();
    const user = await verifyUser(req);
    if (!user) {
      return send(res, 401, { error: "Unauthorized" });
    }

    const action = String(req.query.action || "").toLowerCase();

    if (req.method === "GET" && action === "get") {
      const roomCode = String(req.query.roomCode || "").trim().toUpperCase();
      if (!roomCode) {
        return send(res, 400, { error: "roomCode is required" });
      }
      const row = await getRoom(roomCode);
      if (!row) {
        return send(res, 404, { error: "Room not found" });
      }
      return send(res, 200, { room: rowToRoom(row), role: getRole(row, user.uid) });
    }

    if (req.method !== "POST") {
      return send(res, 405, { error: "Method not allowed" });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};

    if (action === "create") {
      const row = await createRoom(user);
      if (!row) {
        return send(res, 500, { error: "Failed to create room" });
      }
      return send(res, 200, { room: rowToRoom(row), role: "X" });
    }

    const roomCode = String(body.roomCode || "").trim().toUpperCase();
    if (!roomCode) {
      return send(res, 400, { error: "roomCode is required" });
    }

    if (action === "join") {
      const result = await joinRoom(user, roomCode);
      if (result.notFound) {
        return send(res, 404, { error: "Room not found" });
      }
      return send(res, 200, {
        room: rowToRoom(result.row),
        role: result.role,
        spectator: Boolean(result.spectator),
      });
    }

    if (action === "move") {
      const index = Number(body.index);
      const result = await move(user, roomCode, index);
      if (result.notFound) {
        return send(res, 404, { error: "Room not found" });
      }
      return send(res, 200, { room: rowToRoom(result.row), role: getRole(result.row, user.uid) });
    }

    if (action === "next-round") {
      const result = await nextRound(user, roomCode);
      if (result.notFound) {
        return send(res, 404, { error: "Room not found" });
      }
      return send(res, 200, {
        room: result.row ? rowToRoom(result.row) : null,
        role: result.row ? getRole(result.row, user.uid) : null,
      });
    }

    if (action === "leave") {
      const result = await leaveRoom(user, roomCode);
      if (result.notFound) {
        return send(res, 404, { error: "Room not found" });
      }
      return send(res, 200, {
        deleted: Boolean(result.deleted),
        room: result.row ? rowToRoom(result.row) : null,
      });
    }

    return send(res, 400, { error: "Unknown action" });
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: "Server error" });
  }
};
