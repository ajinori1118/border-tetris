import { Cell, Piece, PieceType, Rotation, RotationDirection } from "./types";

const PIECE_SHAPES: Record<PieceType, Cell[]> = {
  I: [
    { x: -1, y: 0 },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
  ],
  O: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
  T: [
    { x: -1, y: 0 },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
  ],
  S: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: 1 },
  ],
  Z: [
    { x: -1, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
  J: [
    { x: -1, y: -1 },
    { x: -1, y: 0 },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
  L: [
    { x: 1, y: -1 },
    { x: -1, y: 0 },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ],
};

export const wrapX = (x: number, worldWidth: number): number => {
  const wrapped = x % worldWidth;
  return wrapped >= 0 ? wrapped : wrapped + worldWidth;
};

const rotateCellClockwise = ({ x, y }: Cell): Cell => ({
  x: -y,
  y: x,
});

const normalizeTurns = (rotation: Rotation): number => rotation;

const rotateCell = (cell: Cell, rotation: Rotation): Cell => {
  if (rotation === 0) {
    return cell;
  }

  let rotated = cell;
  for (let turn = 0; turn < normalizeTurns(rotation); turn += 1) {
    rotated = rotateCellClockwise(rotated);
  }

  return rotated;
};

export const getPieceCells = (piece: Piece, worldWidth: number): Cell[] =>
  PIECE_SHAPES[piece.type].map((cell) => {
    const rotated = piece.type === "O" ? cell : rotateCell(cell, piece.rotation);

    return {
      x: wrapX(piece.x + rotated.x, worldWidth),
      y: piece.y + rotated.y,
    };
  });

export const rotatePiece = (
  piece: Piece,
  direction: RotationDirection,
): Piece => ({
  ...piece,
  rotation: (((piece.rotation + direction) % 4) + 4) % 4 as Rotation,
});
