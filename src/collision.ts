import { getPieceCells, rotatePiece } from "./piece";
import { Cell, Piece, RotationDirection, World } from "./types";

const toKey = ({ x, y }: Cell): string => `${x},${y}`;

const collectOccupiedCells = (world: World, ignoredPieceId?: string): Set<string> => {
  const occupied = new Set<string>();

  for (const cell of world.lockedCells) {
    occupied.add(toKey(cell));
  }

  for (const activePiece of world.activePieces) {
    if (activePiece.id === ignoredPieceId) {
      continue;
    }

    for (const cell of getPieceCells(activePiece, world.width)) {
      occupied.add(toKey(cell));
    }
  }

  return occupied;
};

export const canPlace = (piece: Piece, world: World): boolean => {
  const occupied = collectOccupiedCells(world, piece.id);

  return getPieceCells(piece, world.width).every((cell) => {
    if (cell.y < 0 || cell.y >= world.height) {
      return false;
    }

    return !occupied.has(toKey(cell));
  });
};

export const tryMove = (
  piece: Piece,
  dx: number,
  dy: number,
  world: World,
): Piece | null => {
  const movedPiece: Piece = {
    ...piece,
    x: piece.x + dx,
    y: piece.y + dy,
  };

  return canPlace(movedPiece, world) ? movedPiece : null;
};

export const tryRotate = (
  piece: Piece,
  direction: RotationDirection,
  world: World,
): Piece | null => {
  const rotatedPiece = rotatePiece(piece, direction);
  return canPlace(rotatedPiece, world) ? rotatedPiece : null;
};

export const isGrounded = (piece: Piece, world: World): boolean =>
  tryMove(piece, 0, 1, world) === null;
