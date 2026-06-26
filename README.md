# Pro Ball

A HaxBall-inspired virtual soccer game for workplace World Cup fun.

## Features

- 22 player room capacity
- Red, Blue and Spectator teams
- Room creation, room code sharing and optional password
- Realtime multiplayer via WebSocket when deployed with the Node server
- Top-down field, ball physics, kicking, goals, score and timer
- Host controls: start, pause and reset

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000

## Test

```bash
npm test
```

## Deploy

### Render

Create a Render Web Service from this repo. Use:

- Build command: `npm install`
- Start command: `npm start`

### Vercel / GitHub Pages

These can host the static frontend, but full multiplayer needs the WebSocket server. The simplest full multiplayer deployment is Render, because it serves both the frontend and the realtime server.

## Note

This is inspired by HaxBall-style gameplay, not a copy of HaxBall branding or assets.
