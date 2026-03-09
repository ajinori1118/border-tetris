import test from "node:test";
import assert from "node:assert/strict";

import { createWorldSize, Piece, World } from "./types";
import { tickWorld } from "./world";

const createWorld = (overrides?: Partial<World>): World => ({
  ...createWorldSize(2),
  lockedCells: [],
  activePieces: [],
  ...overrides,
});

const createPiece = (overrides?: Partial<Piece>): Piece => ({
  id: "piece-1",
  type: "O",
  ownerId: "player-1",
  x: 0,
  y: 0,
  rotation: 0,
  ...overrides,
});

test("tickWorld rejects both pieces when they claim the same cells in one tick", () => {
  const world = createWorld({
    activePieces: [
      createPiece({ id: "a", x: 1, y: 5 }),
      createPiece({ id: "b", x: 5, y: 5, ownerId: "player-2" }),
    ],
  });

  const result = tickWorld(world, [
    { pieceId: "a", kind: "move", dx: 2, dy: 0 },
    { pieceId: "b", kind: "move", dx: -2, dy: 0 },
  ]);

  assert.deepEqual(result.failedPieceIds, ["a", "b"]);
  assert.deepEqual(
    result.world.activePieces.map((piece) => ({ id: piece.id, x: piece.x, y: piece.y })),
    [
      { id: "a", x: 1, y: 5 },
      { id: "b", x: 5, y: 5 },
    ],
  );
});

test("tickWorld clears lines independently for each player board", () => {
  const playerZeroFullRow = Array.from({ length: 10 }, (_, x) => ({ x, y: 19 }));
  const world = createWorld({
    lockedCells: [
      ...playerZeroFullRow,
      { x: 0, y: 18 },
      { x: 10, y: 19 },
    ],
  });

  const result = tickWorld(world, []);
  const lockedKeys = result.world.lockedCells
    .map((cell) => `${cell.x},${cell.y}`)
    .sort();

  assert.deepEqual(result.clearedRowsByPlayer, [[19], []]);
  assert.deepEqual(lockedKeys, ["0,19", "10,19"]);
});

test("tickWorld locks a piece when it is grounded on another active piece", () => {
  const world = createWorld({
    activePieces: [
      createPiece({ id: "top", x: 4, y: 15 }),
      createPiece({ id: "bottom", x: 4, y: 17, ownerId: "player-2" }),
    ],
  });

  const result = tickWorld(world, []);

  assert.deepEqual(result.lockedPieceIds, ["top"]);
  assert.deepEqual(result.world.activePieces.map((piece) => piece.id), ["bottom"]);
  assert.equal(result.world.lockedCells.length, 4);
});
