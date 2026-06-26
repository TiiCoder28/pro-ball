import test from 'node:test';
import assert from 'node:assert/strict';
import { makeState, makePlayer, step, FIELD, resetPositions } from '../server/physics.js';

test('room supports max 22 players constant', () => assert.equal(FIELD.maxPlayers, 22));

test('ball scores when crossing left goal', () => {
  const state = makeState();
  state.running = true;
  state.ball.x = 1;
  state.ball.y = FIELD.h / 2;
  state.ball.vx = -5;
  step(state);
  assert.equal(state.blue, 1);
  assert.equal(state.ball.x, FIELD.w / 2);
});

test('player movement changes position while running', () => {
  const state = makeState();
  state.running = true;
  const player = makePlayer('1', 'Tii', 'red');
  player.right = true;
  state.players[player.id] = player;
  const startX = player.x;
  step(state);
  assert.ok(player.x > startX);
});

test('reset positions centers ball', () => {
  const state = makeState();
  state.ball.x = 9;
  resetPositions(state);
  assert.equal(state.ball.x, FIELD.w / 2);
  assert.equal(state.ball.y, FIELD.h / 2);
});
