import test from "node:test";
import assert from "node:assert/strict";

import {
  createSession,
  createSpawnPiece,
  createServerState,
  joinSession,
  queueAction,
  queuePlayerInput,
  stepSession,
  spawnPiece,
  runServerTick,
  leaveSession,
} from "./server";
import { rotatePiece } from "./piece";

test("runServerTick applies queued actions, gravity, and clears the queue", () => {
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
  assert.equal(state.world.activePieces[0]?.y, 1);
});

test("runServerTick still applies gravity when the input is rotation", () => {
  const initialState = createServerState(1);
  const spawnedState = spawnPiece(initialState, {
    id: "piece-1",
    ownerId: "player-1",
    type: "T",
    x: 4,
    y: 1,
    rotation: 0,
  });

  assert.ok(spawnedState);

  const queuedState = queueAction(spawnedState, {
    pieceId: "piece-1",
    kind: "rotate",
    direction: 1,
  });
  const { state } = runServerTick(queuedState);

  assert.equal(state.world.activePieces[0]?.rotation, 1);
  assert.equal(state.world.activePieces[0]?.y, 2);
});

test("createSpawnPiece places a piece inside the target player board", () => {
  const piece = createSpawnPiece({
    id: "piece-2",
    ownerId: "player-2",
    playerIndex: 1,
    type: "T",
  });

  assert.deepEqual(piece, {
    id: "piece-2",
    ownerId: "player-2",
    type: "T",
    x: 14,
    y: 1,
    rotation: 0,
  });
});

test("rotatePiece keeps O pieces in the same state", () => {
  const piece = {
    id: "piece-o",
    ownerId: "player-1",
    type: "O" as const,
    x: 4,
    y: 1,
    rotation: 0 as const,
  };

  assert.deepEqual(rotatePiece(piece, 1), piece);
});

test("joinSession reserves separate players and stepSession spawns a controlled piece", () => {
  const firstJoin = joinSession(createSession(2));
  assert.equal(firstJoin.player?.playerIndex, 0);

  const secondJoin = joinSession(firstJoin.session);
  assert.equal(secondJoin.player?.playerIndex, 1);

  const stepped = stepSession(secondJoin.session);

  assert.equal(stepped.session.world.activePieces.length, 2);
  assert.equal(stepped.session.players[0]?.connected, true);
  assert.equal(stepped.session.players[1]?.connected, true);
});

test("queuePlayerInput affects only the owning player's active piece", () => {
  const joined = joinSession(createSession(2));
  assert.ok(joined.player);

  const spawned = stepSession(joined.session).session;
  const beforeX =
    spawned.world.activePieces.find((piece) => piece.ownerId === joined.player?.playerId)?.x ?? -1;

  const nextSession = queuePlayerInput(spawned, joined.player.playerId, "right");
  const stepped = stepSession(nextSession);
  const afterPiece = stepped.session.world.activePieces.find(
    (piece) => piece.ownerId === joined.player?.playerId,
  );

  assert.ok(afterPiece);
  assert.equal(afterPiece.x, beforeX + 1);
});

test("queuePlayerInput cannot move into a board with no connected player", () => {
  const joined = joinSession(createSession(2));
  assert.ok(joined.player);

  const blockedSession = {
    ...joined.session,
    world: {
      ...joined.session.world,
      activePieces: [
        {
          id: "piece-edge",
          ownerId: joined.player.playerId,
          type: "O" as const,
          x: 0,
          y: 1,
          rotation: 0 as const,
        },
      ],
    },
  };
  const nextSession = queuePlayerInput(blockedSession, joined.player.playerId, "left");
  const stepped = stepSession(nextSession);
  const piece = stepped.session.world.activePieces.find(
    (entry) => entry.ownerId === joined.player?.playerId,
  );

  assert.ok(piece);
  assert.equal(piece.x, 0);
  assert.equal(piece.y, 2);
});

test("game over resets only that board and fixes surviving cells across the boundary", () => {
  const joinedOne = joinSession(createSession(2));
  assert.ok(joinedOne.player);
  const joinedTwo = joinSession(joinedOne.session);
  assert.ok(joinedTwo.player);

  const session = {
    ...joinedTwo.session,
    world: {
      ...joinedTwo.session.world,
      lockedCells: [
        { x: 4, y: 1, ownerId: "player-1", pieceType: "O" as const },
        { x: 5, y: 1, ownerId: "player-1", pieceType: "O" as const },
      ],
      activePieces: [
        {
          id: "crossing-piece",
          ownerId: joinedTwo.player.playerId,
          type: "I" as const,
          x: 9,
          y: 5,
          rotation: 0 as const,
        },
      ],
    },
    players: joinedTwo.session.players.map((player) =>
      player.playerId === joinedOne.player?.playerId
        ? { ...player, nextType: "O" as const }
        : player,
    ),
  };

  const stepped = stepSession(session);
  const playerOne = stepped.session.players.find(
    (player) => player.playerId === joinedOne.player?.playerId,
  );
  const survivingLockedKeys = stepped.session.world.lockedCells
    .map((cell) => `${cell.x},${cell.y},${cell.ownerId},${cell.pieceType}`)
    .sort();

  assert.ok(playerOne);
  assert.equal(playerOne.score, 0);
  assert.equal(playerOne.lines, 0);
  assert.equal(
    stepped.session.world.lockedCells.some((cell) => cell.x >= 0 && cell.x < 10 && cell.y === 1),
    false,
  );
  assert.deepEqual(survivingLockedKeys, [
    `10,5,${joinedTwo.player.playerId},I`,
    `11,5,${joinedTwo.player.playerId},I`,
  ]);
});
