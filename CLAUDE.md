# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Workshop starter project for a multiplayer "coopetition" game. Players use their phones as controllers to play together on a single shared screen. Target audience: UX/UI 3rd year students — code must stay simple and readable.

## Commands

- `npm install` — install dependencies
- `npm start` — start the server (`node server.js`)
- `npm run dev` — start with auto-reload (`node --watch server.js`)

No test suite, no linter, no build step. Everything is vanilla HTML/CSS/JS served as static files.

## Architecture

The project has three parts that communicate via native WebSocket (`ws` package):

```
Phone (controller/) ---WebSocket---> server.js ---WebSocket---> Shared screen (game/)
```

- **`server.js`** — Express + `ws` (WebSocket) server. Holds the authoritative game state (a `players` object keyed by incremental ID). Serves both frontends as static files (`/controller` and `/game` routes). Broadcasts the full state to all clients on every change.
- **`controller/`** — Mobile-first UI. Two screens: join form (pseudo + team selection) then a D-pad with touch support. Emits `join` and `move` events to the server.
- **`game/`** — Display-only page for the projector/TV. Listens to `state` events and renders players as positioned DOM elements inside a fixed-size arena (1200×800). No user interaction.

## WebSocket Protocol

All messages are JSON: `{ type, data }`. No library on the client — uses the browser's native `WebSocket`.

| type | Direction | data |
|------|-----------|------|
| `join` | controller → server | `{ pseudo, team }` |
| `joined` | server → controller | player object (confirmation) |
| `move` | controller → server | `"up"` / `"down"` / `"left"` / `"right"` |
| `state` | server → all clients | `{ players, arena }` |

## Key Design Decisions

- State is server-authoritative: clients never modify positions locally.
- The `state` event broadcasts the entire players object (not deltas) — simple but doesn't scale past ~50 players.
- Players are DOM elements (not canvas) so students can style them with CSS.
- Two teams only: `"rouge"` and `"bleu"`.
