const CELL_SIZE = 28;
const PREVIEW_CELL_SIZE = 28;
const PLAYER_WIDTH = 10;

const COLORS = {
  I: "#41c9e2",
  O: "#f3c64d",
  T: "#a05cff",
  S: "#4bbb69",
  Z: "#ed5f73",
  J: "#4c81ff",
  L: "#ff9a3d",
};

const FOREIGN_LOCKED_COLOR = "#8d877f";

const SHAPES = {
  I: [
    [-1, 0],
    [0, 0],
    [1, 0],
    [2, 0],
  ],
  O: [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  T: [
    [-1, 0],
    [0, 0],
    [1, 0],
    [0, -1],
  ],
  S: [
    [0, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
  ],
  Z: [
    [-1, 0],
    [0, 0],
    [0, 1],
    [1, 1],
  ],
  J: [
    [-1, -1],
    [-1, 0],
    [0, 0],
    [1, 0],
  ],
  L: [
    [1, -1],
    [-1, 0],
    [0, 0],
    [1, 0],
  ],
};

const scoreEl = document.getElementById("score");
const linesEl = document.getElementById("lines");
const levelEl = document.getElementById("level");
const statusEl = document.getElementById("status");
const playerEl = document.getElementById("player");
const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlay-title");
const overlayTextEl = document.getElementById("overlay-text");

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const nextCanvas = document.getElementById("next");
const nextCtx = nextCanvas.getContext("2d");

const appState = {
  playerId: "",
  snapshot: null,
  connected: false,
  eventSource: null,
};

const setOverlay = (title, text, visible) => {
  overlayTitleEl.textContent = title;
  overlayTextEl.textContent = text;
  overlayEl.classList.toggle("hidden", !visible);
};

const getPlayerState = () =>
  appState.snapshot?.players.find((player) => player.playerId === appState.playerId) ?? null;

const getRotationCells = (piece) => {
  let cells = SHAPES[piece.type].map(([x, y]) => [x, y]);

  for (let turn = 0; turn < piece.rotation; turn += 1) {
    cells = cells.map(([x, y]) => [-y, x]);
  }

  return cells;
};

const drawCell = (context, x, y, color, size) => {
  context.fillStyle = color;
  context.fillRect(x * size, y * size, size - 2, size - 2);
  context.fillStyle = "rgba(255,255,255,0.24)";
  context.fillRect(x * size + 4, y * size + 4, size - 10, 6);
};

const setCanvasSize = () => {
  if (!appState.snapshot) {
    return;
  }

  canvas.width = Math.max(
    window.innerWidth - 720,
    appState.snapshot.world.playerCount * PLAYER_WIDTH * CELL_SIZE,
    PLAYER_WIDTH * CELL_SIZE * 3,
  );
  canvas.height = appState.snapshot.world.height * CELL_SIZE;
};

const drawGrid = (boardStarts, height) => {
  for (const startCellX of boardStarts.values()) {
    const offsetX = startCellX * CELL_SIZE;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < PLAYER_WIDTH; x += 1) {
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.strokeRect(offsetX + x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      }
    }
  }
};

const drawBoardLabels = (players, ownPlayerId) => {
  ctx.save();
  ctx.font = 'bold 14px "Segoe UI", sans-serif';
  ctx.textAlign = "left";

  for (const player of players) {
    const color = player.playerId === ownPlayerId ? "#f3a65a" : "rgba(255,255,255,0.8)";
    ctx.fillStyle = color;
    ctx.fillText(
      player.label,
      player.displayStart * CELL_SIZE + 10,
      20,
    );
  }

  ctx.restore();
};

const getBoardOwner = (players, playerIndex) =>
  players.find((player) => player.playerIndex === playerIndex) ?? null;

const drawBoard = () => {
  if (!appState.snapshot) {
    return;
  }

  const { playerCount, height, lockedCells, activePieces } = appState.snapshot.world;
  const ownPlayer = getPlayerState();
  const ownIndex = ownPlayer?.playerIndex ?? 0;

  setCanvasSize();
  const centerBoardStart = Math.floor(canvas.width / CELL_SIZE / 2 - PLAYER_WIDTH / 2);
  const boardStarts = new Map();

  for (let boardIndex = 0; boardIndex < playerCount; boardIndex += 1) {
    const relativeIndex = boardIndex - ownIndex;
    boardStarts.set(boardIndex, centerBoardStart + relativeIndex * PLAYER_WIDTH);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid(boardStarts, height);

  for (const cell of lockedCells) {
    const boardIndex = Math.floor(cell.x / PLAYER_WIDTH);
    const boardOwner = getBoardOwner(appState.snapshot.players, boardIndex);
    const displayStart = boardStarts.get(boardIndex);

    if (displayStart === undefined) {
      continue;
    }

    const color =
      boardOwner && boardOwner.playerId === cell.ownerId
        ? COLORS[cell.pieceType]
        : FOREIGN_LOCKED_COLOR;

    drawCell(
      ctx,
      displayStart + (cell.x - boardIndex * PLAYER_WIDTH),
      cell.y,
      color,
      CELL_SIZE,
    );
  }

  for (const piece of activePieces) {
    for (const [x, y] of getRotationCells(piece)) {
      const worldX = piece.x + x;
      const boardIndex = Math.floor(worldX / PLAYER_WIDTH);
      const displayStart = boardStarts.get(boardIndex);
      const drawX =
        displayStart === undefined
          ? -1
          : displayStart + (worldX - boardIndex * PLAYER_WIDTH);
      const drawY = piece.y + y;

      if (drawX >= 0 && drawY >= 0 && drawY < height) {
        drawCell(ctx, drawX, drawY, COLORS[piece.type], CELL_SIZE);
      }
    }
  }

  if (ownPlayer) {
    const displayStart = boardStarts.get(ownPlayer.playerIndex) ?? centerBoardStart;

    ctx.strokeStyle = "rgba(217,79,4,0.95)";
    ctx.lineWidth = 4;
    ctx.strokeRect(
      displayStart * CELL_SIZE + 2,
      2,
      PLAYER_WIDTH * CELL_SIZE - 4,
      height * CELL_SIZE - 4,
    );
  }

  drawBoardLabels(
    appState.snapshot.players.map((player) => ({
      playerId: player.playerId,
      label: `P${player.playerIndex + 1}`,
      displayStart: boardStarts.get(player.playerIndex) ?? centerBoardStart,
    })),
    appState.playerId,
  );
};

const drawNext = () => {
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const player = getPlayerState();

  if (!player) {
    return;
  }

  for (const [x, y] of SHAPES[player.nextType]) {
    drawCell(nextCtx, x + 2, y + 2, COLORS[player.nextType], PREVIEW_CELL_SIZE);
  }
};

const updateHud = () => {
  const player = getPlayerState();

  scoreEl.textContent = String(player?.score ?? 0);
  linesEl.textContent = String(player?.lines ?? 0);
  levelEl.textContent = String(1 + Math.floor((player?.lines ?? 0) / 10));
  playerEl.textContent = player ? `P${player.playerIndex + 1}` : "-";
  statusEl.textContent = appState.connected ? "connected" : "connecting";

  if (player?.gameOver) {
    setOverlay("Game Over", "Waiting for board reset...", true);
  } else {
    setOverlay("Border Tetris", "Shared world view", false);
  }
};

const render = () => {
  updateHud();
  drawBoard();
  drawNext();
};

const sendInput = async (input) => {
  if (!appState.playerId) {
    return;
  }

  await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId: appState.playerId, input }),
  });
};

const connectEvents = () => {
  if (appState.eventSource) {
    appState.eventSource.close();
  }

  const eventSource = new EventSource("/api/events");
  appState.eventSource = eventSource;

  eventSource.addEventListener("snapshot", (event) => {
    appState.connected = true;
    appState.snapshot = JSON.parse(event.data);
    render();
  });

  eventSource.onerror = () => {
    appState.connected = false;
    updateHud();
  };
};

const joinGame = async () => {
  const response = await fetch("/api/join", { method: "POST" });

  if (!response.ok) {
    setOverlay("Room Full", "The room currently supports two players.", true);
    return;
  }

  const data = await response.json();
  appState.playerId = data.playerId;
  appState.snapshot = data.snapshot;
  connectEvents();
  render();
};

document.addEventListener("keydown", (event) => {
  if (!appState.connected) {
    return;
  }

  if (event.code === "ArrowLeft") {
    sendInput("left");
  } else if (event.code === "ArrowRight") {
    sendInput("right");
  } else if (event.code === "ArrowDown") {
    sendInput("down");
  } else if (event.code === "ArrowUp" || event.code === "KeyX") {
    sendInput("rotateRight");
  } else if (event.code === "KeyZ") {
    sendInput("rotateLeft");
  } else if (event.code === "Space") {
    event.preventDefault();
    sendInput("drop");
  }
});

window.addEventListener("beforeunload", () => {
  if (!appState.playerId) {
    return;
  }

  navigator.sendBeacon(
    "/api/leave",
    new Blob([JSON.stringify({ playerId: appState.playerId })], {
      type: "application/json",
    }),
  );
});

window.addEventListener("resize", () => {
  render();
});

setOverlay("Connecting", "Joining session...", true);
joinGame();
