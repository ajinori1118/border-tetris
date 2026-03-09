import { canPlace } from "./collision";
import { PieceAction, TickResult, World, createWorldSize, Piece, PieceType, PLAYER_WIDTH } from "./types";
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

const SPAWN_X_OFFSET = 4;
const SPAWN_Y = 0;

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

export const spawnPiece = (
  state: ServerState,
  piece: Piece,
): ServerState | null => {
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

export const queueAction = (
  state: ServerState,
  action: PieceAction,
): ServerState => ({
  ...state,
  pendingActions: [
    ...state.pendingActions.filter((queuedAction) => queuedAction.pieceId !== action.pieceId),
    action,
  ],
});

const withGravity = (action: PieceAction | undefined, pieceId: string): PieceAction => {
  if (!action || action.kind === "none") {
    return {
      pieceId,
      kind: "move",
      dx: 0,
      dy: 1,
    };
  }

  if (action.kind === "move") {
    return {
      ...action,
      dy: action.dy + 1,
    };
  }

  return action;
};

export const runServerTick = (
  state: ServerState,
): { state: ServerState; result: TickResult } => {
  const pendingActionByPieceId = new Map(
    state.pendingActions.map((action) => [action.pieceId, action]),
  );
  const tickActions = state.world.activePieces.map((piece) =>
    withGravity(pendingActionByPieceId.get(piece.id), piece.id),
  );
  const result = tickWorld(state.world, tickActions);

  return {
    state: {
      tick: state.tick + 1,
      world: result.world,
      pendingActions: [],
    },
    result,
  };
};
