// =============================================================================
// CONTROLLER — script.js (telephone du joueur)
// =============================================================================
//
// Ce fichier gere la page affichee sur le telephone de chaque joueur.
// Il fait 3 choses :
//   1. Se connecter au serveur via WebSocket
//   2. Envoyer les actions du joueur (rejoindre, se deplacer)
//   3. Afficher les infos recues du serveur (scores, timer)
//
// =============================================================================

// --- Connexion WebSocket ---
// On se connecte au meme serveur qui nous a servi la page HTML.
// "location.host" contient l'adresse IP et le port (ex: "192.168.1.42:3000").
// Le prefixe "ws://" indique qu'on utilise le protocole WebSocket.
const ws = new WebSocket(`ws://${location.host}`);

// Fonction utilitaire pour envoyer un message au serveur.
// Tous nos messages suivent le format : { type: "...", data: ... }
function send(type, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, data }));
  }
}

// =============================================================================
// REFERENCES AUX ELEMENTS HTML (DOM)
// =============================================================================
// On recupere les elements HTML dont on a besoin pour les manipuler en JS.

const screenJoin = document.getElementById("screen-join"); // Ecran de connexion
const screenController = document.getElementById("screen-controller"); // Ecran manette
const screenGameover = document.getElementById("screen-gameover"); // Overlay fin de partie
const ctrlGameoverTitle = document.getElementById("ctrl-gameover-title");
const ctrlFinalRouge = document.getElementById("ctrl-final-rouge");
const ctrlFinalBleu = document.getElementById("ctrl-final-bleu");
const ctrlGameoverWinner = document.getElementById("ctrl-gameover-winner");
const ctrlCountdown = document.getElementById("ctrl-countdown");
const pseudoInput = document.getElementById("pseudo"); // Champ pseudo
const btnJoin = document.getElementById("btn-join"); // Bouton "Rejoindre"
const teamButtons = document.querySelectorAll(".team-btn"); // Boutons d'equipe
const playerPseudo = document.getElementById("player-pseudo"); // Affichage du pseudo
const playerTeam = document.getElementById("player-team"); // Affichage de l'equipe
const joystickBase = document.getElementById("joystick-base"); // Zone du joystick
const joystickStick = document.getElementById("joystick-stick"); // Stick mobile
const ctrlScoreRouge = document.getElementById("ctrl-score-rouge"); // Score rouge
const ctrlScoreBleu = document.getElementById("ctrl-score-bleu"); // Score bleu
const ctrlTimer = document.getElementById("ctrl-timer"); // Timer

// Equipe selectionnee (rouge par defaut)
let selectedTeam = "rouge";

// =============================================================================
// SELECTION DE L'EQUIPE
// =============================================================================
// Quand on clique sur un bouton d'equipe, on :
//   1. Retire la classe "selected" de tous les boutons
//   2. Ajoute "selected" au bouton clique
//   3. Met a jour la variable selectedTeam

teamButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    teamButtons.forEach((b) => b.classList.remove("selected"));
    btn.classList.add("selected");
    selectedTeam = btn.dataset.team; // Lit l'attribut data-team="rouge" ou "bleu"
  });
});

// =============================================================================
// REJOINDRE LA PARTIE
// =============================================================================
// Quand on clique sur "Rejoindre", on envoie un message "join" au serveur
// avec le pseudo et l'equipe choisie.

btnJoin.addEventListener("click", () => {
  const pseudo = pseudoInput.value.trim();

  // Validation : le pseudo ne peut pas etre vide
  if (!pseudo) {
    pseudoInput.style.borderColor = "#e94560"; // Bordure rouge pour signaler l'erreur
    pseudoInput.focus();
    return;
  }

  // Envoyer le message au serveur : { type: "join", data: { pseudo, team } }
  send("join", { pseudo, team: selectedTeam });
});

// =============================================================================
// FORMATER LE TEMPS
// =============================================================================
// Convertit des millisecondes en "M:SS" (ex: 125000 → "2:05")

function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000)); // Convertir ms en secondes
  const min = Math.floor(totalSec / 60); // Minutes
  const sec = totalSec % 60; // Secondes restantes
  return `${min}:${String(sec).padStart(2, "0")}`; // padStart ajoute un "0" devant si < 10
}

// =============================================================================
// RECEPTION DES MESSAGES DU SERVEUR
// =============================================================================
// Le serveur nous envoie des messages JSON. On les parse et on reagit
// en fonction du type de message.

ws.addEventListener("message", (event) => {
  const { type, data } = JSON.parse(event.data);

  // --- Message "joined" : le serveur confirme qu'on a rejoint ---
  // On bascule de l'ecran de connexion vers l'ecran manette
  if (type === "joined") {
    screenJoin.classList.add("hidden"); // Cacher le formulaire
    screenController.classList.remove("hidden"); // Afficher la manette

    // Afficher le pseudo et l'equipe sur l'ecran manette
    playerPseudo.textContent = data.pseudo;
    playerTeam.textContent = data.team;
    playerTeam.className = "badge " + data.team; // Ajoute la couleur de l'equipe
  }

  // --- Message "state" : mise a jour de l'etat du jeu ---
  // Recu toutes les secondes + a chaque mouvement d'un joueur.
  // On met a jour les scores et le timer sur le telephone.
  if (type === "state") {
    ctrlScoreRouge.textContent = data.scores.rouge;
    ctrlScoreBleu.textContent = data.scores.bleu;
    ctrlTimer.textContent = formatTime(data.timeLeft || 0);
    // Si la partie reprend, cacher l'overlay de fin
    if (data.phase === "playing") {
      screenGameover.classList.add("hidden");
    }
  }

  // --- Message "gameOver" : la partie est terminee ---
  // Afficher un overlay sur le controller avec le resultat et le compte a rebours.
  if (type === "gameOver") {
    const { scores, winner, restartIn } = data;

    ctrlFinalRouge.textContent = scores.rouge;
    ctrlFinalBleu.textContent = scores.bleu;

    if (winner === "egalite") {
      ctrlGameoverTitle.textContent = "Egalite !";
      ctrlGameoverWinner.textContent = "";
      ctrlGameoverWinner.className = "";
    } else {
      ctrlGameoverTitle.textContent = "Fin de la partie !";
      ctrlGameoverWinner.textContent =
        winner === "rouge" ? "Les Rouges gagnent !" : "Les Bleus gagnent !";
      ctrlGameoverWinner.className = winner;
    }

    // Compte a rebours avant la prochaine partie
    let remaining = Math.ceil(restartIn / 1000);
    ctrlCountdown.textContent = remaining;
    const interval = setInterval(() => {
      remaining--;
      ctrlCountdown.textContent = Math.max(0, remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);

    screenGameover.classList.remove("hidden");
  }
});

// =============================================================================
// JOYSTICK VIRTUEL : GESTION DU DEPLACEMENT
// =============================================================================
// Le joueur deplace le stick dans la zone circulaire.
// On calcule l'angle et la distance pour determiner la direction.
// Tant que le stick est deplace, on envoie des messages "move" en continu.
//
// On gere a la fois :
//   - Les events "touch" (pour les telephones)
//   - Les events "pointer" (pour tester sur un PC)

let joystickInterval = null; // Reference au setInterval
let currentVec = null; // Vecteur de direction actuel { x, y } normalise, ou null si au centre

// Rayon maximum de deplacement du stick (en pixels)
// La base fait 200px de diametre, le stick fait 80px → rayon max = (200-80)/2 = 60
const MAX_RADIUS = 60;

// Calcule la position du stick par rapport au centre de la base
// et retourne un vecteur normalise { x, y } entre -1 et 1 sur chaque axe,
// ou null si le stick est dans la zone morte (trop proche du centre).
function handleJoystickMove(clientX, clientY) {
  const rect = joystickBase.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  // Distance du doigt par rapport au centre
  let dx = clientX - centerX;
  let dy = clientY - centerY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Limiter le deplacement visuel au rayon maximum
  const clampedDx = dist > MAX_RADIUS ? (dx / dist) * MAX_RADIUS : dx;
  const clampedDy = dist > MAX_RADIUS ? (dy / dist) * MAX_RADIUS : dy;

  // Positionner le stick visuellement
  joystickStick.style.left = `calc(50% + ${clampedDx}px)`;
  joystickStick.style.top = `calc(50% + ${clampedDy}px)`;

  // Zone morte globale : si le doigt est trop proche du centre, aucun mouvement
  const DEAD_ZONE = 15;
  if (dist < DEAD_ZONE) return null;

  // Normaliser par rapport au rayon max → valeurs entre -1 et 1 sur chaque axe
  // Un deplacement diagonal a 45° donne ex: { x: 0.71, y: -0.71 }
  // Un deplacement pur vers la droite donne : { x: 1, y: 0 }
  const nx = Math.max(-1, Math.min(1, dx / MAX_RADIUS));
  const ny = Math.max(-1, Math.min(1, dy / MAX_RADIUS));

  return { x: nx, y: ny };
}

// Remet le stick au centre et arrete l'envoi
function resetJoystick() {
  joystickStick.style.left = "50%";
  joystickStick.style.top = "50%";
  joystickStick.classList.remove("active");
  currentVec = null;
  clearInterval(joystickInterval);
  joystickInterval = null;
}

// --- Debut du toucher : le doigt se pose sur le joystick ---
function onJoystickStart(e) {
  e.preventDefault();
  joystickStick.classList.add("active");

  // Recuperer les coordonnees du doigt (touch ou souris)
  const point = e.touches ? e.touches[0] : e;
  currentVec = handleJoystickMove(point.clientX, point.clientY);

  // Envoyer immediatement le vecteur si le stick est hors de la zone morte
  if (currentVec) send("move", currentVec);

  // Envoyer le vecteur en continu toutes les 50ms
  clearInterval(joystickInterval);
  joystickInterval = setInterval(() => {
    if (currentVec) send("move", currentVec);
  }, 50);
}

// --- Deplacement du doigt : le stick suit le doigt ---
function onJoystickMove(e) {
  e.preventDefault();
  const point = e.touches ? e.touches[0] : e;
  currentVec = handleJoystickMove(point.clientX, point.clientY);
}

// --- Fin du toucher : le doigt quitte le joystick ---
function onJoystickEnd(e) {
  e.preventDefault();
  resetJoystick();
}

// --- Events tactiles (telephones) ---
joystickBase.addEventListener("touchstart", onJoystickStart, {
  passive: false,
});
joystickBase.addEventListener("touchmove", onJoystickMove, { passive: false });
joystickBase.addEventListener("touchend", onJoystickEnd, { passive: false });
joystickBase.addEventListener("touchcancel", onJoystickEnd, { passive: false });

// --- Events souris (pour tester sur PC) ---
let mouseDown = false;
joystickBase.addEventListener("mousedown", (e) => {
  mouseDown = true;
  onJoystickStart(e);
});
window.addEventListener("mousemove", (e) => {
  if (mouseDown) onJoystickMove(e);
});
window.addEventListener("mouseup", (e) => {
  if (mouseDown) {
    mouseDown = false;
    onJoystickEnd(e);
  }
});
