# 🍎 Fruit Eater

Jeu multijoueur en temps réel de type **« coopétition »** : les joueurs utilisent leur **téléphone comme manette** pour jouer ensemble sur un **écran partagé** (projecteur / TV).

Deux équipes (🔴 Rouge vs 🔵 Bleu) s'affrontent pour ramasser un maximum de fruits dans une arène avant la fin du temps imparti.

## Comment ça marche

```
📱 Téléphone (manette)  ──WebSocket──▶  🖥️ Serveur  ──WebSocket──▶  📺 Écran partagé
     /controller                        server.js                      /game
```

1. L'**écran partagé** (`/game`) affiche l'arène, les joueurs, les fruits et les scores.
2. Chaque joueur rejoint depuis son **téléphone** (`/controller`), choisit un pseudo et une équipe, puis contrôle son personnage avec un D-pad tactile.
3. Le **serveur** gère toute la logique : positions, collisions, scores et timer.

## Lancer le jeu

```bash
# Installer les dépendances
npm install

# Démarrer le serveur
npm start

# Ou avec rechargement automatique (développement)
npm run dev
```

Le serveur démarre sur le port **3000**. L'adresse IP locale s'affiche dans la console.

## Accès

| Page | URL | Usage |
|------|-----|-------|
| Manette | `http://<IP>:3000/controller` | Ouvrir sur chaque téléphone |
| Écran de jeu | `http://<IP>:3000/game` | Afficher sur le projecteur / TV |

Un **QR code** pointant vers la manette est affiché sur l'écran de jeu pour faciliter la connexion des joueurs.

## Règles du jeu

- **2 équipes** : Rouge et Bleu.
- Des **fruits** (emoji) apparaissent aléatoirement dans l'arène.
- Un joueur ramasse un fruit en s'en approchant suffisamment → **+1 point** pour son équipe.
- La partie dure **5 minutes**. L'équipe avec le plus de points gagne.
- Une nouvelle partie redémarre automatiquement après **30 secondes**.
- La partie commence dès qu'un premier joueur rejoint.

## Structure du projet

```
fruit-eater/
├── server.js           # Serveur Express + WebSocket (logique de jeu)
├── package.json
├── controller/         # Interface mobile (manette)
│   ├── index.html
│   ├── script.js
│   └── style.css
└── game/               # Interface écran partagé (affichage)
    ├── index.html
    ├── script.js
    └── style.css
```

## Configuration

Les paramètres de jeu sont modifiables en haut de `server.js` :

| Constante | Défaut | Description |
|-----------|--------|-------------|
| `ARENA` | 1200 × 800 | Taille de l'arène en pixels |
| `SPEED` | 5 | Vitesse de déplacement (px par mouvement) |
| `GAME_DURATION` | 5 min | Durée d'une partie |
| `RESTART_DELAY` | 30 s | Délai avant relance automatique |
| `FRUIT_COUNT` | 5 | Nombre de fruits simultanés sur la carte |
| `PICKUP_DISTANCE` | 30 | Distance (px) pour ramasser un fruit |

## Technologies

- **Node.js** + **Express** — serveur HTTP et fichiers statiques
- **ws** — WebSocket natif côté serveur
- **WebSocket API** — côté navigateur (aucune librairie)
- **HTML / CSS / JS vanilla** — aucun framework front-end
- Les joueurs sont des éléments DOM (pas du canvas), stylisables en CSS
