import { createReadStream, existsSync } from "node:fs";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import path from "node:path";
import { canPlace } from "./collision";
import { getPieceCells, rotatePiece } from "./piece";
import {
  LockedCell,
  Piece,
  PieceAction,
  PieceType,
  PLAYER_WIDTH,
  TickResult,
  World,
  createWorldSize,
} from "./types";
import { tickWorld } from "./world";

export type ServerState = {
  tick: number;
  world: World;
  pendingActions: PieceAction[];
};

export type SpawnRequest = {
  id: string;
  ownerId: string;
  playerIndex: number;
  type: PieceType;
};

export type PlayerInput = "left" | "right" | "down" | "rotateLeft" | "rotateRight" | "drop";

export type PlayerState = {
  playerId: string;
  playerIndex: number;
  score: number;
  lines: number;
  nextType: PieceType;
  gameOver: boolean;
  connected: boolean;
};

export type SessionState = {
  tick: number;
  world: World;
  players: PlayerState[];
  pendingInputs: Record<string, PlayerInput[]>;
};

export type SessionSnapshot = {
  tick: number;
  world: World;
  players: PlayerState[];
};

type SseClient = {
  response: ServerResponse<IncomingMessage>;
};

const SPAWN_X_OFFSET = 4;
const SPAWN_Y = 1;
const DEFAULT_PORT = 3000;
const DEFAULT_PLAYER_COUNT = 2;
const TICK_MS = 350;
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");
const PIECE_TYPES: PieceType[] = ["I", "O", "T", "S", "Z", "J", "L"];

export const createServerState = (playerCount: number): ServerState => ({
  tick: 0,
  world: {
    ...createWorldSize(playerCount),
    lockedCells: [],
    activePieces: [],
  },
  pendingActions: [],
});

export const createSpawnPiece = ({
  id,
  ownerId,
  playerIndex,
  type,
}: SpawnRequest): Piece => ({
  id,
  ownerId,
  type,
  x: playerIndex * PLAYER_WIDTH + SPAWN_X_OFFSET,
  y: SPAWN_Y,
  rotation: 0,
});

export const spawnPiece = (state: ServerState, piece: Piece): ServerState | null => {
  if (!canPlace(piece, state.world)) {
    return null;
  }

  return {
    ...state,
    world: {
      ...state.world,
      activePieces: [...state.world.activePieces, piece],
    },
  };
};

export const queueAction = (state: ServerState, action: PieceAction): ServerState => ({
  ...state,
  pendingActions: [
    ...state.pendingActions.filter((queuedAction) => queuedAction.pieceId !== action.pieceId),
    action,
  ],
});

export const runServerTick = (
  state: ServerState,
): { state: ServerState; result: TickResult } => {
  const actionResult = tickWorld(state.world, state.pendingActions);
  const gravityActions = actionResult.world.activePieces.map((piece) => ({
    pieceId: piece.id,
    kind: "move" as const,
    dx: 0,
    dy: 1,
  }));
  const gravityResult = tickWorld(actionResult.world, gravityActions);

  return {
    state: {
      tick: state.tick + 1,
      world: gravityResult.world,
      pendingActions: [],
    },
    result: {
      world: gravityResult.world,
      failedPieceIds: actionResult.failedPieceIds,
      lockedPieceIds: [
        ...new Set([...actionResult.lockedPieceIds, ...gravityResult.lockedPieceIds]),
      ].sort(),
      clearedRowsByPlayer: gravityResult.clearedRowsByPlayer,
    },
  };
};

const randomPieceType = (): PieceType => {
  const nextType = PIECE_TYPES[Math.floor(Math.random() * PIECE_TYPES.length)];
  return nextType ?? "T";
};

const scoreForClears = (clearCount: number): number =>
  [0, 100, 300, 500, 800][clearCount] ?? clearCount * 200;

const getSnapshot = (session: SessionState): SessionSnapshot => ({
  tick: session.tick,
  world: session.world,
  players: session.players,
});

export const createSession = (playerCount: number): SessionState => ({
  tick: 0,
  world: {
    ...createWorldSize(playerCount),
    lockedCells: [],
    activePieces: [],
  },
  players: Array.from({ length: playerCount }, (_, playerIndex) => ({
    playerId: `player-${playerIndex + 1}`,
    playerIndex,
    score: 0,
    lines: 0,
    nextType: randomPieceType(),
    gameOver: false,
    connected: false,
  })),
  pendingInputs: {},
});

export const joinSession = (
  session: SessionState,
): { session: SessionState; player: PlayerState | null } => {
  const player = session.players.find((entry) => !entry.connected && !entry.gameOver) ?? null;

  if (!player) {
    return { session, player: null };
  }

  return {
    session: {
      ...session,
      players: session.players.map((entry) =>
        entry.playerId === player.playerId ? { ...entry, connected: true } : entry,
      ),
    },
    player: { ...player, connected: true },
  };
};

export const leaveSession = (session: SessionState, playerId: string): SessionState => ({
  ...session,
  players: session.players.map((entry) =>
    entry.playerId === playerId ? { ...entry, connected: false } : entry,
  ),
});

const getPlayerActivePiece = (world: World, playerId: string): Piece | undefined =>
  world.activePieces.find((piece) => piece.ownerId === playerId);

const getBoardRange = (playerIndex: number) => ({
  startX: playerIndex * PLAYER_WIDTH,
  endX: (playerIndex + 1) * PLAYER_WIDTH,
});

const isInsideBoardRange = (x: number, startX: number, endX: number): boolean =>
  x >= startX && x < endX;

const resetPlayerBoard = (session: SessionState, playerId: string): SessionState => {
  const player = session.players.find((entry) => entry.playerId === playerId);

  if (!player) {
    return session;
  }

  const { startX, endX } = getBoardRange(player.playerIndex);
  const preservedLockedCells = session.world.lockedCells.filter(
    (cell) => !isInsideBoardRange(cell.x, startX, endX),
  );
  const extraLockedCells: LockedCell[] = [];
  const remainingActivePieces: Piece[] = [];

  for (const piece of session.world.activePieces) {
    const cells = getPieceCells(piece, session.world.width);
    const insideCells = cells.filter((cell) => isInsideBoardRange(cell.x, startX, endX));
    const outsideCells = cells.filter((cell) => !isInsideBoardRange(cell.x, startX, endX));

    if (insideCells.length === 0) {
      remainingActivePieces.push(piece);
      continue;
    }

    if (outsideCells.length > 0) {
      extraLockedCells.push(
        ...outsideCells.map((cell) => ({
          ...cell,
          ownerId: piece.ownerId,
          pieceType: piece.type,
        })),
      );
    }
  }

  return {
    ...session,
    world: {
      ...session.world,
      lockedCells: [...preservedLockedCells, ...extraLockedCells],
      activePieces: remainingActivePieces,
    },
    players: session.players.map((entry) =>
      entry.playerId === playerId
        ? {
            ...entry,
            score: 0,
            lines: 0,
            nextType: randomPieceType(),
            gameOver: false,
          }
        : entry,
    ),
    pendingInputs: {
      ...session.pendingInputs,
      [playerId]: [],
    },
  };
};

const applyInputToPiece = (piece: Piece, input: PlayerInput): Piece => {
  if (input === "left") {
    return { ...piece, x: piece.x - 1 };
  }

  if (input === "right") {
    return { ...piece, x: piece.x + 1 };
  }

  if (input === "down") {
    return { ...piece, y: piece.y + 1 };
  }

  if (input === "rotateLeft") {
    return rotatePiece(piece, -1);
  }

  if (input === "rotateRight") {
    return rotatePiece(piece, 1);
  }

  return { ...piece, y: piece.y + 18 };
};

const isInsideConnectedBoards = (
  world: World,
  piece: Piece,
  connectedBoardIndexes: Set<number>,
): boolean =>
  getPieceCells(piece, world.width).every((cell) =>
    connectedBoardIndexes.has(Math.floor(cell.x / PLAYER_WIDTH)),
  );

const inputToAction = (pieceId: string, input: PlayerInput): PieceAction => {
  if (input === "left") {
    return { pieceId, kind: "move", dx: -1, dy: 0 };
  }

  if (input === "right") {
    return { pieceId, kind: "move", dx: 1, dy: 0 };
  }

  if (input === "down") {
    return { pieceId, kind: "move", dx: 0, dy: 1 };
  }

  if (input === "rotateLeft") {
    return { pieceId, kind: "rotate", direction: -1 };
  }

  if (input === "rotateRight") {
    return { pieceId, kind: "rotate", direction: 1 };
  }

  return { pieceId, kind: "move", dx: 0, dy: 18 };
};

export const queuePlayerInput = (
  session: SessionState,
  playerId: string,
  input: PlayerInput,
): SessionState => ({
  ...session,
  pendingInputs: {
    ...session.pendingInputs,
    [playerId]: [...(session.pendingInputs[playerId] ?? []), input],
  },
});

const ensureSpawnedPieces = (session: SessionState): SessionState => {
  let nextState = session;

  for (const player of nextState.players) {
    if (player.gameOver || !player.connected) {
      continue;
    }

    if (getPlayerActivePiece(nextState.world, player.playerId)) {
      continue;
    }

    const piece = createSpawnPiece({
      id: `${player.playerId}-piece-${nextState.tick + 1}`,
      ownerId: player.playerId,
      playerIndex: player.playerIndex,
      type: player.nextType,
    });
    const spawned = spawnPiece(
      {
        tick: nextState.tick,
        world: nextState.world,
        pendingActions: [],
      },
      piece,
    );

    if (!spawned) {
      nextState = resetPlayerBoard(nextState, player.playerId);
      continue;
    }

    nextState = {
      ...nextState,
      world: spawned.world,
      players: nextState.players.map((entry) =>
        entry.playerId === player.playerId
          ? { ...entry, nextType: randomPieceType() }
          : entry,
      ),
    };
  }

  return nextState;
};

export const stepSession = (
  session: SessionState,
): { session: SessionState; result: TickResult } => {
  const spawned = ensureSpawnedPieces(session);
  const actions: PieceAction[] = [];
  const connectedBoardIndexes = new Set(
    spawned.players
      .filter((player) => player.connected && !player.gameOver)
      .map((player) => player.playerIndex),
  );

  for (const player of spawned.players) {
    const piece = getPlayerActivePiece(spawned.world, player.playerId);

    if (!piece) {
      continue;
    }

    const input = spawned.pendingInputs[player.playerId]?.at(-1);
    if (input) {
      const candidate = applyInputToPiece(piece, input);

      if (isInsideConnectedBoards(spawned.world, candidate, connectedBoardIndexes)) {
        actions.push(inputToAction(piece.id, input));
      }
    }
  }

  const { result } = runServerTick({
    tick: spawned.tick,
    world: spawned.world,
    pendingActions: actions,
  });
  const nextPlayers = spawned.players.map((player) => {
    const cleared = result.clearedRowsByPlayer[player.playerIndex]?.length ?? 0;
    return {
      ...player,
      score: player.score + scoreForClears(cleared),
      lines: player.lines + cleared,
    };
  });

  return {
    session: {
      tick: spawned.tick + 1,
      world: result.world,
      players: nextPlayers,
      pendingInputs: {},
    },
    result,
  };
};

const getContentType = (filePath: string): string => {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }

  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }

  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  return "text/plain; charset=utf-8";
};

const sendJson = (
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: unknown,
): void => {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

const safeJoinPublicPath = (requestPath: string): string => {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const resolvedPath = path.resolve(PUBLIC_DIR, `.${normalizedPath}`);

  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    return path.join(PUBLIC_DIR, "index.html");
  }

  return resolvedPath;
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const text = Buffer.concat(chunks).toString("utf-8");
  return text ? JSON.parse(text) : {};
};

export const startHttpServer = (port = DEFAULT_PORT): Server => {
  let session = createSession(DEFAULT_PLAYER_COUNT);
  const sseClients = new Set<SseClient>();

  const broadcastSnapshot = () => {
    const snapshot = JSON.stringify(getSnapshot(session));

    for (const client of sseClients) {
      client.response.write(`event: snapshot\n`);
      client.response.write(`data: ${snapshot}\n\n`);
    }
  };

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");

    if (requestUrl.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/join") {
      const joined = joinSession(session);
      session = joined.session;

      if (!joined.player) {
        sendJson(response, 409, { error: "room-full" });
        return;
      }

      session = ensureSpawnedPieces(session);
      sendJson(response, 200, {
        playerId: joined.player.playerId,
        snapshot: getSnapshot(session),
      });
      broadcastSnapshot();
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/action") {
      const body = (await readJsonBody(request)) as {
        playerId?: string;
        input?: PlayerInput;
      };

      if (!body.playerId || !body.input) {
        sendJson(response, 400, { error: "invalid-body" });
        return;
      }

      session = queuePlayerInput(session, body.playerId, body.input);
      sendJson(response, 202, { ok: true });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/leave") {
      const body = (await readJsonBody(request)) as {
        playerId?: string;
      };

      if (!body.playerId) {
        sendJson(response, 400, { error: "invalid-body" });
        return;
      }

      session = leaveSession(session, body.playerId);
      sendJson(response, 200, { ok: true });
      broadcastSnapshot();
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      response.write(`event: snapshot\n`);
      response.write(`data: ${JSON.stringify(getSnapshot(session))}\n\n`);

      const client = { response };
      sseClients.add(client);

      request.on("close", () => {
        sseClients.delete(client);
      });
      return;
    }

    const filePath = safeJoinPublicPath(requestUrl.pathname);

    if (!existsSync(filePath)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": getContentType(filePath) });
    createReadStream(filePath).pipe(response);
  });

  setInterval(() => {
    const stepped = stepSession(session);
    session = stepped.session;
    broadcastSnapshot();
  }, TICK_MS);

  server.listen(port, () => {
    process.stdout.write(`border-tetris client: http://localhost:${port}\n`);
  });

  return server;
};

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10);
  startHttpServer(Number.isNaN(port) ? DEFAULT_PORT : port);
}
