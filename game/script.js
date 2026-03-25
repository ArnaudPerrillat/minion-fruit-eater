// =============================================================================
// ECRAN DE JEU 3D — script.js (affiche sur le projecteur / TV)
// =============================================================================
//
// Ce fichier gere l'affichage du jeu en 3D sur l'ecran partage.
// Il utilise Three.js pour creer une scene 3D avec des personnages Minions.
// Il ne fait qu'AFFICHER : aucune logique de jeu ici, tout vient du serveur.
//
// Il fait 4 choses :
//   1. Se connecter au serveur via WebSocket
//   2. Creer la scene 3D (camera, lumieres, sol, bordures)
//   3. Creer des personnages Minions 3D pour chaque joueur
//   4. Afficher les fruits, scores, timer, et ecran de fin
//
// =============================================================================

// --- Connexion WebSocket ---
const ws = new WebSocket(`ws://${location.host}`);

// =============================================================================
// QR CODE
// =============================================================================

(function generateQRCode() {
  const controllerURL = `http://${location.host}/controller`;
  const qr = qrcode(0, "L");
  qr.addData(controllerURL);
  qr.make();
  document.getElementById("qr-code").innerHTML = qr.createImgTag(4, 0);
})();

// =============================================================================
// REFERENCES AUX ELEMENTS HTML (HUD, game over, QR code)
// =============================================================================

const waiting = document.getElementById("waiting");
const scoreRouge = document.getElementById("score-rouge");
const scoreBleu = document.getElementById("score-bleu");
const timerEl = document.getElementById("timer");
const screenGameover = document.getElementById("screen-gameover");
const gameoverTitle = document.getElementById("gameover-title");
const finalRouge = document.getElementById("final-rouge");
const finalBleu = document.getElementById("final-bleu");
const restartCountdown = document.getElementById("restart-countdown");

// =============================================================================
// CONFIGURATION 3D
// =============================================================================
// L'arene du serveur fait 1200x800 pixels.
// En 3D, on la represente comme un plan de 12x8 unites.
// Les coordonnees sont converties : x:[0,1200] → [-6,6], y:[0,800] → [-4,4]

const ARENA_3D_W = 12;
const ARENA_3D_H = 8;

// Convertit les coordonnees 2D du serveur en coordonnees 3D
function toWorld(x2d, y2d) {
  return {
    x: (x2d - 600) / 100, // [0, 1200] → [-6, 6]
    z: (y2d - 400) / 100, // [0, 800]  → [-4, 4]
  };
}

// =============================================================================
// SCENE THREE.JS
// =============================================================================
// On cree la scene 3D : un espace virtuel avec une camera, des lumieres,
// un sol, et des bordures. Les joueurs et fruits seront ajoutes dynamiquement.

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f0f23); // Fond sombre (meme couleur que le CSS)
scene.fog = new THREE.FogExp2(0x0f0f23, 0.035); // Brouillard pour un effet de profondeur

// --- Camera ---
// Vue en plongee (3/4 dessus) pour voir toute l'arene
const camera = new THREE.PerspectiveCamera(
  50, // Champ de vision (degres)
  window.innerWidth / window.innerHeight, // Ratio largeur/hauteur
  0.1, // Distance minimum de rendu
  100, // Distance maximum de rendu
);
camera.position.set(0, 14, 9); // Position : au-dessus et un peu en arriere
camera.lookAt(0, 0, 0); // Regarde le centre de l'arene

// --- Renderer ---
// Le moteur de rendu 3D qui dessine la scene dans un canvas HTML
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limite pour les performances
renderer.shadowMap.enabled = true; // Active les ombres
renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Ombres douces
document.getElementById("game-container").appendChild(renderer.domElement);

// --- Responsive ---
// Quand la fenetre change de taille, on ajuste la camera et le renderer
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =============================================================================
// LUMIERES
// =============================================================================
// Deux types de lumiere pour un eclairage realiste :
// - Ambiante : lumiere douce partout (pas d'ombre)
// - Directionnelle : lumiere du "soleil" qui cree des ombres

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(5, 12, 8);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048); // Resolution de l'ombre
dirLight.shadow.camera.left = -8;
dirLight.shadow.camera.right = 8;
dirLight.shadow.camera.top = 6;
dirLight.shadow.camera.bottom = -6;
scene.add(dirLight);

// Petite lumiere d'appoint pour adoucir les ombres
const fillLight = new THREE.DirectionalLight(0x4ea8de, 0.3);
fillLight.position.set(-5, 8, -5);
scene.add(fillLight);

// =============================================================================
// SOL DE L'ARENE
// =============================================================================

// Plan du sol
const groundGeo = new THREE.PlaneGeometry(ARENA_3D_W + 1, ARENA_3D_H + 1);
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x16213e,
  roughness: 0.8,
  metalness: 0.1,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2; // Coucher le plan a l'horizontale
ground.receiveShadow = true; // Le sol recoit les ombres des personnages
scene.add(ground);

// Grille decorative sur le sol
const gridHelper = new THREE.GridHelper(12, 24, 0x333366, 0x1a1a3e);
gridHelper.position.y = 0.01; // Legerement au-dessus du sol
scene.add(gridHelper);

// Bordure lumineuse de l'arene (lignes bleues)
const borderGeo = new THREE.EdgesGeometry(
  new THREE.BoxGeometry(ARENA_3D_W + 0.2, 0.25, ARENA_3D_H + 0.2),
);
const borderLine = new THREE.LineSegments(
  borderGeo,
  new THREE.LineBasicMaterial({ color: 0x4444aa, linewidth: 2 }),
);
borderLine.position.y = 0.125;
scene.add(borderLine);

// =============================================================================
// CREATION D'UN MINION 3D
// =============================================================================
// Chaque joueur est represente par un petit personnage Minion construit
// a partir de formes geometriques simples (capsules, spheres, cylindres).
// La couleur de la salopette indique l'equipe (rouge ou bleu).

function createMinion(team) {
  const group = new THREE.Group();

  // Couleur de l'equipe pour la salopette
  const teamColor = team === "rouge" ? 0xe94560 : 0x4ea8de;
  const yellow = 0xffd93d; // Jaune Minion classique

  // --- Corps principal (capsule jaune) ---
  const bodyMat = new THREE.MeshStandardMaterial({
    color: yellow,
    roughness: 0.6,
  });
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 0.45, 8, 16),
    bodyMat,
  );
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);

  // --- Salopette (cylindre colore en bas du corps) ---
  const overallsMat = new THREE.MeshStandardMaterial({
    color: teamColor,
    roughness: 0.5,
  });
  const overalls = new THREE.Mesh(
    new THREE.CylinderGeometry(0.29, 0.26, 0.3, 16),
    overallsMat,
  );
  overalls.position.y = 0.25;
  overalls.castShadow = true;
  group.add(overalls);

  // --- Bretelles de la salopette ---
  const strapMat = new THREE.MeshStandardMaterial({
    color: teamColor,
    roughness: 0.5,
  });
  [-0.1, 0.1].forEach((xOff) => {
    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.3, 0.04),
      strapMat,
    );
    strap.position.set(xOff, 0.52, -0.22);
    group.add(strap);
  });

  // --- Lunette (cadre metallique) ---
  const goggleMat = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa,
    metalness: 0.8,
    roughness: 0.2,
  });
  const goggleFrame = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.12, 32),
    goggleMat,
  );
  goggleFrame.rotation.x = Math.PI / 2; // Tourner vers l'avant
  goggleFrame.position.set(0, 0.78, 0.23);
  group.add(goggleFrame);

  // --- Sangle de la lunette (bande noire autour de la tete) ---
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.29, 0.03, 8, 32),
    bandMat,
  );
  band.rotation.x = Math.PI / 2; // Horizontal autour de la tete
  band.position.y = 0.78;
  group.add(band);

  // --- Oeil (sphere blanche + pupille marron) ---
  const eyeWhite = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  eyeWhite.position.set(0, 0.78, 0.28);
  group.add(eyeWhite);

  const pupil = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0x3d2b1f }),
  );
  pupil.position.set(0, 0.79, 0.37);
  group.add(pupil);

  // --- Bouche (petit trait sombre) ---
  const mouth = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.02, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x333333 }),
  );
  mouth.position.set(0, 0.62, 0.27);
  group.add(mouth);

  // --- Bras (petites capsules jaunes sur les cotes) ---
  [-0.36, 0.36].forEach((xOff) => {
    const arm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.065, 0.2, 4, 8),
      bodyMat, // Meme jaune que le corps
    );
    arm.position.set(xOff, 0.38, 0);
    arm.castShadow = true;
    group.add(arm);
  });

  // --- Pieds (petites spheres noires) ---
  const footMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.8,
  });
  [-0.1, 0.1].forEach((xOff) => {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), footMat);
    foot.position.set(xOff, 0.05, 0.05);
    foot.castShadow = true;
    group.add(foot);
  });

  // --- Cheveux (petits "tubes" sur le dessus de la tete) ---
  for (let i = 0; i < 3; i++) {
    const hair = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 0.15, 4),
      new THREE.MeshStandardMaterial({ color: 0x222222 }),
    );
    hair.position.set(-0.05 + i * 0.05, 1.02, 0);
    hair.rotation.z = (Math.random() - 0.5) * 0.4;
    group.add(hair);
  }

  // --- Ombre au sol (cercle sombre transparent) ---
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 16),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.25,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  group.add(shadow);

  return group;
}

// =============================================================================
// ETIQUETTE DE NOM (Sprite au-dessus du Minion)
// =============================================================================
// On dessine le pseudo sur un canvas 2D, puis on utilise cette image
// comme texture pour un Sprite 3D qui flotte au-dessus du personnage.

function createNameSprite(pseudo, team) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 256;
  canvas.height = 64;

  ctx.font = "bold 30px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Ombre du texte pour la lisibilite
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillText(pseudo, 129, 34);
  // Texte principal (blanc)
  ctx.fillStyle = team === "rouge" ? "#ff8a9e" : "#8ecaf6";
  ctx.fillText(pseudo, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true }),
  );
  sprite.scale.set(1.4, 0.35, 1);
  sprite.position.y = 1.5; // Au-dessus de la tete
  return sprite;
}

// =============================================================================
// SPRITE DE FRUIT (emoji flottant en 3D)
// =============================================================================
// On dessine l'emoji du fruit sur un canvas, puis on cree un Sprite 3D.

function createFruitSprite(emoji) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 64;
  canvas.height = 64;

  ctx.font = "48px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 32, 36);

  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true }),
  );
  sprite.scale.set(0.7, 0.7, 0.7);
  return sprite;
}

// =============================================================================
// HALO LUMINEUX SOUS LES FRUITS
// =============================================================================

function createFruitGlow() {
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.25, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffee58,
      transparent: true,
      opacity: 0.2,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.02;
  return glow;
}

// =============================================================================
// CREATION DE L'ENNEMI 3D (minion sinistre violet et rouge)
// =============================================================================
// L'ennemi est plus grand que les joueurs, avec un oeil rouge brillant,
// des pointes sur la tete et un halo rouge au sol.
// La fonction retourne { group, halo } pour pouvoir animer le halo separement.

function createEnemyMesh() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x2a0a3a,
    roughness: 0.5,
  });
  const accentColor = 0xff1133;

  // Corps (plus grand que les joueurs, violet tres sombre)
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.34, 0.55, 8, 16),
    bodyMat,
  );
  body.position.y = 0.65;
  body.castShadow = true;
  group.add(body);

  // Bas du corps
  const belly = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.3, 0.3, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a0028, roughness: 0.6 }),
  );
  belly.position.y = 0.28;
  belly.castShadow = true;
  group.add(belly);

  // Cadre de lunette rouge
  const goggle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.12, 32),
    new THREE.MeshStandardMaterial({
      color: accentColor,
      metalness: 0.7,
      roughness: 0.2,
    }),
  );
  goggle.rotation.x = Math.PI / 2;
  goggle.position.set(0, 0.88, 0.28);
  group.add(goggle);

  // Sangle noire
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(0.36, 0.035, 8, 32),
    new THREE.MeshStandardMaterial({ color: 0x111111 }),
  );
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.88;
  group.add(band);

  // Oeil rouge brillant (emissive = il brille dans le noir)
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 16, 16),
    new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff2200,
      emissiveIntensity: 0.8,
    }),
  );
  eye.position.set(0, 0.88, 0.34);
  group.add(eye);

  // Pupille noire
  const pupil = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0x000000 }),
  );
  pupil.position.set(0, 0.89, 0.44);
  group.add(pupil);

  // Pointes rouges sur la tete (5 spikes)
  const spikeMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.4,
  });
  for (let i = 0; i < 5; i++) {
    const spike = new THREE.Mesh(
      new THREE.ConeGeometry(0.055, 0.28, 6),
      spikeMat,
    );
    spike.position.set(
      Math.sin((i / 5) * Math.PI * 2) * 0.2,
      1.18 + (i % 2) * 0.06,
      Math.cos((i / 5) * Math.PI * 2) * 0.08,
    );
    spike.rotation.z = Math.sin((i / 5) * Math.PI * 2) * 0.5;
    group.add(spike);
  }

  // Bras (sombres)
  [-0.44, 0.44].forEach((xOff) => {
    const arm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.08, 0.22, 4, 8),
      bodyMat,
    );
    arm.position.set(xOff, 0.45, 0);
    arm.castShadow = true;
    group.add(arm);
  });

  // Pieds
  const footMat = new THREE.MeshStandardMaterial({ color: 0x0a0010 });
  [-0.13, 0.13].forEach((xOff) => {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), footMat);
    foot.position.set(xOff, 0.06, 0.06);
    foot.castShadow = true;
    group.add(foot);
  });

  // Halo rouge au sol (pulse en permanence)
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.15,
  });
  const halo = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32), haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.01;
  group.add(halo);

  return { group, halo }; // On retourne les deux pour pouvoir animer le halo
}

// =============================================================================
// ETAT DU JEU
// =============================================================================
// On garde en memoire les objets 3D crees pour chaque joueur et fruit.

const playerObjects = {}; // id → { group, targetX, targetZ, currentX, currentZ, targetRotY }
const fruitObjects = {}; // id → { sprite, glow }
let enemyObject = null; // { group, halo, currentX, currentZ, targetX, targetZ, targetRotY }

let timeLeft = 0;

function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

// =============================================================================
// RECEPTION DES MESSAGES DU SERVEUR
// =============================================================================

ws.addEventListener("message", (event) => {
  const { type, data } = JSON.parse(event.data);

  // =========================================================================
  // MESSAGE "state" : mise a jour complete de l'etat du jeu
  // =========================================================================

  if (type === "state") {
    const { players, fruits, scores, phase } = data;
    timeLeft = data.timeLeft || 0;

    // --- Cacher l'ecran game over si la partie reprend ---
    if (phase === "playing") {
      screenGameover.classList.add("hidden");
    }

    // --- Message "En attente de joueurs..." ---
    const ids = Object.keys(players);
    waiting.style.display =
      ids.length === 0 && phase === "waiting" ? "flex" : "none";

    // --- Timer ---
    timerEl.textContent = formatTime(timeLeft);
    timerEl.classList.toggle("urgent", timeLeft < 30000 && timeLeft > 0);

    // --- Scores dans le HUD ---
    scoreRouge.textContent = scores.rouge;
    scoreBleu.textContent = scores.bleu;

    // -----------------------------------------------------------------
    // MISE A JOUR DES JOUEURS (Minions 3D)
    // -----------------------------------------------------------------

    ids.forEach((id) => {
      const p = players[id];
      const worldPos = toWorld(p.x, p.y);

      // Creer le Minion s'il n'existe pas encore
      if (!playerObjects[id]) {
        const group = createMinion(p.team);
        const nameSprite = createNameSprite(p.pseudo, p.team);
        group.add(nameSprite);
        scene.add(group);
        group.position.set(worldPos.x, 0, worldPos.z);

        playerObjects[id] = {
          group,
          targetX: worldPos.x,
          targetZ: worldPos.z,
          currentX: worldPos.x,
          currentZ: worldPos.z,
          targetRotY: 0,
        };
      }

      // Mettre a jour la position cible (l'interpolation se fait dans animate())
      const obj = playerObjects[id];
      obj.targetX = worldPos.x;
      obj.targetZ = worldPos.z;

      // Orienter le Minion selon le vecteur de direction du serveur
      // dirX = axe horizontal (2D) = axe X en 3D
      // dirY = axe vertical (2D) = axe Z en 3D
      if (
        p.dirX !== undefined &&
        (Math.abs(p.dirX) > 0.05 || Math.abs(p.dirY) > 0.05)
      ) {
        obj.targetRotY = Math.atan2(p.dirX, p.dirY);
      }
    });

    // Supprimer les joueurs deconnectes
    Object.keys(playerObjects).forEach((id) => {
      if (!players[id]) {
        scene.remove(playerObjects[id].group);
        delete playerObjects[id];
      }
    });

    // -----------------------------------------------------------------
    // MISE A JOUR DES FRUITS (sprites emoji 3D)
    // -----------------------------------------------------------------

    const fruitIds = Object.keys(fruits);

    fruitIds.forEach((id) => {
      const f = fruits[id];
      const worldPos = toWorld(f.x, f.y);

      if (!fruitObjects[id]) {
        const sprite = createFruitSprite(f.emoji);
        sprite.position.set(worldPos.x, 0.5, worldPos.z);
        scene.add(sprite);

        const glow = createFruitGlow();
        glow.position.set(worldPos.x, 0.02, worldPos.z);
        scene.add(glow);

        fruitObjects[id] = { sprite, glow };
      }

      fruitObjects[id].sprite.position.set(worldPos.x, 0.5, worldPos.z);
      fruitObjects[id].glow.position.set(worldPos.x, 0.02, worldPos.z);
    });

    // Supprimer les fruits ramasces
    Object.keys(fruitObjects).forEach((id) => {
      if (!fruits[id]) {
        scene.remove(fruitObjects[id].sprite);
        scene.remove(fruitObjects[id].glow);
        delete fruitObjects[id];
      }
    });

    // -----------------------------------------------------------------
    // MISE A JOUR DE L'ENNEMI
    // -----------------------------------------------------------------

    if (data.enemy) {
      const wp = toWorld(data.enemy.x, data.enemy.y);

      // Creer le mesh de l'ennemi s'il n'existe pas encore
      if (!enemyObject) {
        const { group, halo } = createEnemyMesh();
        scene.add(group);
        enemyObject = {
          group,
          halo,
          currentX: wp.x,
          currentZ: wp.z,
          targetX: wp.x,
          targetZ: wp.z,
          targetRotY: 0,
        };
      }

      enemyObject.targetX = wp.x;
      enemyObject.targetZ = wp.z;

      // Orienter l'ennemi dans sa direction de deplacement
      const spd = Math.sqrt(data.enemy.vx ** 2 + data.enemy.vy ** 2);
      if (spd > 0.1) {
        enemyObject.targetRotY = Math.atan2(data.enemy.vx, data.enemy.vy);
      }
    } else if (enemyObject) {
      // La partie n'est plus en cours : supprimer l'ennemi de la scene
      scene.remove(enemyObject.group);
      enemyObject = null;
    }
  }

  // =========================================================================
  // MESSAGE "gameOver" : la partie est terminee
  // =========================================================================

  if (type === "gameOver") {
    const { scores, winner, restartIn } = data;
    screenGameover.classList.remove("hidden");
    finalRouge.textContent = scores.rouge;
    finalBleu.textContent = scores.bleu;

    if (winner === "egalite") {
      gameoverTitle.textContent = "Egalite !";
    } else {
      gameoverTitle.textContent =
        winner === "rouge" ? "Les Rouges gagnent !" : "Les Bleus gagnent !";
    }

    document.querySelectorAll(".gameover-team").forEach((el) => {
      el.classList.remove("winner");
      if (el.classList.contains(winner)) el.classList.add("winner");
    });

    let remaining = Math.ceil(restartIn / 1000);
    restartCountdown.textContent = remaining;
    const countdownInterval = setInterval(() => {
      remaining--;
      restartCountdown.textContent = Math.max(0, remaining);
      if (remaining <= 0) clearInterval(countdownInterval);
    }, 1000);
  }
});

// =============================================================================
// BOUCLE D'ANIMATION
// =============================================================================
// requestAnimationFrame appelle cette fonction ~60 fois par seconde.
// On y fait :
//   - L'interpolation fluide des positions (les Minions glissent vers leur cible)
//   - Les animations idle (balancement, flottement des fruits)
//   - Le rendu de la scene 3D

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const time = clock.getElapsedTime();

  // --- Interpolation des positions et rotations des Minions ---
  // Au lieu de teleporter les Minions, on les fait glisser doucement
  // vers leur position cible (lerp = linear interpolation)
  Object.values(playerObjects).forEach((obj, i) => {
    // Interpolation de la position (15% par frame → mouvement fluide)
    obj.currentX += (obj.targetX - obj.currentX) * 0.15;
    obj.currentZ += (obj.targetZ - obj.currentZ) * 0.15;

    // Interpolation de la rotation (10% par frame → pivotement fluide)
    // On interpole sur le plus court chemin angulaire pour eviter les demi-tours
    let dRot = obj.targetRotY - obj.group.rotation.y;
    // Ramener dRot dans [-PI, PI] pour prendre le chemin le plus court
    while (dRot > Math.PI) dRot -= 2 * Math.PI;
    while (dRot < -Math.PI) dRot += 2 * Math.PI;
    obj.group.rotation.y += dRot * 0.1;

    // Animation idle : petit balancement de haut en bas
    const bob = Math.sin(time * 3 + i * 1.5) * 0.03;
    obj.group.position.set(obj.currentX, bob, obj.currentZ);

    // Oscillation du corps quand le Minion bouge
    const isMoving =
      Math.abs(obj.targetX - obj.currentX) > 0.01 ||
      Math.abs(obj.targetZ - obj.currentZ) > 0.01;
    if (isMoving) {
      obj.group.children[0].rotation.x = Math.sin(time * 10) * 0.06;
    } else {
      obj.group.children[0].rotation.x *= 0.9; // Retour progressif a la normale
    }
  });

  // --- Animation des fruits : flottement + rotation ---
  Object.values(fruitObjects).forEach((obj, i) => {
    obj.sprite.position.y = 0.5 + Math.sin(time * 2.5 + i * 0.8) * 0.12;
    obj.sprite.material.rotation = Math.sin(time * 1.5 + i) * 0.15;
    // Pulsation du halo
    obj.glow.material.opacity = 0.15 + Math.sin(time * 3 + i) * 0.08;
  });

  // --- Animation de l'ennemi ---
  if (enemyObject) {
    // Interpolation fluide vers la position cible (plus rapide que les joueurs)
    enemyObject.currentX += (enemyObject.targetX - enemyObject.currentX) * 0.2;
    enemyObject.currentZ += (enemyObject.targetZ - enemyObject.currentZ) * 0.2;

    // Balancement menacant (plus rapide et plus ample que les joueurs)
    const bob = Math.sin(time * 5) * 0.05;
    enemyObject.group.position.set(
      enemyObject.currentX,
      bob,
      enemyObject.currentZ,
    );

    // Interpolation de la rotation vers la direction de deplacement
    let dRot = enemyObject.targetRotY - enemyObject.group.rotation.y;
    while (dRot > Math.PI) dRot -= 2 * Math.PI;
    while (dRot < -Math.PI) dRot += 2 * Math.PI;
    enemyObject.group.rotation.y += dRot * 0.12;

    // Pulsation du halo rouge au sol
    enemyObject.halo.material.opacity = 0.1 + Math.sin(time * 5) * 0.09;
  }

  // --- Rendu de la scene ---
  renderer.render(scene, camera);
}

animate();
