export const FIELD = { w: 980, h: 560, goalH: 150, playerR: 15, ballR: 9, maxPlayers: 22 };

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function makePlayer(id, name, team = 'spectators', host = false) {
  return {
    id,
    name,
    team,
    host,
    x: FIELD.w / 2,
    y: FIELD.h / 2,
    vx: 0,
    vy: 0,
    up: false,
    down: false,
    left: false,
    right: false,
    kick: false
  };
}

export function makeState() {
  return {
    room: '',
    running: false,
    time: 0,
    limit: 300,
    red: 0,
    blue: 0,
    players: {},
    ball: { x: FIELD.w / 2, y: FIELD.h / 2, vx: 0, vy: 0 }
  };
}

export function spawn(team, index = 0) {
  const side = team === 'red' ? 0.25 : 0.75;
  const lane = [-0.28, -0.17, -0.07, 0.07, 0.17, 0.28][index % 6];
  const row = Math.floor(index / 6) * 42;
  return { x: FIELD.w * side + (team === 'red' ? -row : row), y: FIELD.h / 2 + lane * FIELD.h };
}

function limitSpeed(body, max) {
  const speed = Math.hypot(body.vx, body.vy);
  if (speed > max) {
    body.vx = (body.vx / speed) * max;
    body.vy = (body.vy / speed) * max;
  }
}

function collidePlayers(players) {
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      if (a.team === 'spectators' || b.team === 'spectators') continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const min = FIELD.playerR * 2;
      if (dist >= min) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const push = (min - dist) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      a.vx -= nx * 0.12;
      a.vy -= ny * 0.12;
      b.vx += nx * 0.12;
      b.vy += ny * 0.12;
    }
  }
}

function collideBallPlayer(ball, player) {
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  const dist = Math.hypot(dx, dy) || 1;
  const min = FIELD.playerR + FIELD.ballR;
  if (dist >= min) return;
  const nx = dx / dist;
  const ny = dy / dist;
  ball.x = player.x + nx * min;
  ball.y = player.y + ny * min;
  const control = player.kick ? 7.6 : 1.75;
  ball.vx += nx * control + player.vx * 0.55;
  ball.vy += ny * control + player.vy * 0.55;
  player.vx -= nx * 0.08;
  player.vy -= ny * 0.08;
  player.kick = false;
}

export function step(state, dt = 1 / 60) {
  if (!state.running) return state;
  state.time += dt;
  const players = Object.values(state.players);

  for (const player of players) {
    if (player.team === 'spectators') continue;
    let ax = (player.right ? 1 : 0) - (player.left ? 1 : 0);
    let ay = (player.down ? 1 : 0) - (player.up ? 1 : 0);
    const magnitude = Math.hypot(ax, ay) || 1;
    ax /= magnitude;
    ay /= magnitude;

    player.vx = (player.vx + ax * 0.52) * 0.88;
    player.vy = (player.vy + ay * 0.52) * 0.88;
    limitSpeed(player, 4.2);
    player.x = clamp(player.x + player.vx, FIELD.playerR + 8, FIELD.w - FIELD.playerR - 8);
    player.y = clamp(player.y + player.vy, FIELD.playerR + 8, FIELD.h - FIELD.playerR - 8);
  }

  collidePlayers(players);
  for (const player of players) collideBallPlayer(state.ball, player);

  const ball = state.ball;
  limitSpeed(ball, 11.5);
  ball.x += ball.vx;
  ball.y += ball.vy;
  ball.vx *= 0.982;
  ball.vy *= 0.982;

  if (Math.abs(ball.vx) < 0.012) ball.vx = 0;
  if (Math.abs(ball.vy) < 0.012) ball.vy = 0;

  if (ball.y < FIELD.ballR || ball.y > FIELD.h - FIELD.ballR) {
    ball.y = clamp(ball.y, FIELD.ballR, FIELD.h - FIELD.ballR);
    ball.vy *= -0.82;
  }

  const inGoal = ball.y > FIELD.h / 2 - FIELD.goalH / 2 && ball.y < FIELD.h / 2 + FIELD.goalH / 2;
  if (ball.x < FIELD.ballR) {
    if (inGoal) {
      state.blue += 1;
      resetPositions(state);
    } else {
      ball.x = FIELD.ballR;
      ball.vx *= -0.82;
    }
  }

  if (ball.x > FIELD.w - FIELD.ballR) {
    if (inGoal) {
      state.red += 1;
      resetPositions(state);
    } else {
      ball.x = FIELD.w - FIELD.ballR;
      ball.vx *= -0.82;
    }
  }

  return state;
}

export function resetPositions(state) {
  state.ball = { x: FIELD.w / 2, y: FIELD.h / 2, vx: 0, vy: 0 };
  let redIndex = 0;
  let blueIndex = 0;
  for (const player of Object.values(state.players)) {
    if (player.team === 'spectators') continue;
    const position = spawn(player.team, player.team === 'red' ? redIndex++ : blueIndex++);
    player.x = position.x;
    player.y = position.y;
    player.vx = 0;
    player.vy = 0;
  }
}
