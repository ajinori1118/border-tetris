import { canPlace } from "./collision";
import { PieceAction, TickResult, World, createWorldSize, Piece } from "./types";
import { tickWorld } from "./world";

export type ServerState = {
  tick: number;
  world: World;
  pendingActions: PieceAction[];
};

export const createServerState = (playerCount: number): ServerState => ({
  tick: 0,
  world: {
    ...createWorldSize(playerCount),
    lockedCells: [],
    activePieces: [],
  },
  pendingActions: [],
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

export const runServerTick = (
  state: ServerState,
): { state: ServerState; result: TickResult } => {
  const result = tickWorld(state.world, state.pendingActions);

  return {
    state: {
      tick: state.tick + 1,
      world: result.world,
      pendingActions: [],
    },
    result,
  };
};
