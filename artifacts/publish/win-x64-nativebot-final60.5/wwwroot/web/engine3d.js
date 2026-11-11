import * as THREE from "https://esm.sh/three@0.166.1";
import { FBXLoader } from "https://esm.sh/three@0.166.1/examples/jsm/loaders/FBXLoader.js";

const PHYSICS_HZ = 4800;
const DT = 1 / PHYSICS_HZ;
const CHARACTER_VISUAL_HZ = 2400;
const CHARACTER_VISUAL_STEP_INTERVAL = PHYSICS_HZ / CHARACTER_VISUAL_HZ;
const RENDER_TARGETS = [4800, 2400, 1200, 960, 480];
const TARGET_RENDER_HZ = RENDER_TARGETS[0];
const MIN_RENDER_HZ = RENDER_TARGETS[RENDER_TARGETS.length - 1];
const FEET_TO_METERS = 0.3048;
const MECH_BASE_SPEED = 180 * FEET_TO_METERS;
const MECH_SPRINT_MULTIPLIER = 7;
const MECH_SHIFT_SPRINT_MULTIPLIER = 10;
const MECH_SPRINT_RAMP_SECONDS = 0.3;
const MAP_SIZE_METERS = 3218.688;
const MAP_HALF = MAP_SIZE_METERS * 0.5;
const PLAYER_HEIGHT_METERS = 90 * FEET_TO_METERS;
const EYE_HEIGHT_METERS = PLAYER_HEIGHT_METERS * 0.78;
const STRUCTURE_COUNT = 132;
const BOT_COUNT = 34;
const BOT_FLY_SPEED = MECH_BASE_SPEED;
const BOT_DIFFICULTY_SPEED = 1.0;
const BOT_AI_STEP_INTERVAL = PHYSICS_HZ / 120;
const BOT_MAX_FLIGHT_ALTITUDE = 10000 * FEET_TO_METERS;
const BOT_VERTICAL_FLIGHT_SPEED = 1000 * FEET_TO_METERS;
const SHIP_COUNT = 72;
const SHIP_MIN_LENGTH_METERS = 40 * FEET_TO_METERS;
const SHIP_MAX_LENGTH_METERS = 140 * FEET_TO_METERS;
const SHIP_WIDTH_METERS = 18 * FEET_TO_METERS;
const SHIP_HEIGHT_METERS = 18 * FEET_TO_METERS;
const PLAYER_COLLISION_RADIUS = 7.2;
const PLAYER_MAP_LIMIT = MAP_HALF - PLAYER_COLLISION_RADIUS;
const MAX_MOUSE_DELTA = 90;
const MAX_PHYSICS_STEPS_PER_FRAME = 640;
const PLAYER_SPAWN_CLEARANCE = 24;
const PROJECTILE_SPEED = 1800 * FEET_TO_METERS;
const PROJECTILE_RANGE = 3 * 1609.344;
const PROJECTILE_HZ = 480;
const PROJECTILE_STEP_INTERVAL = PHYSICS_HZ / PROJECTILE_HZ;
const PROJECTILE_DT = 1 / PROJECTILE_HZ;
const AIM_SCOPE_ZOOM = 2.5;
const PLAYER_AIM_RAISE_SECONDS = 0.68;
const PLAYER_MAX_PITCH = Math.PI * 0.5 * 1.14;
const PLAYER_ROLL_RATE = Math.PI;
const PLAYER_ROLL_RAMP_UP_SECONDS = 0.15;
const PLAYER_ROLL_RAMP_DOWN_SECONDS = 0.3;
const PLAYER_ROLL_CENTER_SNAP = 2 * Math.PI / 180;
const PLAYER_FIRE_RATE = 11.5;
const PLAYER_MAGAZINE_SIZE = 120;
const PLAYER_RELOAD_SECONDS = 2.2;
const MATCH_DURATION_SECONDS = 600;
const MATCH_TEAM_DEATH_LIMIT = 250;
const PLAYER_RESPAWN_SECONDS = 5;
const ENEMY_FIRE_RATE = 11.5;
const ENEMY_PROJECTILE_SPREAD = 0.0012;
const PLAYER_AIM_REFERENCE_RANGE = 2400 * FEET_TO_METERS;
const PLAYER_FIRST_SHOT_SPREAD_FEET = 0.5;
const PLAYER_FOLLOWUP_SPREAD_FEET = 1.5;
const PLAYER_MAX_HEALTH = 100;
const BOT_MAX_HEALTH = 200;
const MELEE_RANGE = 180 * FEET_TO_METERS;
const MELEE_ARC_COS = Math.cos(Math.PI / 6);
const MIN_DYNAMIC_RES_SCALE = 0.55;
const MAX_DYNAMIC_RES_SCALE = 1.0;
const ENEMY_PROJECTILE_MAX = 180;
const LOW_MEMORY_HINT = (Number(navigator.deviceMemory) || 8) <= 4;
let softwareRaytracedCollision = false;
const ACTOR_RENDER_CULL_DISTANCE = 1700;
const ACTOR_SIM_CULL_DISTANCE = 2100;
const STRUCTURE_STAGE_SCALE = [1.0, 0.5, 0];
const STRUCTURE_STAGE_HEALTH = [400, 200, 0];

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
const scopeCanvas = document.getElementById("scopeCanvas");
if (!canvas) {
  throw new Error("Canvas #world not found");
}

let renderer;
let WebGPURendererClass = null;
let rendererBackend = "WebGPU";
try {
  const { default: WebGPURenderer } = await import("https://esm.sh/three@0.166.1/examples/jsm/renderers/webgpu/WebGPURenderer.js");
  WebGPURendererClass = WebGPURenderer;
  renderer = new WebGPURenderer({ canvas, antialias: !LOW_MEMORY_HINT, alpha: false, powerPreference: "high-performance" });
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend) rendererBackend = "WebGL compatibility fallback";
} catch (error) {
  console.warn("WebGPU initialization failed; using WebGL fallback.", error);
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW_MEMORY_HINT, alpha: false, powerPreference: "high-performance" });
  rendererBackend = "WebGL fallback";
}
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
window.__CONDUCT_GAME_BACKEND__ = rendererBackend;

let scopeRenderer = null;
let scopeRenderSize = 320;
if (scopeCanvas) {
  try {
    scopeRenderer = new THREE.WebGLRenderer({ canvas: scopeCanvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    scopeRenderer.setPixelRatio(1);
    scopeRenderer.setSize(320, 320, false);
    scopeRenderer.outputColorSpace = THREE.SRGBColorSpace;
    scopeRenderer.shadowMap.enabled = true;
  } catch (scopeError) {
    console.warn("Scope renderer unavailable; retaining standard live view.", scopeError);
    scopeCanvas.hidden = true;
  }
}

let renderHzCurrent = TARGET_RENDER_HZ;
let renderScaleCurrent = 1;
let fpsEma = 0;
let fpsEmaInit = false;
let renderedFrameCount = 0;
let lastRenderStatsSample = performance.now() / 1000;
let autoRenderTargetIndex = 0;

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
const botHudRaycaster = new THREE.Raycaster();
const BASE_CAMERA_FOV = camera.fov;
let cameraZoom = 1;
const scopeCamera = new THREE.PerspectiveCamera(BASE_CAMERA_FOV / 2.5, 1, camera.near, camera.far);
const scopeColorTarget = scopeRenderer ? new THREE.WebGLRenderTarget(320, 320, {
  format: THREE.RGBFormat,
  type: THREE.UnsignedShort565Type,
  depthBuffer: true,
  stencilBuffer: false,
  generateMipmaps: false
}) : null;
if (scopeColorTarget) {
  scopeColorTarget.texture.colorSpace = THREE.SRGBColorSpace;
  scopeColorTarget.texture.generateMipmaps = false;
  scopeColorTarget.texture.minFilter = THREE.LinearFilter;
  scopeColorTarget.texture.magFilter = THREE.LinearFilter;
}
const scopePresentScene = new THREE.Scene();
const scopePresentCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
scopePresentCamera.position.z = 1;
if (scopeColorTarget) {
  const scopePresentMaterial = new THREE.MeshBasicMaterial({ map: scopeColorTarget.texture, toneMapped: false });
  const scopePresentQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), scopePresentMaterial);
  scopePresentQuad.frustumCulled = false;
  scopePresentScene.add(scopePresentQuad);
}

const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(300, 700, 420);
sun.castShadow = true;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(MAP_SIZE_METERS, MAP_SIZE_METERS, LOW_MEMORY_HINT ? 40 : 96, LOW_MEMORY_HINT ? 40 : 96),
  new THREE.MeshStandardMaterial({ color: 0x203443, roughness: 0.95, metalness: 0.05 })
);
ground.rotation.x = -Math.PI * 0.5;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(MAP_SIZE_METERS, LOW_MEMORY_HINT ? 96 : 160, 0x4b7ea4, 0x24445a);
grid.position.y = 0.04;
scene.add(grid);

const missingFbx = new Set();

const player = {
  pos: new THREE.Vector3(0, 0, 0),
  prevPos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  roll: 0,
  prevRoll: 0,
  rollVelocity: 0,
  rollInput: 0,
  rollReleaseRemaining: 0,
  sprintCharge: 0,
  shiftSprintCharge: 0,
  recoilPitch: 0,
  recoilYaw: 0,
  weaponRecoil: 0,
  aimTransition: 0,
  flyMode: true,
  team: "friendly",
  health: PLAYER_MAX_HEALTH,
  isDead: false,
  respawnTimer: 0,
  deathVelocity: new THREE.Vector3(),
  deathSpin: new THREE.Vector3(),
  deathPitch: 0,
  deathRoll: 0,
  magazineAmmo: PLAYER_MAGAZINE_SIZE,
  reloadTimer: 0,
  fireCooldown: 0,
  meleeCooldown: 0,
  triggerHeld: false,
  aimZoomHeld: false
};

const keys = new Set();
const mouseButtons = new Set();
const actors = [];
const BINDINGS_STORAGE_KEY = "conductDyadraModalBindings";
const DEFAULT_INPUT_BINDINGS = {
  forward: { keyboard: "KeyW", mouse: null },
  backward: { keyboard: "KeyS", mouse: null },
  left: { keyboard: "KeyA", mouse: null },
  right: { keyboard: "KeyD", mouse: null },
  rise: { keyboard: "Space", mouse: null },
  descend: { keyboard: "ControlLeft", mouse: null },
  sprint: { keyboard: "KeyC", mouse: null },
  leanLeft: { keyboard: "KeyE", mouse: null },
  leanRight: { keyboard: "KeyQ", mouse: null },
  fire: { keyboard: null, mouse: 0 },
  aim: { keyboard: null, mouse: 2 },
  melee: { keyboard: "KeyF", mouse: null },
  reload: { keyboard: "KeyR", mouse: null },
  settings: { keyboard: "Escape", mouse: null }
};
const INPUT_ACTIONS = [
  ["forward", "Move Forward"], ["backward", "Move Backward"],
  ["left", "Move Left"], ["right", "Move Right"],
  ["rise", "Fly / Jump"], ["descend", "Descend"],
  ["sprint", "Sprint / Sprint-Fly"], ["leanLeft", "Roll Left"],
  ["leanRight", "Roll Right"], ["fire", "Fire"],
  ["aim", "Aim / Scope"], ["melee", "Melee"],
  ["reload", "Reload"], ["settings", "Settings Menu"]
];
const inputBindings = JSON.parse(JSON.stringify(DEFAULT_INPUT_BINDINGS));
let bindingCapture = null;

try {
  const savedBindings = JSON.parse(localStorage.getItem(BINDINGS_STORAGE_KEY) || "null");
  for (const [action, defaults] of Object.entries(DEFAULT_INPUT_BINDINGS)) {
    const saved = savedBindings?.[action];
    if (typeof saved?.keyboard === "string" || saved?.keyboard === null) inputBindings[action].keyboard = saved.keyboard;
    if ((Number.isInteger(saved?.mouse) && saved.mouse >= 0 && saved.mouse <= 4) || saved?.mouse === null) inputBindings[action].mouse = saved.mouse;
  }
  if (savedBindings?.leanLeft?.keyboard === "KeyQ" && savedBindings?.leanRight?.keyboard === "KeyE") {
    inputBindings.leanLeft.keyboard = "KeyE";
    inputBindings.leanRight.keyboard = "KeyQ";
    localStorage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify(inputBindings));
  }
} catch {
  localStorage.removeItem(BINDINGS_STORAGE_KEY);
}
const uiState = {
  stage: "loadout",
  settingsOpen: false,
  gameMode: "multiplayer",
  menuPage: "home"
};

const runtimeSettings = {
  invertMouseY: false,
  spawnSpread: 0.75,
  structureCount: STRUCTURE_COUNT,
  enemyCount: BOT_COUNT,
  shadowQuality: "soft-low",
  autoGpuQuality: true,
  presentationMode: "adaptive",
  renderTarget: "auto",
  lowVramProfile: false
};

const shadowQualitySel = document.getElementById("shadowQuality");
const autoGpuQualitySel = document.getElementById("autoGpuQuality");
const presentationModeSel = document.getElementById("presentationMode");
const renderTargetSel = document.getElementById("renderTarget");
const renderPerformanceStatus = document.getElementById("renderPerformanceStatus");
const rayTracingCollisionSel = document.getElementById("rayTracingCollision");
const musicTrackSel = document.getElementById("musicTrack");
const menuMusicEnabledSel = document.getElementById("menuMusicEnabled");
const gameplayMusicEnabledSel = document.getElementById("gameplayMusicEnabled");
const musicVolumeSel = document.getElementById("musicVolume");
const musicVolumeText = document.getElementById("musicVolumeText");
const sfxVolumeSel = document.getElementById("sfxVolume");
const sfxVolumeText = document.getElementById("sfxVolumeText");
const musicStatus = document.getElementById("musicStatus");
const MUSIC_TRACK_FILES = [
  "Obsidian Bazaar Chillhop.mp3",
  "Obsidian Bazaar Chillhop (1).mp3",
  "Obsidian Bazaar Chillhop (2).mp3"
];
const musicSettings = { track: 0, menuEnabled: true, gameplayEnabled: true, volume: 0.9 };
const menuMusicPlayer = new Audio();
const gameplayMusicPlayer = new Audio();
menuMusicPlayer.loop = true;
gameplayMusicPlayer.loop = true;
menuMusicPlayer.preload = "none";
gameplayMusicPlayer.preload = "none";
let musicUnlocked = false;

function saveMusicSettings() {
  localStorage.setItem("conductDyadraModalMusic", JSON.stringify(musicSettings));
}

function syncMusicPlayback() {
  const filename = MUSIC_TRACK_FILES[musicSettings.track] || MUSIC_TRACK_FILES[0];
  const source = `https://conduct-audio.local/${encodeURIComponent(filename)}`;
  for (const playerAudio of [menuMusicPlayer, gameplayMusicPlayer]) {
    if (playerAudio.src !== source) {
      playerAudio.src = source;
      playerAudio.load();
    }
    playerAudio.volume = musicSettings.volume;
  }

  const isMenu = uiState.stage === "loadout";
  const activePlayer = isMenu ? menuMusicPlayer : gameplayMusicPlayer;
  const enabled = isMenu ? musicSettings.menuEnabled : musicSettings.gameplayEnabled;
  const inactivePlayer = isMenu ? gameplayMusicPlayer : menuMusicPlayer;
  inactivePlayer.pause();
  if (!musicUnlocked || !enabled) {
    activePlayer.pause();
    return;
  }
  activePlayer.play().catch(() => {
    if (musicStatus) musicStatus.textContent = "Music playback was blocked by the browser.";
  });
}

function initMusicUi() {
  try {
    const saved = JSON.parse(localStorage.getItem("conductDyadraModalMusic") || "null");
    if (Number.isInteger(saved?.track) && saved.track >= 0 && saved.track < MUSIC_TRACK_FILES.length) musicSettings.track = saved.track;
    if (typeof saved?.menuEnabled === "boolean") musicSettings.menuEnabled = saved.menuEnabled;
    if (typeof saved?.gameplayEnabled === "boolean") musicSettings.gameplayEnabled = saved.gameplayEnabled;
    if (Number.isFinite(saved?.volume)) musicSettings.volume = clamp(saved.volume, 0, 1);
  } catch {
    localStorage.removeItem("conductDyadraModalMusic");
  }
  if (musicTrackSel) musicTrackSel.value = String(musicSettings.track);
  if (menuMusicEnabledSel) menuMusicEnabledSel.checked = musicSettings.menuEnabled;
  if (gameplayMusicEnabledSel) gameplayMusicEnabledSel.checked = musicSettings.gameplayEnabled;
  if (musicVolumeSel) musicVolumeSel.value = String(Math.round(musicSettings.volume * 100));
  if (musicVolumeText) musicVolumeText.value = `${Math.round(musicSettings.volume * 100)}%`;
  if (sfxVolumeSel) sfxVolumeSel.value = String(Math.round(sfxSettings.volume * 100));
  if (sfxVolumeText) sfxVolumeText.value = `${Math.round(sfxSettings.volume * 100)}%`;

  musicTrackSel?.addEventListener("change", () => { musicSettings.track = Number(musicTrackSel.value) || 0; saveMusicSettings(); syncMusicPlayback(); });
  menuMusicEnabledSel?.addEventListener("change", () => { musicSettings.menuEnabled = menuMusicEnabledSel.checked; saveMusicSettings(); syncMusicPlayback(); });
  gameplayMusicEnabledSel?.addEventListener("change", () => { musicSettings.gameplayEnabled = gameplayMusicEnabledSel.checked; saveMusicSettings(); syncMusicPlayback(); });
  musicVolumeSel?.addEventListener("input", () => {
    musicSettings.volume = clamp(Number(musicVolumeSel.value) / 100, 0, 1);
    if (musicVolumeText) musicVolumeText.value = `${musicVolumeSel.value}%`;
    saveMusicSettings();
    syncMusicPlayback();
  });
  sfxVolumeSel?.addEventListener("input", () => {
    sfxSettings.volume = clamp(Number(sfxVolumeSel.value) / 100, 0, 1.5);
    if (sfxVolumeText) sfxVolumeText.value = `${sfxVolumeSel.value}%`;
    if (sfxMaster && sfxContext) sfxMaster.gain.setTargetAtTime(sfxSettings.volume, sfxContext.currentTime, 0.025);
    localStorage.setItem(SFX_STORAGE_KEY, JSON.stringify(sfxSettings));
  });

  const unlockMusic = () => {
    musicUnlocked = true;
    ensureSfxAudio();
    syncMusicPlayback();
  };
  window.addEventListener("pointerdown", unlockMusic, { once: true });
  window.addEventListener("keydown", unlockMusic, { once: true });
}

let sfxContext = null;
let sfxMaster = null;
let sfxNoiseBuffer = null;
let lastBotSfxTime = 0;
const SFX_STORAGE_KEY = "conductDyadraModalSfx";
const sfxSettings = { volume: 1.0 };
try {
  const savedSfx = JSON.parse(localStorage.getItem(SFX_STORAGE_KEY) || "null");
  if (Number.isFinite(savedSfx?.volume)) sfxSettings.volume = clamp(savedSfx.volume, 0, 1.5);
} catch {
  localStorage.removeItem(SFX_STORAGE_KEY);
}
const SPEED_OF_SOUND_METERS_PER_SECOND = 343;

function ensureSfxAudio() {
  if (!sfxContext) {
    const AudioContextType = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextType) return null;
    sfxContext = new AudioContextType();
    sfxMaster = sfxContext.createGain();
    sfxMaster.gain.value = sfxSettings.volume;
    sfxMaster.connect(sfxContext.destination);
    sfxNoiseBuffer = sfxContext.createBuffer(1, sfxContext.sampleRate, sfxContext.sampleRate);
    const samples = sfxNoiseBuffer.getChannelData(0);
    for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
  }
  if (sfxContext.state === "suspended") sfxContext.resume().catch(() => {});
  return sfxContext;
}

function setAudioVectorParam(param, value, time) {
  if (param) param.setValueAtTime(value, time);
}

function routeSpatialSfx(inputNode, sourcePosition, extraDelay = 0) {
  const context = ensureSfxAudio();
  if (!context) return 0;
  const listenerPosition = new THREE.Vector3(player.pos.x, player.pos.y + EYE_HEIGHT_METERS, player.pos.z);
  const source = sourcePosition?.isVector3 ? sourcePosition : listenerPosition;
  const distance = source.distanceTo(listenerPosition);
  const now = context.currentTime;
  const arrivalTime = now + Math.max(0, extraDelay) + distance / SPEED_OF_SOUND_METERS_PER_SECOND;
  const listener = context.listener;
  if (listener.positionX) {
    setAudioVectorParam(listener.positionX, listenerPosition.x, now);
    setAudioVectorParam(listener.positionY, listenerPosition.y, now);
    setAudioVectorParam(listener.positionZ, listenerPosition.z, now);
    setAudioVectorParam(listener.forwardX, -Math.sin(player.yaw) * Math.cos(player.pitch), now);
    setAudioVectorParam(listener.forwardY, Math.sin(player.pitch), now);
    setAudioVectorParam(listener.forwardZ, -Math.cos(player.yaw) * Math.cos(player.pitch), now);
    setAudioVectorParam(listener.upX, 0, now);
    setAudioVectorParam(listener.upY, 1, now);
    setAudioVectorParam(listener.upZ, 0, now);
  } else {
    listener.setPosition(listenerPosition.x, listenerPosition.y, listenerPosition.z);
    listener.setOrientation(-Math.sin(player.yaw), Math.sin(player.pitch), -Math.cos(player.yaw), 0, 1, 0);
  }

  const panner = context.createPanner();
  panner.panningModel = "HRTF";
  panner.distanceModel = "inverse";
  panner.refDistance = 30;
  panner.maxDistance = 5000;
  panner.rolloffFactor = 0.6;
  if (panner.positionX) {
    setAudioVectorParam(panner.positionX, source.x, now);
    setAudioVectorParam(panner.positionY, source.y, now);
    setAudioVectorParam(panner.positionZ, source.z, now);
  } else {
    panner.setPosition(source.x, source.y, source.z);
  }
  inputNode.connect(panner);
  panner.connect(sfxMaster);

  const reflections = actors
    .filter((actor) => actor.type === "structure" && actor.health > 0)
    .map((actor) => {
      const structurePosition = actor.pos;
      const pathLength = source.distanceTo(structurePosition) + structurePosition.distanceTo(listenerPosition);
      return { extraPath: pathLength - distance, actor };
    })
    .filter((reflection) => reflection.extraPath > 8 && reflection.extraPath < 220)
    .sort((a, b) => a.extraPath - b.extraPath)
    .slice(0, 2);

  for (let index = 0; index < reflections.length; index++) {
    const reflection = reflections[index];
    const delay = context.createDelay(1);
    delay.delayTime.setValueAtTime(clamp(reflection.extraPath / SPEED_OF_SOUND_METERS_PER_SECOND, 0.025, 0.64), now);
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(index === 0 ? 2400 : 1350, now);
    const echoGain = context.createGain();
    echoGain.gain.setValueAtTime(index === 0 ? 0.2 : 0.11, now);
    const echoPanner = context.createPanner();
    echoPanner.panningModel = "HRTF";
    echoPanner.distanceModel = "inverse";
    echoPanner.refDistance = 30;
    echoPanner.maxDistance = 5000;
    echoPanner.rolloffFactor = 0.6;
    if (echoPanner.positionX) {
      setAudioVectorParam(echoPanner.positionX, reflection.actor.pos.x, now);
      setAudioVectorParam(echoPanner.positionY, reflection.actor.pos.y, now);
      setAudioVectorParam(echoPanner.positionZ, reflection.actor.pos.z, now);
    } else {
      echoPanner.setPosition(reflection.actor.pos.x, reflection.actor.pos.y, reflection.actor.pos.z);
    }
    inputNode.connect(delay);
    delay.connect(lowpass).connect(echoGain).connect(echoPanner).connect(sfxMaster);
  }
  return arrivalTime;
}

function playNoiseSfx(duration, filterType, frequency, peak, endFrequency, delay = 0, sourcePosition = null) {
  const context = ensureSfxAudio();
  if (!context || !sfxNoiseBuffer) return;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const start = routeSpatialSfx(gain, sourcePosition, delay);
  source.buffer = sfxNoiseBuffer;
  filter.type = filterType;
  filter.frequency.setValueAtTime(frequency, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), start + duration);
  gain.gain.setValueAtTime(0.001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.006, duration * 0.2));
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  source.connect(filter).connect(gain);
  source.start(start);
  source.stop(start + duration + 0.01);
}

function playToneSfx(frequency, duration, waveform = "triangle", peak = 0.18, delay = 0, sourcePosition = null) {
  const context = ensureSfxAudio();
  if (!context) return;
  const gain = context.createGain();
  const start = routeSpatialSfx(gain, sourcePosition, delay);
  const oscillator = context.createOscillator();
  oscillator.type = waveform;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(35, frequency * 0.56), start + duration);
  gain.gain.setValueAtTime(0.001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.connect(gain);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
}

function playWeaponFireSfx(isBot = false, sourcePosition = null) {
  const now = performance.now() / 1000;
  if (isBot && now - lastBotSfxTime < 0.11) return;
  if (isBot) lastBotSfxTime = now;
  const source = sourcePosition || new THREE.Vector3(player.pos.x, player.pos.y + EYE_HEIGHT_METERS, player.pos.z);
  playNoiseSfx(0.055, "highpass", 1100, isBot ? 0.09 : 0.16, 360, 0, source);
  playToneSfx(isBot ? 92 : 118, 0.075, "triangle", isBot ? 0.12 : 0.22, 0, source);
  playToneSfx(1850, 0.018, "square", 0.07, 0, source);
}

function playReloadSfx(sourcePosition = null) {
  playToneSfx(780, 0.035, "square", 0.09, 0, sourcePosition);
  playToneSfx(420, 0.045, "triangle", 0.12, 0.16, sourcePosition);
  playToneSfx(980, 0.055, "square", 0.11, 1.72, sourcePosition);
}

function playExplosionSfx(sourcePosition = null) {
  playNoiseSfx(0.72, "lowpass", 1250, 0.34, 75, 0, sourcePosition);
  playToneSfx(72, 0.52, "sine", 0.28, 0, sourcePosition);
}

function applyShadowQuality(mode) {
  const presets = {
    "soft-low": { mapSize: 512, radius: 2, type: THREE.VSMShadowMap },
    "soft-high": { mapSize: 1536, radius: 4, type: THREE.VSMShadowMap },
    hard: { mapSize: 1024, radius: 0, type: THREE.BasicShadowMap }
  };
  const preset = presets[mode] || presets["soft-low"];
  runtimeSettings.shadowQuality = presets[mode] ? mode : "soft-low";
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = preset.type;
  sun.castShadow = true;
  sun.shadow.mapSize.set(preset.mapSize, preset.mapSize);
  sun.shadow.radius = preset.radius;
  sun.shadow.bias = -0.00015;
  sun.shadow.camera.left = -1800;
  sun.shadow.camera.right = 1800;
  sun.shadow.camera.top = 1800;
  sun.shadow.camera.bottom = -1800;
  sun.shadow.camera.updateProjectionMatrix();
  for (const actor of actors) {
    actor.mesh?.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
  }
}

const worldRuntime = {
  projectiles: [],
  enemyProjectiles: [],
  meleeFx: [],
  deathFx: [],
  playerRoundsFired: 0,
  weaponShotsFired: Object.create(null)
};

const matchState = {
  elapsedSeconds: 0,
  teamDeaths: { friendly: 0, enemy: 0 },
  ended: false,
  lastHudSecond: -1
};

const loadout = {
  rifleFamily: "G36C",
  rifleVariant: "G36C Tactical",
  bazooka: "Javelin Pike",
  handgun: "Viper 10mm",
  meleeWeapon: "Combat Knife"
};

const loadoutData = {
  rifles: {
    M4: ["M4A1 CQB", "M4A1 Marksman", "M4A1 Heavy"],
    SCAR: ["SCAR-L Scout", "SCAR-H Battle", "SCAR-H Precision"],
    G36C: ["G36C Compact", "G36C Tactical", "G36C DMR"]
  },
  bazookas: ["Javelin Pike", "Bazooka HE-1", "Bazooka Thermobaric", "Bazooka EMP"],
  handguns: ["Viper 10mm", "9mm Ranger", ".45 Titan", "Auto-10 Viper"],
  melees: ["Combat Knife", "Energy Blade", "Titan Wrench"]
};

const panel = document.querySelector(".panel");
const preStartMenu = document.getElementById("preStartMenu");
const combatCrosshair = document.getElementById("combatCrosshair");
const combatAmmoHud = document.getElementById("combatAmmoHud");
const playerCombatHud = document.getElementById("playerCombatHud");
const teamStatusHud = document.getElementById("teamStatusHud");
const scopeOverlay = document.getElementById("scopeOverlay");
const fpsHud = document.getElementById("fpsHud");
const overPitchIndicator = document.getElementById("overPitchIndicator");
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
const menuHome = document.getElementById("menuHome");
const menuSettings = document.getElementById("menuSettings");
const menuLoadout = document.getElementById("menuLoadout");
const menuStats = document.getElementById("menuStats");
const menuStartBotsBtn = document.getElementById("menuStartBotsBtn");
const menuStartWorldBtn = document.getElementById("menuStartWorldBtn");
const menuSettingsBtn = document.getElementById("menuSettingsBtn");
const menuLoadoutBtn = document.getElementById("menuLoadoutBtn");
const menuStatsBtn = document.getElementById("menuStatsBtn");
const menuExitBtn = document.getElementById("menuExitBtn");
const returnMainMenuBtn = document.getElementById("returnMainMenuBtn");
const settingsFullscreenBtn = document.getElementById("settingsFullscreenBtn");
const lowVramProfileBtn = document.getElementById("lowVramProfileBtn");
const mouseSensitivityX = document.getElementById("mouseSensitivityX");
const mouseSensitivityY = document.getElementById("mouseSensitivityY");
const mouseSensitivityXText = document.getElementById("mouseSensitivityXText");
const mouseSensitivityYText = document.getElementById("mouseSensitivityYText");
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
let lookSensitivityX = 1;
let lookSensitivityY = 1;
const lookState = {
  pendingX: 0,
  pendingY: 0
};

const weaponAnchor = new THREE.Group();
camera.add(weaponAnchor);
weaponAnchor.position.set(0.22, -0.26, -0.55);
weaponAnchor.userData.scope = null;
const weaponHipPosition = new THREE.Vector3(0.3, -0.26, -0.55);
const weaponAimPosition = new THREE.Vector3(0.035, -0.13, -0.42);

const tmpVecA = new THREE.Vector3();
const tmpVecB = new THREE.Vector3();
const tmpForward = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpSphere = new THREE.Sphere();
const cameraFrustum = new THREE.Frustum();
const cameraProjectionMatrix = new THREE.Matrix4();

let physicsStepCount = 0;

function createNineSideProjectileMesh(glowing = false, enemy = false, friendly = false) {
  const color = enemy ? 0xe83939 : (friendly ? 0x36d978 : 0xc5ced8);
  const glowColor = enemy ? 0xff3030 : (friendly ? 0x35ff84 : 0x8fdcff);
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
  mesh.castShadow = true;
  mesh.receiveShadow = true;
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
  actor.healthRevealTimer = 6;
  actor.health = Math.max(0, actor.health - damage);
  if (actor.health > 0) return;

  actor.destructStage = Math.min(2, actor.destructStage + 1);
  actor.health = STRUCTURE_STAGE_HEALTH[actor.destructStage] ?? 0;
  actor.crumblePitch = (Math.random() - 0.5) * 0.2;
  actor.crumbleRoll = (Math.random() - 0.5) * 0.2;
  updateStructureBoundsForStage(actor);

  if (actor.mesh) {
    const oldMesh = actor.mesh;
    const healthBar = actor.healthBar;
    healthBar?.parent?.remove(healthBar);
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
    if (actor.destructStage >= 2) actor.mesh.visible = false;
    scene.add(actor.mesh);
    if (healthBar && actor.destructStage < 2) {
      actor.mesh.add(healthBar);
      healthBar.position.y = actor.bounds.halfH + 8;
      updateBotHealthBar(actor);
    }
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

function isActionPressed(action) {
  const binding = inputBindings[action];
  return Boolean(binding && ((binding.keyboard && keys.has(binding.keyboard)) || (binding.mouse !== null && mouseButtons.has(binding.mouse))));
}

function actionUsesKey(action, code) {
  return inputBindings[action]?.keyboard === code;
}

function actionUsesMouse(action, button) {
  return inputBindings[action]?.mouse === button;
}

function formatKeyBinding(code) {
  if (!code) return "Unbound";
  if (code === "Space") return "Space";
  if (code === "ControlLeft") return "Left Ctrl";
  if (code === "ControlRight") return "Right Ctrl";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code;
}

function formatMouseBinding(button) {
  return button === null ? "Unbound" : ["Left Mouse", "Middle Mouse", "Right Mouse", "Mouse Back", "Mouse Forward"][button] || "Unbound";
}

function saveInputBindings() {
  localStorage.setItem(BINDINGS_STORAGE_KEY, JSON.stringify(inputBindings));
}

function completeBindingCapture(device, value) {
  if (!bindingCapture || bindingCapture.device !== device) return;
  const { action } = bindingCapture;
  const conflict = INPUT_ACTIONS.find(([otherAction]) => otherAction !== action && inputBindings[otherAction][device] === value);
  if (conflict) {
    const status = document.getElementById("keybindStatus");
    if (status) status.textContent = `${conflict[1]} already uses that ${device === "keyboard" ? "key" : "mouse button"}.`;
  } else {
    inputBindings[action][device] = value;
    saveInputBindings();
    const status = document.getElementById("keybindStatus");
    if (status) status.textContent = `${INPUT_ACTIONS.find(([name]) => name === action)?.[1]} ${device} binding saved.`;
  }
  bindingCapture = null;
  renderInputBindings();
}

function renderInputBindings() {
  const list = document.getElementById("keybindList");
  if (!list) return;
  list.replaceChildren();
  for (const heading of ["Action", "Keyboard", "Mouse"]) {
    const cell = document.createElement("span");
    cell.textContent = heading;
    list.appendChild(cell);
  }
  for (const [action, label] of INPUT_ACTIONS) {
    const actionLabel = document.createElement("span");
    actionLabel.textContent = label;
    list.appendChild(actionLabel);
    for (const device of ["keyboard", "mouse"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = bindingCapture?.action === action && bindingCapture.device === device
        ? "Press input..."
        : (device === "keyboard" ? formatKeyBinding(inputBindings[action].keyboard) : formatMouseBinding(inputBindings[action].mouse));
      button.addEventListener("click", () => {
        bindingCapture = { action, device };
        const status = document.getElementById("keybindStatus");
        if (status) status.textContent = `Press a ${device === "keyboard" ? "key" : "mouse button"} for ${label}.`;
        renderInputBindings();
      });
      list.appendChild(button);
    }
  }
}

function resetInputBindings() {
  for (const [action, defaults] of Object.entries(DEFAULT_INPUT_BINDINGS)) {
    inputBindings[action].keyboard = defaults.keyboard;
    inputBindings[action].mouse = defaults.mouse;
  }
  bindingCapture = null;
  saveInputBindings();
  renderInputBindings();
  const status = document.getElementById("keybindStatus");
  if (status) status.textContent = "Default bindings restored.";
}

function refreshHeldInputActions() {
  const wasAiming = player.aimZoomHeld;
  player.triggerHeld = isActionPressed("fire");
  player.aimZoomHeld = isActionPressed("aim");
  if (wasAiming !== player.aimZoomHeld) syncCombatHud();
}

function triggerInputAction(action) {
  if (uiState.stage !== "multiplayer" || uiState.settingsOpen) return;
  if (action === "reload") startPlayerReload();
  if (action === "melee" && player.meleeCooldown <= 0) {
    applyMeleeAttack();
    player.meleeCooldown = 0.28;
  }
}

function syncUi() {
  const showMenu = uiState.stage === "loadout" || uiState.settingsOpen;
  if (panel) panel.classList.remove("menu-visible");
  if (preStartMenu) preStartMenu.classList.toggle("prestart-show", showMenu);
  if (floatingControls) floatingControls.style.display = "none";
  if (sensitivityWheel) sensitivityWheel.style.display = "none";

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
  syncTeamHud();
  if (teamStatusHud) teamStatusHud.hidden = uiState.stage !== "multiplayer" || uiState.settingsOpen;
  syncCombatHud();
  syncMusicPlayback();
}

function syncTeamHud() {
  if (!teamStatusHud) return;
  const friendly = actors.filter((actor) => actor.type === "bot" && actor.team === "friendly").length;
  const enemy = actors.filter((actor) => actor.type === "bot" && actor.team === "enemy").length;
  const remaining = Math.max(0, MATCH_DURATION_SECONDS - matchState.elapsedSeconds);
  const timeText = `${Math.floor(remaining / 60)}:${String(Math.floor(remaining % 60)).padStart(2, "0")}`;
  const respawnText = player.isDead
    ? (player.respawnTimer > 0 ? `  |  RESPAWN ${Math.ceil(player.respawnTimer)}` : "  |  PRESS 5 TO RESPAWN")
    : "";
  teamStatusHud.textContent = `ALLIES ${friendly}  |  HOSTILES ${enemy}  |  ${timeText}  |  DEATHS ${matchState.teamDeaths.friendly}/${matchState.teamDeaths.enemy}${respawnText}`;
}

function finishMatch(message) {
  if (matchState.ended) return;
  matchState.ended = true;
  uiState.stage = "loadout";
  uiState.settingsOpen = false;
  uiState.menuPage = "home";
  keys.clear();
  mouseButtons.clear();
  player.triggerHeld = false;
  player.aimZoomHeld = false;
  try { document.exitPointerLock(); } catch {
    // ignore
  }
  syncMenuPage();
  syncUi();
  if (matchText) matchText.textContent = message;
}

function recordTeamDeath(team) {
  if (matchState.ended || (team !== "friendly" && team !== "enemy")) return;
  matchState.teamDeaths[team]++;
  syncTeamHud();
  if (matchState.teamDeaths[team] >= MATCH_TEAM_DEATH_LIMIT) {
    finishMatch(`${team === "friendly" ? "Friendly" : "Hostile"} team reached ${MATCH_TEAM_DEATH_LIMIT} deaths.`);
  }
}

function syncScopeVisibility() {
  const scopeVisible = uiState.stage === "multiplayer"
    && !uiState.settingsOpen
    && player.aimZoomHeld
    && player.aimTransition >= 1;
  if (scopeOverlay) scopeOverlay.hidden = !scopeVisible;
  if (scopeCanvas) scopeCanvas.hidden = !scopeVisible || !scopeRenderer;
}

function syncCombatHud() {
  const inGame = uiState.stage === "multiplayer" && !uiState.settingsOpen;
  if (combatCrosshair) combatCrosshair.hidden = !inGame;
  if (combatCrosshair) combatCrosshair.classList.toggle("aiming", inGame && player.aimZoomHeld);
  syncScopeVisibility();
  if (playerCombatHud) playerCombatHud.hidden = !inGame;
  if (teamStatusHud) teamStatusHud.hidden = !inGame;
  if (combatAmmoHud) {
    combatAmmoHud.hidden = !inGame;
    const text = player.reloadTimer > 0
      ? `Reloading ${player.reloadTimer.toFixed(1)}s | ${PLAYER_FIRE_RATE * 60} RPM`
      : `${player.magazineAmmo} / ${PLAYER_MAGAZINE_SIZE} | ${PLAYER_FIRE_RATE * 60} RPM`;
    if (combatAmmoHud.textContent !== text) combatAmmoHud.textContent = text;
  }
}

function startPlayerReload() {
  if (player.reloadTimer > 0 || player.magazineAmmo >= PLAYER_MAGAZINE_SIZE) return;
  player.reloadTimer = PLAYER_RELOAD_SECONDS;
  playReloadSfx(new THREE.Vector3(player.pos.x, player.pos.y + EYE_HEIGHT_METERS, player.pos.z));
  syncCombatHud();
}

function beginGame(mode) {
  matchState.elapsedSeconds = 0;
  matchState.teamDeaths.friendly = 0;
  matchState.teamDeaths.enemy = 0;
  matchState.ended = false;
  matchState.lastHudSecond = -1;
  uiState.gameMode = mode;
  uiState.stage = "multiplayer";
  uiState.settingsOpen = false;
  placePlayerAtRandomSpawn();
  player.prevPos.copy(player.pos);
  player.vel.set(0, 0, 0);
  player.health = PLAYER_MAX_HEALTH;
  player.isDead = false;
  player.respawnTimer = 0;
  player.deathVelocity.set(0, 0, 0);
  player.deathSpin.set(0, 0, 0);
  player.deathPitch = 0;
  player.deathRoll = 0;
  player.roll = 0;
  player.prevRoll = 0;
  player.magazineAmmo = PLAYER_MAGAZINE_SIZE;
  player.reloadTimer = 0;
  player.fireCooldown = 0;
  player.meleeCooldown = 0;
  worldRuntime.projectiles.length = 0;
  worldRuntime.enemyProjectiles.length = 0;
  worldRuntime.meleeFx.length = 0;
  worldRuntime.playerRoundsFired = 0;
  worldRuntime.weaponShotsFired = Object.create(null);
  syncUi();
  syncCombatHud();
  syncPlayerHealthUi();
  canvas.requestPointerLock?.();
}

function toggleSettingsMenu() {
  if (uiState.stage !== "multiplayer") return;
  uiState.settingsOpen = !uiState.settingsOpen;
  uiState.menuPage = uiState.settingsOpen ? "settings" : "home";
  if (returnMainMenuBtn) returnMainMenuBtn.hidden = !uiState.settingsOpen;
  if (uiState.settingsOpen) {
    keys.clear();
    mouseButtons.clear();
    player.triggerHeld = false;
    player.aimZoomHeld = false;
  }
  syncMenuPage();
  syncUi();
  if (uiState.settingsOpen) {
    try { document.exitPointerLock(); } catch {
      // ignore
    }
  } else {
    canvas.requestPointerLock?.();
  }
}

function syncMenuPage() {
  const pages = { home: menuHome, settings: menuSettings, loadout: menuLoadout, stats: menuStats };
  for (const [name, page] of Object.entries(pages)) {
    if (page) page.hidden = name !== uiState.menuPage;
  }
}

function showMenuPage(name) {
  if (uiState.stage === "multiplayer" && name !== "settings") {
    uiState.settingsOpen = false;
    canvas.requestPointerLock?.();
  }
  uiState.menuPage = name;
  if (returnMainMenuBtn) returnMainMenuBtn.hidden = uiState.stage !== "multiplayer" || name !== "settings";
  if (uiState.stage === "multiplayer" && name === "settings") {
    uiState.settingsOpen = true;
    try { document.exitPointerLock(); } catch {
      // ignore
    }
  }
  syncMenuPage();
  syncUi();
  syncCombatHud();
}

function initMenuUi() {
  document.getElementById("loadoutContent")?.appendChild(document.getElementById("loadoutPane"));
  document.getElementById("menuLoadoutContent")?.appendChild(document.getElementById("loadoutPane"));
  document.getElementById("menuSettingsContent")?.appendChild(document.getElementById("settingsPane"));
  if (cycleWeaponBtn) cycleWeaponBtn.textContent = "Settings Panel (Esc)";
  if (shadowQualitySel) shadowQualitySel.value = runtimeSettings.shadowQuality;
  if (autoGpuQualitySel) autoGpuQualitySel.checked = runtimeSettings.autoGpuQuality;
  if (presentationModeSel) presentationModeSel.value = runtimeSettings.presentationMode;
  if (renderTargetSel) renderTargetSel.value = runtimeSettings.renderTarget;
  if (rayTracingCollisionSel) rayTracingCollisionSel.checked = softwareRaytracedCollision;
  applyShadowQuality(runtimeSettings.shadowQuality);
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

  const settingsPane = document.getElementById("settingsPane");
  const loadoutPane = document.getElementById("loadoutPane");
  const savedLoadout = localStorage.getItem("conductDyadraModalLoadout");
  if (savedLoadout) {
    try {
      const saved = JSON.parse(savedLoadout);
      if (loadoutData.rifles[saved.rifleFamily]?.includes(saved.rifleVariant)) {
        loadout.rifleFamily = saved.rifleFamily;
        loadout.rifleVariant = saved.rifleVariant;
      }
      if (loadoutData.bazookas.includes(saved.bazooka)) loadout.bazooka = saved.bazooka;
      if (loadoutData.handguns.includes(saved.handgun)) loadout.handgun = saved.handgun;
      if (loadoutData.melees.includes(saved.meleeWeapon)) loadout.meleeWeapon = saved.meleeWeapon;
      if (rifleFamilySel) rifleFamilySel.value = loadout.rifleFamily;
      fillSelect(rifleVariantSel, loadoutData.rifles[loadout.rifleFamily]);
      if (rifleVariantSel) rifleVariantSel.value = loadout.rifleVariant;
      if (bazookaSel) bazookaSel.value = loadout.bazooka;
      if (handgunSel) handgunSel.value = loadout.handgun;
      if (meleeWeaponSel) meleeWeaponSel.value = loadout.meleeWeapon;
    } catch {
      localStorage.removeItem("conductDyadraModalLoadout");
    }
  }

  rifleFamilySel?.addEventListener("change", () => {
    loadout.rifleFamily = rifleFamilySel.value;
    fillSelect(rifleVariantSel, loadoutData.rifles[loadout.rifleFamily]);
    loadout.rifleVariant = loadoutData.rifles[loadout.rifleFamily][0];
    if (rifleVariantSel) rifleVariantSel.value = loadout.rifleVariant;
    initWeaponModel();
  });
  rifleVariantSel?.addEventListener("change", () => { loadout.rifleVariant = rifleVariantSel.value; });
  bazookaSel?.addEventListener("change", () => { loadout.bazooka = bazookaSel.value; });
  handgunSel?.addEventListener("change", () => { loadout.handgun = handgunSel.value; });
  meleeWeaponSel?.addEventListener("change", () => { loadout.meleeWeapon = meleeWeaponSel.value; });

  nextBtn?.addEventListener("click", () => beginGame("multiplayer"));
  opsBtn?.addEventListener("click", () => beginGame("operations-ai"));
  menuStartBotsBtn?.addEventListener("click", () => beginGame("operations-ai"));
  menuStartWorldBtn?.addEventListener("click", () => beginGame("multiplayer"));
  menuSettingsBtn?.addEventListener("click", () => showMenuPage("settings"));
  menuLoadoutBtn?.addEventListener("click", () => showMenuPage("loadout"));
  menuStatsBtn?.addEventListener("click", () => showMenuPage("stats"));
  menuExitBtn?.addEventListener("click", () => window.chrome?.webview?.postMessage("exit"));
  document.getElementById("resetKeybindsBtn")?.addEventListener("click", resetInputBindings);
  returnMainMenuBtn?.addEventListener("click", () => {
    if (!window.confirm("Are you sure you want to return to the Main Menu? Your current round will end.")) return;
    uiState.stage = "loadout";
    uiState.gameMode = "multiplayer";
    uiState.settingsOpen = false;
    uiState.menuPage = "home";
    returnMainMenuBtn.hidden = true;
    worldRuntime.projectiles.length = 0;
    worldRuntime.enemyProjectiles.length = 0;
    worldRuntime.meleeFx.length = 0;
    player.triggerHeld = false;
    player.aimZoomHeld = false;
    try { document.exitPointerLock(); } catch {
      // ignore
    }
    syncMenuPage();
    syncUi();
  });
  document.querySelectorAll(".menu-back").forEach((button) => {
    button.addEventListener("click", () => showMenuPage("home"));
  });
  document.getElementById("saveLoadoutBtn")?.addEventListener("click", () => {
    localStorage.setItem("conductDyadraModalLoadout", JSON.stringify(loadout));
    const button = document.getElementById("saveLoadoutBtn");
    if (button) button.textContent = "Load Out Saved";
  });

  let hostBorderlessMode = Boolean(window.chrome?.webview);
  settingsFullscreenBtn?.addEventListener("click", async () => {
    if (window.chrome?.webview) {
      window.chrome.webview.postMessage("toggleWindowMode");
      return;
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Ignore browser/API denial and keep game running.
    }
  });
  const syncFullscreenLabel = () => {
    const active = window.chrome?.webview ? hostBorderlessMode : Boolean(document.fullscreenElement);
    if (settingsFullscreenBtn) settingsFullscreenBtn.textContent = `Toggle Fullscreen: ${active ? "On" : "Off"}`;
  };
  document.addEventListener("fullscreenchange", syncFullscreenLabel);
  window.chrome?.webview?.addEventListener("message", (event) => {
    if (event.data === "window-mode:borderless") hostBorderlessMode = true;
    if (event.data === "window-mode:windowed") hostBorderlessMode = false;
    syncFullscreenLabel();
  });
  syncFullscreenLabel();
  lowVramProfileBtn?.addEventListener("click", () => {
    runtimeSettings.lowVramProfile = !runtimeSettings.lowVramProfile;
    runtimeSettings.autoGpuQuality = !runtimeSettings.lowVramProfile;
    if (autoGpuQualitySel) autoGpuQualitySel.checked = runtimeSettings.autoGpuQuality;
    if (runtimeSettings.lowVramProfile) {
      applyShadowQuality("soft-low");
      applyRenderScale(0.65);
    } else {
      applyRenderScale(1);
    }
    if (lowVramProfileBtn) lowVramProfileBtn.textContent = `Low VRAM Profile: ${runtimeSettings.lowVramProfile ? "On" : "Off"}`;
  });
  mouseSensitivityX?.addEventListener("input", () => {
    lookSensitivityX = Number(mouseSensitivityX.value) / 100;
    if (mouseSensitivityXText) mouseSensitivityXText.value = `${mouseSensitivityX.value}%`;
  });
  mouseSensitivityY?.addEventListener("input", () => {
    lookSensitivityY = Number(mouseSensitivityY.value) / 100;
    if (mouseSensitivityYText) mouseSensitivityYText.value = `${mouseSensitivityY.value}%`;
  });

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

  shadowQualitySel?.addEventListener("change", () => {
    runtimeSettings.autoGpuQuality = false;
    if (autoGpuQualitySel) autoGpuQualitySel.checked = false;
    applyShadowQuality(shadowQualitySel.value);
  });
  autoGpuQualitySel?.addEventListener("change", () => {
    runtimeSettings.autoGpuQuality = Boolean(autoGpuQualitySel.checked);
  });
  presentationModeSel?.addEventListener("change", () => {
    runtimeSettings.presentationMode = presentationModeSel.value;
    lastRenderT = 0;
  });
  renderTargetSel?.addEventListener("change", () => {
    runtimeSettings.renderTarget = renderTargetSel.value;
    if (runtimeSettings.renderTarget === "auto") autoRenderTargetIndex = 0;
    updateRenderTarget();
    lastRenderT = 0;
  });
  rayTracingCollisionSel?.addEventListener("change", () => {
    softwareRaytracedCollision = Boolean(rayTracingCollisionSel.checked);
    updatePerformanceHud();
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
    runtimeSettings.enemyCount = clamp(Math.round((Number(enemyCountSel.value) || BOT_COUNT) / 2) * 2, 16, 96);
    enemyCountSel.value = String(runtimeSettings.enemyCount);
    if (enemyCountText) {
      enemyCountText.textContent = `Enemies: ${runtimeSettings.enemyCount}`;
    }
  });

  applySpawnSettingsBtn?.addEventListener("click", () => {
    rebuildSpawnActors();
  });

  mouseSensitivity?.dispatchEvent(new Event("input"));
  mouseSensitivityX?.dispatchEvent(new Event("input"));
  mouseSensitivityY?.dispatchEvent(new Event("input"));
  spawnSpreadSel?.dispatchEvent(new Event("input"));
  structureDensitySel?.dispatchEvent(new Event("input"));
  enemyCountSel?.dispatchEvent(new Event("input"));

  if (loadoutPane) loadoutPane.querySelector("h3").textContent = "Weapon Selection";
  if (settingsPane) settingsPane.querySelector("h3").textContent = "Gameplay Settings";
  initMusicUi();
  renderInputBindings();
  syncMenuPage();
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

function attachActorHealthBar(actor) {
  if (!actor.mesh || actor.healthBar || actor.health <= 0) return;
  actor.healthBar = createHealthBarGroup();
  actor.healthBar.position.set(0, actor.bounds.halfH + 8, 0);
  const widthScale = clamp(actor.bounds.halfW / 5, 0.8, 5);
  actor.healthBar.scale.set(widthScale, widthScale, widthScale);
  actor.healthBar.visible = false;
  actor.mesh.add(actor.healthBar);
  updateBotHealthBar(actor);
}

function syncPlayerHealthUi() {
  const ratio = clamp(player.health / PLAYER_MAX_HEALTH, 0, 1);
  if (playerHealthFill) {
    playerHealthFill.style.width = `${(ratio * 100).toFixed(1)}%`;
    playerHealthFill.style.backgroundColor = "#0c5a51";
  }
  if (playerHealthText) playerHealthText.textContent = `${Math.round(player.health)} / ${PLAYER_MAX_HEALTH}`;
}

function respawnPlayer() {
  if (!player.isDead || player.respawnTimer > 0 || matchState.ended) return;
  player.pos.copy(findTeamRespawnPosition(player.team, 0));
  player.prevPos.copy(player.pos);
  player.vel.set(0, 0, 0);
  player.health = PLAYER_MAX_HEALTH;
  player.isDead = false;
  player.respawnTimer = 0;
  player.deathVelocity.set(0, 0, 0);
  player.deathSpin.set(0, 0, 0);
  player.deathPitch = 0;
  player.deathRoll = 0;
  player.recoilPitch = 0;
  player.recoilYaw = 0;
  player.magazineAmmo = PLAYER_MAGAZINE_SIZE;
  player.reloadTimer = 0;
  player.fireCooldown = 0;
  syncPlayerHealthUi();
  syncCombatHud();
  if (!uiState.settingsOpen) canvas.requestPointerLock?.();
}

function damagePlayer(damage, impactDirection = null) {
  if (player.isDead || matchState.ended) return;
  player.health = Math.max(0, player.health - damage);
  syncPlayerHealthUi();
  if (player.health > 0) return;

  player.isDead = true;
  player.respawnTimer = PLAYER_RESPAWN_SECONDS;
  player.deathVelocity.copy(impactDirection
    ? impactDirection.clone().normalize().multiplyScalar(22)
    : new THREE.Vector3(randRange(-10, 10), 8, randRange(-10, 10)));
  player.deathVelocity.y += 14;
  player.deathSpin.set(randRange(-3, 3), randRange(-1, 1), randRange(-3, 3));
  player.deathPitch = 0;
  player.deathRoll = 0;
  player.vel.set(0, 0, 0);
  player.triggerHeld = false;
  player.aimZoomHeld = false;
  spawnBotDefeatEffect(player, 0xff7957);
  keys.clear();
  mouseButtons.clear();
  syncCombatHud();
  recordTeamDeath(player.team);
}

function updateBotHealthBar(actor) {
  if (!actor.healthBar || !actor.healthBar.userData.fill) return;
  const ratio = clamp(actor.health / actor.maxHealth, 0, 1);
  const fill = actor.healthBar.userData.fill;
  fill.scale.x = Math.max(0.02, ratio);
  fill.position.x = (-9.2 * 0.5) * (1 - ratio);
  const barColor = actor.type === "bot" ? (actor.team === "enemy" ? 0xf04444 : 0x45df70) : 0x89d7f5;
  fill.material.color.setHex(barColor);
}

function spawnBotDefeatEffect(actor, colorOverride = null) {
  playExplosionSfx(actor.pos);
  const color = colorOverride || (actor.team === "enemy" ? 0xff493d : 0x58ff98);
  for (let index = 0; index < 16; index++) {
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.5,
      roughness: 0.35,
      metalness: 0.35,
      transparent: true,
      opacity: 1
    });
    const particle = new THREE.Mesh(new THREE.OctahedronGeometry(randRange(0.45, 1.4), 0), material);
    particle.position.set(
      actor.pos.x + randRange(-4, 4),
      actor.pos.y + randRange(6, 20),
      actor.pos.z + randRange(-4, 4)
    );
    particle.castShadow = false;
    scene.add(particle);
    worldRuntime.deathFx.push({
      mesh: particle,
      velocity: new THREE.Vector3(randRange(-18, 18), randRange(8, 28), randRange(-18, 18)),
      spin: new THREE.Vector3(randRange(-8, 8), randRange(-8, 8), randRange(-8, 8)),
      life: 0.8
    });
  }
}

function updateDefeatEffects() {
  for (let index = worldRuntime.deathFx.length - 1; index >= 0; index--) {
    const effect = worldRuntime.deathFx[index];
    effect.life -= DT;
    effect.velocity.y -= 24 * DT;
    effect.mesh.position.addScaledVector(effect.velocity, DT);
    effect.mesh.rotation.x += effect.spin.x * DT;
    effect.mesh.rotation.y += effect.spin.y * DT;
    effect.mesh.rotation.z += effect.spin.z * DT;
    effect.mesh.material.opacity = clamp(effect.life / 0.8, 0, 1);
    if (effect.life <= 0) {
      scene.remove(effect.mesh);
      effect.mesh.geometry.dispose();
      effect.mesh.material.dispose();
      worldRuntime.deathFx.splice(index, 1);
    }
  }
}

function markActorHit(actor, damage, impactDirection = null) {
  if (!actor || actor.health <= 0) return;
  if (actor.type === "structure") {
    applyStructureDamage(actor, damage);
    return;
  }
  actor.healthRevealTimer = 6;
  actor.health = Math.max(0, actor.health - damage);
  updateBotHealthBar(actor);
  if (actor.type === "bot" && actor.health <= 0) {
    actor.respawnTimer = PLAYER_RESPAWN_SECONDS;
    actor.deathVelocity.copy(impactDirection
      ? impactDirection.clone().normalize().multiplyScalar(22)
      : new THREE.Vector3(randRange(-10, 10), 8, randRange(-10, 10)));
    actor.deathVelocity.y += 14;
    actor.deathSpin.set(randRange(-3, 3), randRange(-1, 1), randRange(-3, 3));
    actor.deathPitch = 0;
    actor.deathRoll = 0;
    spawnBotDefeatEffect(actor);
    recordTeamDeath(actor.team);
  }
  if (actor.health <= 0 && actor.type === "ship") {
    actor.destroyed = true;
    actor.mesh?.remove(actor.healthBar);
    actor.healthBar = null;
    if (actor.mesh) actor.mesh.visible = false;
  }
}

function applyBotTeamLighting(actor) {
  if (!actor.mesh) return;
  const emissiveColor = actor.team === "enemy" ? 0xb51f16 : 0x168f45;
  actor.mesh.traverse((node) => {
    if (!node.isMesh || !node.material) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const teamMaterials = materials.map((material) => {
      if (!material.emissive || material.emissive.getHex() === 0 || material.emissiveIntensity <= 0) {
        return material;
      }
      const teamMaterial = material.clone();
      teamMaterial.emissive.setHex(emissiveColor);
      return teamMaterial;
    });
    node.material = Array.isArray(node.material) ? teamMaterials : teamMaterials[0];
  });
}

function isBotHudVisible(actor, eye, occluders) {
  if (!actor.mesh || !actor.healthBar || actor.health <= 0 || actor.healthRevealTimer <= 0 || actor.destroyed) return false;
  const maxDistance = (player.aimZoomHeld ? 2800 : 1400) * FEET_TO_METERS;
  const barPosition = new THREE.Vector3(actor.pos.x, actor.pos.y + actor.bounds.halfH + 8, actor.pos.z);
  const distance = eye.distanceTo(barPosition);
  if (distance > maxDistance) return false;

  const screenPosition = barPosition.project(camera);
  if (screenPosition.z < -1 || screenPosition.z > 1) return false;
  const screenX = (screenPosition.x * 0.5 + 0.5) * canvas.clientWidth;
  const screenY = (1 - (screenPosition.y * 0.5 + 0.5)) * canvas.clientHeight;
  if (Math.hypot(screenX - canvas.clientWidth * 0.5, screenY - canvas.clientHeight * 0.5) > 200) return false;

  const direction = barPosition.sub(eye);
  const rayLength = direction.length();
  direction.normalize();
  botHudRaycaster.set(eye, direction);
  botHudRaycaster.far = rayLength;
  return botHudRaycaster.intersectObjects(occluders.filter((mesh) => mesh !== actor.mesh), true).length === 0;
}

function createFallbackMesh(type) {
  if (type === "structure") {
    return new THREE.Mesh(
      new THREE.CylinderGeometry(16, 16, 70, 9, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x7e8e9f, roughness: 0.45, metalness: 0.78 })
    );
  }
  if (type === "bot") {
    const mech = new THREE.Group();
    const armor = new THREE.MeshStandardMaterial({ color: 0x29343b, roughness: 0.48, metalness: 0.76 });
    const armorLight = new THREE.MeshStandardMaterial({ color: 0x697984, roughness: 0.42, metalness: 0.82 });
    const shadowArmor = new THREE.MeshStandardMaterial({ color: 0x151d22, roughness: 0.58, metalness: 0.62 });
    const cyan = new THREE.MeshStandardMaterial({ color: 0x6ee5f2, emissive: 0x1b8194, emissiveIntensity: 1.1, roughness: 0.24, metalness: 0.45 });
    const addBox = (width, height, depth, x, y, z, material = armor) => {
      const part = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      part.position.set(x, y, z);
      part.castShadow = true;
      part.receiveShadow = true;
      mech.add(part);
      return part;
    };

    addBox(7.2, 4.0, 3.6, 0, 10.1, 0, armor);
    addBox(6.0, 2.2, 3.0, 0, 8.0, 0, shadowArmor);
    addBox(7.4, 2.8, 4.0, -4.4, 12.0, 0, armorLight);
    addBox(7.4, 2.8, 4.0, 4.4, 12.0, 0, armorLight);
    addBox(2.8, 2.2, 2.5, 0, 13.7, 0, armorLight);
    addBox(2.15, 1.25, 0.22, 0, 13.8, -1.32, cyan);
    addBox(3.0, 2.7, 3.4, 0, 6.4, 0, armor);
    addBox(2.5, 5.2, 2.6, -2.0, 3.6, 0, armor);
    addBox(2.5, 5.2, 2.6, 2.0, 3.6, 0, armor);
    addBox(2.0, 3.1, 2.0, -6.5, 8.2, 0, shadowArmor);
    addBox(2.0, 3.1, 2.0, 6.5, 8.2, 0, shadowArmor);
    addBox(2.7, 5.1, 2.7, -6.5, 4.3, -0.3, armorLight);
    addBox(2.7, 5.1, 2.7, 6.5, 4.3, -0.3, armorLight);
    addBox(2.8, 1.1, 3.2, 0, 10.3, -1.92, cyan);
    addBox(1.4, 4.8, 1.4, -2.0, 3.3, -1.62, cyan);
    addBox(1.4, 4.8, 1.4, 2.0, 3.3, -1.62, cyan);

    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x20272c, roughness: 0.8, metalness: 0.4 });
    for (const x of [-2.0, 2.0]) {
      for (const z of [-1.25, 1.0]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 2.25, 8), wheelMaterial);
        wheel.rotation.z = Math.PI * 0.5;
        wheel.position.set(x, 1.45, z);
        wheel.castShadow = true;
        mech.add(wheel);
      }
    }
    return mech;
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

const menuPreviewMech = createFallbackMesh("bot");
menuPreviewMech.scale.setScalar(1.43);
scene.add(menuPreviewMech);
const menuPreviewShots = [];
let nextMenuShotAt = 0;
let lastMenuPreviewTime = performance.now() / 1000;

function updateMenuMechPreview(now) {
  const dt = clamp(now - lastMenuPreviewTime, 0, 0.1);
  lastMenuPreviewTime = now;
  const inMenu = uiState.stage === "loadout";
  menuPreviewMech.visible = inMenu;
  if (inMenu) {
    menuPreviewMech.rotation.y = Math.sin(now * 0.45) * 0.08;
    if (now >= nextMenuShotAt) {
      const start = menuPreviewMech.localToWorld(new THREE.Vector3(-3.2, 13.2, -2.0));
      const direction = new THREE.Vector3(randRange(-0.2, 0.2), 1, randRange(-0.16, 0.16))
        .normalize()
        .applyQuaternion(menuPreviewMech.quaternion);
      const end = start.clone().addScaledVector(direction, 155);
      const beam = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([start, end]),
        new THREE.LineBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0.95, depthWrite: false })
      );
      scene.add(beam);
      menuPreviewShots.push({ beam, life: 0.22 });
      nextMenuShotAt = now + randRange(0.35, 1.65);
    }
  }

  for (let i = menuPreviewShots.length - 1; i >= 0; i--) {
    const shot = menuPreviewShots[i];
    shot.life -= dt;
    shot.beam.material.opacity = clamp(shot.life / 0.12, 0, 0.95);
    if (shot.life <= 0) {
      scene.remove(shot.beam);
      shot.beam.geometry.dispose();
      shot.beam.material.dispose();
      menuPreviewShots.splice(i, 1);
    }
  }
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

function addWeaponPart(group, geometry, material, position, rotation = null) {
  const part = new THREE.Mesh(geometry, material);
  part.position.set(position[0], position[1], position[2]);
  if (rotation) part.rotation.set(rotation[0], rotation[1], rotation[2]);
  part.castShadow = true;
  part.receiveShadow = true;
  group.add(part);
  return part;
}

function createScopeModel(accentMaterial) {
  const scope = new THREE.Group();
  const tubeMaterial = new THREE.MeshStandardMaterial({ color: 0x18242b, metalness: 0.88, roughness: 0.28 });
  const lensMaterial = new THREE.MeshStandardMaterial({
    color: 0x82c9d8,
    emissive: 0x16465a,
    emissiveIntensity: 0.55,
    metalness: 0.42,
    roughness: 0.16,
    transparent: true,
    opacity: 0.82
  });
  const tube = addWeaponPart(scope, new THREE.CylinderGeometry(0.045, 0.052, 0.24, 12), tubeMaterial, [0, 0, 0], [Math.PI / 2, 0, 0]);
  tube.position.z = -0.02;
  addWeaponPart(scope, new THREE.CylinderGeometry(0.067, 0.067, 0.035, 12), accentMaterial, [0, 0, 0.105], [Math.PI / 2, 0, 0]);
  addWeaponPart(scope, new THREE.CylinderGeometry(0.062, 0.062, 0.018, 16), lensMaterial, [0, 0, -0.145], [Math.PI / 2, 0, 0]);
  addWeaponPart(scope, new THREE.BoxGeometry(0.045, 0.065, 0.09), tubeMaterial, [0, -0.075, 0.015]);
  return scope;
}

function initWeaponModel() {
  for (const oldPart of [...weaponAnchor.children]) {
    weaponAnchor.remove(oldPart);
    oldPart.traverse((node) => {
      if (!node.isMesh) return;
      node.geometry?.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) material?.dispose();
    });
  }
  weaponAnchor.userData.scope = null;
  const familyAccent = { M4: 0x465b68, SCAR: 0x766448, G36C: 0x45695c }[loadout.rifleFamily] || 0x45695c;
  const receiverMaterial = new THREE.MeshStandardMaterial({ color: 0x29343b, roughness: 0.42, metalness: 0.68 });
  const polymerMaterial = new THREE.MeshStandardMaterial({ color: 0x151d22, roughness: 0.62, metalness: 0.28 });
  const railMaterial = new THREE.MeshStandardMaterial({ color: familyAccent, roughness: 0.34, metalness: 0.8 });
  const barrelMaterial = new THREE.MeshStandardMaterial({ color: 0x68737a, roughness: 0.3, metalness: 0.88 });
  addWeaponPart(weaponAnchor, new THREE.BoxGeometry(0.15, 0.14, 0.48), receiverMaterial, [0, -0.015, -0.28]);
  addWeaponPart(weaponAnchor, new THREE.BoxGeometry(0.14, 0.12, 0.39), polymerMaterial, [0, -0.005, -0.66]);
  addWeaponPart(weaponAnchor, new THREE.BoxGeometry(0.16, 0.105, 0.26), polymerMaterial, [0, -0.015, 0.055]);
  addWeaponPart(weaponAnchor, new THREE.BoxGeometry(0.09, 0.19, 0.14), polymerMaterial, [0, -0.155, -0.23], [-0.12, 0, 0]);
  addWeaponPart(weaponAnchor, new THREE.CylinderGeometry(0.024, 0.024, 0.43, 10), barrelMaterial, [0, 0.005, -0.99], [Math.PI / 2, 0, 0]);
  addWeaponPart(weaponAnchor, new THREE.CylinderGeometry(0.033, 0.033, 0.12, 10), railMaterial, [0, 0.005, -1.2], [Math.PI / 2, 0, 0]);
  addWeaponPart(weaponAnchor, new THREE.BoxGeometry(0.16, 0.025, 0.55), railMaterial, [0, 0.085, -0.43]);
  addWeaponPart(weaponAnchor, new THREE.BoxGeometry(0.055, 0.08, 0.11), polymerMaterial, [0, 0.145, -0.34]);
  const scope = createScopeModel(railMaterial);
  scope.position.set(0, 0.19, -0.38);
  scope.visible = false;
  weaponAnchor.add(scope);
  weaponAnchor.userData.scope = scope;
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

function createActor(type, x, y, z, team = null) {
  const shipLength = SHIP_MIN_LENGTH_METERS + Math.random() * (SHIP_MAX_LENGTH_METERS - SHIP_MIN_LENGTH_METERS);
  const shipAltitude = type === "ship" ? randRange(1200 * FEET_TO_METERS, BOT_MAX_FLIGHT_ALTITUDE) : 0;
  const structureRadius = randRange(13, 26);
  const structureHeight = randRange(40, 1400) * FEET_TO_METERS;
  const botIsFlying = type === "bot" && Math.random() < 0.65;
  const botFlightAltitude = botIsFlying ? randRange(300 * FEET_TO_METERS, BOT_MAX_FLIGHT_ALTITUDE) : 0;
  const defaultWidth = type === "structure" ? structureRadius * 2 : (type === "ship" ? SHIP_WIDTH_METERS : (type === "bot" ? 14 : 12));
  const defaultHeight = type === "structure" ? structureHeight : (type === "ship" ? SHIP_HEIGHT_METERS : (type === "bot" ? 78 * FEET_TO_METERS : 22));
  const defaultLength = type === "structure" ? structureRadius * 2 : (type === "ship" ? shipLength : (type === "bot" ? 14 : 12));
  const actor = {
    type,
    team,
    pos: new THREE.Vector3(x, type === "structure" ? structureHeight * 0.5 : (type === "bot" ? botFlightAltitude : (type === "ship" ? shipAltitude : y)), z),
    prevPos: new THREE.Vector3(x, type === "structure" ? structureHeight * 0.5 : (type === "bot" ? botFlightAltitude : (type === "ship" ? shipAltitude : y)), z),
    yaw: Math.random() * Math.PI * 2,
    speed: type === "ship" ? 22 + Math.random() * 16 : (type === "bot" ? BOT_FLY_SPEED * BOT_DIFFICULTY_SPEED : 0),
    flightPhase: Math.random() * Math.PI * 2,
    strafeSign: Math.random() < 0.5 ? -1 : 1,
    isFlying: botIsFlying,
    flightAltitude: botFlightAltitude,
    shipAltitude,
    movementModeTimer: type === "bot" ? (botIsFlying ? randRange(8, 18) : randRange(3, 8)) : 0,
    sprintCharge: 0,
    meleeCooldown: type === "bot" ? randRange(0, 0.7) : 0,
    burstShotsRemaining: 0,
    burstPause: type === "bot" ? randRange(0, 1.2) : 0,
    deathVelocity: new THREE.Vector3(),
    deathSpin: new THREE.Vector3(),
    deathPitch: 0,
    deathRoll: 0,
    respawnTimer: 0,
    focusPlayer: type === "bot" && Math.random() < 0.3,
    playerFocusTimer: type === "bot" ? randRange(2, 5) : 0,
    shipLength,
    maxHealth: type === "bot" ? BOT_MAX_HEALTH : ((type === "structure" || type === "ship") ? STRUCTURE_STAGE_HEALTH[0] : 0),
    health: type === "bot" ? BOT_MAX_HEALTH : ((type === "structure" || type === "ship") ? STRUCTURE_STAGE_HEALTH[0] : 0),
    healthRevealTimer: 0,
    destroyed: false,
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
    healthBar: null,
    teamMarker: null
  };
  if (type === "structure") updateStructureBoundsForStage(actor);
  actors.push(actor);

  if (type === "structure" && LOW_MEMORY_HINT) {
    actor.mesh = createStructureMesh(actor);
    actor.mesh.position.copy(actor.pos);
    scene.add(actor.mesh);
    attachActorHealthBar(actor);
    return;
  }

  buildVisual(type).then((mesh) => {
    actor.mesh = mesh;
    actor.mesh.position.copy(actor.pos);
    actor.mesh.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    if (type === "bot") fitMeshToDimensions(actor.mesh, 14, 78 * FEET_TO_METERS, 14);
    if (type === "structure") fitMeshToDimensions(actor.mesh, structureRadius * 2, structureHeight, structureRadius * 2);
    if (type === "ship") {
      fitMeshToDimensions(actor.mesh, SHIP_WIDTH_METERS, SHIP_HEIGHT_METERS, actor.shipLength);
    }
    scene.add(actor.mesh);

    if (type === "bot") applyBotTeamLighting(actor);
    if (type === "bot" || type === "structure" || type === "ship") attachActorHealthBar(actor);
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

function findTeamRespawnPosition(team, altitude = 0, excludedActor = null) {
  const allies = actors.filter((actor) => actor !== excludedActor && actor.type === "bot" && actor.team === team && actor.health > 0 && !actor.destroyed);
  const enemies = actors.filter((actor) => actor !== excludedActor && actor.type === "bot" && actor.team !== team && actor.health > 0 && !actor.destroyed);
  if (player.team !== team && !player.isDead && player.health > 0) enemies.push(player);

  for (const minimumEnemyDistance of [420, 280, 140, 0]) {
    for (let attempt = 0; attempt < 120; attempt++) {
      let x;
      let z;
      if (allies.length > 0 && Math.random() < 0.8) {
        const ally = allies[Math.floor(Math.random() * allies.length)];
        x = ally.pos.x + randRange(-240, 240);
        z = ally.pos.z + randRange(-240, 240);
      } else {
        x = team === "friendly" ? randRange(-900, -250) : randRange(250, 900);
        z = randRange(-800, 800);
      }
      x = clamp(x, -PLAYER_MAP_LIMIT, PLAYER_MAP_LIMIT);
      z = clamp(z, -PLAYER_MAP_LIMIT, PLAYER_MAP_LIMIT);
      if (!isPointClearOfStaticActors(x, z, altitude, altitude + PLAYER_HEIGHT_METERS, 12)) continue;

      const enemyTooClose = enemies.some((enemy) => {
        const dx = x - enemy.pos.x;
        const dy = altitude - enemy.pos.y;
        const dz = z - enemy.pos.z;
        return Math.hypot(dx, dy, dz) < minimumEnemyDistance;
      });
      if (enemyTooClose) continue;
      return new THREE.Vector3(x, altitude, z);
    }
  }

  return new THREE.Vector3(team === "friendly" ? -500 : 500, altitude, 0);
}

function placePlayerAtRandomSpawn() {
  player.pos.copy(findTeamRespawnPosition(player.team, 0));
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
    const team = i < enemyCount / 2 ? "friendly" : "enemy";
    for (let attempt = 0; attempt < 120; attempt++) {
      x = team === "friendly" ? randRange(-650, -250) : randRange(250, 650);
      z = randRange(-550, 550);
      if (isPointClearOfStaticActors(x, z, 7, 28, 8)) break;
    }
    createActor("bot", x, 0, z, team);
  }
  for (let i = 0; i < SHIP_COUNT; i++) {
    createActor("ship", randRange(-MAP_HALF, MAP_HALF), 0, randRange(-MAP_HALF, MAP_HALF));
  }

  placePlayerAtRandomSpawn();
  player.prevPos.copy(player.pos);
  syncTeamHud();
}

function spawnPlayerProjectile() {
  playWeaponFireSfx(false, new THREE.Vector3(player.pos.x, player.pos.y + EYE_HEIGHT_METERS, player.pos.z));
  camera.position.set(player.pos.x, player.pos.y + EYE_HEIGHT_METERS, player.pos.z);
  camera.rotation.order = "YXZ";
  camera.rotation.set(player.pitch + player.recoilPitch + player.deathPitch, player.yaw + player.recoilYaw, player.roll + player.deathRoll, "YXZ");
  camera.updateMatrixWorld(true);
  weaponAnchor.updateMatrixWorld(true);
  const forward = camera.getWorldDirection(new THREE.Vector3()).normalize();
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  const origin = weaponAnchor.localToWorld(new THREE.Vector3(0, 0, -1.26));
  const aimPoint = camera.position.clone().addScaledVector(forward, PLAYER_AIM_REFERENCE_RANGE);
  const direction = aimPoint.sub(origin).normalize();
  const weaponKey = loadout.rifleVariant;
  const shotsFired = worldRuntime.weaponShotsFired[weaponKey] || 0;
  const spreadFeet = shotsFired === 0 ? PLAYER_FIRST_SHOT_SPREAD_FEET : PLAYER_FOLLOWUP_SPREAD_FEET;
  const spreadRadius = Math.sqrt(Math.random()) * spreadFeet * FEET_TO_METERS;
  const spreadAngle = Math.random() * Math.PI * 2;
  direction
    .addScaledVector(right, Math.cos(spreadAngle) * spreadRadius / PLAYER_AIM_REFERENCE_RANGE)
    .addScaledVector(up, Math.sin(spreadAngle) * spreadRadius / PLAYER_AIM_REFERENCE_RANGE)
    .normalize();

  worldRuntime.weaponShotsFired[weaponKey] = shotsFired + 1;
  worldRuntime.playerRoundsFired++;
  const glowRound = (worldRuntime.playerRoundsFired % 6) === 0;
  const proj = {
    pos: origin,
    prevPos: origin.clone(),
    vel: direction.clone().multiplyScalar(PROJECTILE_SPEED),
    ownerTeam: player.team,
    life: PROJECTILE_RANGE / PROJECTILE_SPEED,
    mesh: createNineSideProjectileMesh(glowRound, false)
  };
  proj.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  proj.mesh.position.copy(proj.pos);
  scene.add(proj.mesh);
  worldRuntime.projectiles.push(proj);
  player.recoilPitch = Math.min(0.055, player.recoilPitch + 0.0035);
  player.recoilYaw = clamp(player.recoilYaw + randRange(-0.0007, 0.0007), -0.012, 0.012);
  player.weaponRecoil = Math.min(1, player.weaponRecoil + 0.32);
}

function spawnEnemyProjectile(actor, target) {
  if (worldRuntime.enemyProjectiles.length >= ENEMY_PROJECTILE_MAX) return;
  playWeaponFireSfx(true, new THREE.Vector3(actor.pos.x, actor.pos.y + 12, actor.pos.z));

  const start = new THREE.Vector3(actor.pos.x, actor.pos.y + 12, actor.pos.z);
  const aimAtPlayer = target === player;
  const aimPos = aimAtPlayer
    ? new THREE.Vector3(player.pos.x, player.pos.y + EYE_HEIGHT_METERS * 0.86, player.pos.z)
    : new THREE.Vector3(target.pos.x, target.pos.y + 12, target.pos.z);
  const dir = aimPos.sub(start).normalize();
  dir.x += (Math.random() - 0.5) * ENEMY_PROJECTILE_SPREAD;
  dir.y += (Math.random() - 0.5) * ENEMY_PROJECTILE_SPREAD * 0.8;
  dir.z += (Math.random() - 0.5) * ENEMY_PROJECTILE_SPREAD;
  dir.normalize();

  const proj = {
    pos: start,
    prevPos: start.clone(),
    vel: dir.multiplyScalar(PROJECTILE_SPEED),
    life: PROJECTILE_RANGE / PROJECTILE_SPEED,
    ownerTeam: actor.team,
    target: aimAtPlayer ? null : target,
    targetsPlayer: aimAtPlayer,
    mesh: createNineSideProjectileMesh(true, actor.team === "enemy", actor.team === "friendly")
  };
  proj.mesh.scale.z = 8;
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
      new THREE.TorusGeometry(MELEE_RANGE * 0.9, 0.18, 6, 36, Math.PI * 0.78),
      new THREE.MeshBasicMaterial({ color: 0xb8f8ff, transparent: true, opacity: 0.82 })
    )
  };
  fx.mesh.position.copy(eye).addScaledVector(dir, MELEE_RANGE * 0.5);
  fx.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
  scene.add(fx.mesh);
  worldRuntime.meleeFx.push(fx);

  for (const actor of actors) {
    if (actor.type !== "bot" || actor.team === player.team || actor.health <= 0) continue;
    const toBot = tmpVecA.set(actor.pos.x - eye.x, (actor.pos.y + 10) - eye.y, actor.pos.z - eye.z);
    const dist = toBot.length();
    if (dist > MELEE_RANGE) continue;
    toBot.normalize();
    const dot = toBot.dot(dir);
    if (dot < MELEE_ARC_COS) continue;
    markActorHit(actor, 45);
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
    if ((actor.type !== "structure" && actor.type !== "ship") || actor.health <= 0 || actor.destroyed) continue;
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

    if (!softwareRaytracedCollision) {
      const pointX = (b.x - actor.pos.x) * c + (b.z - actor.pos.z) * s;
      const pointZ = -(b.x - actor.pos.x) * s + (b.z - actor.pos.z) * c;
      const pointY = b.y - actor.pos.y;
      if (Math.abs(pointX) <= actor.bounds.halfW + 1.5 && Math.abs(pointZ) <= actor.bounds.halfL + 1.5 && Math.abs(pointY) <= actor.bounds.halfH + 1.5) return actor;
      continue;
    }

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

function updateProjectiles(projectileDt = PROJECTILE_DT) {
  for (let i = worldRuntime.projectiles.length - 1; i >= 0; i--) {
    const p = worldRuntime.projectiles[i];
    p.prevPos.copy(p.pos);
    p.pos.addScaledVector(p.vel, projectileDt);
    p.life -= projectileDt;
    p.mesh.position.copy(p.pos);
    p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.vel.clone().normalize());

    let hit = false;
    for (const actor of actors) {
      if (actor.type !== "bot" || actor.team === player.team || actor.health <= 0) continue;
      const dx = p.pos.x - actor.pos.x;
      const dz = p.pos.z - actor.pos.z;
      const dy = p.pos.y - (actor.pos.y + 10);
      if ((dx * dx + dz * dz) < (actor.bounds.halfW + 2.5) ** 2 && Math.abs(dy) < actor.bounds.halfH + 4) {
        markActorHit(actor, 26, p.vel);
        hit = true;
        break;
      }
    }

    const worldHitActor = !hit ? testProjectileVsStructures(p.prevPos, p.pos) : null;
    if (worldHitActor) {
      markActorHit(worldHitActor, 38);
      hit = true;
    }
    if (hit || p.life <= 0) {
      removeProjectile(worldRuntime.projectiles, i);
    }
  }

  for (let i = worldRuntime.enemyProjectiles.length - 1; i >= 0; i--) {
    const p = worldRuntime.enemyProjectiles[i];
    const target = p.targetsPlayer ? player : p.target;
    if (!target || (!p.targetsPlayer && target.health <= 0)) {
      removeProjectile(worldRuntime.enemyProjectiles, i);
      continue;
    }
    p.prevPos.copy(p.pos);
    p.pos.addScaledVector(p.vel, projectileDt);
    p.life -= projectileDt;
    p.mesh.position.copy(p.pos);
    p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.vel.clone().normalize());

    const dx = p.pos.x - target.pos.x;
    const dz = p.pos.z - target.pos.z;
    const targetCenterY = p.targetsPlayer
      ? target.pos.y + EYE_HEIGHT_METERS * 0.8
      : target.pos.y + 10;
    const dy = p.pos.y - targetCenterY;
    const targetRadius = p.targetsPlayer ? PLAYER_COLLISION_RADIUS + 1.8 : target.bounds.halfW + 2.5;
    const targetHalfHeight = p.targetsPlayer ? EYE_HEIGHT_METERS * 0.75 : target.bounds.halfH + 4;
    const targetHit = (dx * dx + dz * dz) < targetRadius ** 2 && Math.abs(dy) < targetHalfHeight;
    const worldHitActor = !targetHit ? testProjectileVsStructures(p.prevPos, p.pos) : null;
    const worldHit = Boolean(worldHitActor);
    if (worldHitActor) markActorHit(worldHitActor, 16);
    if (targetHit && p.targetsPlayer) {
      damagePlayer(7.5, p.vel);
    } else if (targetHit) {
      markActorHit(target, 7.5, p.vel);
    }

    if (targetHit || worldHit || p.life <= 0) {
      removeProjectile(worldRuntime.enemyProjectiles, i);
    }
  }
}

function applyLookInput() {
  const lookSpeedX = lookSensitivity * lookSensitivityX * 0.0158;
  const lookSpeedY = lookSensitivity * lookSensitivityY * 0.0158;
  const dx = lookState.pendingX;
  const dy = lookState.pendingY;
  lookState.pendingX = 0;
  lookState.pendingY = 0;

  // Raw, fixed-step mouse integration for axis-accurate camera control.
  player.yaw -= dx * lookSpeedX;
  const pitchInput = runtimeSettings.invertMouseY ? -dy : dy;
  player.pitch = clamp(player.pitch + pitchInput * lookSpeedY, -PLAYER_MAX_PITCH, PLAYER_MAX_PITCH);
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

function findBotTarget(actor) {
  let nearest = null;
  let nearestDistanceSq = (1600 * 1600);
  if (actor.focusPlayer && !player.isDead && player.health > 0) {
    const dx = player.pos.x - actor.pos.x;
    const dz = player.pos.z - actor.pos.z;
    const playerDistanceSq = dx * dx + dz * dz;
    if (playerDistanceSq < nearestDistanceSq) {
      nearestDistanceSq = playerDistanceSq;
      nearest = player;
    }
  }
  for (const candidate of actors) {
    if (candidate === actor || candidate.type !== "bot" || candidate.health <= 0 || candidate.team === actor.team) continue;
    const dx = candidate.pos.x - actor.pos.x;
    const dz = candidate.pos.z - actor.pos.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < nearestDistanceSq) {
      nearestDistanceSq = distanceSq;
      nearest = candidate;
    }
  }
  return nearest;
}

function applyBotMeleeAttack(actor, target) {
  const botCenter = new THREE.Vector3(actor.pos.x, actor.pos.y + 39 * FEET_TO_METERS, actor.pos.z);
  const targetCenter = target === player
    ? new THREE.Vector3(player.pos.x, player.pos.y + EYE_HEIGHT_METERS * 0.75, player.pos.z)
    : new THREE.Vector3(target.pos.x, target.pos.y + 39 * FEET_TO_METERS, target.pos.z);
  const direction = targetCenter.sub(botCenter);
  if (direction.length() > MELEE_RANGE) return false;
  direction.normalize();
  if (direction.x * Math.cos(actor.yaw) + direction.z * Math.sin(actor.yaw) < MELEE_ARC_COS) return false;

  if (target === player) {
    damagePlayer(14, direction);
  } else {
    markActorHit(target, 30);
  }
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(MELEE_RANGE * 0.45, 0.24, 5, 24, Math.PI * 0.6),
    new THREE.MeshBasicMaterial({ color: actor.team === "enemy" ? 0xff514b : 0x54f08b, transparent: true, opacity: 0.64 })
  );
  mesh.position.copy(botCenter).addScaledVector(direction, MELEE_RANGE * 0.38);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  scene.add(mesh);
  worldRuntime.meleeFx.push({ mesh, life: 0.18 });
  return true;
}

function moveBotAltitude(actor, targetAltitude, aiDt) {
  const maxStep = BOT_VERTICAL_FLIGHT_SPEED * aiDt;
  actor.pos.y += clamp(targetAltitude - actor.pos.y, -maxStep, maxStep);
}

function updateBotTactics(actor, aiDt) {
  actor.fireCooldown -= aiDt;
  actor.meleeCooldown -= aiDt;
  actor.burstPause = Math.max(0, actor.burstPause - aiDt);
  actor.playerFocusTimer -= aiDt;
  if (actor.playerFocusTimer <= 0) {
    actor.focusPlayer = Math.random() < 0.32;
    actor.playerFocusTimer = randRange(2.5, 6);
  }
  actor.movementModeTimer -= aiDt;
  if (actor.movementModeTimer <= 0) {
    actor.isFlying = !actor.isFlying;
    actor.flightAltitude = actor.isFlying ? randRange(300 * FEET_TO_METERS, BOT_MAX_FLIGHT_ALTITUDE) : 0;
    actor.movementModeTimer = actor.isFlying ? randRange(9, 24) : randRange(3, 8);
    if (Math.random() < 0.55) actor.strafeSign *= -1;
  }
  const target = findBotTarget(actor);
  if (!target) {
    actor.sprintCharge = clamp(actor.sprintCharge + aiDt / MECH_SPRINT_RAMP_SECONDS, 0, 1);
    actor.yaw += actor.strafeSign * 0.18 * aiDt;
    const speed = actor.speed * (1 + (MECH_SPRINT_MULTIPLIER - 1) * actor.sprintCharge);
    actor.pos.x += Math.cos(actor.yaw) * speed * aiDt;
    actor.pos.z += Math.sin(actor.yaw) * speed * aiDt;
    const altitude = actor.isFlying
      ? actor.flightAltitude + Math.sin(physicsStepCount * 0.00055 + actor.flightPhase) * 30 * FEET_TO_METERS
      : 0;
    moveBotAltitude(actor, clamp(altitude, 0, BOT_MAX_FLIGHT_ALTITUDE), aiDt);
    return;
  }

  const dx = target.pos.x - actor.pos.x;
  const dz = target.pos.z - actor.pos.z;
  const distance = Math.hypot(dx, dz);
  const bearing = Math.atan2(dz, dx);
  actor.yaw = bearing;
  const retreating = distance < 155;
  const sprinting = distance > 480 || retreating;
  actor.sprintCharge = clamp(actor.sprintCharge + (sprinting ? aiDt / MECH_SPRINT_RAMP_SECONDS : -aiDt / 0.35), 0, 1);
  const movementSpeed = actor.speed * (1 + (MECH_SPRINT_MULTIPLIER - 1) * actor.sprintCharge);
  const movementAngle = distance > 480
    ? bearing
    : (retreating ? bearing + Math.PI : bearing + actor.strafeSign * Math.PI * 0.5);
  const flightTarget = actor.isFlying
    ? actor.flightAltitude + Math.sin(physicsStepCount * 0.00022 + actor.flightPhase) * 30 * FEET_TO_METERS
    : 0;
  moveBotAltitude(actor, clamp(flightTarget, 0, BOT_MAX_FLIGHT_ALTITUDE), aiDt);
  actor.pos.x += Math.cos(movementAngle) * movementSpeed * aiDt;
  actor.pos.z += Math.sin(movementAngle) * movementSpeed * aiDt;

  const fullDistance = actor.pos.distanceTo(target.pos);
  if (fullDistance <= MELEE_RANGE && actor.meleeCooldown <= 0) {
    applyBotMeleeAttack(actor, target);
    actor.meleeCooldown = 1.05;
  } else if (distance < 1250 && actor.fireCooldown <= 0 && actor.burstPause <= 0) {
    if (actor.burstShotsRemaining <= 0) actor.burstShotsRemaining = 4;
    spawnEnemyProjectile(actor, target);
    actor.fireCooldown = 1 / ENEMY_FIRE_RATE;
    actor.burstShotsRemaining--;
    if (actor.burstShotsRemaining === 0) actor.burstPause = randRange(0.65, 1.35);
  }
}

function physicsStep() {
  if (uiState.stage !== "multiplayer") return;
  physicsStepCount++;
  matchState.elapsedSeconds += DT;
  if (matchState.elapsedSeconds >= MATCH_DURATION_SECONDS) {
    matchState.elapsedSeconds = MATCH_DURATION_SECONDS;
    finishMatch("The 10-minute match has ended.");
    return;
  }
  const matchSecond = Math.floor(matchState.elapsedSeconds);
  if (matchSecond !== matchState.lastHudSecond) {
    matchState.lastHudSecond = matchSecond;
    syncTeamHud();
  }
  if (player.isDead && player.respawnTimer > 0) {
    player.respawnTimer = Math.max(0, player.respawnTimer - DT);
    if (player.respawnTimer === 0) syncTeamHud();
  }
  player.prevPos.copy(player.pos);
  if (player.isDead) {
    player.deathVelocity.y -= 24 * DT;
    player.pos.addScaledVector(player.deathVelocity, DT);
    player.deathPitch += player.deathSpin.x * DT;
    player.yaw += player.deathSpin.y * DT;
    player.deathRoll += player.deathSpin.z * DT;
    if (player.pos.y <= 0) {
      player.pos.y = 0;
      player.deathVelocity.y = 0;
      player.deathVelocity.x *= Math.exp(-3 * DT);
      player.deathVelocity.z *= Math.exp(-3 * DT);
    }
  }
  if ((physicsStepCount % CHARACTER_VISUAL_STEP_INTERVAL) === 0) updateCharacterVisuals();
  applyLookInput();

  if (player.fireCooldown > 0) player.fireCooldown -= DT;
  if (player.meleeCooldown > 0) player.meleeCooldown -= DT;
  if (player.reloadTimer > 0) {
    player.reloadTimer = Math.max(0, player.reloadTimer - DT);
    syncCombatHud();
    if (player.reloadTimer === 0) {
      player.magazineAmmo = PLAYER_MAGAZINE_SIZE;
      syncCombatHud();
    }
  }

  if (!player.isDead && player.triggerHeld && player.fireCooldown <= 0 && player.reloadTimer <= 0) {
    if (player.magazineAmmo <= 0) {
      startPlayerReload();
    } else {
      spawnPlayerProjectile();
      player.magazineAmmo--;
      player.fireCooldown = 1 / PLAYER_FIRE_RATE;
      syncCombatHud();
      if (player.magazineAmmo === 0) startPlayerReload();
    }
  }

  const sprintDelta = !player.isDead && isActionPressed("sprint") ? DT / MECH_SPRINT_RAMP_SECONDS : -DT / 0.35;
  player.sprintCharge = clamp(player.sprintCharge + sprintDelta, 0, 1);
  const shiftSprintHeld = !player.isDead && isActionPressed("sprint") && (keys.has("ShiftLeft") || keys.has("ShiftRight"));
  const shiftSprintDelta = shiftSprintHeld ? DT / MECH_SPRINT_RAMP_SECONDS : -DT / 0.35;
  player.shiftSprintCharge = clamp(player.shiftSprintCharge + shiftSprintDelta, 0, 1);

  const yaw = player.yaw;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

  const isInFlight = player.pos.y > 0.5;
  const cursorInFlightWindow = Math.abs(player.pitch) <= camera.fov * 0.25;
  const movementPitch = isInFlight && cursorInFlightWindow ? player.pitch : 0;
  tmpQuat.setFromEuler(new THREE.Euler(movementPitch, player.yaw + player.recoilYaw, player.roll, "YXZ"));
  const viewForward = tmpVecA.set(0, 0, -1).applyQuaternion(tmpQuat).normalize();
  const viewRight = tmpVecB.set(1, 0, 0).applyQuaternion(tmpQuat).normalize();
  let moveF = player.isDead ? 0 : (isActionPressed("forward") ? 1 : 0) + (isActionPressed("backward") ? -1 : 0);
  let moveR = player.isDead ? 0 : (isActionPressed("right") ? 1 : 0) + (isActionPressed("left") ? -1 : 0);
  const len = Math.hypot(moveF, moveR) || 1;
  moveF /= len;
  moveR /= len;

  const moveSpeed = MECH_BASE_SPEED * (1
    + (MECH_SPRINT_MULTIPLIER - 1) * player.sprintCharge
    + (MECH_SHIFT_SPRINT_MULTIPLIER - MECH_SPRINT_MULTIPLIER) * player.shiftSprintCharge);
  const desiredVel = new THREE.Vector3();
  desiredVel.addScaledVector(viewForward, moveF * moveSpeed);
  desiredVel.addScaledVector(viewRight, moveR * moveSpeed);

  if (!player.isDead && isActionPressed("rise")) desiredVel.y += moveSpeed;
  if (!player.isDead && isActionPressed("descend")) desiredVel.y -= moveSpeed;

  const response = 1 - Math.exp(-14 * DT);
  player.vel.lerp(desiredVel, response);
  const movementInput = !player.isDead && (moveF !== 0 || moveR !== 0 || isActionPressed("rise") || isActionPressed("descend"));
  if (!movementInput) player.vel.set(0, 0, 0);

  player.pos.addScaledVector(player.vel, DT);
  player.pos.x = clamp(player.pos.x, -PLAYER_MAP_LIMIT, PLAYER_MAP_LIMIT);
  player.pos.z = clamp(player.pos.z, -PLAYER_MAP_LIMIT, PLAYER_MAP_LIMIT);
  player.pos.y = clamp(player.pos.y, 0, 3048);
  resolvePlayerActorClipping();
  player.pos.x = clamp(player.pos.x, -PLAYER_MAP_LIMIT, PLAYER_MAP_LIMIT);
  player.pos.z = clamp(player.pos.z, -PLAYER_MAP_LIMIT, PLAYER_MAP_LIMIT);

  for (const actor of actors) {
    if (actor.healthRevealTimer > 0) actor.healthRevealTimer = Math.max(0, actor.healthRevealTimer - DT);
    if (actor.destroyed) {
      if (actor.mesh) actor.mesh.visible = false;
      if (actor.healthBar) actor.healthBar.visible = false;
      continue;
    }
    actor.prevPos.copy(actor.pos);
    const dxToPlayer = actor.pos.x - player.pos.x;
    const dzToPlayer = actor.pos.z - player.pos.z;
    const farForSim = (dxToPlayer * dxToPlayer + dzToPlayer * dzToPlayer) > (ACTOR_SIM_CULL_DISTANCE * ACTOR_SIM_CULL_DISTANCE);

    if (farForSim && (physicsStepCount % 6) !== 0) {
      continue;
    }

    if (actor.type === "bot") {
      if (actor.health <= 0) {
        actor.respawnTimer = Math.max(0, actor.respawnTimer - DT);
        actor.deathVelocity.y -= 24 * DT;
        actor.pos.addScaledVector(actor.deathVelocity, DT);
        actor.deathPitch += actor.deathSpin.x * DT;
        actor.yaw += actor.deathSpin.y * DT;
        actor.deathRoll += actor.deathSpin.z * DT;
        if (actor.pos.y <= 0) {
          actor.pos.y = 0;
          actor.deathVelocity.y = 0;
          actor.deathVelocity.x *= Math.exp(-3 * DT);
          actor.deathVelocity.z *= Math.exp(-3 * DT);
        }
        if (actor.respawnTimer > 0) continue;
        actor.health = actor.maxHealth;
        actor.healthRevealTimer = 0;
        actor.deathVelocity.set(0, 0, 0);
        actor.deathSpin.set(0, 0, 0);
        actor.deathPitch = 0;
        actor.deathRoll = 0;
        actor.pos.copy(findTeamRespawnPosition(actor.team, actor.isFlying ? actor.flightAltitude : 0, actor));
        actor.prevPos.copy(actor.pos);
        updateBotHealthBar(actor);
      }
      if ((physicsStepCount % BOT_AI_STEP_INTERVAL) === 0) updateBotTactics(actor, 1 / 120);
    } else if (actor.type === "ship") {
      actor.yaw += 0.18 * DT;
      actor.pos.x += Math.cos(actor.yaw) * actor.speed * DT;
      actor.pos.z += Math.sin(actor.yaw) * actor.speed * DT;
      actor.pos.y = actor.shipAltitude + Math.sin(physicsStepCount * 0.0007 + actor.flightPhase) * 120 * FEET_TO_METERS;
    }

    const actorMapMargin = Math.max(actor.bounds.halfW, actor.bounds.halfL) + 1;
    const actorMapLimit = MAP_HALF - actorMapMargin;
    actor.pos.x = clamp(actor.pos.x, -actorMapLimit, actorMapLimit);
    actor.pos.z = clamp(actor.pos.z, -actorMapLimit, actorMapLimit);
  }

  updateDefeatEffects();
  updateMeleeFx();
}

function updateCharacterVisuals() {
  player.prevRoll = player.roll;
  const rollInput = (isActionPressed("leanRight") ? 1 : 0) - (isActionPressed("leanLeft") ? 1 : 0);
  const previousLevelError = Math.atan2(Math.sin(player.roll), Math.cos(player.roll));
  const visualDt = 1 / CHARACTER_VISUAL_HZ;
  if (rollInput !== 0) {
    player.rollInput = rollInput;
    player.rollReleaseRemaining = 0;
    const targetRollVelocity = rollInput * PLAYER_ROLL_RATE;
    const maxVelocityChange = PLAYER_ROLL_RATE * visualDt / PLAYER_ROLL_RAMP_UP_SECONDS;
    player.rollVelocity += clamp(targetRollVelocity - player.rollVelocity, -maxVelocityChange, maxVelocityChange);
  } else {
    if (player.rollInput !== 0) player.rollReleaseRemaining = PLAYER_ROLL_RAMP_DOWN_SECONDS;
    player.rollInput = 0;
    if (player.rollReleaseRemaining > 0) {
      const previousRemaining = player.rollReleaseRemaining;
      player.rollReleaseRemaining = Math.max(0, previousRemaining - visualDt);
      player.rollVelocity *= player.rollReleaseRemaining / previousRemaining;
    } else {
      player.rollVelocity = 0;
    }
  }

  if (player.rollVelocity !== 0) {
    const nextRoll = player.roll + player.rollVelocity * visualDt;
    const nextLevelError = Math.atan2(Math.sin(nextRoll), Math.cos(nextRoll));
    const manuallyReturningToLevel = rollInput !== 0 && Math.sign(nextLevelError) !== Math.sign(previousLevelError);
    if (manuallyReturningToLevel && Math.abs(previousLevelError) <= PLAYER_ROLL_CENTER_SNAP + PLAYER_ROLL_RATE * visualDt) {
      player.roll = nextRoll - nextLevelError;
      player.rollVelocity = 0;
      player.rollReleaseRemaining = 0;
    } else {
      player.roll = nextRoll;
    }
  }
  if (overPitchIndicator) {
    overPitchIndicator.hidden = uiState.stage !== "multiplayer" || uiState.settingsOpen || Math.abs(player.pitch) <= Math.PI * 0.5;
  }
  const recoilDecay = Math.exp(-9 / CHARACTER_VISUAL_HZ);
  player.recoilPitch *= recoilDecay;
  player.recoilYaw *= recoilDecay;
  player.weaponRecoil *= Math.exp(-20 / CHARACTER_VISUAL_HZ);
  const aimStep = 1 / (PLAYER_AIM_RAISE_SECONDS * CHARACTER_VISUAL_HZ);
  player.aimTransition = clamp(player.aimTransition + (player.aimZoomHeld ? aimStep : -aimStep), 0, 1);
  const aimBlend = player.aimTransition * player.aimTransition * (3 - 2 * player.aimTransition);
  cameraZoom = 1 + (AIM_SCOPE_ZOOM - 1) * aimBlend;
  weaponAnchor.position.lerpVectors(weaponHipPosition, weaponAimPosition, aimBlend);
  weaponAnchor.position.z += player.weaponRecoil * 0.055;
  weaponAnchor.rotation.x = -player.weaponRecoil * 0.045;
  weaponAnchor.rotation.z = player.recoilYaw * 2 + Math.sin(physicsStepCount * 0.1) * player.weaponRecoil * 0.006;
  if (weaponAnchor.userData.scope) {
    const scope = weaponAnchor.userData.scope;
    scope.visible = player.aimTransition > 0;
    scope.scale.setScalar(0.25 + 0.75 * aimBlend);
    scope.position.x = 0.12 * (1 - aimBlend);
  }
  scopeCamera.fov = BASE_CAMERA_FOV / cameraZoom;
  scopeCamera.updateProjectionMatrix();
  syncScopeVisibility();
}

function render(alpha) {
  const now = performance.now() / 1000;
  updateMenuMechPreview(now);
  if (uiState.stage === "loadout") {
    weaponAnchor.visible = false;
    for (const actor of actors) {
      if (actor.healthBar) actor.healthBar.visible = false;
    }
    const t = now * 0.24;
    camera.position.set(Math.cos(t) * 48, 25, Math.sin(t) * 48);
    camera.lookAt(0, 10, 0);
    renderer.render(scene, camera);
    recordRenderedFrame(now);
    return;
  }
  weaponAnchor.visible = true;

  const interpPos = new THREE.Vector3().lerpVectors(player.prevPos, player.pos, alpha);

  camera.position.set(interpPos.x, interpPos.y + EYE_HEIGHT_METERS, interpPos.z);
  camera.rotation.order = "YXZ";
  camera.rotation.y = player.yaw + player.recoilYaw;
  camera.rotation.x = player.pitch + player.recoilPitch + player.deathPitch;
  camera.rotation.z = player.prevRoll + (player.roll - player.prevRoll) * alpha + player.deathRoll;
  camera.updateMatrixWorld(true);
  cameraProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  cameraFrustum.setFromProjectionMatrix(cameraProjectionMatrix);

  for (const actor of actors) {
    if (!actor.mesh || actor.destroyed || (actor.health <= 0 && actor.type !== "bot")) {
      if (actor.healthBar) actor.healthBar.visible = false;
      continue;
    }
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
    } else if (actor.type === "bot" && actor.health <= 0) {
      actor.mesh.rotation.set(actor.deathPitch, actor.yaw, actor.deathRoll);
    } else {
      actor.mesh.rotation.set(0, actor.yaw, 0);
    }
  }

  const eye = camera.position;
  const occluders = actors
    .filter((actor) => (actor.type === "structure" || actor.type === "ship") && actor.mesh)
    .map((actor) => actor.mesh);
  scene.updateMatrixWorld(true);
  for (const actor of actors) {
    if (!actor.healthBar) continue;
    actor.healthBar.quaternion.copy(camera.quaternion);
    actor.healthBar.visible = actor.mesh?.visible === true && isBotHudVisible(actor, eye, occluders);
  }

  renderer.render(scene, camera);
  if (scopeRenderer && !scopeCanvas.hidden && player.aimZoomHeld && player.aimTransition >= 1) {
    scopeCamera.position.copy(camera.position);
    scopeCamera.quaternion.copy(camera.quaternion);
    scopeCamera.updateMatrixWorld(true);
    const weaponWasVisible = weaponAnchor.visible;
    weaponAnchor.visible = false;
    scopeRenderer.setRenderTarget(scopeColorTarget);
    scopeRenderer.render(scene, scopeCamera);
    scopeRenderer.setRenderTarget(null);
    scopeRenderer.render(scopePresentScene, scopePresentCamera);
    weaponAnchor.visible = weaponWasVisible;
  }
  recordRenderedFrame(now);
}

function resize() {
  applyRenderScale(renderScaleCurrent);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = Math.max(1, canvas.clientWidth) / Math.max(1, canvas.clientHeight);
  camera.updateProjectionMatrix();
}

function updateRenderTarget() {
  if (runtimeSettings.renderTarget === "auto") {
    renderHzCurrent = RENDER_TARGETS[autoRenderTargetIndex];
  } else {
    renderHzCurrent = clamp(Number(runtimeSettings.renderTarget), MIN_RENDER_HZ, TARGET_RENDER_HZ);
  }
}

function updatePerformanceHud() {
  const drawCallsPerSecond = fpsEmaInit ? Math.round(fpsEma) : 0;
  if (fpsHud) fpsHud.textContent = `FPS: ${drawCallsPerSecond} | ${rendererBackend}`;
  if (renderPerformanceStatus) {
    renderPerformanceStatus.textContent = `${rendererBackend}; high-performance GPU requested; renderer calls ${drawCallsPerSecond}/s; request ${Math.round(renderHzCurrent)}/s.`;
  }
}

function recordRenderedFrame(now) {
  renderedFrameCount++;
  const elapsed = now - lastRenderStatsSample;
  if (elapsed < 1) return;

  const sampleFps = renderedFrameCount / elapsed;
  fpsEma = fpsEmaInit ? fpsEma * 0.8 + sampleFps * 0.2 : sampleFps;
  fpsEmaInit = true;
  const nextScopeSize = fpsEma < 50 ? 192 : (fpsEma < 90 ? 256 : 320);
  if (scopeRenderer && nextScopeSize !== scopeRenderSize) {
    scopeRenderSize = nextScopeSize;
    scopeRenderer.setSize(scopeRenderSize, scopeRenderSize, false);
    scopeColorTarget?.setSize(scopeRenderSize, scopeRenderSize);
  }
  renderedFrameCount = 0;
  lastRenderStatsSample = now;

  if (runtimeSettings.renderTarget === "auto") {
    const sustainableRequest = fpsEma / 0.9;
    const nextIndex = RENDER_TARGETS.findIndex((target) => target <= sustainableRequest);
    autoRenderTargetIndex = nextIndex < 0 ? RENDER_TARGETS.length - 1 : nextIndex;
  }
  updateRenderTarget();
  updatePerformanceHud();
}

function updateAdaptiveRendering(now) {
  if (fpsEma < 58) {
    applyRenderScale(renderScaleCurrent - 0.015);
  } else if (fpsEma > 66) {
    applyRenderScale(renderScaleCurrent + 0.01);
  }

  if (runtimeSettings.autoGpuQuality) {
    const targetShadowQuality = LOW_MEMORY_HINT || fpsEma < 48
      ? "soft-low"
      : (fpsEma >= 84 ? "soft-high" : (fpsEma >= 58 ? "soft-low" : runtimeSettings.shadowQuality));
    if (targetShadowQuality !== runtimeSettings.shadowQuality) applyShadowQuality(targetShadowQuality);
  }

}

window.addEventListener("resize", resize);
window.addEventListener("keydown", (e) => {
  if (bindingCapture?.device === "keyboard") {
    e.preventDefault();
    e.stopPropagation();
    completeBindingCapture("keyboard", e.code);
    return;
  }
  if (actionUsesKey("settings", e.code) && uiState.stage === "multiplayer" && !e.repeat) {
    toggleSettingsMenu();
    return;
  }
  if (e.code === "Digit5" && uiState.stage === "multiplayer" && player.isDead && player.respawnTimer <= 0) {
    e.preventDefault();
    respawnPlayer();
    return;
  }

  if (uiState.stage !== "multiplayer" || uiState.settingsOpen) return;
  if (actionUsesKey("rise", e.code)) e.preventDefault();
  keys.add(e.code);
  if (!e.repeat && actionUsesKey("reload", e.code)) triggerInputAction("reload");
  if (!e.repeat && actionUsesKey("melee", e.code)) triggerInputAction("melee");
  refreshHeldInputActions();
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
  refreshHeldInputActions();
});
window.addEventListener("blur", () => {
  keys.clear();
  mouseButtons.clear();
  player.triggerHeld = false;
  player.aimZoomHeld = false;
  syncCombatHud();
});

window.addEventListener("mousemove", (e) => {
  if (uiState.stage !== "multiplayer" || uiState.settingsOpen) return;
  lookState.pendingX += clamp(e.movementX, -MAX_MOUSE_DELTA, MAX_MOUSE_DELTA);
  lookState.pendingY += clamp(e.movementY, -MAX_MOUSE_DELTA, MAX_MOUSE_DELTA);
});

window.addEventListener("mousedown", (e) => {
  if (bindingCapture?.device === "mouse") {
    e.preventDefault();
    e.stopImmediatePropagation();
    completeBindingCapture("mouse", e.button);
    return;
  }
  if (uiState.stage === "multiplayer" && !uiState.settingsOpen) {
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    mouseButtons.add(e.button);
    refreshHeldInputActions();
    if (actionUsesMouse("settings", e.button)) toggleSettingsMenu();
    else {
      if (actionUsesMouse("reload", e.button)) triggerInputAction("reload");
      if (actionUsesMouse("melee", e.button)) triggerInputAction("melee");
    }
  }
}, true);

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("mouseup", (e) => {
  mouseButtons.delete(e.button);
  refreshHeldInputActions();
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
    if (uiState.stage === "multiplayer" && (physicsStepCount % PROJECTILE_STEP_INTERVAL) === 0) {
      updateProjectiles(PROJECTILE_DT);
    }
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

}

resize();
initMenuUi();
initActors();
initWeaponModel();
renderer.setAnimationLoop(frame);
window.__CONDUCT_GAME_READY__ = {
  backend: rendererBackend,
  physicsHz: PHYSICS_HZ,
  projectileHz: PROJECTILE_HZ,
  projectileSpeedFps: 1800,
  meleeReachFeet: 180,
  botMeleeReachFeet: 180,
  botMaxFlightAltitudeFeet: 10000,
  botBurstRateRpm: ENEMY_FIRE_RATE * 60,
  botSprintMultiplier: MECH_SPRINT_MULTIPLIER,
  playerShiftSprintMultiplier: MECH_SHIFT_SPRINT_MULTIPLIER,
  playerBulletsUseLiveCameraTransform: true,
  actorMapBoundaryMode: "body-aware-clamp",
  spatialSfxAvailable: Boolean(window.AudioContext || window.webkitAudioContext),
  spatialSfxVolume: sfxSettings.volume,
  soundPropagationMetersPerSecond: SPEED_OF_SOUND_METERS_PER_SECOND,
  buildingEchoReflections: true,
  defeatExplosionAndFall: true,
  shipCount: actors.filter((actor) => actor.type === "ship").length,
  shipHealth: BOT_MAX_HEALTH * 3,
  structureHealthTotal: STRUCTURE_STAGE_HEALTH[0] + STRUCTURE_STAGE_HEALTH[1],
  scopeRendererReady: Boolean(scopeRenderer),
  scopeColorBitsPerPixel: scopeColorTarget ? 16 : 0,
  scopeZoom: AIM_SCOPE_ZOOM,
  gunAimRaiseSeconds: PLAYER_AIM_RAISE_SECONDS,
  scopeRenderCadence: "main-render-loop",
  playerMaxPitchDegrees: PLAYER_MAX_PITCH * 180 / Math.PI,
  playerRollRateDegreesPerSecond: PLAYER_ROLL_RATE * 180 / Math.PI,
  playerRollRampUpSeconds: PLAYER_ROLL_RAMP_UP_SECONDS,
  playerRollRampDownSeconds: PLAYER_ROLL_RAMP_DOWN_SECONDS,
  playerRollCenterSnapDegrees: PLAYER_ROLL_CENTER_SNAP * 180 / Math.PI,
  matchDurationSeconds: MATCH_DURATION_SECONDS,
  matchTeamDeathLimit: MATCH_TEAM_DEATH_LIMIT,
  playerRespawnSeconds: PLAYER_RESPAWN_SECONDS,
  botRespawnSeconds: PLAYER_RESPAWN_SECONDS,
  manualRespawnKey: "5",
  fpsHudCount: fpsHud ? 1 : 0,
  flightCursorWindowPercent: 50,
  flightForwardUsesLookDirection: true,
  movementUsesCurrentYawAndRoll: true,
  customBindingActionCount: INPUT_ACTIONS.length,
  musicTrackCount: MUSIC_TRACK_FILES.length,
  borderlessHost: Boolean(window.chrome?.webview),
  structureHealth: STRUCTURE_STAGE_HEALTH[0],
  friendlyBotCount: actors.filter((actor) => actor.type === "bot" && actor.team === "friendly").length,
  hostileBotCount: actors.filter((actor) => actor.type === "bot" && actor.team === "enemy").length,
  playerHealthHud: Boolean(playerCombatHud),
  shadowQuality: runtimeSettings.shadowQuality,
  menuLoaded: Boolean(preStartMenu),
  actorCount: actors.length
};
