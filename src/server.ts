import { createReadStream, existsSync } from "node:fs";
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import path from "node:path";
import { canPlace } from "./collision";
import { getPieceCells, rotatePiece } from "./piece";
import {
  GAME_OVER_LINE_Y,
  LockedCell,
  Piece,
  PieceAction,
  PieceType,
  PlayerRole,
  PLAYER_WIDTH,
  RingOrder,
  TopologyChange,
  TickResult,
  World,
  createWorldSize,
} from "./types";
import { applyLineClears, applyWorldActions, tickWorld } from "./world";

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

export type PlayerInput =
  | "left"
  | "right"
  | "down"
  | "up"
  | "rotateLeft"
  | "rotateRight"
  | "drop";

export type PlayerState = {
  playerId: string;
  playerIndex: number;
  displayName: string;
  score: number;
  lines: number;
  nextType: PieceType;
  gravityMeter: number;
  connected: boolean;
  role: PlayerRole;
  reviveAtTick: number | null;
  disconnectDeadlineTick: number | null;
};

export type SessionState = {
  tick: number;
  world: World;
  players: PlayerState[];
  ringOrder: RingOrder;
  pendingTopologyChanges: TopologyChange[];
  pendingInputs: Record<string, PlayerInput[]>;
};

export type SessionPlayerSnapshot = PlayerState & {
  gameOver: boolean;
  leftNeighbor: string | null;
  rightNeighbor: string | null;
};

export type SessionSnapshot = {
  tick: number;
  world: World;
  players: SessionPlayerSnapshot[];
  ringOrder: RingOrder;
  pendingTopologyChanges: TopologyChange[];
};

export type SessionInfo = {
  snapshot: SessionSnapshot;
  activePlayerCount: number;
  maxPlayerCount: number;
};

type SseClient = {
  response: ServerResponse<IncomingMessage>;
};

const SPAWN_X_OFFSET = 4;
const SPAWN_Y = GAME_OVER_LINE_Y - 3;
const DEFAULT_PORT = 3000;
const DEFAULT_PLAYER_COUNT = 12;
const TICK_MS = 100;
const BASE_GRAVITY_PER_TICK = 0.22;
const SOFT_DROP_GRAVITY_PER_TICK = 0.68;
const BRAKE_GRAVITY_PER_TICK = 0.06;
const REVIVE_DELAY_TICKS = 56;
const DISCONNECT_GRACE_TICKS = 140;
const MAX_HORIZONTAL_INPUTS_PER_TICK = 1;
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
  [0, 100, 200, 500, 800][clearCount] ?? clearCount * 200;

const createEmptyClearRows = (playerCount: number): number[][] =>
  Array.from({ length: playerCount }, () => []);

const mergeClearedRows = (left: number[][], right: number[][]): number[][] =>
  left.map((rows, index) => [...rows, ...(right[index] ?? [])]);

const isRingRole = (role: PlayerRole): boolean =>
  role === "playing" || role === "dead" || role === "disconnected";

const isPlayingRole = (role: PlayerRole): boolean => role === "playing";

const getNeighbors = (
  ringOrder: RingOrder,
  playerId: string,
): { leftNeighbor: string | null; rightNeighbor: string | null } => {
  const index = ringOrder.indexOf(playerId);

  if (index === -1 || ringOrder.length === 1) {
    return { leftNeighbor: null, rightNeighbor: null };
  }

  if (ringOrder.length === 2) {
    return {
      leftNeighbor: index === 1 ? (ringOrder[0] ?? null) : null,
      rightNeighbor: index === 0 ? (ringOrder[1] ?? null) : null,
    };
  }

  return {
    leftNeighbor: ringOrder[(index - 1 + ringOrder.length) % ringOrder.length] ?? null,
    rightNeighbor: ringOrder[(index + 1) % ringOrder.length] ?? null,
  };
};

export const getSessionSnapshot = (session: SessionState): SessionSnapshot => ({
  tick: session.tick,
  world: session.world,
  players: session.players.map((player) => ({
    ...player,
    gameOver: player.role === "dead",
    ...getNeighbors(session.ringOrder, player.playerId),
  })),
  ringOrder: session.ringOrder,
  pendingTopologyChanges: session.pendingTopologyChanges,
});

const getSessionInfo = (session: SessionState): SessionInfo => ({
  snapshot: getSessionSnapshot(session),
  activePlayerCount: session.ringOrder.length,
  maxPlayerCount: session.players.length,
});

export const createSession = (playerCount: number): SessionState => ({
  tick: 0,
  world: {
    ...createWorldSize(1),
    lockedCells: [],
    activePieces: [],
  },
  players: Array.from({ length: playerCount }, (_, playerIndex) => ({
    playerId: `player-${playerIndex + 1}`,
    playerIndex: -1,
    displayName: `Player ${playerIndex + 1}`,
    score: 0,
    lines: 0,
    nextType: randomPieceType(),
    gravityMeter: 0,
    connected: false,
    role: "spectating",
    reviveAtTick: null,
    disconnectDeadlineTick: null,
  })),
  ringOrder: [],
  pendingTopologyChanges: [],
  pendingInputs: {},
});

const createTopologyChange = (
  kind: TopologyChange["kind"],
  playerId: string,
  scheduledAtTick: number,
): TopologyChange => {
  return {
    id: `${kind}-${playerId}-${scheduledAtTick}`,
    kind,
    playerId,
    scheduledAtTick,
    status: "pending",
  };
};

const upsertTopologyChange = (
  pendingTopologyChanges: TopologyChange[],
  nextChange: TopologyChange,
): TopologyChange[] => [
  ...pendingTopologyChanges.filter(
    (change) => !(change.kind === nextChange.kind && change.playerId === nextChange.playerId),
  ),
  nextChange,
];

const getWorldPlayerCount = (ringOrder: RingOrder): number => Math.max(ringOrder.length, 1);

const shiftWorldColumns = (
  world: World,
  startBoardIndex: number,
  deltaBoards: number,
): World => {
  if (deltaBoards === 0) {
    return world;
  }

  const startX = startBoardIndex * PLAYER_WIDTH;
  const deltaX = deltaBoards * PLAYER_WIDTH;

  return {
    ...world,
    lockedCells: world.lockedCells.flatMap((cell) => {
      if (cell.x < startX) {
        return [cell];
      }

      return [{ ...cell, x: cell.x + deltaX }];
    }),
    activePieces: world.activePieces.map((piece) => {
      const cells = getPieceCells(piece, world.width);

      if (cells.every((cell) => cell.x < startX)) {
        return piece;
      }

      return {
        ...piece,
        x: piece.x + deltaX,
      };
    }),
  };
};

const removeBoardFromWorld = (world: World, removedBoardIndex: number, nextPlayerCount: number): World => {
  const removedStartX = removedBoardIndex * PLAYER_WIDTH;
  const removedEndX = removedStartX + PLAYER_WIDTH;
  const filteredWorld: World = {
    ...world,
    lockedCells: world.lockedCells.filter((cell) => cell.x < removedStartX || cell.x >= removedEndX),
    activePieces: world.activePieces.filter((piece) =>
      getPieceCells(piece, world.width).every((cell) => cell.x < removedStartX || cell.x >= removedEndX),
    ),
  };
  const shiftedWorld = shiftWorldColumns(filteredWorld, removedBoardIndex + 1, -1);

  return {
    ...shiftedWorld,
    playerCount: nextPlayerCount,
    width: PLAYER_WIDTH * nextPlayerCount,
  };
};

const appendBoardToWorld = (world: World, nextPlayerCount: number): World => ({
  ...world,
  playerCount: nextPlayerCount,
  width: PLAYER_WIDTH * nextPlayerCount,
});

const hasBoundaryCrossingActivePiece = (
  world: World,
  playerIndex: number,
  playerId?: string,
): boolean => {
  const { startX, endX } = getBoardRange(playerIndex);

  return world.activePieces.some((piece) => {
    if (playerId && piece.ownerId === playerId) {
      return false;
    }

    const cells = getPieceCells(piece, world.width);
    const hasInside = cells.some((cell) => isInsideBoardRange(cell.x, startX, endX));
    const hasOutside = cells.some((cell) => !isInsideBoardRange(cell.x, startX, endX));

    return hasInside && hasOutside;
  });
};

const hasForeignIntrusionInBoard = (
  world: World,
  playerIndex: number,
  playerId: string,
): boolean => {
  const { startX, endX } = getBoardRange(playerIndex);

  return world.activePieces.some((piece) => {
    if (piece.ownerId === playerId) {
      return false;
    }

    return getPieceCells(piece, world.width).some((cell) =>
      isInsideBoardRange(cell.x, startX, endX),
    );
  });
};

const evaluateTopologySafety = (
  session: SessionState,
  change: TopologyChange,
): TopologyChange => {
  const player = session.players.find((entry) => entry.playerId === change.playerId);

  if (!player) {
    return { ...change, status: "blocked", reason: "missing-player" };
  }

  if (session.tick < change.scheduledAtTick) {
    const { reason: _reason, ...rest } = change;
    return { ...rest, status: "pending" };
  }

  if (
    hasBoundaryCrossingActivePiece(session.world, player.playerIndex, change.playerId) ||
    hasForeignIntrusionInBoard(session.world, player.playerIndex, change.playerId)
  ) {
    return {
      ...change,
      status: "blocked",
      reason: "unsafe-boundary",
    };
  }

  const { reason: _reason, ...rest } = change;
  return { ...rest, status: "ready" };
};

const evaluateTopologyChanges = (session: SessionState): SessionState => ({
  ...session,
  pendingTopologyChanges: session.pendingTopologyChanges.map((change) =>
    evaluateTopologySafety(session, change),
  ),
});

const applyReadyTopologyChanges = (session: SessionState): SessionState => {
  let nextSession = session;
  const readyChanges = session.pendingTopologyChanges.filter((change) => change.status === "ready");

  for (const change of readyChanges) {
    const player = nextSession.players.find((entry) => entry.playerId === change.playerId);

    if (!player) {
      continue;
    }

    if (change.kind === "add") {
      const nextRingOrder = nextSession.ringOrder.includes(change.playerId)
        ? nextSession.ringOrder
        : [...nextSession.ringOrder, change.playerId];
      const nextPlayerIndex = nextRingOrder.indexOf(change.playerId);

      nextSession = {
        ...nextSession,
        world: appendBoardToWorld(nextSession.world, getWorldPlayerCount(nextRingOrder)),
        ringOrder: nextRingOrder,
        players: nextSession.players.map((entry) =>
          entry.playerId === change.playerId
            ? {
                ...entry,
                playerIndex: nextPlayerIndex,
                role: "playing",
                connected: true,
                gravityMeter: 0,
                disconnectDeadlineTick: null,
              }
            : entry,
        ),
      };
      continue;
    }

    const removedBoardIndex = player.playerIndex;
    const nextRingOrder = nextSession.ringOrder.filter((playerId) => playerId !== change.playerId);

    nextSession = {
      ...nextSession,
      world: removeBoardFromWorld(
        nextSession.world,
        removedBoardIndex,
        getWorldPlayerCount(nextRingOrder),
      ),
      ringOrder: nextRingOrder,
        players: nextSession.players.map((entry) =>
          entry.playerId === change.playerId
            ? {
                ...entry,
                playerIndex: -1,
                role: "spectating",
                gravityMeter: 0,
                disconnectDeadlineTick: null,
                reviveAtTick: null,
              }
            : entry.playerIndex > removedBoardIndex
            ? {
                ...entry,
                playerIndex: entry.playerIndex - 1,
              }
            : entry
      ),
      pendingInputs: Object.fromEntries(
        Object.entries(nextSession.pendingInputs).filter(([playerId]) => playerId !== change.playerId),
      ),
    };
  }

  return {
    ...nextSession,
    pendingTopologyChanges: nextSession.pendingTopologyChanges.filter(
      (change) => change.status !== "ready",
    ),
  };
};

const advancePlayerLifecycle = (session: SessionState): SessionState => {
  let nextSession = session;

  nextSession = {
    ...nextSession,
    players: nextSession.players.map((player) => {
      if (player.role === "dead" && player.reviveAtTick !== null && player.reviveAtTick <= session.tick) {
        return {
          ...player,
          role: nextSession.ringOrder.includes(player.playerId) ? "playing" : "spectating",
          reviveAtTick: null,
        };
      }

      return player;
    }),
  };

  for (const player of nextSession.players) {
    if (
      player.role === "disconnected" &&
      player.disconnectDeadlineTick !== null &&
      player.disconnectDeadlineTick <= nextSession.tick
    ) {
      nextSession = {
        ...nextSession,
        pendingTopologyChanges: upsertTopologyChange(
          nextSession.pendingTopologyChanges,
          createTopologyChange("remove", player.playerId, nextSession.tick),
        ),
      };
    }
  }

  return nextSession;
};

export const joinSession = (
  session: SessionState,
  displayName?: string,
): { session: SessionState; player: PlayerState | null } => {
  const player =
    session.players.find((entry) => entry.role === "spectating" && !entry.connected) ?? null;

  if (!player) {
    return { session, player: null };
  }

  const nextSession = applyReadyTopologyChanges(
    evaluateTopologyChanges({
      ...session,
      players: session.players.map((entry) =>
        entry.playerId === player.playerId
          ? {
              ...entry,
              connected: true,
              displayName: displayName?.trim() ? displayName.trim().slice(0, 12) : entry.displayName,
            }
          : entry,
      ),
      pendingTopologyChanges: upsertTopologyChange(
        session.pendingTopologyChanges,
        createTopologyChange("add", player.playerId, session.tick),
      ),
    }),
  );
  const nextPlayer = nextSession.players.find((entry) => entry.playerId === player.playerId) ?? null;

  return {
    session: nextSession,
    player: nextPlayer,
  };
};

export const leaveSession = (session: SessionState, playerId: string): SessionState => ({
  ...session,
  players: session.players.map((entry) =>
    entry.playerId === playerId
      ? {
          ...entry,
          connected: false,
          role: isRingRole(entry.role) ? "disconnected" : "spectating",
          disconnectDeadlineTick: isRingRole(entry.role)
            ? session.tick + DISCONNECT_GRACE_TICKS
            : null,
        }
      : entry,
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
  const bonusCellCounts = new Map<string, number>();

  for (const cell of session.world.lockedCells) {
    if (!isInsideBoardRange(cell.x, startX, endX)) {
      continue;
    }

    if (cell.ownerId === playerId) {
      continue;
    }

    bonusCellCounts.set(cell.ownerId, (bonusCellCounts.get(cell.ownerId) ?? 0) + 1);
  }

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
            gravityMeter: 0,
            role: "dead",
            reviveAtTick: session.tick + REVIVE_DELAY_TICKS,
          }
        : entry.role === "playing"
          ? {
              ...entry,
              score:
                entry.score + (bonusCellCounts.get(entry.playerId) ?? 0) * player.score,
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

  if (input === "up") {
    return piece;
  }

  if (input === "rotateLeft") {
    return rotatePiece(piece, -1);
  }

  if (input === "rotateRight") {
    return rotatePiece(piece, 1);
  }

  return { ...piece, y: piece.y + 18 };
};

const clampInputsForTick = (inputs: PlayerInput[]): PlayerInput[] => {
  let horizontalCount = 0;

  return inputs.filter((input) => {
    if (input !== "left" && input !== "right") {
      return true;
    }

    if (horizontalCount >= MAX_HORIZONTAL_INPUTS_PER_TICK) {
      return false;
    }

    horizontalCount += 1;
    return true;
  });
};

const getGravityRateForInputs = (inputs: PlayerInput[]): number => {
  const verticalInput = [...inputs].reverse().find((input) => input === "down" || input === "up");

  if (verticalInput === "down") {
    return SOFT_DROP_GRAVITY_PER_TICK;
  }

  if (verticalInput === "up") {
    return BRAKE_GRAVITY_PER_TICK;
  }

  return BASE_GRAVITY_PER_TICK;
};

const isInsideConnectedBoards = (
  world: World,
  piece: Piece,
  connectedBoardIndexes: Set<number>,
): boolean =>
  getPieceCells(piece, world.width).every((cell) =>
    connectedBoardIndexes.has(Math.floor(cell.x / PLAYER_WIDTH)),
  );

const getOccupiedBoardIndexes = (piece: Piece, world: World): Set<number> =>
  new Set(getPieceCells(piece, world.width).map((cell) => Math.floor(cell.x / PLAYER_WIDTH)));

const canOccupyBoardFromPlayer = (
  session: SessionState,
  player: PlayerState,
  targetBoardIndex: number,
): boolean => {
  if (targetBoardIndex === player.playerIndex) {
    return true;
  }

  const targetPlayer =
    session.players.find(
      (entry) =>
        entry.playerIndex === targetBoardIndex && session.ringOrder.includes(entry.playerId),
    ) ?? null;

  if (targetPlayer?.role === "dead") {
    return false;
  }

  const { leftNeighbor, rightNeighbor } = getNeighbors(session.ringOrder, player.playerId);
  const leftBoardIndex =
    player.playerIndex === 0 ? session.world.playerCount - 1 : player.playerIndex - 1;
  const rightBoardIndex =
    player.playerIndex === session.world.playerCount - 1 ? 0 : player.playerIndex + 1;
  const leftNeighborIndex =
    leftNeighbor === null
      ? null
      : (session.players.find((entry) => entry.playerId === leftNeighbor)?.playerIndex ?? null);
  const rightNeighborIndex =
    rightNeighbor === null
      ? null
      : (session.players.find((entry) => entry.playerId === rightNeighbor)?.playerIndex ?? null);

  if (leftBoardIndex === rightBoardIndex) {
    return leftNeighborIndex === targetBoardIndex || rightNeighborIndex === targetBoardIndex;
  }

  if (targetBoardIndex === leftBoardIndex) {
    return leftNeighborIndex === targetBoardIndex;
  }

  if (targetBoardIndex === rightBoardIndex) {
    return rightNeighborIndex === targetBoardIndex;
  }

  return false;
};

const canOccupyCandidateBoards = (
  session: SessionState,
  player: PlayerState,
  piece: Piece,
  candidate: Piece,
  input: PlayerInput,
): boolean => {
  const currentBoards = getOccupiedBoardIndexes(piece, session.world);
  const nextBoards = getOccupiedBoardIndexes(candidate, session.world);
  const { leftNeighbor, rightNeighbor } = getNeighbors(session.ringOrder, player.playerId);
  const leftBoardIndex =
    player.playerIndex === 0 ? session.world.playerCount - 1 : player.playerIndex - 1;
  const rightBoardIndex =
    player.playerIndex === session.world.playerCount - 1 ? 0 : player.playerIndex + 1;
  const leftNeighborIndex =
    leftNeighbor === null
      ? null
      : (session.players.find((entry) => entry.playerId === leftNeighbor)?.playerIndex ?? null);
  const rightNeighborIndex =
    rightNeighbor === null
      ? null
      : (session.players.find((entry) => entry.playerId === rightNeighbor)?.playerIndex ?? null);

  return [...nextBoards].every((boardIndex) => {
    if (!canOccupyBoardFromPlayer(session, player, boardIndex)) {
      return false;
    }

    if (boardIndex === leftBoardIndex && leftBoardIndex === rightBoardIndex && !currentBoards.has(boardIndex)) {
      if (input === "left") {
        return leftNeighborIndex === boardIndex;
      }

      if (input === "right") {
        return rightNeighborIndex === boardIndex;
      }
    }

    return true;
  });
};

const entersPendingBoard = (
  session: SessionState,
  piece: Piece,
  candidate: Piece,
): boolean => {
  const currentBoards = getOccupiedBoardIndexes(piece, session.world);
  const nextBoards = getOccupiedBoardIndexes(candidate, session.world);

  for (const change of session.pendingTopologyChanges) {
    const player = session.players.find((entry) => entry.playerId === change.playerId);

    if (!player || piece.ownerId === change.playerId) {
      continue;
    }

    if (nextBoards.has(player.playerIndex) && !currentBoards.has(player.playerIndex)) {
      return true;
    }
  }

  return false;
};

const crossesBlockedEdge = (
  session: SessionState,
  player: PlayerState,
  piece: Piece,
  input: PlayerInput,
): boolean => {
  if (input !== "left" && input !== "right") {
    return false;
  }

  const { leftNeighbor, rightNeighbor } = getNeighbors(session.ringOrder, player.playerId);
  const cells = getPieceCells(piece, session.world.width);

  if (input === "left" && leftNeighbor === null) {
    return cells.some((cell) => cell.x === 0);
  }

  if (input === "right" && rightNeighbor === null) {
    return cells.some((cell) => cell.x === session.world.width - 1);
  }

  return false;
};

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

const areSamePieceState = (left: Piece, right: Piece): boolean =>
  left.id === right.id &&
  left.x === right.x &&
  left.y === right.y &&
  left.rotation === right.rotation;

const createCellOwnerMap = (pieces: Piece[], worldWidth: number): Map<string, string> => {
  const occupancy = new Map<string, string>();

  for (const piece of pieces) {
    for (const cell of getPieceCells(piece, worldWidth)) {
      occupancy.set(`${cell.x},${cell.y}`, piece.id);
    }
  }

  return occupancy;
};

const hardDropCarriedPieces = (
  world: World,
  pieceId: string,
): { world: World; lockedPieceIds: string[]; clearedRowsByPlayer: number[][] } => {
  const targetPiece = world.activePieces.find((piece) => piece.id === pieceId);

  if (!targetPiece) {
    return {
      world,
      lockedPieceIds: [],
      clearedRowsByPlayer: createEmptyClearRows(world.playerCount),
    };
  }

  let currentWorld = world;
  const carriedIds = new Set<string>([pieceId]);
  const lockedCells = new Set(currentWorld.lockedCells.map((cell) => `${cell.x},${cell.y}`));

  while (true) {
    while (true) {
      const movingPieces = currentWorld.activePieces.filter((piece) => carriedIds.has(piece.id));
      const stationaryPieces = currentWorld.activePieces.filter((piece) => !carriedIds.has(piece.id));
      const occupancy = createCellOwnerMap(stationaryPieces, currentWorld.width);
      let expanded = false;

      for (const piece of movingPieces) {
        const movedPiece = {
          ...piece,
          y: piece.y + 1,
        };

        for (const cell of getPieceCells(movedPiece, currentWorld.width)) {
          const blockingPieceId = occupancy.get(`${cell.x},${cell.y}`);

          if (blockingPieceId && !carriedIds.has(blockingPieceId)) {
            carriedIds.add(blockingPieceId);
            expanded = true;
          }
        }
      }

      if (!expanded) {
        break;
      }
    }

    const movingPieces = currentWorld.activePieces.filter((piece) => carriedIds.has(piece.id));
    const stationaryPieces = currentWorld.activePieces.filter((piece) => !carriedIds.has(piece.id));
    const occupancy = createCellOwnerMap(stationaryPieces, currentWorld.width);
    const canMove = movingPieces.every((piece) => {
      const movedPiece = {
        ...piece,
        y: piece.y + 1,
      };

      return getPieceCells(movedPiece, currentWorld.width).every((cell) => {
        if (cell.y >= currentWorld.height) {
          return false;
        }

        if (lockedCells.has(`${cell.x},${cell.y}`)) {
          return false;
        }

        return !occupancy.has(`${cell.x},${cell.y}`);
      });
    });

    if (!canMove) {
      break;
    }

    currentWorld = {
      ...currentWorld,
      activePieces: currentWorld.activePieces.map((piece) =>
        carriedIds.has(piece.id)
          ? {
              ...piece,
              y: piece.y + 1,
            }
          : piece,
      ),
    };
  }

  const lockedPieceIds = [...carriedIds].sort();
  const carriedPieces = currentWorld.activePieces.filter((piece) => carriedIds.has(piece.id));
  const remainingPieces = currentWorld.activePieces.filter((piece) => !carriedIds.has(piece.id));
  const newLockedCells: LockedCell[] = carriedPieces.flatMap((piece) =>
    getPieceCells(piece, currentWorld.width).map((cell) => ({
      ...cell,
      ownerId: piece.ownerId,
      pieceType: piece.type,
    })),
  );
  const lockedWorld: World = {
    ...currentWorld,
    lockedCells: [...currentWorld.lockedCells, ...newLockedCells],
    activePieces: remainingPieces,
  };
  const { world: clearedWorld, clearedRowsByPlayer } = applyLineClears(lockedWorld);

  return {
    world: clearedWorld,
    lockedPieceIds,
    clearedRowsByPlayer,
  };
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
    if (!player.connected || !isPlayingRole(player.role)) {
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
  const topologyReadySession = applyReadyTopologyChanges(
    evaluateTopologyChanges(advancePlayerLifecycle(session)),
  );
  const spawned = ensureSpawnedPieces(topologyReadySession);
  const failedPieceIds = new Set<string>();
  const hardDropPieceIds: string[] = [];
  const connectedBoardIndexes = new Set(
    spawned.players
      .filter((player) => player.connected && isRingRole(player.role) && spawned.ringOrder.includes(player.playerId))
      .map((player) => player.playerIndex),
  );
  const inputQueues = new Map(
    spawned.players.map((player) => [
      player.playerId,
      clampInputsForTick([...(spawned.pendingInputs[player.playerId] ?? [])]),
    ]),
  );
  const gravityRateByPlayerId = new Map(
    spawned.players.map((player) => [
      player.playerId,
      getGravityRateForInputs(inputQueues.get(player.playerId) ?? []),
    ]),
  );
  const maxInputCount = Math.max(0, ...[...inputQueues.values()].map((inputs) => inputs.length));
  let worldAfterInputs = spawned.world;

  for (let round = 0; round < maxInputCount; round += 1) {
    const actions: PieceAction[] = [];

    for (const player of spawned.players) {
      const piece = getPlayerActivePiece(worldAfterInputs, player.playerId);

      if (!piece) {
        continue;
      }

      const input = inputQueues.get(player.playerId)?.[round];

      if (!input) {
        continue;
      }

      if (input === "down" || input === "up") {
        continue;
      }

      const candidate = applyInputToPiece(piece, input);

      if (
        !crossesBlockedEdge(spawned, player, piece, input) &&
        isInsideConnectedBoards(worldAfterInputs, candidate, connectedBoardIndexes) &&
        canOccupyCandidateBoards(spawned, player, piece, candidate, input) &&
        !entersPendingBoard(spawned, piece, candidate)
      ) {
        if (input === "drop") {
          if (!hardDropPieceIds.includes(piece.id)) {
            hardDropPieceIds.push(piece.id);
          }
          continue;
        }

        actions.push(inputToAction(piece.id, input));
      }
    }

    if (actions.length === 0) {
      continue;
    }

    const actionResult = applyWorldActions(worldAfterInputs, actions);
    worldAfterInputs = actionResult.world;

    for (const pieceId of actionResult.failedPieceIds) {
      failedPieceIds.add(pieceId);
    }
  }

  let worldAfterDrops = worldAfterInputs;
  let lockedPieceIds: string[] = [];
  let clearedRowsByPlayer = createEmptyClearRows(worldAfterDrops.playerCount);

  for (const dropPieceId of hardDropPieceIds) {
    const dropped = hardDropCarriedPieces(worldAfterDrops, dropPieceId);
    worldAfterDrops = dropped.world;
    lockedPieceIds = [...new Set([...lockedPieceIds, ...dropped.lockedPieceIds])].sort();
    clearedRowsByPlayer = mergeClearedRows(clearedRowsByPlayer, dropped.clearedRowsByPlayer);
  }

  let gravityWorld = worldAfterDrops;
  let gravityLockedPieceIds: string[] = [];
  let gravityFailedPieceIds: string[] = [];
  let gravityClearedRows = createEmptyClearRows(worldAfterDrops.playerCount);
  let nextPlayers = spawned.players.map((player) => {
    if (!player.connected || !isPlayingRole(player.role)) {
      return { ...player, gravityMeter: 0 };
    }

    const piece = getPlayerActivePiece(gravityWorld, player.playerId);

    if (!piece) {
      return { ...player, gravityMeter: 0 };
    }

    return {
      ...player,
      gravityMeter: player.gravityMeter + (gravityRateByPlayerId.get(player.playerId) ?? BASE_GRAVITY_PER_TICK),
    };
  });

  while (true) {
    const fallingPlayerIds = nextPlayers
      .filter((player) => {
        if (!player.connected || !isPlayingRole(player.role)) {
          return false;
        }

        const piece = getPlayerActivePiece(gravityWorld, player.playerId);

        if (!piece) {
          return false;
        }

        return player.gravityMeter >= 1;
      })
      .map((player) => player.playerId);

    if (fallingPlayerIds.length === 0) {
      break;
    }

    const gravityStep = tickWorld(
      gravityWorld,
      gravityWorld.activePieces
        .filter((piece) => fallingPlayerIds.includes(piece.ownerId))
        .map((piece) => ({
          pieceId: piece.id,
          kind: "move" as const,
          dx: 0,
          dy: 1,
        })),
    );

    gravityWorld = gravityStep.world;
    gravityLockedPieceIds = [...new Set([...gravityLockedPieceIds, ...gravityStep.lockedPieceIds])].sort();
    gravityFailedPieceIds = [...new Set([...gravityFailedPieceIds, ...gravityStep.failedPieceIds])].sort();
    gravityClearedRows = mergeClearedRows(gravityClearedRows, gravityStep.clearedRowsByPlayer);
    nextPlayers = nextPlayers.map((player) =>
      fallingPlayerIds.includes(player.playerId)
        ? {
            ...player,
            gravityMeter: Math.max(0, player.gravityMeter - 1),
          }
        : player,
    );
  }

  nextPlayers = nextPlayers.map((player) => {
    if (!player.connected || !isPlayingRole(player.role)) {
      return { ...player, gravityMeter: 0 };
    }

    const piece = getPlayerActivePiece(gravityWorld, player.playerId);

    if (!piece) {
      return { ...player, gravityMeter: 0 };
    }

    return player;
  });

  const nextTick = spawned.tick + 1;
  const result: TickResult = {
    world: gravityWorld,
    failedPieceIds: [...new Set([...failedPieceIds, ...gravityFailedPieceIds])].sort(),
    lockedPieceIds: [...new Set([...lockedPieceIds, ...gravityLockedPieceIds])].sort(),
    clearedRowsByPlayer: mergeClearedRows(clearedRowsByPlayer, gravityClearedRows),
  };
  nextPlayers = nextPlayers.map((player) => {
    const cleared = result.clearedRowsByPlayer[player.playerIndex]?.length ?? 0;
    return {
      ...player,
      score: player.score + scoreForClears(cleared),
      lines: player.lines + cleared,
    };
  });

  return {
    session: {
      tick: nextTick,
      world: result.world,
      players: nextPlayers,
      ringOrder: spawned.ringOrder,
      pendingTopologyChanges: spawned.pendingTopologyChanges,
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

export const startHttpServer = (
  port = DEFAULT_PORT,
  playerCount = DEFAULT_PLAYER_COUNT,
): Server => {
  let session = createSession(playerCount);
  const sseClients = new Set<SseClient>();

  const broadcastSnapshot = () => {
    const snapshot = JSON.stringify(getSessionSnapshot(session));

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

    if (request.method === "GET" && requestUrl.pathname === "/api/session") {
      sendJson(response, 200, getSessionInfo(session));
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/join") {
      const body = (await readJsonBody(request)) as {
        name?: string;
      };
      const joined = joinSession(session, body.name);
      session = joined.session;

      if (!joined.player) {
        sendJson(response, 409, { error: "room-full" });
        return;
      }

      session = ensureSpawnedPieces(session);
      sendJson(response, 200, {
        playerId: joined.player.playerId,
        snapshot: getSessionSnapshot(session),
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
      response.write(`data: ${JSON.stringify(getSessionSnapshot(session))}\n\n`);

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
  const playerCount = Number.parseInt(process.env.PLAYER_COUNT ?? `${DEFAULT_PLAYER_COUNT}`, 10);
  startHttpServer(
    Number.isNaN(port) ? DEFAULT_PORT : port,
    Number.isNaN(playerCount) ? DEFAULT_PLAYER_COUNT : playerCount,
  );
}
