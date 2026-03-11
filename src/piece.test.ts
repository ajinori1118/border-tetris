import test from "node:test";
import assert from "node:assert/strict";

import { getPieceCells, rotatePiece } from "./piece";

test("O piece keeps the same occupied cells after rotation", () => {
  const piece = {
    id: "o-1",
    ownerId: "player-1",
    type: "O" as const,
    x: 4,
    y: 5,
    rotation: 0 as const,
  };

  const rotated = rotatePiece(piece, 1);

  assert.deepEqual(getPieceCells(rotated, 20), getPieceCells(piece, 20));
  assert.deepEqual(rotated, piece);
});

test("S piece keeps the same x positions after 180 degree rotation", () => {
  const piece = {
    id: "s-1",
    ownerId: "player-1",
    type: "S" as const,
    x: 4,
    y: 5,
    rotation: 0 as const,
  };

  const rotatedOnce = rotatePiece(piece, 1);
  const rotatedTwice = rotatePiece(rotatedOnce, 1);
  const originalX = getPieceCells(piece, 20)
    .map((cell) => cell.x)
    .sort((left, right) => left - right);
  const rotatedX = getPieceCells(rotatedTwice, 20)
    .map((cell) => cell.x)
    .sort((left, right) => left - right);

  assert.deepEqual(rotatedX, originalX);
});
