import * as THREE from "https://esm.sh/three@0.166.1";
import { FBXLoader } from "https://esm.sh/three@0.166.1/examples/jsm/loaders/FBXLoader.js";

const PHYSICS_HZ = 2400;
const DT = 1 / PHYSICS_HZ;
const TARGET_RENDER_HZ = 1200;
const MIN_RENDER_HZ = 60;
const FEET_TO_METERS = 0.3048;
const MAP_SIZE_METERS = 3218.688;
const MAP_HALF = MAP_SIZE_METERS * 0.5;
const PLAYER_HEIGHT_METERS = 90 * FEET_TO_METERS;
const EYE_HEIGHT_METERS = PLAYER_HEIGHT_METERS * 0.78;
const STRUCTURE_COUNT = 132;
const BOT_COUNT = 34;
const SHIP_COUNT = 32;
const SHIP_MIN_LENGTH_METERS = 40 * FEET_TO_METERS;
const SHIP_MAX_LENGTH_METERS = 140 * FEET_TO_METERS;
const SHIP_WIDTH_METERS = 18 * FEET_TO_METERS;
const SHIP_HEIGHT_METERS = 18 * FEET_TO_METERS;
const PLAYER_COLLISION_RADIUS = 7.2;
const MAX_MOUSE_DELTA = 90;
const MAX_PHYSICS_STEPS_PER_FRAME = 320;
const PLAYER_SPAWN_CLEARANCE = 24;
const PROJECTILE_SPEED = 1800 * FEET_TO_METERS;
const PROJECTILE_RANGE = 3 * 1609.344;
const PLAYER_FIRE_RATE = 11.5;
const ENEMY_FIRE_RATE = 8.5;
const PLAYER_MAX_HEALTH = 100;
const BOT_MAX_HEALTH = 200;
const MELEE_RANGE = 28;
const MELEE_ARC_COS = Math.cos(Math.PI * 0.38);
const MIN_DYNAMIC_RES_SCALE = 0.55;
const MAX_DYNAMIC_RES_SCALE = 1.0;
const ENEMY_PROJECTILE_MAX = 180;
const ENEMY_PROJECTILE_STEP_INTERVAL = 8;
const LOW_VRAM_TARGET_MB = 256;
const FORCE_LOW_VRAM_PROFILE = true;
const SOFTWARE_RAYTRACED_COLLISION = true;
const ACTOR_RENDER_CULL_DISTANCE = 1700;
const ACTOR_SIM_CULL_DISTANCE = 2100;
const STRUCTURE_STAGE_SCALE = [1.0, 0.5, 0.26];
const STRUCTURE_STAGE_HEALTH = [95, 70, 0];

const MODEL_PATHS = {
  structure: "./assets/fbx/structure.fbx",
  bot: "./assets/fbx/bot.fbx",
  ship: "./assets/fbx/ship.fbx",
  weapon: "./assets/fbx/weapon.fbx"
};

const loader = new FBXLoader();
const modelCache = new Map();

function acquirePrototype(type) {
  if (modelCache.has(type)) return modelCache.get(type);
  const path = MODEL_PATHS[type];
  const promise = new Promise((resolve) => {
    if (!path) {
      resolve(null);
      return;
    }
    loader.load(
      path,
      (fbx) => resolve(fbx),
      undefined,
      () => resolve(null)
    );
  });
  modelCache.set(type, promise);
  return promise;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

const canvas = document.getElementById("world");
if (!canvas) {
  throw new Error("Canvas #world not found");
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: !FORCE_LOW_VRAM_PROFILE, alpha: false });
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.shadowMap.enabled = !FORCE_LOW_VRAM_PROFILE;
renderer.outputColorSpace = THREE.SRGBColorSpace;

let renderHzCurrent = TARGET_RENDER_HZ;
let renderScaleCurrent = 1;
let fpsEma = 60;
let fpsEmaInit = false;
let lastAdaptiveSample = performance.now() / 1000;

function applyRenderScale(scale) {
  renderScaleCurrent = clamp(scale, MIN_DYNAMIC_RES_SCALE, MAX_DYNAMIC_RES_SCALE);
  const baseRatio = Math.max(1, window.devicePixelRatio || 1);
  renderer.setPixelRatio(baseRatio * renderScaleCurrent);
}

applyRenderScale(1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1a26);
scene.fog = new THREE.Fog(0x0b1a26, 500, 4200);

const camera = new THREE.PerspectiveCamera(82, Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight), 0.25, 7000);
scene.add(camera);

const hemi = new THREE.HemisphereLight(0x9dd8ff, 0x2b3d46, 1.0);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(300, 700, 420);
sun.castShadow = true;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(MAP_SIZE_METERS, MAP_SIZE_METERS, FORCE_LOW_VRAM_PROFILE ? 40 : 96, FORCE_LOW_VRAM_PROFILE ? 40 : 96),
  new THREE.MeshStandardMaterial({ color: 0x203443, roughness: 0.95, metalness: 0.05 })
);
ground.rotation.x = -Math.PI * 0.5;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(MAP_SIZE_METERS, FORCE_LOW_VRAM_PROFILE ? 96 : 160, 0x4b7ea4, 0x24445a);
grid.position.y = 0.04;
scene.add(grid);

const hud = document.createElement("div");
hud.style.position = "absolute";
hud.style.left = "12px";
hud.style.top = "12px";
hud.style.padding = "8px 10px";
hud.style.border = "1px solid rgba(120,190,235,0.45)";
hud.style.background = "rgba(7,16,24,0.72)";
hud.style.color = "#e7f4ff";
hud.style.font = "12px Segoe UI, Tahoma, sans-serif";
hud.style.borderRadius = "8px";
hud.style.zIndex = "20";
hud.innerText = `True 3D Engine Active | Physics 2400Hz | Bullets 1800fps | Ray-traced collisions ${SOFTWARE_RAYTRACED_COLLISION ? "ON" : "OFF"} | LowVRAM ${LOW_VRAM_TARGET_MB}MB`;
const mainWrap = document.querySelector(".main-wrap");
if (mainWrap) mainWrap.appendChild(hud);

const missingFbx = new Set();

const player = {
  pos: new THREE.Vector3(0, 0, 0),
  prevPos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  flyMode: true,
  health: PLAYER_MAX_HEALTH,
  fireCooldown: 0,
  meleeCooldown: 0,
  triggerHeld: false
};

const keys = new Set();
const actors = [];
const uiState = {
  stage: "loadout",
  settingsOpen: false,
  gameMode: "multiplayer"
};

const runtimeSettings = {
  invertMouseY: false,
  spawnSpread: 0.75,
  structureCount: STRUCTURE_COUNT,
  enemyCount: BOT_COUNT
};

const worldRuntime = {
  projectiles: [],
  enemyProjectiles: [],
  meleeFx: [],
  playerRoundsFired: 0
};

const loadout = {
  rifleFamily: "M4",
  rifleVariant: "M4A1 CQB",
  bazooka: "Bazooka HE-1",
  handgun: "9mm Ranger",
  meleeWeapon: "Combat Knife"
};

const loadoutData = {
  rifles: {
    M4: ["M4A1 CQB", "M4A1 Marksman", "M4A1 Heavy"],
    SCAR: ["SCAR-L Scout", "SCAR-H Battle", "SCAR-H Precision"],
    G36C: ["G36C Compact", "G36C Tactical", "G36C DMR"]
  },
  bazookas: ["Bazooka HE-1", "Bazooka Thermobaric", "Bazooka EMP"],
  handguns: ["9mm Ranger", ".45 Titan", "Auto-10 Viper"],
  melees: ["Combat Knife", "Energy Blade", "Titan Wrench"]
};

const panel = document.querySelector(".panel");
const preStartMenu = document.getElementById("preStartMenu");
const floatingControls = document.querySelector(".floating-controls");
const sensitivityWheel = document.getElementById("sensitivityWheel");
const stageText = document.getElementById("stageText");
const matchText = document.getElementById("matchText");
const cycleWeaponBtn = document.getElementById("cycleWeaponBtn");
const mouseSensitivity = document.getElementById("mouseSensitivity");
const mouseSensitivityText = document.getElementById("mouseSensitivityText");
const nextBtn = document.getElementById("nextBtn");
const opsBtn = document.getElementById("opsBtn");
const menuStartMultiBtn = document.getElementById("menuStartMultiBtn");
const menuStartOpsBtn = document.getElementById("menuStartOpsBtn");
const rifleFamilySel = document.getElementById("rifleFamily");
const rifleVariantSel = document.getElementById("rifleVariant");
const bazookaSel = document.getElementById("bazooka");
const handgunSel = document.getElementById("handgun");
const meleeWeaponSel = document.getElementById("meleeWeapon");
const invertMouseYSel = document.getElementById("invertMouseY");
const spawnSpreadSel = document.getElementById("spawnSpread");
const spawnSpreadText = document.getElementById("spawnSpreadText");
const structureDensitySel = document.getElementById("structureDensity");
const structureDensityText = document.getElementById("structureDensityText");
const enemyCountSel = document.getElementById("enemyCount");
const enemyCountText = document.getElementById("enemyCountText");
const applySpawnSettingsBtn = document.getElementById("applySpawnSettings");
const playerHealthFill = document.getElementById("playerHealthFill");
const playerHealthText = document.getElementById("playerHealthText");

let lookSensitivity = 0.12;
const lookState = {
  pendingX: 0,
  pendingY: 0
};

const weaponAnchor = new THREE.Group();
camera.add(weaponAnchor);
weaponAnchor.position.set(0.22, -0.26, -0.55);

const tmpVecA = new THREE.Vector3();
const tmpVecB = new THREE.Vector3();
const tmpForward = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpSphere = new THREE.Sphere();
const cameraFrustum = new THREE.Frustum();
const cameraProjectionMatrix = new THREE.Matrix4();

let physicsStepCount = 0;

function createNineSideProjectileMesh(glowing = false, enemy = false) {
  const color = enemy ? 0xc97d5f : 0xc5ced8;
  const glowColor = enemy ? 0xffa57d : 0x8fdcff;
  const mat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.92,
    roughness: glowing ? 0.2 : 0.38,
    emissive: glowing ? glowColor : 0x000000,
    emissiveIntensity: glowing ? 1.55 : 0
  });

  // 6 box sides + 3 cone sides = 9 visible sides while keeping poly cost tiny.
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.62), mat);
  body.position.z = -0.08;

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.34, 3, 1, true), mat);
  tip.rotation.x = Math.PI * 0.5;
  tip.position.z = 0.4;

  const group = new THREE.Group();
  group.add(body);
  group.add(tip);
  return group;
}

function createStructureMesh(actor) {
  const scale = STRUCTURE_STAGE_SCALE[actor.destructStage] ?? 1;
  const radius = actor.structureRadius * scale;
  const height = actor.structureHeight * scale;
  const mesh = new THREE.Mesh(
    // Open-ended 9-gon prism => 18 triangles.
    new THREE.CylinderGeometry(radius, radius, height, 9, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x8c96a2,
      metalness: 0.84,
      roughness: 0.4,
      emissive: 0x11161b,
      emissiveIntensity: actor.destructStage > 0 ? 0.18 : 0.08
    })
  );
  mesh.castShadow = !FORCE_LOW_VRAM_PROFILE;
  mesh.receiveShadow = !FORCE_LOW_VRAM_PROFILE;
  return mesh;
}

function updateStructureBoundsForStage(actor) {
  const scale = STRUCTURE_STAGE_SCALE[actor.destructStage] ?? 1;
  actor.bounds.halfW = actor.structureRadius * scale;
  actor.bounds.halfH = actor.structureHeight * 0.5 * scale;
  actor.bounds.halfL = actor.structureRadius * scale;
}

function applyStructureDamage(actor, damage) {
  if (actor.type !== "structure" || actor.destructStage >= 2) return;
  actor.health = Math.max(0, actor.health - damage);
  if (actor.health > 0) return;

  actor.destructStage = Math.min(2, actor.destructStage + 1);
  actor.health = STRUCTURE_STAGE_HEALTH[actor.destructStage] ?? 0;
  actor.crumblePitch = (Math.random() - 0.5) * 0.2;
  actor.crumbleRoll = (Math.random() - 0.5) * 0.2;
  updateStructureBoundsForStage(actor);

  if (actor.mesh) {
    const oldMesh = actor.mesh;
    scene.remove(oldMesh);
    oldMesh.traverse?.((node) => {
      if (node.isMesh) {
        node.geometry?.dispose?.();
        if (Array.isArray(node.material)) {
          for (const m of node.material) m?.dispose?.();
        } else {
          node.material?.dispose?.();
        }
      }
    });
    actor.mesh = createStructureMesh(actor);
    actor.mesh.position.copy(actor.pos);
    actor.mesh.rotation.set(actor.crumblePitch, actor.yaw, actor.crumbleRoll);
    scene.add(actor.mesh);
  }
}

function fillSelect(sel, values) {
  if (!sel) return;
  sel.innerHTML = "";
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
}

function syncUi() {
  const showMenu = uiState.stage === "loadout" || uiState.settingsOpen;
  if (panel) panel.classList.toggle("menu-visible", showMenu);
  if (preStartMenu) preStartMenu.classList.toggle("prestart-show", showMenu);
  if (floatingControls) floatingControls.style.display = uiState.stage === "loadout" ? "none" : "flex";
  if (sensitivityWheel) sensitivityWheel.style.display = uiState.stage === "loadout" ? "none" : "block";

  if (stageText) {
    stageText.textContent = uiState.stage === "loadout"
      ? "Loadout"
      : (uiState.gameMode === "operations-ai" ? "Operations Against AI" : "Multiplayer FPS Active");
  }
  if (matchText) {
    matchText.textContent = uiState.stage === "loadout"
      ? "Preview menu active. Configure loadout then start."
      : "True 3D scene active with fixed-step 2400Hz simulation.";
  }
}

function beginGame(mode) {
  uiState.gameMode = mode;
  uiState.stage = "multiplayer";
  uiState.settingsOpen = false;
  placePlayerAtRandomSpawn();
  player.prevPos.copy(player.pos);
  player.vel.set(0, 0, 0);
  player.health = PLAYER_MAX_HEALTH;
  player.fireCooldown = 0;
  player.meleeCooldown = 0;
  worldRuntime.projectiles.length = 0;
  worldRuntime.enemyProjectiles.length = 0;
  worldRuntime.meleeFx.length = 0;
  worldRuntime.playerRoundsFired = 0;
  syncUi();
  syncPlayerHealthUi();
  canvas.requestPointerLock?.();
}

function toggleSettingsMenu() {
  if (uiState.stage !== "multiplayer") return;
  uiState.settingsOpen = !uiState.settingsOpen;
  syncUi();
  if (uiState.settingsOpen) {
    try { document.exitPointerLock(); } catch {
      // ignore
    }
  } else {
    canvas.requestPointerLock?.();
  }
}

function initMenuUi() {
  if (cycleWeaponBtn) cycleWeaponBtn.textContent = "Settings Panel (K)";
  fillSelect(rifleFamilySel, Object.keys(loadoutData.rifles));
  if (rifleFamilySel) rifleFamilySel.value = loadout.rifleFamily;
  fillSelect(rifleVariantSel, loadoutData.rifles[loadout.rifleFamily]);
  if (rifleVariantSel) rifleVariantSel.value = loadout.rifleVariant;
  fillSelect(bazookaSel, loadoutData.bazookas);
  if (bazookaSel) bazookaSel.value = loadout.bazooka;
  fillSelect(handgunSel, loadoutData.handguns);
  if (handgunSel) handgunSel.value = loadout.handgun;
  fillSelect(meleeWeaponSel, loadoutData.melees);
  if (meleeWeaponSel) meleeWeaponSel.value = loadout.meleeWeapon;

  rifleFamilySel?.addEventListener("change", () => {
    loadout.rifleFamily = rifleFamilySel.value;
    fillSelect(rifleVariantSel, loadoutData.rifles[loadout.rifleFamily]);
    loadout.rifleVariant = loadoutData.rifles[loadout.rifleFamily][0];
    if (rifleVariantSel) rifleVariantSel.value = loadout.rifleVariant;
  });
  rifleVariantSel?.addEventListener("change", () => { loadout.rifleVariant = rifleVariantSel.value; });
  bazookaSel?.addEventListener("change", () => { loadout.bazooka = bazookaSel.value; });
  handgunSel?.addEventListener("change", () => { loadout.handgun = handgunSel.value; });
  meleeWeaponSel?.addEventListener("change", () => { loadout.meleeWeapon = meleeWeaponSel.value; });

  nextBtn?.addEventListener("click", () => beginGame("multiplayer"));
  opsBtn?.addEventListener("click", () => beginGame("operations-ai"));
  menuStartMultiBtn?.addEventListener("click", () => beginGame("multiplayer"));
  menuStartOpsBtn?.addEventListener("click", () => beginGame("operations-ai"));

  cycleWeaponBtn?.addEventListener("click", () => toggleSettingsMenu());
  mouseSensitivity?.addEventListener("input", () => {
    lookSensitivity = Number(mouseSensitivity.value) || 0.12;
    if (mouseSensitivityText) {
      mouseSensitivityText.textContent = `Look speed: ${lookSensitivity.toFixed(3)}`;
    }
  });

  invertMouseYSel?.addEventListener("change", () => {
    runtimeSettings.invertMouseY = Boolean(invertMouseYSel.checked);
  });

  spawnSpreadSel?.addEventListener("input", () => {
    runtimeSettings.spawnSpread = clamp(Number(spawnSpreadSel.value) || 0.75, 0.45, 0.95);
    if (spawnSpreadText) {
      spawnSpreadText.textContent = `Spawn spread: ${Math.round(runtimeSettings.spawnSpread * 100)}%`;
    }
  });

  structureDensitySel?.addEventListener("input", () => {
    runtimeSettings.structureCount = Math.round(Number(structureDensitySel.value) || STRUCTURE_COUNT);
    if (structureDensityText) {
      structureDensityText.textContent = `Structures: ${runtimeSettings.structureCount}`;
    }
  });

  enemyCountSel?.addEventListener("input", () => {
    runtimeSettings.enemyCount = Math.round(Number(enemyCountSel.value) || BOT_COUNT);
    if (enemyCountText) {
      enemyCountText.textContent = `Enemies: ${runtimeSettings.enemyCount}`;
    }
  });

  applySpawnSettingsBtn?.addEventListener("click", () => {
    rebuildSpawnActors();
  });

  mouseSensitivity?.dispatchEvent(new Event("input"));
  spawnSpreadSel?.dispatchEvent(new Event("input"));
  structureDensitySel?.dispatchEvent(new Event("input"));
  enemyCountSel?.dispatchEvent(new Event("input"));

  syncUi();
}

function createHealthBarGroup() {
  const group = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 1.2),
    new THREE.MeshBasicMaterial({ color: 0x1c2126, transparent: true, opacity: 0.86, depthTest: false })
  );
  const fg = new THREE.Mesh(
    new THREE.PlaneGeometry(9.2, 0.72),
    new THREE.MeshBasicMaterial({ color: 0x5be36f, transparent: true, opacity: 0.95, depthTest: false })
  );
  fg.position.z = 0.02;
  group.add(bg);
  group.add(fg);
  group.userData.fill = fg;
  return group;
}

function syncPlayerHealthUi() {
  const ratio = clamp(player.health / PLAYER_MAX_HEALTH, 0, 1);
  if (playerHealthFill) playerHealthFill.style.width = `${(ratio * 100).toFixed(1)}%`;
  if (playerHealthText) playerHealthText.textContent = `${Math.round(player.health)} / ${PLAYER_MAX_HEALTH}`;
}

function updateBotHealthBar(actor) {
  if (!actor.healthBar || !actor.healthBar.userData.fill) return;
  const ratio = clamp(actor.health / actor.maxHealth, 0, 1);
  const fill = actor.healthBar.userData.fill;
  fill.scale.x = Math.max(0.02, ratio);
  fill.position.x = (-9.2 * 0.5) * (1 - ratio);
  fill.material.color.setHex(ratio > 0.5 ? 0x5be36f : (ratio > 0.25 ? 0xf0cf5e : 0xf26a6a));
}

function createFallbackMesh(type) {
  if (type === "structure") {
    return new THREE.Mesh(
      new THREE.CylinderGeometry(16, 16, 70, 9, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x7e8e9f, roughness: 0.45, metalness: 0.78 })
    );
  }
  if (type === "bot") {
    return new THREE.Mesh(
      new THREE.CapsuleGeometry(5.8, 20, 8, 12),
      new THREE.MeshStandardMaterial({ color: 0xdf8f6b, roughness: 0.65, metalness: 0.15 })
    );
  }
  if (type === "ship") {
    return new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x9ce0ff, roughness: 0.55, metalness: 0.4 })
    );
  }
  return new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.16, 0.68),
    new THREE.MeshStandardMaterial({ color: 0x8ca3b8, roughness: 0.45, metalness: 0.3 })
  );
}

async function buildVisual(type) {
  const proto = await acquirePrototype(type);
  if (proto) {
    const clone = proto.clone(true);
    clone.traverse((n) => {
      if (n.isMesh) {
        n.castShadow = true;
        n.receiveShadow = true;
      }
    });
    return clone;
  }
  if (!missingFbx.has(type)) {
    missingFbx.add(type);
    console.warn(`Missing FBX for ${type}. Add file at ${MODEL_PATHS[type]} to replace fallback.`);
  }
  return createFallbackMesh(type);
}

async function initWeaponModel() {
  const weapon = await buildVisual("weapon");
  weapon.scale.setScalar(0.65);
  weapon.rotation.y = Math.PI;
  weaponAnchor.add(weapon);
}

function fitMeshToDimensions(mesh, widthMeters, heightMeters, lengthMeters) {
  const box = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.x <= 0.0001 || size.y <= 0.0001 || size.z <= 0.0001) return;

  mesh.scale.set(
    mesh.scale.x * (widthMeters / size.x),
    mesh.scale.y * (heightMeters / size.y),
    mesh.scale.z * (lengthMeters / size.z)
  );
}

function createActor(type, x, y, z) {
  const shipLength = SHIP_MIN_LENGTH_METERS + Math.random() * (SHIP_MAX_LENGTH_METERS - SHIP_MIN_LENGTH_METERS);
  const structureRadius = randRange(13, 26);
  const structureHeight = randRange(48, 104);
  const defaultWidth = type === "structure" ? structureRadius * 2 : (type === "ship" ? SHIP_WIDTH_METERS : 12);
  const defaultHeight = type === "structure" ? structureHeight : (type === "ship" ? SHIP_HEIGHT_METERS : 22);
  const defaultLength = type === "structure" ? structureRadius * 2 : (type === "ship" ? shipLength : 12);
  const actor = {
    type,
    pos: new THREE.Vector3(x, y, z),
    prevPos: new THREE.Vector3(x, y, z),
    yaw: Math.random() * Math.PI * 2,
    speed: type === "ship" ? 22 + Math.random() * 16 : 8 + Math.random() * 8,
    shipLength,
    maxHealth: type === "bot" ? BOT_MAX_HEALTH : (type === "structure" ? STRUCTURE_STAGE_HEALTH[0] : 0),
    health: type === "bot" ? BOT_MAX_HEALTH : (type === "structure" ? STRUCTURE_STAGE_HEALTH[0] : 0),
    fireCooldown: type === "bot" ? Math.random() / ENEMY_FIRE_RATE : 0,
    structureRadius,
    structureHeight,
    destructStage: 0,
    crumblePitch: 0,
    crumbleRoll: 0,
    bounds: {
      halfW: defaultWidth * 0.5,
      halfH: defaultHeight * 0.5,
      halfL: defaultLength * 0.5
    },
    mesh: null,
    healthBar: null
  };
  if (type === "structure") updateStructureBoundsForStage(actor);
  actors.push(actor);

  if (type === "structure" && FORCE_LOW_VRAM_PROFILE) {
    actor.mesh = createStructureMesh(actor);
    actor.mesh.position.copy(actor.pos);
    scene.add(actor.mesh);
    return;
  }

  buildVisual(type).then((mesh) => {
    actor.mesh = mesh;
    actor.mesh.position.copy(actor.pos);
    if (type === "bot") actor.mesh.scale.setScalar(1.5);
    if (type === "ship") {
      fitMeshToDimensions(actor.mesh, SHIP_WIDTH_METERS, SHIP_HEIGHT_METERS, actor.shipLength);
    }
    scene.add(actor.mesh);

    if (type === "bot") {
      actor.healthBar = createHealthBarGroup();
      actor.healthBar.position.set(0, 24, 0);
      actor.mesh.add(actor.healthBar);
      updateBotHealthBar(actor);
    }
  });
}

function isPointClearOfStaticActors(x, z, yBottom = 0, yTop = PLAYER_HEIGHT_METERS, extra = PLAYER_SPAWN_CLEARANCE) {
  for (const actor of actors) {
    if (actor.type !== "structure") continue;
    const actorBottom = actor.pos.y - actor.bounds.halfH;
    const actorTop = actor.pos.y + actor.bounds.halfH;
    if (yTop < actorBottom || yBottom > actorTop) continue;

    const c = Math.cos(actor.yaw);
    const s = Math.sin(actor.yaw);
    const localX = (x - actor.pos.x) * c + (z - actor.pos.z) * s;
    const localZ = -(x - actor.pos.x) * s + (z - actor.pos.z) * c;
    const extX = actor.bounds.halfW + PLAYER_COLLISION_RADIUS + extra;
    const extZ = actor.bounds.halfL + PLAYER_COLLISION_RADIUS + extra;
    if (Math.abs(localX) <= extX && Math.abs(localZ) <= extZ) return false;
  }
  return true;
}

function placePlayerAtRandomSpawn() {
  for (let i = 0; i < 240; i++) {
    const spread = runtimeSettings.spawnSpread;
    const x = randRange(-MAP_HALF * spread, MAP_HALF * spread);
    const z = randRange(-MAP_HALF * spread, MAP_HALF * spread);
    if (!isPointClearOfStaticActors(x, z)) continue;
    player.pos.set(x, 0, z);
    return;
  }
  player.pos.set(0, 0, 0);
}

function clearWorldActors() {
  for (const actor of actors) {
    if (actor.mesh) {
      scene.remove(actor.mesh);
    }
  }
  actors.length = 0;
}

function rebuildSpawnActors() {
  clearWorldActors();
  worldRuntime.projectiles.length = 0;
  worldRuntime.enemyProjectiles.length = 0;
  worldRuntime.meleeFx.length = 0;
  initActors();
}

function initActors() {
  const structurePoints = [];
  const minStructureSpacing = 72;
  const structureMargin = MAP_HALF * 0.1;
  const structureCount = runtimeSettings.structureCount;
  const enemyCount = runtimeSettings.enemyCount;
  for (let i = 0; i < structureCount; i++) {
    let placed = false;
    for (let attempt = 0; attempt < 160; attempt++) {
      const x = randRange(-MAP_HALF + structureMargin, MAP_HALF - structureMargin);
      const z = randRange(-MAP_HALF + structureMargin, MAP_HALF - structureMargin);
      let ok = true;
      for (const p of structurePoints) {
        if (Math.hypot(x - p.x, z - p.z) < minStructureSpacing) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      structurePoints.push({ x, z });
      createActor("structure", x, 35, z);
      placed = true;
      break;
    }
    if (!placed) {
      const fallbackX = randRange(-MAP_HALF + structureMargin, MAP_HALF - structureMargin);
      const fallbackZ = randRange(-MAP_HALF + structureMargin, MAP_HALF - structureMargin);
      structurePoints.push({ x: fallbackX, z: fallbackZ });
      createActor("structure", fallbackX, 35, fallbackZ);
    }
  }
  for (let i = 0; i < enemyCount; i++) {
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 120; attempt++) {
      x = randRange(-MAP_HALF * 0.78, MAP_HALF * 0.78);
      z = randRange(-MAP_HALF * 0.78, MAP_HALF * 0.78);
      if (isPointClearOfStaticActors(x, z, 7, 28, 8)) break;
    }
    createActor("bot", x, 18, z);
  }
  for (let i = 0; i < SHIP_COUNT; i++) {
    createActor("ship", randRange(-MAP_HALF, MAP_HALF), 220 + Math.random() * 280, randRange(-MAP_HALF, MAP_HALF));
  }

  placePlayerAtRandomSpawn();
  player.prevPos.copy(player.pos);
}

function spawnPlayerProjectile() {
  const origin = new THREE.Vector3(player.pos.x, player.pos.y + EYE_HEIGHT_METERS * 0.92, player.pos.z);
  tmpQuat.setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, "YXZ"));
  tmpForward.set(0, 0, -1).applyQuaternion(tmpQuat).normalize();

  worldRuntime.playerRoundsFired++;
  const glowRound = (worldRuntime.playerRoundsFired % 6) === 0;
  const proj = {
    pos: origin,
    prevPos: origin.clone(),
    vel: tmpForward.clone().multiplyScalar(PROJECTILE_SPEED),
    life: PROJECTILE_RANGE / PROJECTILE_SPEED,
    mesh: createNineSideProjectileMesh(glowRound, false)
  };
  proj.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tmpForward.clone().normalize());
  proj.mesh.position.copy(proj.pos);
  scene.add(proj.mesh);
  worldRuntime.projectiles.push(proj);
}

function spawnEnemyProjectile(actor) {
  if (worldRuntime.enemyProjectiles.length >= ENEMY_PROJECTILE_MAX) return;

  const start = new THREE.Vector3(actor.pos.x, actor.pos.y + 16, actor.pos.z);
  const target = new THREE.Vector3(player.pos.x, player.pos.y + EYE_HEIGHT_METERS * 0.86, player.pos.z);
  const dir = target.sub(start).normalize();
  const spread = 0.028;
  dir.x += (Math.random() - 0.5) * spread;
  dir.y += (Math.random() - 0.5) * spread * 0.8;
  dir.z += (Math.random() - 0.5) * spread;
  dir.normalize();

  const proj = {
    pos: start,
    prevPos: start.clone(),
    vel: dir.multiplyScalar(PROJECTILE_SPEED),
    life: PROJECTILE_RANGE / PROJECTILE_SPEED,
    mesh: createNineSideProjectileMesh(false, true)
  };
  proj.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
  proj.mesh.position.copy(proj.pos);
  scene.add(proj.mesh);
  worldRuntime.enemyProjectiles.push(proj);
}

function removeProjectile(list, index) {
  const p = list[index];
  if (p.mesh) scene.remove(p.mesh);
  list.splice(index, 1);
}

function applyMeleeAttack() {
  const eye = tmpVecA.set(player.pos.x, player.pos.y + EYE_HEIGHT_METERS * 0.86, player.pos.z);
  tmpQuat.setFromEuler(new THREE.Euler(player.pitch, player.yaw, 0, "YXZ"));
  const dir = tmpVecB.set(0, 0, -1).applyQuaternion(tmpQuat).normalize();

  const fx = {
    pos: eye.clone(),
    dir: dir.clone(),
    life: 0.18,
    mesh: new THREE.Mesh(
      new THREE.TorusGeometry(3.2, 0.18, 6, 20, Math.PI * 0.78),
      new THREE.MeshBasicMaterial({ color: 0xb8f8ff, transparent: true, opacity: 0.82 })
    )
  };
  fx.mesh.position.copy(eye).addScaledVector(dir, 4.2);
  fx.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
  scene.add(fx.mesh);
  worldRuntime.meleeFx.push(fx);

  for (const actor of actors) {
    if (actor.type !== "bot" || actor.health <= 0) continue;
    const toBot = tmpVecA.set(actor.pos.x - eye.x, (actor.pos.y + 10) - eye.y, actor.pos.z - eye.z);
    const dist = toBot.length();
    if (dist > MELEE_RANGE) continue;
    toBot.normalize();
    const dot = toBot.dot(dir);
    if (dot < MELEE_ARC_COS) continue;
    actor.health = Math.max(0, actor.health - 45);
    updateBotHealthBar(actor);
  }
}

function updateMeleeFx() {
  for (let i = worldRuntime.meleeFx.length - 1; i >= 0; i--) {
    const fx = worldRuntime.meleeFx[i];
    fx.life -= DT;
    if (fx.mesh?.material) {
      fx.mesh.material.opacity = clamp(fx.life / 0.18, 0, 0.82);
    }
    if (fx.life <= 0) {
      if (fx.mesh) scene.remove(fx.mesh);
      worldRuntime.meleeFx.splice(i, 1);
    }
  }
}

function testProjectileVsStructures(a, b) {
  for (const actor of actors) {
    if (actor.type !== "structure" && actor.type !== "ship") continue;
    const c = Math.cos(actor.yaw);
    const s = Math.sin(actor.yaw);

    const ax = (a.x - actor.pos.x) * c + (a.z - actor.pos.z) * s;
    const az = -(a.x - actor.pos.x) * s + (a.z - actor.pos.z) * c;
    const bx = (b.x - actor.pos.x) * c + (b.z - actor.pos.z) * s;
    const bz = -(b.x - actor.pos.x) * s + (b.z - actor.pos.z) * c;
    const ay = a.y - actor.pos.y;
    const by = b.y - actor.pos.y;

    const minX = -actor.bounds.halfW;
    const maxX = actor.bounds.halfW;
    const minY = -actor.bounds.halfH;
    const maxY = actor.bounds.halfH;
    const minZ = -actor.bounds.halfL;
    const maxZ = actor.bounds.halfL;

    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    let tMin = 0;
    let tMax = 1;

    const axes = [
      { p: ax, d: dx, lo: minX, hi: maxX },
      { p: ay, d: dy, lo: minY, hi: maxY },
      { p: az, d: dz, lo: minZ, hi: maxZ }
    ];

    let intersects = true;
    for (const axis of axes) {
      if (Math.abs(axis.d) < 1e-8) {
        if (axis.p < axis.lo || axis.p > axis.hi) {
          intersects = false;
          break;
        }
        continue;
      }
      const inv = 1 / axis.d;
      let t1 = (axis.lo - axis.p) * inv;
      let t2 = (axis.hi - axis.p) * inv;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) {
        intersects = false;
        break;
      }
    }

    if (intersects) return actor;
  }
  return null;
}

function updateProjectiles() {
  for (let i = worldRuntime.projectiles.length - 1; i >= 0; i--) {
    const p = worldRuntime.projectiles[i];
    p.prevPos.copy(p.pos);
    p.pos.addScaledVector(p.vel, DT);
    p.life -= DT;
    p.mesh.position.copy(p.pos);
    p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.vel.clone().normalize());

    let hit = false;
    for (const actor of actors) {
      if (actor.type !== "bot" || actor.health <= 0) continue;
      const dx = p.pos.x - actor.pos.x;
      const dz = p.pos.z - actor.pos.z;
      const dy = p.pos.y - (actor.pos.y + 10);
      if ((dx * dx + dz * dz) < (actor.bounds.halfW + 2.5) ** 2 && Math.abs(dy) < actor.bounds.halfH + 4) {
        actor.health = Math.max(0, actor.health - 26);
        updateBotHealthBar(actor);
        hit = true;
        break;
      }
    }

    const worldHitActor = !hit ? testProjectileVsStructures(p.prevPos, p.pos) : null;
    if (worldHitActor) {
      if (worldHitActor.type === "structure") {
        applyStructureDamage(worldHitActor, 38);
      }
      hit = true;
    }
    if (hit || p.life <= 0) {
      removeProjectile(worldRuntime.projectiles, i);
    }
  }

  const doEnemyStep = (physicsStepCount % ENEMY_PROJECTILE_STEP_INTERVAL) === 0;
  if (!doEnemyStep) return;

  const enemyStepDt = DT * ENEMY_PROJECTILE_STEP_INTERVAL;
  for (let i = worldRuntime.enemyProjectiles.length - 1; i >= 0; i--) {
    const p = worldRuntime.enemyProjectiles[i];
    p.prevPos.copy(p.pos);
    p.pos.addScaledVector(p.vel, enemyStepDt);
    p.life -= enemyStepDt;
    p.mesh.position.copy(p.pos);
    p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.vel.clone().normalize());

    const dx = p.pos.x - player.pos.x;
    const dz = p.pos.z - player.pos.z;
    const dy = p.pos.y - (player.pos.y + EYE_HEIGHT_METERS * 0.8);
    const playerHit = (dx * dx + dz * dz) < (PLAYER_COLLISION_RADIUS + 1.8) ** 2 && Math.abs(dy) < EYE_HEIGHT_METERS * 0.75;
    const worldHitActor = testProjectileVsStructures(p.prevPos, p.pos);
    const worldHit = Boolean(worldHitActor);
    if (worldHitActor?.type === "structure") {
      applyStructureDamage(worldHitActor, 16);
    }
    if (playerHit) {
      player.health = Math.max(0, player.health - 7.5);
      syncPlayerHealthUi();
    }

    if (playerHit || worldHit || p.life <= 0) {
      removeProjectile(worldRuntime.enemyProjectiles, i);
    }
  }
}

function applyLookInput() {
  const lookSpeed = lookSensitivity * 0.0158;
  const dx = lookState.pendingX;
  const dy = lookState.pendingY;
  lookState.pendingX = 0;
  lookState.pendingY = 0;

  // Raw, fixed-step mouse integration for axis-accurate camera control.
  player.yaw -= dx * lookSpeed;
  const pitchInput = runtimeSettings.invertMouseY ? -dy : dy;
  player.pitch = clamp(player.pitch + pitchInput * lookSpeed, -Math.PI * 0.49, Math.PI * 0.49);
}

function resolvePlayerActorClipping() {
  const playerBottom = player.pos.y;
  const playerTop = player.pos.y + PLAYER_HEIGHT_METERS;

  for (const actor of actors) {
    if (actor.type !== "structure" && actor.type !== "ship") continue;

    const halfH = actor.bounds.halfH;
    const actorBottom = actor.pos.y - halfH;
    const actorTop = actor.pos.y + halfH;
    if (playerTop < actorBottom || playerBottom > actorTop) continue;

    const localX = (player.pos.x - actor.pos.x) * Math.cos(actor.yaw) + (player.pos.z - actor.pos.z) * Math.sin(actor.yaw);
    const localZ = -(player.pos.x - actor.pos.x) * Math.sin(actor.yaw) + (player.pos.z - actor.pos.z) * Math.cos(actor.yaw);

    const extX = actor.bounds.halfW + PLAYER_COLLISION_RADIUS;
    const extZ = actor.bounds.halfL + PLAYER_COLLISION_RADIUS;
    const penX = extX - Math.abs(localX);
    const penZ = extZ - Math.abs(localZ);

    if (penX <= 0 || penZ <= 0) continue;

    let outX = localX;
    let outZ = localZ;
    if (penX < penZ) {
      outX += localX >= 0 ? penX : -penX;
    } else {
      outZ += localZ >= 0 ? penZ : -penZ;
    }

    const worldDX = outX * Math.cos(actor.yaw) - outZ * Math.sin(actor.yaw);
    const worldDZ = outX * Math.sin(actor.yaw) + outZ * Math.cos(actor.yaw);
    player.pos.x = actor.pos.x + worldDX;
    player.pos.z = actor.pos.z + worldDZ;
  }

  player.pos.x = clamp(player.pos.x, -MAP_HALF, MAP_HALF);
  player.pos.z = clamp(player.pos.z, -MAP_HALF, MAP_HALF);
}

function physicsStep() {
  if (uiState.stage !== "multiplayer") return;
  physicsStepCount++;
  player.prevPos.copy(player.pos);
  applyLookInput();

  if (player.fireCooldown > 0) player.fireCooldown -= DT;
  if (player.meleeCooldown > 0) player.meleeCooldown -= DT;

  if (player.triggerHeld && player.fireCooldown <= 0) {
    spawnPlayerProjectile();
    player.fireCooldown = 1 / PLAYER_FIRE_RATE;
  }

  const yaw = player.yaw;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  let moveF = (keys.has("KeyW") ? 1 : 0) + (keys.has("KeyS") ? -1 : 0);
  let moveR = (keys.has("KeyD") ? 1 : 0) + (keys.has("KeyA") ? -1 : 0);
  const len = Math.hypot(moveF, moveR) || 1;
  moveF /= len;
  moveR /= len;

  const moveSpeed = player.flyMode ? 68 : 46;
  const desiredVel = new THREE.Vector3();
  desiredVel.addScaledVector(fwd, moveF * moveSpeed);
  desiredVel.addScaledVector(right, moveR * moveSpeed);

  if (player.flyMode) {
    if (keys.has("Space")) desiredVel.y += 58;
    if (keys.has("ControlLeft") || keys.has("ControlRight")) desiredVel.y -= 58;
  }

  const response = 1 - Math.exp(-14 * DT);
  player.vel.lerp(desiredVel, response);

  player.pos.addScaledVector(player.vel, DT);
  player.pos.x = clamp(player.pos.x, -MAP_HALF, MAP_HALF);
  player.pos.z = clamp(player.pos.z, -MAP_HALF, MAP_HALF);
  if (!player.flyMode) player.pos.y = 0;
  player.pos.y = clamp(player.pos.y, 0, 3048);
  resolvePlayerActorClipping();

  for (const actor of actors) {
    actor.prevPos.copy(actor.pos);
    const dxToPlayer = actor.pos.x - player.pos.x;
    const dzToPlayer = actor.pos.z - player.pos.z;
    const farForSim = (dxToPlayer * dxToPlayer + dzToPlayer * dzToPlayer) > (ACTOR_SIM_CULL_DISTANCE * ACTOR_SIM_CULL_DISTANCE);

    if (farForSim && (physicsStepCount % 6) !== 0) {
      continue;
    }

    if (actor.type === "bot") {
      if (actor.health <= 0) {
        actor.health = actor.maxHealth;
        actor.pos.set(randRange(-MAP_HALF * 0.8, MAP_HALF * 0.8), 18, randRange(-MAP_HALF * 0.8, MAP_HALF * 0.8));
        updateBotHealthBar(actor);
      }

      actor.fireCooldown -= DT;
      actor.yaw += (0.26 + actor.speed * 0.006) * DT;
      actor.pos.x += Math.cos(actor.yaw) * actor.speed * DT;
      actor.pos.z += Math.sin(actor.yaw) * actor.speed * DT;

      if (actor.fireCooldown <= 0) {
        spawnEnemyProjectile(actor);
        actor.fireCooldown = 1 / ENEMY_FIRE_RATE;
      }
    } else if (actor.type === "ship") {
      actor.yaw += 0.18 * DT;
      actor.pos.x += Math.cos(actor.yaw) * actor.speed * DT;
      actor.pos.z += Math.sin(actor.yaw) * actor.speed * DT;
      actor.pos.y += Math.sin(actor.yaw * 0.5) * 0.45 * DT;
    }

    if (actor.pos.x > MAP_HALF) actor.pos.x = -MAP_HALF;
    if (actor.pos.x < -MAP_HALF) actor.pos.x = MAP_HALF;
    if (actor.pos.z > MAP_HALF) actor.pos.z = -MAP_HALF;
    if (actor.pos.z < -MAP_HALF) actor.pos.z = MAP_HALF;
  }

  updateProjectiles();
  updateMeleeFx();
}

function render(alpha) {
  if (uiState.stage === "loadout") {
    const t = performance.now() * 0.00025;
    const r = MAP_HALF * 0.32;
    camera.position.set(Math.cos(t) * r, 120, Math.sin(t) * r);
    camera.lookAt(0, 24, 0);
    renderer.render(scene, camera);
    return;
  }

  const interpPos = new THREE.Vector3().lerpVectors(player.prevPos, player.pos, alpha);

  camera.position.set(interpPos.x, interpPos.y + EYE_HEIGHT_METERS, interpPos.z);
  camera.rotation.order = "YXZ";
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
  camera.rotation.z = 0;
  cameraProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  cameraFrustum.setFromProjectionMatrix(cameraProjectionMatrix);

  for (const actor of actors) {
    if (!actor.mesh) continue;
    actor.mesh.position.lerpVectors(actor.prevPos, actor.pos, alpha);
    const cullDx = actor.mesh.position.x - interpPos.x;
    const cullDz = actor.mesh.position.z - interpPos.z;
    const distSq = cullDx * cullDx + cullDz * cullDz;
    const cullRadius = Math.max(actor.bounds.halfW, actor.bounds.halfH, actor.bounds.halfL) + 8;
    tmpSphere.center.copy(actor.mesh.position);
    tmpSphere.radius = cullRadius;
    const inRange = distSq <= (ACTOR_RENDER_CULL_DISTANCE * ACTOR_RENDER_CULL_DISTANCE);
    actor.mesh.visible = inRange && cameraFrustum.intersectsSphere(tmpSphere);
    if (!actor.mesh.visible) continue;

    if (actor.type === "structure") {
      actor.mesh.rotation.set(actor.crumblePitch, actor.yaw, actor.crumbleRoll);
    } else {
      actor.mesh.rotation.set(0, actor.yaw, 0);
    }
    if (actor.type === "bot" && actor.healthBar) {
      actor.healthBar.quaternion.copy(camera.quaternion);
    }
  }

  renderer.render(scene, camera);
}

function resize() {
  applyRenderScale(renderScaleCurrent);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
  camera.updateProjectionMatrix();
}

function updateAdaptiveRendering(now) {
  const sampleDt = Math.max(1e-4, now - lastAdaptiveSample);
  lastAdaptiveSample = now;
  const instantFps = 1 / sampleDt;
  if (!fpsEmaInit) {
    fpsEma = instantFps;
    fpsEmaInit = true;
  } else {
    fpsEma = fpsEma * 0.9 + instantFps * 0.1;
  }

  if (fpsEma < 58) {
    applyRenderScale(renderScaleCurrent - 0.015);
  } else if (fpsEma > 66) {
    applyRenderScale(renderScaleCurrent + 0.01);
  }

  // Keep simulation untouched; only stage render cadence by device headroom.
  if (fpsEma < 60) {
    renderHzCurrent = MIN_RENDER_HZ;
  } else {
    renderHzCurrent = clamp(fpsEma * 20, MIN_RENDER_HZ, TARGET_RENDER_HZ);
  }
}

window.addEventListener("resize", resize);
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyK" && uiState.stage === "multiplayer") {
    toggleSettingsMenu();
    return;
  }

  if (uiState.stage !== "multiplayer" || uiState.settingsOpen) return;
  keys.add(e.code);
  if (e.code === "KeyF" && !e.repeat) player.flyMode = !player.flyMode;
  if (e.code === "KeyQ" && !e.repeat && player.meleeCooldown <= 0) {
    applyMeleeAttack();
    player.meleeCooldown = 0.28;
  }
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
});
window.addEventListener("blur", () => {
  keys.clear();
});

window.addEventListener("mousemove", (e) => {
  if (uiState.stage !== "multiplayer" || uiState.settingsOpen) return;
  lookState.pendingX += clamp(e.movementX, -MAX_MOUSE_DELTA, MAX_MOUSE_DELTA);
  lookState.pendingY += clamp(e.movementY, -MAX_MOUSE_DELTA, MAX_MOUSE_DELTA);
});

canvas.addEventListener("mousedown", () => {
  if (uiState.stage === "multiplayer" && !uiState.settingsOpen && document.pointerLockElement !== canvas) {
    canvas.requestPointerLock?.();
  }
  if (uiState.stage === "multiplayer" && !uiState.settingsOpen) {
    player.triggerHeld = true;
  }
});

window.addEventListener("mouseup", () => {
  player.triggerHeld = false;
});

let accumulator = 0;
let lastTime = performance.now() / 1000;
let lastRenderT = lastTime;

function frame(nowMs) {
  const now = nowMs / 1000;
  const dt = Math.min(0.25, now - lastTime);
  lastTime = now;
  accumulator += dt;
  updateAdaptiveRendering(now);

  let steps = 0;
  while (accumulator >= DT && steps < MAX_PHYSICS_STEPS_PER_FRAME) {
    physicsStep();
    accumulator -= DT;
    steps++;
  }

  if (steps >= MAX_PHYSICS_STEPS_PER_FRAME) {
    accumulator = Math.min(accumulator, DT * MAX_PHYSICS_STEPS_PER_FRAME);
  }

  const renderInterval = 1 / renderHzCurrent;
  if ((now - lastRenderT) >= renderInterval) {
    render(accumulator / DT);
    lastRenderT = now;
  }

  requestAnimationFrame(frame);
}

resize();
initMenuUi();
initActors();
initWeaponModel();
requestAnimationFrame(frame);
