import { canPlace } from "./collision";
import { getPieceCells } from "./piece";
import {
  Cell,
  LockedCell,
  Piece,
  PieceAction,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  TickResult,
  World,
} from "./types";

const toKey = ({ x, y }: Cell): string => `${x},${y}`;

const sortNumbersAscending = (left: number, right: number): number => left - right;

const buildLockedCellSet = (world: World): Set<string> =>
  new Set(world.lockedCells.map((cell) => toKey(cell)));

const buildLockedOnlyWorld = (world: World): World => ({
  ...world,
  activePieces: [],
});

const areSamePieceState = (left: Piece, right: Piece): boolean =>
  left.x === right.x && left.y === right.y && left.rotation === right.rotation;

const applyActionToPiece = (
  piece: Piece,
  action: PieceAction | undefined,
): Piece => {
  if (!action || action.kind === "none") {
    return piece;
  }

  if (action.kind === "move") {
    return {
      ...piece,
      x: piece.x + action.dx,
      y: piece.y + action.dy,
    };
  }

  return {
    ...piece,
    rotation: (((piece.rotation + action.direction) % 4) + 4) % 4 as Piece["rotation"],
  };
};

const findBlockedProposals = (
  worldWidth: number,
  basePieces: Piece[],
  proposedPieces: Map<string, Piece>,
): Set<string> => {
  const blocked = new Set<string>();
  const occupiedByStablePiece = new Map<string, string>();
  const claims = new Map<string, string[]>();

  for (const piece of basePieces) {
    if (proposedPieces.has(piece.id)) {
      continue;
    }

    for (const cell of getPieceCells(piece, worldWidth)) {
      occupiedByStablePiece.set(toKey(cell), piece.id);
    }
  }

  for (const [pieceId, piece] of proposedPieces) {
    for (const cell of getPieceCells(piece, worldWidth)) {
      const key = toKey(cell);
      const stableOwner = occupiedByStablePiece.get(key);

      if (stableOwner) {
        blocked.add(pieceId);
        continue;
      }

      const pieceIds = claims.get(key) ?? [];
      pieceIds.push(pieceId);
      claims.set(key, pieceIds);
    }
  }

  for (const pieceIds of claims.values()) {
    if (pieceIds.length < 2) {
      continue;
    }

    for (const pieceId of pieceIds) {
      blocked.add(pieceId);
    }
  }

  return blocked;
};

const resolveActions = (
  world: World,
  actions: PieceAction[],
): { pieces: Piece[]; failedPieceIds: string[] } => {
  const actionByPieceId = new Map(actions.map((action) => [action.pieceId, action]));
  const lockedOnlyWorld = buildLockedOnlyWorld(world);
  const failedPieceIds = new Set<string>();
  const proposedPieces = new Map<string, Piece>();

  for (const piece of world.activePieces) {
    const candidate = applyActionToPiece(piece, actionByPieceId.get(piece.id));

    if (areSamePieceState(piece, candidate)) {
      continue;
    }

    if (!canPlace(candidate, lockedOnlyWorld)) {
      failedPieceIds.add(piece.id);
      continue;
    }

    proposedPieces.set(piece.id, candidate);
  }

  while (true) {
    const blocked = findBlockedProposals(world.width, world.activePieces, proposedPieces);

    if (blocked.size === 0) {
      break;
    }

    for (const pieceId of blocked) {
      proposedPieces.delete(pieceId);
      failedPieceIds.add(pieceId);
    }
  }

  return {
    pieces: world.activePieces.map((piece) => proposedPieces.get(piece.id) ?? piece),
    failedPieceIds: [...failedPieceIds].sort(),
  };
};

const clearLinesByPlayer = (
  lockedCells: LockedCell[],
  playerCount: number,
): { lockedCells: LockedCell[]; clearedRowsByPlayer: number[][] } => {
  let nextCells = lockedCells;
  const clearedRowsByPlayer: number[][] = [];

  for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
    const startX = playerIndex * PLAYER_WIDTH;
    const endX = startX + PLAYER_WIDTH;
    const playerCells = nextCells.filter((cell) => cell.x >= startX && cell.x < endX);
    const otherCells = nextCells.filter((cell) => cell.x < startX || cell.x >= endX);
    const filledRows = new Set<number>();

    for (let y = 0; y < PLAYER_HEIGHT; y += 1) {
      let count = 0;

      for (const cell of playerCells) {
        if (cell.y === y) {
          count += 1;
        }
      }

      if (count === PLAYER_WIDTH) {
        filledRows.add(y);
      }
    }

    const clearedRows = [...filledRows].sort(sortNumbersAscending);
    clearedRowsByPlayer.push(clearedRows);

    const shiftedCells = playerCells
      .filter((cell) => !filledRows.has(cell.y))
      .map((cell) => {
        let drop = 0;

        for (const row of clearedRows) {
          if (row > cell.y) {
            drop += 1;
          }
        }

        return {
          ...cell,
          y: cell.y + drop,
        };
      });

    nextCells = [...otherCells, ...shiftedCells];
  }

  return {
    lockedCells: nextCells,
    clearedRowsByPlayer,
  };
};

export const applyLineClears = (
  world: World,
): { world: World; clearedRowsByPlayer: number[][] } => {
  const { lockedCells, clearedRowsByPlayer } = clearLinesByPlayer(
    world.lockedCells,
    world.playerCount,
  );

  return {
    world: {
      ...world,
      lockedCells,
    },
    clearedRowsByPlayer,
  };
};

export const lockGroundedPieces = (
  world: World,
): { world: World; lockedPieceIds: string[] } => {
  const lockedCellSet = buildLockedCellSet(world);
  const lockedPieceIds = world.activePieces
    .filter((piece) =>
      getPieceCells(piece, world.width).some((cell) => {
        const nextY = cell.y + 1;

        if (nextY >= world.height) {
          return true;
        }

        return lockedCellSet.has(toKey({ x: cell.x, y: nextY }));
      }),
    )
    .map((piece) => piece.id)
    .sort();

  if (lockedPieceIds.length === 0) {
    return { world, lockedPieceIds };
  }

  const lockedIdSet = new Set(lockedPieceIds);
  const groundedPieces = world.activePieces.filter((piece) => lockedIdSet.has(piece.id));
  const stillActivePieces = world.activePieces.filter((piece) => !lockedIdSet.has(piece.id));
  const groundedCells = groundedPieces.flatMap((piece) =>
    getPieceCells(piece, world.width).map((cell) => ({
      ...cell,
      ownerId: piece.ownerId,
      pieceType: piece.type,
    })),
  );

  return {
    world: {
      ...world,
      lockedCells: [...world.lockedCells, ...groundedCells],
      activePieces: stillActivePieces,
    },
    lockedPieceIds,
  };
};

export const tickWorld = (world: World, actions: PieceAction[]): TickResult => {
  const { pieces, failedPieceIds } = resolveActions(world, actions);
  const movedWorld: World = {
    ...world,
    activePieces: pieces,
  };
  const { world: lockedWorld, lockedPieceIds } = lockGroundedPieces(movedWorld);
  const { world: clearedWorld, clearedRowsByPlayer } = applyLineClears(lockedWorld);

  return {
    world: clearedWorld,
    failedPieceIds,
    lockedPieceIds,
    clearedRowsByPlayer,
  };
};
