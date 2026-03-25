// =============================================================================
// SERVEUR DE JEU — server.js
// =============================================================================
//
// Ce fichier est le "cerveau" du jeu. Il fait 3 choses :
//   1. Servir les pages web (controller + ecran de jeu) via Express
//   2. Gerer les connexions WebSocket (communication temps reel)
//   3. Stocker et mettre a jour l'etat du jeu (joueurs, fruits, scores, timer)
//
// Le serveur est AUTORITAIRE : c'est lui qui decide de la position des joueurs,
// des scores, etc. Les clients (telephones, ecran) ne font qu'afficher ce que
// le serveur leur envoie.
//
// =============================================================================

// --- Imports ---
// Express : framework web pour servir les fichiers HTML/CSS/JS
const express = require("express");
// createServer : cree un serveur HTTP a partir d'Express
const { createServer } = require("http");
// WebSocketServer : gere les connexions WebSocket (communication temps reel)
const { WebSocketServer } = require("ws");
// path : utilitaire pour construire des chemins de fichiers
const path = require("path");
// os : pour recuperer l'adresse IP locale de la machine
const os = require("os");

// --- Initialisation du serveur ---
const app = express(); // Application Express
const http = createServer(app); // Serveur HTTP qui enveloppe Express
const wss = new WebSocketServer({ server: http }); // Serveur WebSocket attache au serveur HTTP

const PORT = 3000;

// =============================================================================
// FICHIERS STATIQUES
// =============================================================================
// Express sert les dossiers "controller" et "game" comme des sites web statiques.
// Quand un telephone accede a http://IP:3000/controller, il recoit les fichiers
// du dossier "controller/" (index.html, style.css, script.js).
// Meme chose pour l'ecran de jeu avec /game.

app.use("/controller", express.static(path.join(__dirname, "controller")));
app.use("/game", express.static(path.join(__dirname, "game")));

// Si quelqu'un accede a la racine "/", on le redirige vers le controller
app.get("/", (req, res) => {
  res.redirect("/controller");
});

// =============================================================================
// CONFIGURATION DU JEU
// =============================================================================
// Toutes les constantes sont ici pour etre faciles a modifier.
// Changez ces valeurs pour ajuster le gameplay !

const ARENA = { width: 1200, height: 800 }; // Taille de l'arene en pixels
const SPEED = 15; // Vitesse de deplacement des joueurs (pixels par mouvement)
const GAME_DURATION = 1 * 60 * 1000; // Duree d'une partie : 1 minute (en ms)
const RESTART_DELAY = 10 * 1000; // Delai avant relance : 10 secondes (en ms)
const FRUIT_COUNT = 5; // Nombre de fruits presents en meme temps sur la map
const PICKUP_DISTANCE = 50; // Distance (en pixels) pour ramasser un fruit

const ENEMY_SPEED = 6; // Vitesse de l'ennemi (pixels par tick de physique)
const ENEMY_HIT_DISTANCE = 65; // Distance de collision ennemi-joueur (pixels)
const PLAYER_COLLISION_RADIUS = 35; // Rayon de collision joueur-joueur (pixels)
const BOUNCE_FORCE = 50; // Force du rebond entre joueurs (pixels)
const IMPULSE_DECAY = 0.72; // Deceleration de l'impulsion par tick (0 = stop, 1 = glisse)
const FRUITS_DROPPED = 5; // Fruits perdus quand touche par l'ennemi
const ENEMY_DIR_TICKS = 15; // Ticks entre chaque changement de direction de l'ennemi

// =============================================================================
// ETAT DU JEU
// =============================================================================
// Ces variables contiennent TOUT l'etat du jeu a un instant T.
// C'est le serveur qui modifie ces variables, puis les envoie aux clients.

let players = {}; // Objet contenant tous les joueurs { id: { id, pseudo, team, x, y } }
let fruits = {}; // Objet contenant tous les fruits { id: { id, emoji, x, y } }
let scores = { rouge: 0, bleu: 0 }; // Score de chaque equipe

// Phase de jeu :
//   "waiting" = en attente du premier joueur
//   "playing" = partie en cours
//   "ended"   = partie terminee, en attente de relance
let gamePhase = "waiting";

let gameEndTime = 0; // Timestamp (ms) de fin de partie
let restartTime = 0; // Timestamp (ms) de relance
let nextId = 1; // Compteur pour generer des IDs uniques de joueurs
let nextFruitId = 1; // Compteur pour generer des IDs uniques de fruits
let gameInterval = null; // Reference au setInterval du tick de jeu
let restartTimeout = null; // Reference au setTimeout de relance

let enemy = null; // L'ennemi unique { x, y, vx, vy, dirTick }
let physicsInterval = null; // setInterval du tick de physique (100ms)

// =============================================================================
// GESTION DES FRUITS
// =============================================================================

// Liste des emojis de fruits possibles
const FRUIT_TYPES = [
  "🍎",
  "🍊",
  "🍋",
  "🍇",
  "🍓",
  "🍑",
  "🍒",
  "🥝",
  "🍌",
  "🍐",
];

// Retourne un emoji de fruit au hasard
function randomFruitType() {
  return FRUIT_TYPES[Math.floor(Math.random() * FRUIT_TYPES.length)];
}

// Cree un nouveau fruit a une position aleatoire dans l'arene
function spawnFruit() {
  const id = String(nextFruitId++);
  fruits[id] = {
    id,
    emoji: randomFruitType(),
    // Position aleatoire avec une marge de 40px par rapport aux bords
    x: Math.floor(Math.random() * (ARENA.width - 80)) + 40,
    y: Math.floor(Math.random() * (ARENA.height - 80)) + 40,
  };
  return id;
}

// S'assure qu'il y a toujours FRUIT_COUNT fruits sur la map
// Si des fruits ont ete ramasces, en cree de nouveaux pour compenser
function fillFruits() {
  while (Object.keys(fruits).length < FRUIT_COUNT) {
    spawnFruit();
  }
}

// =============================================================================
// ENNEMI : deplacement aleatoire + collision avec les joueurs
// =============================================================================
// L'ennemi apparait au debut de chaque partie et se deplace en continu.
// Il rebondit sur les murs et change progressivement de direction.
// Si un joueur entre en contact avec lui, il perd ses fruits individuels.

// Cree l'ennemi a une position aleatoire avec une direction aleatoire
function spawnEnemy() {
  const angle = Math.random() * Math.PI * 2;
  enemy = {
    x: Math.floor(Math.random() * (ARENA.width - 200)) + 100,
    y: Math.floor(Math.random() * (ARENA.height - 200)) + 100,
    vx: Math.cos(angle) * ENEMY_SPEED,
    vy: Math.sin(angle) * ENEMY_SPEED,
    dirTick: 0, // Compteur de ticks pour le changement de direction
  };
}

// Deplace l'ennemi et gere ses rebonds sur les murs
function updateEnemy() {
  if (!enemy) return;

  enemy.x += enemy.vx;
  enemy.y += enemy.vy;

  // Rebond sur les bords de l'arene
  if (enemy.x < 40) {
    enemy.x = 40;
    enemy.vx = Math.abs(enemy.vx);
  }
  if (enemy.x > ARENA.width - 40) {
    enemy.x = ARENA.width - 40;
    enemy.vx = -Math.abs(enemy.vx);
  }
  if (enemy.y < 40) {
    enemy.y = 40;
    enemy.vy = Math.abs(enemy.vy);
  }
  if (enemy.y > ARENA.height - 40) {
    enemy.y = ARENA.height - 40;
    enemy.vy = -Math.abs(enemy.vy);
  }

  // Changement de direction progressif (virage, pas demi-tour brutal)
  enemy.dirTick++;
  if (enemy.dirTick >= ENEMY_DIR_TICKS) {
    enemy.dirTick = 0;
    const currentAngle = Math.atan2(enemy.vy, enemy.vx);
    const turn = (Math.random() - 0.5) * Math.PI; // Virage aleatoire de ±90°
    const newAngle = currentAngle + turn;
    enemy.vx = Math.cos(newAngle) * ENEMY_SPEED;
    enemy.vy = Math.sin(newAngle) * ENEMY_SPEED;
  }
}

// Verifie si l'ennemi touche un joueur
// Si oui : le joueur perd ses fruits individuels (repartis sur la map) et est repousse
function checkEnemyCollisions() {
  if (!enemy) return;

  for (const player of Object.values(players)) {
    if ((player.hitCooldown || 0) > 0) continue; // Invincibilite temporaire

    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < ENEMY_HIT_DISTANCE) {
      const toDrop = Math.min(player.fruits || 0, FRUITS_DROPPED);

      // Faire eclater les fruits a proximite du joueur
      for (let i = 0; i < toDrop; i++) {
        const fid = String(nextFruitId++);
        fruits[fid] = {
          id: fid,
          emoji: randomFruitType(),
          x: Math.max(
            40,
            Math.min(ARENA.width - 40, player.x + (Math.random() - 0.5) * 130),
          ),
          y: Math.max(
            40,
            Math.min(ARENA.height - 40, player.y + (Math.random() - 0.5) * 130),
          ),
        };
      }

      // Deduire de la cagnotte du joueur et du score d'equipe
      if (toDrop > 0) {
        player.fruits -= toDrop;
        scores[player.team] = Math.max(0, scores[player.team] - toDrop);
        console.log(
          `${player.pseudo} touche par l'ennemi ! ${toDrop} fruits perdus.`,
        );
      }

      // Repousser le joueur (impulsion s'eloignant de l'ennemi)
      if (dist > 0) {
        player.impulseX = (player.impulseX || 0) + (dx / dist) * BOUNCE_FORCE;
        player.impulseY = (player.impulseY || 0) + (dy / dist) * BOUNCE_FORCE;
      }

      // Invincibilite de 2 secondes (20 ticks a 100ms) pour eviter les hits en rafale
      player.hitCooldown = 20;
    }
  }
}

// =============================================================================
// COLLISIONS JOUEUR / JOUEUR : REBOND
// =============================================================================
// Quand deux joueurs se touchent, ils se repoussent mutuellement.
// L'impulsion permet de strategiquement pousser un adversaire vers l'ennemi !

function checkPlayerCollisions() {
  const list = Object.values(players);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];

      // Ignorer si l'un des deux est en cooldown de rebond
      if ((a.bounceCooldown || 0) > 0 || (b.bounceCooldown || 0) > 0) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < PLAYER_COLLISION_RADIUS * 2 && dist > 0.1) {
        const nx = dx / dist; // Vecteur normalise de la collision
        const ny = dy / dist;

        // Appliquer une impulsion opposee aux deux joueurs
        a.impulseX = (a.impulseX || 0) - nx * BOUNCE_FORCE;
        a.impulseY = (a.impulseY || 0) - ny * BOUNCE_FORCE;
        b.impulseX = (b.impulseX || 0) + nx * BOUNCE_FORCE;
        b.impulseY = (b.impulseY || 0) + ny * BOUNCE_FORCE;

        // Separer les joueurs pour qu'ils ne se superposent pas
        const overlap = (PLAYER_COLLISION_RADIUS * 2 - dist) / 2;
        a.x = Math.max(0, Math.min(ARENA.width, a.x - nx * overlap));
        a.y = Math.max(0, Math.min(ARENA.height, a.y - ny * overlap));
        b.x = Math.max(0, Math.min(ARENA.width, b.x + nx * overlap));
        b.y = Math.max(0, Math.min(ARENA.height, b.y + ny * overlap));

        // Cooldown pour eviter les rebonds en boucle (5 ticks = 500ms)
        a.bounceCooldown = 5;
        b.bounceCooldown = 5;

        console.log(`Rebond : ${a.pseudo} <-> ${b.pseudo}`);
      }
    }
  }
}

// Applique et decroit l'impulsion de chaque joueur a chaque tick de physique
function applyImpulses() {
  for (const player of Object.values(players)) {
    // Decrementer les cooldowns
    if (player.hitCooldown > 0) player.hitCooldown--;
    if (player.bounceCooldown > 0) player.bounceCooldown--;

    // Appliquer l'impulsion si elle est non nulle
    if ((player.impulseX || 0) !== 0 || (player.impulseY || 0) !== 0) {
      player.x = Math.max(0, Math.min(ARENA.width, player.x + player.impulseX));
      player.y = Math.max(
        0,
        Math.min(ARENA.height, player.y + player.impulseY),
      );

      // Deceleration progressive
      player.impulseX *= IMPULSE_DECAY;
      player.impulseY *= IMPULSE_DECAY;

      // Arreter l'impulsion quand elle est negligeable
      if (Math.abs(player.impulseX) < 0.5) player.impulseX = 0;
      if (Math.abs(player.impulseY) < 0.5) player.impulseY = 0;

      // Un joueur peut ramasser des fruits meme pendant un rebond
      checkPickup(player);
    }
  }
}

// Le tick de physique est appele toutes les 100ms :
// il gere l'ennemi, les collisions et les impulsions
function physicsTick() {
  updateEnemy();
  checkEnemyCollisions();
  checkPlayerCollisions();
  applyImpulses();
  broadcastState();
}

// =============================================================================
// COLLISION JOUEUR / FRUIT
// =============================================================================
// Verifie si un joueur est assez proche d'un fruit pour le ramasser.
// On utilise la distance euclidienne (theoreme de Pythagore) :
//   distance = racine( (x2-x1)² + (y2-y1)² )

function checkPickup(player) {
  for (const [id, fruit] of Object.entries(fruits)) {
    const dx = player.x - fruit.x; // Distance horizontale
    const dy = player.y - fruit.y; // Distance verticale
    const distance = Math.sqrt(dx * dx + dy * dy); // Distance reelle

    if (distance < PICKUP_DISTANCE) {
      // Le joueur est assez proche : il ramasse le fruit !
      scores[player.team]++; // +1 point pour son equipe
      player.fruits = (player.fruits || 0) + 1; // Cagnotte individuelle du joueur
      console.log(
        `${player.pseudo} a ramasse un fruit ! (${player.team}: ${scores[player.team]})`,
      );
      delete fruits[id]; // Supprime le fruit ramasse
      fillFruits(); // S'assure qu'il y a toujours assez de fruits
      return true; // Un fruit a ete ramasse
    }
  }
  return false; // Aucun fruit ramasse
}

// =============================================================================
// GESTION DE LA PARTIE (START / END / RESTART)
// =============================================================================

// Demarre une nouvelle partie
function startGame() {
  // Remettre les scores a zero
  scores = { rouge: 0, bleu: 0 };

  // Regenerer tous les fruits
  fruits = {};
  fillFruits();

  // Passer en phase de jeu
  gamePhase = "playing";
  gameEndTime = Date.now() + GAME_DURATION; // Calcule quand la partie se termine

  // Repositionner les joueurs et reinitialiser leurs proprietes de physique
  for (const player of Object.values(players)) {
    player.x = Math.floor(Math.random() * (ARENA.width - 100)) + 50;
    player.y = Math.floor(Math.random() * (ARENA.height - 100)) + 50;
    player.fruits = 0; // Cagnotte individuelle
    player.impulseX = 0; // Impulsion horizontale (rebond)
    player.impulseY = 0; // Impulsion verticale (rebond)
    player.hitCooldown = 0; // Invincibilite apres un hit de l'ennemi
    player.bounceCooldown = 0; // Cooldown apres un rebond joueur-joueur
  }

  // Faire apparaitre l'ennemi
  spawnEnemy();

  console.log("--- Partie lancee ! ---");
  broadcastState();

  // Tick de jeu : verifie si la partie est terminee (toutes les secondes)
  gameInterval = setInterval(() => {
    if (Date.now() >= gameEndTime) {
      endGame();
    } else {
      fillFruits();
      broadcastState();
    }
  }, 1000);

  // Tick de physique : ennemi + collisions + impulsions (toutes les 100ms)
  physicsInterval = setInterval(physicsTick, 100);
}

// Termine la partie en cours
function endGame() {
  // Arreter les ticks de jeu et de physique
  clearInterval(gameInterval);
  gameInterval = null;
  clearInterval(physicsInterval);
  physicsInterval = null;

  // Supprimer l'ennemi
  enemy = null;

  // Passer en phase "terminee"
  gamePhase = "ended";
  restartTime = Date.now() + RESTART_DELAY;

  // Determiner le gagnant
  const winner =
    scores.rouge > scores.bleu
      ? "rouge"
      : scores.bleu > scores.rouge
        ? "bleu"
        : "egalite";

  console.log(
    `--- Partie terminee ! Rouge: ${scores.rouge} | Bleu: ${scores.bleu} | Gagnant: ${winner} ---`,
  );

  // Envoyer l'ecran de fin a tous les clients
  broadcast("gameOver", {
    scores,
    winner,
    restartIn: RESTART_DELAY, // Temps avant relance (en ms)
  });

  // Programmer la relance automatique apres RESTART_DELAY
  restartTimeout = setTimeout(() => {
    startGame();
  }, RESTART_DELAY);
}

// =============================================================================
// ENVOI DE MESSAGES WEBSOCKET
// =============================================================================
//
// Le protocole est simple : tous les messages sont du JSON avec cette structure :
//   { type: "nomDuMessage", data: { ... } }
//
// Par exemple : { type: "move", data: "up" }
//              { type: "state", data: { players, fruits, scores, ... } }

// Envoie un message a UN SEUL client
function send(ws, type, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, data }));
  }
}

// Envoie un message a TOUS les clients connectes (broadcast)
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(msg);
    }
  });
}

// Envoie l'etat complet du jeu a tous les clients
// C'est cette fonction qui est appelee a chaque changement dans le jeu
function broadcastState() {
  broadcast("state", {
    players, // Tous les joueurs avec leurs positions
    fruits, // Tous les fruits avec leurs positions
    scores, // Scores des deux equipes
    arena: ARENA, // Dimensions de l'arene
    phase: gamePhase, // Phase actuelle (waiting/playing/ended)
    enemy, // L'ennemi (null si pas en cours)
    timeLeft:
      gamePhase === "playing" ? Math.max(0, gameEndTime - Date.now()) : 0,
  });
}

// =============================================================================
// GESTION DES CONNEXIONS WEBSOCKET
// =============================================================================
// Chaque fois qu'un client (telephone ou ecran) se connecte, ce code s'execute.
// Le serveur ecoute les messages du client et reagit en consequence.

wss.on("connection", (ws) => {
  // Attribuer un ID unique a ce client
  const id = String(nextId++);
  ws._playerId = id;
  console.log(`Connexion: ${id}`);

  // --- Reception des messages du client ---
  ws.on("message", (raw) => {
    // Parser le message JSON
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // Message invalide, on l'ignore
    }

    const { type, data } = msg;

    // ----- MESSAGE "join" : un joueur veut rejoindre la partie -----
    if (type === "join") {
      // Creer le joueur avec une position aleatoire
      players[id] = {
        id,
        pseudo: data.pseudo || "Anonyme",
        team: data.team || "rouge",
        x: Math.floor(Math.random() * (ARENA.width - 100)) + 50,
        y: Math.floor(Math.random() * (ARENA.height - 100)) + 50,
        fruits: 0, // Cagnotte individuelle de fruits
        impulseX: 0, // Impulsion de rebond horizontale
        impulseY: 0, // Impulsion de rebond verticale
        hitCooldown: 0, // Invincibilite apres hit de l'ennemi
        bounceCooldown: 0, // Cooldown apres rebond joueur-joueur
      };

      console.log(
        `${players[id].pseudo} (${players[id].team}) a rejoint la partie`,
      );

      // Confirmer au joueur qu'il a bien rejoint (pour changer d'ecran sur son tel)
      send(ws, "joined", players[id]);

      // Si c'est le premier joueur et qu'on attend, lancer la partie
      if (gamePhase === "waiting" && Object.keys(players).length >= 1) {
        startGame();
      } else {
        // Sinon, juste informer tout le monde du nouvel etat
        broadcastState();
      }
    }

    // ----- MESSAGE "move" : un joueur veut se deplacer -----
    // On ne traite les mouvements que pendant la phase de jeu
    // "data" est desormais un vecteur { x, y } normalise entre -1 et 1
    if (type === "move" && gamePhase === "playing") {
      const player = players[id];
      if (!player) return; // Joueur inconnu

      // Valider et extraire le vecteur (securite : on borne a [-1, 1])
      const vx = Math.max(-1, Math.min(1, Number(data.x) || 0));
      const vy = Math.max(-1, Math.min(1, Number(data.y) || 0));

      // Appliquer le deplacement proportionnel au vecteur
      // Un stick a fond (1.0) donne la vitesse maximale SPEED
      // Un stick a mi-course (0.5) donne la moitie de la vitesse
      player.x = Math.max(0, Math.min(ARENA.width, player.x + vx * SPEED));
      player.y = Math.max(0, Math.min(ARENA.height, player.y + vy * SPEED));

      // Stocker la direction pour que le client jeu puisse orienter le Minion
      player.dirX = vx;
      player.dirY = vy;

      // Verifier si le joueur ramasse un fruit apres son deplacement
      checkPickup(player);

      // Envoyer le nouvel etat a tout le monde
      broadcastState();
    }
  });

  // --- Deconnexion d'un client ---
  ws.on("close", () => {
    if (players[id]) {
      console.log(`${players[id].pseudo} a quitte la partie`);
      delete players[id]; // Retirer le joueur de l'etat du jeu
      broadcastState(); // Informer tout le monde
    }
  });
});

// =============================================================================
// DEMARRAGE DU SERVEUR
// =============================================================================

http.listen(PORT, () => {
  // Trouver l'adresse IP locale de la machine sur le reseau WiFi
  // C'est cette IP que les joueurs utiliseront pour se connecter
  const nets = os.networkInterfaces();
  let localIP = "localhost";
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // On cherche une adresse IPv4 qui n'est pas "localhost" (127.0.0.1)
      if (net.family === "IPv4" && !net.internal) {
        localIP = net.address;
        break;
      }
    }
  }

  console.log("");
  console.log("===========================================");
  console.log("  SERVEUR DEMARRE !");
  console.log("===========================================");
  console.log("");
  console.log(`  Ecran de jeu : http://${localIP}:${PORT}/game`);
  console.log(`  Controller   : http://${localIP}:${PORT}/controller`);
  console.log("");
  console.log("  (Partagez le lien controller aux joueurs)");
  console.log("===========================================");
  console.log("");
});
