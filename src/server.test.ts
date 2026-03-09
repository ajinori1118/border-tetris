import test from "node:test";
import assert from "node:assert/strict";

import { createServerState, queueAction, runServerTick, spawnPiece } from "./server";

test("runServerTick applies queued actions and clears the queue", () => {
  const initialState = createServerState(2);
  const spawnedState = spawnPiece(initialState, {
    id: "piece-1",
    ownerId: "player-1",
    type: "O",
    x: 4,
    y: 0,
    rotation: 0,
  });

  assert.ok(spawnedState);

  const queuedState = queueAction(spawnedState, {
    pieceId: "piece-1",
    kind: "move",
    dx: 1,
    dy: 0,
  });
  const { state, result } = runServerTick(queuedState);

  assert.equal(state.tick, 1);
  assert.deepEqual(state.pendingActions, []);
  assert.deepEqual(result.failedPieceIds, []);
  assert.equal(state.world.activePieces[0]?.x, 5);
});
