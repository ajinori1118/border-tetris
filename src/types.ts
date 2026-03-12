export const PLAYER_WIDTH = 10;
export const PLAYER_HEIGHT = 20;

export type Rotation = 0 | 1 | 2 | 3;
export type RotationDirection = -1 | 1;
export type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
export type PlayerRole = "playing" | "dead" | "disconnected" | "spectating";
export type TopologyChangeKind = "add" | "remove";
export type TopologyChangeStatus = "pending" | "blocked" | "ready";

export type Cell = {
  x: number;
  y: number;
};

export type LockedCell = Cell & {
  ownerId: string;
  pieceType: PieceType;
};

export type Piece = {
  id: string;
  type: PieceType;
  ownerId: string;
  x: number;
  y: number;
  rotation: Rotation;
};

export type World = {
  playerCount: number;
  width: number;
  height: number;
  lockedCells: LockedCell[];
  activePieces: Piece[];
};

export type PieceAction =
  | {
      pieceId: string;
      kind: "move";
      dx: number;
      dy: number;
    }
  | {
      pieceId: string;
      kind: "rotate";
      direction: RotationDirection;
    }
  | {
      pieceId: string;
      kind: "none";
    };

export type TickResult = {
  world: World;
  failedPieceIds: string[];
  lockedPieceIds: string[];
  clearedRowsByPlayer: number[][];
};

export type TopologyChange = {
  id: string;
  kind: TopologyChangeKind;
  playerId: string;
  scheduledAtTick: number;
  status: TopologyChangeStatus;
  reason?: string;
};

export type RingOrder = string[];

export const createWorldSize = (playerCount: number) => ({
  playerCount,
  width: PLAYER_WIDTH * playerCount,
  height: PLAYER_HEIGHT,
});
