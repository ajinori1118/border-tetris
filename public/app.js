const CELL_SIZE = 28;
const PREVIEW_CELL_SIZE = 14;
const PLAYER_WIDTH = 10;
const GAME_OVER_LINE_Y = 4;
const PLAYER_NAME_STORAGE_KEY = "border-tetris-player-name";
const HORIZONTAL_REPEAT_DELAY_MS = 120;
const HORIZONTAL_REPEAT_INTERVAL_MS = 83;
const VERTICAL_REPEAT_DELAY_MS = 0;
const VERTICAL_REPEAT_INTERVAL_MS = 90;

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

const PREVIEW_SHAPES = {
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

const PIECE_LAYOUTS = {
  I: {
    0: [
      [-1, 0],
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    1: [
      [1, -1],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    2: [
      [-1, 0],
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    3: [
      [1, -1],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
  },
  O: {
    0: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    1: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    2: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    3: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  },
  T: {
    0: [
      [-1, 0],
      [0, 0],
      [1, 0],
      [0, -1],
    ],
    1: [
      [0, -1],
      [0, 0],
      [0, 1],
      [1, 0],
    ],
    2: [
      [-1, 0],
      [0, 0],
      [1, 0],
      [0, 1],
    ],
    3: [
      [0, -1],
      [0, 0],
      [0, 1],
      [-1, 0],
    ],
  },
  S: {
    0: [
      [0, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
    ],
    1: [
      [0, -1],
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    2: [
      [0, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
    ],
    3: [
      [0, -1],
      [0, 0],
      [1, 0],
      [1, 1],
    ],
  },
  Z: {
    0: [
      [-1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    1: [
      [1, -1],
      [0, 0],
      [1, 0],
      [0, 1],
    ],
    2: [
      [-1, 0],
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    3: [
      [1, -1],
      [0, 0],
      [1, 0],
      [0, 1],
    ],
  },
  J: {
    0: [
      [-1, -1],
      [-1, 0],
      [0, 0],
      [1, 0],
    ],
    1: [
      [0, -1],
      [1, -1],
      [0, 0],
      [0, 1],
    ],
    2: [
      [-1, 0],
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    3: [
      [0, -1],
      [0, 0],
      [-1, 1],
      [0, 1],
    ],
  },
  L: {
    0: [
      [1, -1],
      [-1, 0],
      [0, 0],
      [1, 0],
    ],
    1: [
      [0, -1],
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    2: [
      [-1, 0],
      [0, 0],
      [1, 0],
      [-1, 1],
    ],
    3: [
      [-1, -1],
      [0, -1],
      [0, 0],
      [0, 1],
    ],
  },
};

const scoreEl = document.getElementById("score");
const linesEl = document.getElementById("lines");
const levelEl = document.getElementById("level");
const statusEl = document.getElementById("status");
const playerEl = document.getElementById("player");
const topologyEventEl = document.getElementById("topology-event");
const overlayEl = document.getElementById("overlay");
const overlayTitleEl = document.getElementById("overlay-title");
const overlayTextEl = document.getElementById("overlay-text");

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const nextCanvas = document.getElementById("next");
const nextCtx = nextCanvas ? nextCanvas.getContext("2d") : null;

const appState = {
  playerId: "",
  snapshot: null,
  connected: false,
  eventSource: null,
  topologyMessage: "",
  topologyMessageUntil: 0,
  boardEffects: {},
  repeatState: {},
  mode: document.body.dataset.mode === "spectate" ? "spectate" : "player",
};

const setText = (element, value) => {
  if (element) {
    element.textContent = value;
  }
};

const setOverlay = (title, text, visible) => {
  setText(overlayTitleEl, title);
  setText(overlayTextEl, text);
  overlayEl?.classList.toggle("hidden", !visible);
};

const getPlayerState = () =>
  appState.snapshot?.players.find((player) => player.playerId === appState.playerId) ?? null;

const getPrimaryPlayerState = () =>
  getPlayerState() ??
  appState.snapshot?.players.find((player) => appState.snapshot?.ringOrder.includes(player.playerId)) ??
  null;

const getPlayerLabel = (playerId, displayName) => {
  if (displayName) {
    return displayName;
  }

  const match = /player-(\d+)/.exec(playerId);
  return match ? `P${match[1]}` : playerId;
};

const wrapX = (x, width) => {
  const wrapped = x % width;
  return wrapped < 0 ? wrapped + width : wrapped;
};

const getRingPlayers = (snapshot) =>
  snapshot.ringOrder
    .map((playerId) => snapshot.players.find((player) => player.playerId === playerId) ?? null)
    .filter((player) => player !== null);

const getMaxVisibleBoards = () => (appState.mode === "spectate" ? Number.POSITIVE_INFINITY : 5);

const getBoardLayout = (snapshot, ownPlayerId) => {
  const ownPlayer =
    snapshot.players.find((player) => player.playerId === ownPlayerId) ?? getRingPlayers(snapshot)[0] ?? null;

  if (!ownPlayer) {
    return { orderedPlayers: [], boardStarts: new Map() };
  }

  const ringPlayers = getRingPlayers(snapshot);
  const leftPlayers = [];
  const rightPlayers = [];
  const seenIds = new Set([ownPlayer.playerId]);
  const maxVisibleBoards = Math.min(ringPlayers.length, getMaxVisibleBoards());
  let leftCursor = ownPlayer.leftNeighbor;
  let rightCursor = ownPlayer.rightNeighbor;

  while (seenIds.size < maxVisibleBoards) {
    if (leftCursor && !seenIds.has(leftCursor)) {
      const player = snapshot.players.find((entry) => entry.playerId === leftCursor);

      if (player) {
        leftPlayers.push(player);
        seenIds.add(player.playerId);
        leftCursor = player.leftNeighbor;
      } else {
        leftCursor = null;
      }
    } else {
      leftCursor = null;
    }

    if (seenIds.size >= maxVisibleBoards) {
      break;
    }

    if (rightCursor && !seenIds.has(rightCursor)) {
      const player = snapshot.players.find((entry) => entry.playerId === rightCursor);

      if (player) {
        rightPlayers.push(player);
        seenIds.add(player.playerId);
        rightCursor = player.rightNeighbor;
      } else {
        rightCursor = null;
      }
    } else {
      rightCursor = null;
    }

    if (!leftCursor && !rightCursor) {
      break;
    }
  }

  const fallbackPlayers =
    appState.mode === "spectate"
      ? ringPlayers.filter((player) => !seenIds.has(player.playerId))
      : [];
  const orderedPlayers = [...leftPlayers.slice().reverse(), ownPlayer, ...rightPlayers, ...fallbackPlayers];
  const ownPosition = orderedPlayers.findIndex((player) => player.playerId === ownPlayer.playerId);
  const centerBoardStart = Math.floor(canvas.width / CELL_SIZE / 2 - PLAYER_WIDTH / 2);
  const boardStarts = new Map();

  orderedPlayers.forEach((player, index) => {
    boardStarts.set(player.playerIndex, centerBoardStart + (index - ownPosition) * PLAYER_WIDTH);
  });

  return { orderedPlayers, boardStarts };
};

const setTopologyMessage = (message) => {
  appState.topologyMessage = message;
  appState.topologyMessageUntil = Date.now() + 2200;
};

const updateTopologyDiff = (previousSnapshot, nextSnapshot) => {
  if (!previousSnapshot || !nextSnapshot) {
    return;
  }

  const previousRing = previousSnapshot.ringOrder ?? [];
  const nextRing = nextSnapshot.ringOrder ?? [];
  const joinedIds = nextRing.filter((playerId) => !previousRing.includes(playerId));
  const leftIds = previousRing.filter((playerId) => !nextRing.includes(playerId));
  const nextEffects = { ...appState.boardEffects };

  for (const playerId of joinedIds) {
    nextEffects[playerId] = { kind: "join", until: Date.now() + 2200 };
    const player = nextSnapshot.players.find((entry) => entry.playerId === playerId);
    setTopologyMessage(
      `${player ? getPlayerLabel(player.playerId, player.displayName) : playerId} joined the ring`,
    );
  }

  for (const playerId of leftIds) {
    const player = previousSnapshot.players.find((entry) => entry.playerId === playerId);
    setTopologyMessage(
      `${player ? getPlayerLabel(player.playerId, player.displayName) : playerId} left the ring`,
    );
  }

  appState.boardEffects = nextEffects;
};

const getRotationCells = (piece) => PIECE_LAYOUTS[piece.type][piece.rotation];

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

  const visibleBoardCount = Math.max(
    Math.min(appState.snapshot.ringOrder.length, getMaxVisibleBoards()),
    1,
  );
  canvas.width = Math.max(
    window.innerWidth - 720,
    visibleBoardCount * PLAYER_WIDTH * CELL_SIZE,
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

const drawDangerZone = (boardStarts) => {
  const dangerHeight = GAME_OVER_LINE_Y * CELL_SIZE;

  ctx.save();

  for (const startCellX of boardStarts.values()) {
    const pixelX = startCellX * CELL_SIZE;
    const gradient = ctx.createLinearGradient(pixelX, 0, pixelX, dangerHeight);
    gradient.addColorStop(0, "rgba(237, 95, 115, 0.28)");
    gradient.addColorStop(1, "rgba(237, 95, 115, 0.08)");
    ctx.fillStyle = gradient;
    ctx.fillRect(pixelX, 0, PLAYER_WIDTH * CELL_SIZE, dangerHeight);
  }

  ctx.restore();
};

const drawGameOverLine = (boardStarts) => {
  const lineY = GAME_OVER_LINE_Y * CELL_SIZE;

  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = "rgba(237, 95, 115, 0.9)";
  ctx.lineWidth = 2;

  for (const startCellX of boardStarts.values()) {
    const pixelX = startCellX * CELL_SIZE;

    ctx.beginPath();
    ctx.moveTo(pixelX + 6, lineY);
    ctx.lineTo(pixelX + PLAYER_WIDTH * CELL_SIZE - 6, lineY);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255, 220, 220, 0.88)";
  ctx.font = 'bold 11px "Segoe UI", sans-serif';
  ctx.textAlign = "left";
  const firstStart = [...boardStarts.values()][0];

  if (firstStart !== undefined) {
    ctx.fillText("GAME OVER LINE", firstStart * CELL_SIZE + 10, lineY - 8);
  }

  ctx.restore();
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

const getPendingChangeForPlayer = (snapshot, playerId) =>
  snapshot.pendingTopologyChanges.find((change) => change.playerId === playerId) ?? null;

const getBoardStateStyle = (snapshot, player) => {
  const pendingChange = getPendingChangeForPlayer(snapshot, player.playerId);

  if (pendingChange?.kind === "remove") {
    return {
      border: "rgba(255, 176, 92, 0.95)",
      fill: "rgba(255, 176, 92, 0.14)",
      label: "PENDING REMOVE",
    };
  }

  if (player.role === "dead") {
    return {
      border: "rgba(237, 95, 115, 0.95)",
      fill: "rgba(237, 95, 115, 0.16)",
      label: "DEAD",
    };
  }

  if (player.role === "disconnected") {
    return {
      border: "rgba(141, 135, 127, 0.95)",
      fill: "rgba(141, 135, 127, 0.18)",
      label: "DISCONNECTED",
    };
  }

  return null;
};

const drawBoardStateOverlay = (displayStart, height, style) => {
  const pixelX = displayStart * CELL_SIZE;
  const pixelWidth = PLAYER_WIDTH * CELL_SIZE;
  const pixelHeight = height * CELL_SIZE;

  ctx.save();
  ctx.fillStyle = style.fill;
  ctx.fillRect(pixelX, 0, pixelWidth, pixelHeight);
  ctx.strokeStyle = style.border;
  ctx.lineWidth = 3;
  ctx.strokeRect(pixelX + 2, 2, pixelWidth - 4, pixelHeight - 4);
  ctx.fillStyle = style.border;
  ctx.fillRect(pixelX + 8, 28, pixelWidth - 16, 24);
  ctx.fillStyle = "#15110f";
  ctx.font = 'bold 12px "Segoe UI", sans-serif';
  ctx.textAlign = "center";
  ctx.fillText(style.label, pixelX + pixelWidth / 2, 45);
  ctx.restore();
};

const getBoardOwner = (snapshot, playerIndex) =>
  snapshot.ringOrder
    .map((playerId) => snapshot.players.find((player) => player.playerId === playerId) ?? null)
    .find((player) => player && player.playerIndex === playerIndex) ?? null;

const drawBoard = () => {
  if (!appState.snapshot) {
    return;
  }

  const { height, lockedCells, activePieces } = appState.snapshot.world;
  const ownPlayer = getPlayerState();

  setCanvasSize();
  const centerBoardStart = Math.floor(canvas.width / CELL_SIZE / 2 - PLAYER_WIDTH / 2);
  const { orderedPlayers, boardStarts } = getBoardLayout(appState.snapshot, appState.playerId);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid(boardStarts, height);
  drawDangerZone(boardStarts);
  drawGameOverLine(boardStarts);

  for (const player of orderedPlayers) {
    const displayStart = boardStarts.get(player.playerIndex);
    const stateStyle = getBoardStateStyle(appState.snapshot, player);

    if (displayStart === undefined || !stateStyle) {
      continue;
    }

    drawBoardStateOverlay(displayStart, height, stateStyle);
  }

  for (const cell of lockedCells) {
    const boardIndex = Math.floor(cell.x / PLAYER_WIDTH);
    const boardOwner = getBoardOwner(appState.snapshot, boardIndex);
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
      const worldX = wrapX(piece.x + x, appState.snapshot.world.width);
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
    orderedPlayers.map((player) => ({
      playerId: player.playerId,
      label: `${getPlayerLabel(player.playerId, player.displayName)}${
        getPendingChangeForPlayer(appState.snapshot, player.playerId)?.kind === "remove"
          ? " EXIT"
          : player.role === "dead"
            ? " DEAD"
            : player.role === "disconnected"
              ? " OFF"
              : ""
      }`,
      displayStart: boardStarts.get(player.playerIndex) ?? centerBoardStart,
    })),
    appState.playerId,
  );

  const now = Date.now();
  appState.boardEffects = Object.fromEntries(
    Object.entries(appState.boardEffects).filter(([, effect]) => effect.until > now),
  );

  for (const player of orderedPlayers) {
    const effect = appState.boardEffects[player.playerId];
    const displayStart = boardStarts.get(player.playerIndex);

    if (!effect || displayStart === undefined) {
      continue;
    }

    const alpha = Math.max(0, (effect.until - now) / 2200);
    ctx.strokeStyle =
      effect.kind === "join"
        ? `rgba(243,166,90,${0.25 + alpha * 0.6})`
        : `rgba(141,135,127,${0.2 + alpha * 0.4})`;
    ctx.lineWidth = 6;
    ctx.strokeRect(
      displayStart * CELL_SIZE + 4,
      4,
      PLAYER_WIDTH * CELL_SIZE - 8,
      height * CELL_SIZE - 8,
    );
  }
};

const drawNext = () => {
  if (!nextCanvas || !nextCtx) {
    return;
  }

  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const player = appState.mode === "spectate" ? getPrimaryPlayerState() : getPlayerState();

  if (!player) {
    return;
  }

  const cells = PREVIEW_SHAPES[player.nextType];
  const centroid = cells.reduce(
    (accumulator, [x, y]) => ({
      x: accumulator.x + x,
      y: accumulator.y + y,
    }),
    { x: 0, y: 0 },
  );
  const centerX = centroid.x / cells.length;
  const centerY = centroid.y / cells.length;
  const previewCenterX = nextCanvas.width / 2 / PREVIEW_CELL_SIZE;
  const previewCenterY = nextCanvas.height / 2 / PREVIEW_CELL_SIZE;

  for (const [x, y] of cells) {
    drawCell(
      nextCtx,
      previewCenterX + (x - centerX) - 0.5,
      previewCenterY + (y - centerY) - 0.5,
      COLORS[player.nextType],
      PREVIEW_CELL_SIZE,
    );
  }
};

const updateHud = () => {
  const player = getPlayerState();

  if (appState.mode === "spectate") {
    setText(scoreEl, "-");
    setText(linesEl, "-");
    setText(levelEl, "-");
    setText(playerEl, "Spectator");
    setText(statusEl, appState.connected ? "watching" : "connecting");
  } else {
    setText(scoreEl, String(player?.score ?? 0));
    setText(linesEl, String(player?.lines ?? 0));
    setText(levelEl, String(1 + Math.floor((player?.lines ?? 0) / 10)));
    setText(playerEl, player ? getPlayerLabel(player.playerId, player.displayName) : "-");
    setText(statusEl, appState.connected ? "connected" : "connecting");
  }

  if (appState.mode === "spectate") {
    setOverlay("越境テトリス", "Watching current session", false);
  } else if (player?.gameOver) {
    setOverlay("Game Over", "Waiting for board reset...", true);
  } else {
    setOverlay("越境テトリス", "Shared world view", false);
  }

  if (Date.now() < appState.topologyMessageUntil) {
    setText(topologyEventEl, appState.topologyMessage);
    topologyEventEl?.classList.remove("hidden");
  } else {
    topologyEventEl?.classList.add("hidden");
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

const stopHorizontalRepeat = (code) => {
  const repeat = appState.repeatState[code];

  if (!repeat) {
    return;
  }

  window.clearTimeout(repeat.timeoutId);
  window.clearInterval(repeat.intervalId);
  delete appState.repeatState[code];
};

const startHorizontalRepeat = (code, input) => {
  if (appState.repeatState[code]) {
    return;
  }

  sendInput(input);
  const timeoutId = window.setTimeout(() => {
    const intervalId = window.setInterval(() => {
      sendInput(input);
    }, HORIZONTAL_REPEAT_INTERVAL_MS);
    const repeat = appState.repeatState[code];

    if (repeat) {
      repeat.intervalId = intervalId;
    } else {
      window.clearInterval(intervalId);
    }
  }, HORIZONTAL_REPEAT_DELAY_MS);

  appState.repeatState[code] = {
    timeoutId,
    intervalId: null,
  };
};

const startVerticalRepeat = (code, input) => {
  if (appState.repeatState[code]) {
    return;
  }

  sendInput(input);
  const timeoutId = window.setTimeout(() => {
    const intervalId = window.setInterval(() => {
      sendInput(input);
    }, VERTICAL_REPEAT_INTERVAL_MS);
    const repeat = appState.repeatState[code];

    if (repeat) {
      repeat.intervalId = intervalId;
    } else {
      window.clearInterval(intervalId);
    }
  }, VERTICAL_REPEAT_DELAY_MS);

  appState.repeatState[code] = {
    timeoutId,
    intervalId: null,
  };
};

const connectEvents = () => {
  if (appState.eventSource) {
    appState.eventSource.close();
  }

  const eventSource = new EventSource("/api/events");
  appState.eventSource = eventSource;

  eventSource.addEventListener("snapshot", (event) => {
    appState.connected = true;
    const previousSnapshot = appState.snapshot;
    const nextSnapshot = JSON.parse(event.data);
    updateTopologyDiff(previousSnapshot, nextSnapshot);
    appState.snapshot = nextSnapshot;
    render();
  });

  eventSource.onerror = () => {
    appState.connected = false;
    updateHud();
  };
};

const joinGame = async () => {
  const name = window.sessionStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? "";
  const response = await fetch("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    setOverlay("Room Full", "The room currently has no free player slots.", true);
    return;
  }

  const data = await response.json();
  appState.playerId = data.playerId;
  appState.snapshot = data.snapshot;
  connectEvents();
  render();
};

const startSpectating = () => {
  connectEvents();
  render();
};

document.addEventListener("keydown", (event) => {
  if (!appState.connected || appState.mode === "spectate") {
    return;
  }

  if (
    event.code === "ArrowLeft" ||
    event.code === "ArrowRight" ||
    event.code === "ArrowDown" ||
    event.code === "ArrowUp" ||
    event.code === "Space"
  ) {
    event.preventDefault();
  }

  if (event.code === "ArrowLeft") {
    startHorizontalRepeat(event.code, "left");
  } else if (event.code === "ArrowRight") {
    startHorizontalRepeat(event.code, "right");
  } else if (event.code === "ArrowDown") {
    startVerticalRepeat(event.code, "down");
  } else if (event.code === "ArrowUp") {
    startVerticalRepeat(event.code, "up");
  } else if (event.code === "KeyX") {
    if (event.repeat) {
      return;
    }
    sendInput("rotateRight");
  } else if (event.code === "KeyZ") {
    if (event.repeat) {
      return;
    }
    sendInput("rotateLeft");
  } else if (event.code === "Space") {
    event.preventDefault();
    if (event.repeat) {
      return;
    }
    sendInput("drop");
  }
});

document.addEventListener("keyup", (event) => {
  if (
    event.code === "ArrowLeft" ||
    event.code === "ArrowRight" ||
    event.code === "ArrowDown" ||
    event.code === "ArrowUp"
  ) {
    stopHorizontalRepeat(event.code);
  }
});

window.addEventListener("beforeunload", () => {
  stopHorizontalRepeat("ArrowLeft");
  stopHorizontalRepeat("ArrowRight");
  stopHorizontalRepeat("ArrowDown");
  stopHorizontalRepeat("ArrowUp");

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

if (appState.mode === "spectate") {
  startSpectating();
} else {
  joinGame();
}
