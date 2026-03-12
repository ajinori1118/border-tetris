import test from "node:test";
import assert from "node:assert/strict";

import {
  createSession,
  createSpawnPiece,
  createServerState,
  getSessionSnapshot,
  joinSession,
  queueAction,
  queuePlayerInput,
  stepSession,
  spawnPiece,
  runServerTick,
  leaveSession,
  SessionState,
} from "./server";
import { getPieceCells } from "./piece";
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
  assert.deepEqual(firstJoin.session.ringOrder, ["player-1"]);
  assert.equal(firstJoin.player?.role, "playing");

  const secondJoin = joinSession(firstJoin.session);
  assert.equal(secondJoin.player?.playerIndex, 1);
  assert.deepEqual(secondJoin.session.ringOrder, ["player-1", "player-2"]);
  assert.equal(secondJoin.player?.role, "playing");

  const stepped = stepSession(secondJoin.session);

  assert.equal(stepped.session.world.activePieces.length, 2);
  assert.equal(stepped.session.players[0]?.connected, true);
  assert.equal(stepped.session.players[1]?.connected, true);
});

test("leaveSession keeps a disconnected player in ringOrder during grace period", () => {
  const joinedOne = joinSession(createSession(2));
  const joinedTwo = joinSession(joinedOne.session);
  const disconnected = leaveSession(joinedTwo.session, "player-2");

  assert.deepEqual(disconnected.ringOrder, ["player-1", "player-2"]);
  assert.equal(
    disconnected.players.find((player) => player.playerId === "player-2")?.role,
    "disconnected",
  );
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

test("queuePlayerInput does not wrap left in a two-player session", () => {
  const joinedOne = joinSession(createSession(2));
  assert.ok(joinedOne.player);
  const joinedTwo = joinSession(joinedOne.session);
  assert.ok(joinedTwo.player);

  const blockedSession = {
    ...joinedTwo.session,
    world: {
      ...joinedTwo.session.world,
      activePieces: [
        {
          id: "piece-left-edge",
          ownerId: joinedOne.player.playerId,
          type: "O" as const,
          x: 0,
          y: 1,
          rotation: 0 as const,
        },
      ],
    },
  };
  const stepped = stepSession(queuePlayerInput(blockedSession, joinedOne.player.playerId, "left"));
  const piece = stepped.session.world.activePieces.find(
    (entry) => entry.ownerId === joinedOne.player?.playerId,
  );

  assert.ok(piece);
  assert.equal(piece.x, 0);
  assert.equal(piece.y, 2);
});

test("queuePlayerInput wraps left in a three-player ring", () => {
  const joinedOne = joinSession(createSession(3));
  assert.ok(joinedOne.player);
  const joinedTwo = joinSession(joinedOne.session);
  assert.ok(joinedTwo.player);
  const joinedThree = joinSession(joinedTwo.session);
  assert.ok(joinedThree.player);

  const wrappedSession = {
    ...joinedThree.session,
    world: {
      ...joinedThree.session.world,
      activePieces: [
        {
          id: "piece-left-ring",
          ownerId: joinedOne.player.playerId,
          type: "O" as const,
          x: 0,
          y: 1,
          rotation: 0 as const,
        },
      ],
    },
  };
  const stepped = stepSession(queuePlayerInput(wrappedSession, joinedOne.player.playerId, "left"));
  const piece = stepped.session.world.activePieces.find(
    (entry) => entry.ownerId === joinedOne.player?.playerId,
  );

  assert.ok(piece);
  assert.deepEqual(
    getPieceCells(piece, stepped.session.world.width)
      .map((cell) => cell.x)
      .sort((left, right) => left - right),
    [0, 0, 29, 29],
  );
  assert.equal(piece.y, 2);
});

test("queuePlayerInput cannot newly enter a board with a pending topology change", () => {
  const joinedOne = joinSession(createSession(2));
  assert.ok(joinedOne.player);
  const joinedTwo = joinSession(joinedOne.session);
  assert.ok(joinedTwo.player);

  const blockedSession = {
    ...joinedTwo.session,
    pendingTopologyChanges: [
      {
        id: "remove-player-2-later",
        kind: "remove" as const,
        playerId: joinedTwo.player.playerId,
        scheduledAtTick: joinedTwo.session.tick + 5,
        status: "pending" as const,
      },
    ],
    world: {
      ...joinedTwo.session.world,
      activePieces: [
        {
          id: "piece-edge",
          ownerId: joinedOne.player.playerId,
          type: "O" as const,
          x: 8,
          y: 1,
          rotation: 0 as const,
        },
      ],
    },
  };

  const stepped = stepSession(queuePlayerInput(blockedSession, joinedOne.player.playerId, "right"));
  const piece = stepped.session.world.activePieces.find(
    (entry) => entry.ownerId === joinedOne.player?.playerId,
  );

  assert.ok(piece);
  assert.equal(piece.x, 8);
  assert.equal(piece.y, 2);
});

test("hard drop immediately locks the piece and carries other active pieces in its path", () => {
  const joinedOne = joinSession(createSession(2));
  assert.ok(joinedOne.player);
  const joinedTwo = joinSession(joinedOne.session);
  assert.ok(joinedTwo.player);

  const session = {
    ...joinedTwo.session,
    world: {
      ...joinedTwo.session.world,
      activePieces: [
        {
          id: "dropper",
          ownerId: joinedOne.player.playerId,
          type: "O" as const,
          x: 9,
          y: 1,
          rotation: 0 as const,
        },
        {
          id: "carried",
          ownerId: joinedTwo.player.playerId,
          type: "O" as const,
          x: 9,
          y: 5,
          rotation: 0 as const,
        },
      ],
    },
  };

  const stepped = stepSession(queuePlayerInput(session, joinedOne.player.playerId, "drop"));

  assert.deepEqual(stepped.result.lockedPieceIds, ["carried", "dropper"]);
  assert.equal(stepped.session.world.activePieces.length, 0);
  assert.deepEqual(
    stepped.session.world.lockedCells.map((cell) => `${cell.x},${cell.y},${cell.ownerId}`).sort(),
    [
      `9,16,${joinedOne.player.playerId}`,
      `9,18,${joinedTwo.player.playerId}`,
      `9,19,${joinedTwo.player.playerId}`,
      `9,17,${joinedOne.player.playerId}`,
      `10,16,${joinedOne.player.playerId}`,
      `10,17,${joinedOne.player.playerId}`,
      `10,18,${joinedTwo.player.playerId}`,
      `10,19,${joinedTwo.player.playerId}`,
    ].sort(),
  );
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
  assert.equal(playerOne.role, "dead");
  assert.equal(
    stepped.session.world.lockedCells.some((cell) => cell.x >= 0 && cell.x < 10 && cell.y === 1),
    false,
  );
  assert.deepEqual(stepped.session.ringOrder, ["player-1", "player-2"]);
  assert.deepEqual(survivingLockedKeys, [
    `10,5,${joinedTwo.player.playerId},I`,
    `11,5,${joinedTwo.player.playerId},I`,
  ]);
});

test("dead players revive in the same ring position after the revive delay", () => {
  const joinedOne = joinSession(createSession(2));
  assert.ok(joinedOne.player);
  const joinedTwo = joinSession(joinedOne.session);
  assert.ok(joinedTwo.player);

  const blockedSpawnSession = {
    ...joinedTwo.session,
    world: {
      ...joinedTwo.session.world,
      lockedCells: [
        { x: 4, y: 1, ownerId: "player-1", pieceType: "O" as const },
        { x: 5, y: 1, ownerId: "player-1", pieceType: "O" as const },
      ],
      activePieces: [],
    },
    players: joinedTwo.session.players.map((player) =>
      player.playerId === joinedOne.player?.playerId
        ? { ...player, nextType: "O" as const }
        : player,
    ),
  };

  let current = stepSession(blockedSpawnSession).session;
  const deadPlayer = current.players.find((player) => player.playerId === joinedOne.player?.playerId);
  assert.equal(deadPlayer?.role, "dead");
  assert.deepEqual(current.ringOrder, ["player-1", "player-2"]);

  current = {
    ...current,
    world: {
      ...current.world,
      lockedCells: [],
    },
  };

  for (let index = 0; index < 12; index += 1) {
    current = stepSession(current).session;
  }

  const revivedPlayer = current.players.find(
    (player) => player.playerId === joinedOne.player?.playerId,
  );
  assert.equal(revivedPlayer?.role, "playing");
  assert.deepEqual(current.ringOrder, ["player-1", "player-2"]);
  assert.ok(current.world.activePieces.some((piece) => piece.ownerId === joinedOne.player?.playerId));
});

test("queuePlayerInput cannot enter a dead player's board", () => {
  const joinedOne = joinSession(createSession(2));
  assert.ok(joinedOne.player);
  const joinedTwo = joinSession(joinedOne.session);
  assert.ok(joinedTwo.player);

  const deadBoardSession = {
    ...joinedTwo.session,
    world: {
      ...joinedTwo.session.world,
      activePieces: [
        {
          id: "piece-edge",
          ownerId: joinedTwo.player.playerId,
          type: "O" as const,
          x: 10,
          y: 1,
          rotation: 0 as const,
        },
      ],
    },
    players: joinedTwo.session.players.map((player) =>
      player.playerId === joinedOne.player?.playerId ? { ...player, role: "dead" as const } : player,
    ),
  };

  const stepped = stepSession(queuePlayerInput(deadBoardSession, joinedTwo.player.playerId, "left"));
  const piece = stepped.session.world.activePieces.find(
    (entry) => entry.ownerId === joinedTwo.player?.playerId,
  );

  assert.ok(piece);
  assert.equal(piece.x, 10);
  assert.equal(piece.y, 2);
});

test("disconnected players are removed from ringOrder after the grace period", () => {
  const joinedOne = joinSession(createSession(2));
  assert.ok(joinedOne.player);
  const joinedTwo = joinSession(joinedOne.session);
  assert.ok(joinedTwo.player);

  let current: SessionState = {
    ...leaveSession(joinedTwo.session, joinedTwo.player.playerId),
    world: {
      ...joinedTwo.session.world,
      activePieces: [],
      lockedCells: [],
    },
    pendingInputs: {},
  };

  for (let index = 0; index < 31; index += 1) {
    current = stepSession(current).session;
  }

  const removedPlayer = current.players.find(
    (player) => player.playerId === joinedTwo.player?.playerId,
  );
  assert.deepEqual(current.ringOrder, ["player-1"]);
  assert.equal(removedPlayer?.role, "spectating");
  assert.equal(
    current.pendingTopologyChanges.some((change) => change.playerId === joinedTwo.player?.playerId),
    false,
  );
});

test("snapshot exposes player roles, neighbors, ringOrder, and pending topology changes", () => {
  const joinedOne = joinSession(createSession(3));
  assert.ok(joinedOne.player);
  const joinedTwo = joinSession(joinedOne.session);
  assert.ok(joinedTwo.player);

  const disconnected = leaveSession(joinedTwo.session, joinedTwo.player.playerId);
  const snapshot = getSessionSnapshot(disconnected);
  const firstPlayer = snapshot.players.find((player) => player.playerId === joinedOne.player?.playerId);
  const secondPlayer = snapshot.players.find((player) => player.playerId === joinedTwo.player?.playerId);

  assert.deepEqual(snapshot.ringOrder, ["player-1", "player-2"]);
  assert.equal(firstPlayer?.leftNeighbor, null);
  assert.equal(firstPlayer?.rightNeighbor, joinedTwo.player.playerId);
  assert.equal(secondPlayer?.role, "disconnected");
  assert.equal(secondPlayer?.leftNeighbor, joinedOne.player.playerId);
  assert.equal(secondPlayer?.rightNeighbor, null);
  assert.equal(snapshot.pendingTopologyChanges.length, 0);
});
