const postgres = require("postgres");

let sql = null;

function getSql() {
  if (sql) {
    return sql;
  }
  const connection = String(process.env.DATABASE_URL || "").trim();
  if (!connection) {
    throw new Error("DATABASE_URL is required");
  }
  sql = postgres(connection, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return sql;
}

async function ensureSchema() {
  await getSql()`
    create table if not exists game_rooms (
      room_code text primary key,
      board text not null,
      current_turn text not null,
      status text not null,
      round integer not null,
      winner text,
      winner_line text,
      score_x integer not null default 0,
      score_o integer not null default 0,
      score_draw integer not null default 0,
      x_uid text,
      x_name text,
      o_uid text,
      o_name text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;
}

function rowToRoom(row) {
  if (!row) {
    return null;
  }
  return {
    roomCode: row.room_code,
    board: (row.board || "---------").split("").map((v) => (v === "-" ? "" : v)),
    currentTurn: row.current_turn,
    status: row.status,
    round: row.round,
    winner: row.winner || null,
    winnerLine: row.winner_line ? row.winner_line.split(",").map((n) => Number(n)) : null,
    scores: {
      X: row.score_x,
      O: row.score_o,
      draw: row.score_draw,
    },
    players: {
      X: row.x_uid ? { uid: row.x_uid, name: row.x_name || "Player X" } : null,
      O: row.o_uid ? { uid: row.o_uid, name: row.o_name || "Player O" } : null,
    },
    updatedAt: row.updated_at,
  };
}

module.exports = {
  getSql,
  ensureSchema,
  rowToRoom,
};
