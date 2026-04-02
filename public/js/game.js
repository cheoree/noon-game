// =============================================================================
// game.js - Three.js 3D Game Renderer for Noon Arena
// Fall Guys style bean characters with full arena view
// =============================================================================

(function () {
  'use strict';

  const JOYSTICK_MAX_RADIUS = 50;
  const PUNCH_MAX_CHARGE_MS = 2000; // max charge time in ms
  const DODGE_COOLDOWN = 5000;
  const INTERPOLATION_DELAY = 100;

  // World scale: shrink positions so full arena fits on screen
  const WORLD_SCALE = 0.5;
  // Character scale: bigger than world scale so characters are visible
  const CHAR_SCALE = 1.6;

  // Camera - high up to see full arena
  const CAM_HEIGHT = 750;
  const CAM_DIST = 220;
  const CAM_FOV = 52;

  // Character tuning
  const WOBBLE_FREQ = 10;
  const WOBBLE_AMP = 0.12;
  const WALK_SPEED = 14;
  const WALK_LIFT = 0.5;
  const IDLE_BOB_SPEED = 2.5;
  const IDLE_BOB_AMP = 0.25;

  // Fall Guys face variants
  const FACES = [
    { eyes: 'round', mouth: 'smile' },
    { eyes: 'round', mouth: 'open' },
    { eyes: 'happy', mouth: 'smile' },
    { eyes: 'round', mouth: 'cat' },
    { eyes: 'dot', mouth: 'o' },
    { eyes: 'round', mouth: 'grin' },
    { eyes: 'happy', mouth: 'open' },
    { eyes: 'dot', mouth: 'smile' },
    { eyes: 'round', mouth: 'grin' },
    { eyes: 'happy', mouth: 'cat' },
  ];

  const HATS = [
    'crown', 'party', 'propeller', 'halo', 'horns',
    'bow', 'antenna', 'chef', 'headband', 'none',
  ];

  const PATTERNS = [
    'solid', 'belly', 'stripe', 'twoTone', 'gradient',
    'solid', 'belly', 'stripe', 'twoTone', 'gradient',
  ];

  // ─── Game state ─────────────────────────────────────────────────────────────
  const game = {
    canvas: null, running: false, width: 0, height: 0,
    stateBuffer: [], currentState: null, interpolatedPlayers: {},
    myId: null,
    joystick: { active: false, touchId: null, originX: 0, originY: 0, dx: 0, dy: 0 },
    punchCharging: false, punchChargeStart: 0,
    dodgeCooldownEnd: 0,
    keyboardDx: 0, keyboardDy: 0,
    elimAnimations: [], killLogEntries: [],
    countdownValue: null, countdownFade: 0,
  };
  window.game = game;

  // ─── Three.js objects ───────────────────────────────────────────────────────
  let scene, camera, renderer, clock;
  let arenaGroup, arenaMesh, arenaEdge, arenaGlow, dangerRing;
  let charGroups = {};   // id -> THREE.Group
  let charAnims = {};    // id -> anim state
  let particles3d = [];
  let elimAnims3d = [];

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function serverToWorld(sx, sy) {
    return { x: (sx - 400) * WORLD_SCALE, z: (sy - 400) * WORLD_SCALE };
  }

  // ─── Init ───────────────────────────────────────────────────────────────────
  let initialized = false;

  function init() {
    if (initialized) { onResize(); return; }
    initialized = true;

    game.canvas = document.getElementById('game-canvas');
    game.width = window.innerWidth;
    game.height = window.innerHeight;

    // Renderer
    renderer = new THREE.WebGLRenderer({ canvas: game.canvas, antialias: true, alpha: false });
    renderer.setSize(game.width, game.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x0a0a1e);

    // Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a0a1e, 0.0004);

    // Clock
    clock = new THREE.Clock();

    // Camera (high overhead to see full arena)
    camera = new THREE.PerspectiveCamera(CAM_FOV, game.width / game.height, 10, 2000);
    camera.position.set(0, CAM_HEIGHT, CAM_DIST);
    camera.lookAt(0, 0, 0);

    // Lights
    const ambient = new THREE.AmbientLight(0x9090c0, 0.6);
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight(0xaaccff, 0x334466, 0.5);
    scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(150, 400, 200);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.left = -300;
    dir.shadow.camera.right = 300;
    dir.shadow.camera.top = 300;
    dir.shadow.camera.bottom = -300;
    dir.shadow.camera.near = 10;
    dir.shadow.camera.far = 900;
    scene.add(dir);

    // Rim light
    const rim = new THREE.DirectionalLight(0x66ccff, 0.35);
    rim.position.set(-100, 150, -250);
    scene.add(rim);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const starVerts = [];
    for (let i = 0; i < 400; i++) {
      starVerts.push(
        (Math.random() - 0.5) * 2000,
        Math.random() * 500 + 100,
        (Math.random() - 0.5) * 2000
      );
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, transparent: true, opacity: 0.5 });
    scene.add(new THREE.Points(starGeo, starMat));

    // Arena (scaled)
    createArena(380 * WORLD_SCALE);

    // Events
    window.addEventListener('resize', onResize);
    setupTouchControls();
    setupButtonControls();
  }

  function onResize() {
    game.width = window.innerWidth;
    game.height = window.innerHeight;
    if (renderer) {
      renderer.setSize(game.width, game.height);
      camera.aspect = game.width / game.height;
      camera.updateProjectionMatrix();
    }
  }

  // ─── Arena ──────────────────────────────────────────────────────────────────
  function createArena(radius) {
    if (arenaGroup) scene.remove(arenaGroup);
    arenaGroup = new THREE.Group();

    // Platform disc
    const geo = new THREE.CylinderGeometry(radius, radius, 6, 64);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a2840,
      roughness: 0.6,
      metalness: 0.15,
    });
    arenaMesh = new THREE.Mesh(geo, mat);
    arenaMesh.position.y = -3;
    arenaMesh.receiveShadow = true;
    arenaGroup.add(arenaMesh);

    // Grid
    const gridHelper = new THREE.GridHelper(radius * 2, 24, 0x1a4466, 0x152535);
    gridHelper.position.y = 0.5;
    arenaGroup.add(gridHelper);

    // Bright edge ring
    const ringGeo = new THREE.TorusGeometry(radius, 1.5, 8, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ddff, transparent: true, opacity: 0.7 });
    arenaEdge = new THREE.Mesh(ringGeo, ringMat);
    arenaEdge.rotation.x = -Math.PI / 2;
    arenaEdge.position.y = 0.5;
    arenaGroup.add(arenaEdge);

    // Danger ring
    const dangerGeo = new THREE.TorusGeometry(radius, 3, 8, 64);
    const dangerMat = new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0 });
    dangerRing = new THREE.Mesh(dangerGeo, dangerMat);
    dangerRing.rotation.x = -Math.PI / 2;
    dangerRing.position.y = 1;
    arenaGroup.add(dangerRing);

    // Under-glow
    const glowGeo = new THREE.CylinderGeometry(radius + 15, radius + 30, 2, 64);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x0088cc, transparent: true, opacity: 0.05 });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    glowMesh.position.y = -7;
    arenaGroup.add(glowMesh);

    scene.add(arenaGroup);
  }

  function updateArena(arenaState, ts) {
    if (!arenaMesh) return;
    const r = arenaState.radius;
    const scale = r / 380;
    arenaMesh.scale.set(scale, 1, scale);
    arenaEdge.scale.set(scale, scale, scale);

    if (r < 375) {
      const pulse = 0.4 + 0.4 * Math.sin(ts * 4);
      dangerRing.material.opacity = pulse;
      dangerRing.scale.set(scale, scale, scale);
    } else {
      dangerRing.material.opacity = 0;
    }
  }

  // ─── Fall Guys Bean Character ───────────────────────────────────────────────
  function createCharacter3D(id, color) {
    const h = hashStr(id);
    const faceIdx = h % FACES.length;
    const hatIdx = h % HATS.length;
    const patternIdx = h % PATTERNS.length;
    const col = new THREE.Color(color || '#ff6b6b');
    const colDark = col.clone().multiplyScalar(0.6);
    const colLight = col.clone().lerp(new THREE.Color(0xffffff), 0.4);
    const white = new THREE.Color(0xffffff);

    const group = new THREE.Group();

    // Main body material
    const bodyMat = new THREE.MeshPhongMaterial({
      color: col, specular: 0x333333, shininess: 45,
    });
    const bellyMat = new THREE.MeshPhongMaterial({
      color: colLight, specular: 0x444444, shininess: 50,
    });
    const darkMat = new THREE.MeshPhongMaterial({ color: colDark, shininess: 25 });

    // === BEAN BODY (single tall capsule - the entire character) ===
    const bodyGeo = new THREE.SphereGeometry(10, 20, 16);
    bodyGeo.scale(1, 1.65, 0.95);
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 17;
    body.castShadow = true;
    body.name = 'body';
    group.add(body);

    // === BELLY PATCH (lighter front panel, Fall Guys style) ===
    const pattern = PATTERNS[patternIdx];
    if (pattern === 'belly' || pattern === 'twoTone') {
      const bellyGeo = new THREE.SphereGeometry(9.2, 16, 12, 0, Math.PI * 2, 0.3, 1.2);
      bellyGeo.scale(0.85, 1.55, 0.7);
      const belly = new THREE.Mesh(bellyGeo, bellyMat);
      belly.position.set(0, 17, 2);
      belly.name = 'belly';
      group.add(belly);
    }
    if (pattern === 'stripe') {
      const stripeGeo = new THREE.CylinderGeometry(10.3, 10.3, 3, 16);
      const stripeMat = new THREE.MeshPhongMaterial({ color: colLight, shininess: 40 });
      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.position.y = 18;
      stripe.name = 'stripe';
      group.add(stripe);
    }

    // === EYES (on upper body front, big and cute) ===
    const eyeWhiteMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 80 });
    const pupilMat = new THREE.MeshPhongMaterial({ color: 0x111122 });
    const face = FACES[faceIdx];

    [-1, 1].forEach((side) => {
      const eyeGroup = new THREE.Group();
      eyeGroup.position.set(side * 3.5, 24.5, 8);
      eyeGroup.name = side < 0 ? 'eyeL' : 'eyeR';

      if (face.eyes === 'round') {
        // Big round eyes (classic Fall Guys)
        const eyeGeo = new THREE.SphereGeometry(2.8, 12, 10);
        const eyeMesh = new THREE.Mesh(eyeGeo, eyeWhiteMat);
        eyeGroup.add(eyeMesh);
        // Pupil
        const pupilGeo = new THREE.SphereGeometry(1.6, 8, 8);
        const pupil = new THREE.Mesh(pupilGeo, pupilMat);
        pupil.position.z = 1.5;
        pupil.name = 'pupil';
        eyeGroup.add(pupil);
      } else if (face.eyes === 'happy') {
        // Happy curved eyes (^ ^)
        const eyeGeo = new THREE.TorusGeometry(2, 0.6, 6, 12, Math.PI);
        const eyeMesh = new THREE.Mesh(eyeGeo, pupilMat);
        eyeMesh.rotation.z = Math.PI;
        eyeGroup.add(eyeMesh);
      } else if (face.eyes === 'dot') {
        // Small dot eyes
        const eyeGeo = new THREE.SphereGeometry(1.4, 8, 8);
        const eyeMesh = new THREE.Mesh(eyeGeo, pupilMat);
        eyeGroup.add(eyeMesh);
      }

      group.add(eyeGroup);
    });

    // === MOUTH ===
    const mouthGroup = new THREE.Group();
    mouthGroup.position.set(0, 20.5, 9);
    mouthGroup.name = 'mouth';
    const mouthType = face.mouth;

    if (mouthType === 'smile') {
      const curve = new THREE.TorusGeometry(1.8, 0.4, 6, 12, Math.PI);
      const curveMat = new THREE.MeshPhongMaterial({ color: 0x442222 });
      const mouthMesh = new THREE.Mesh(curve, curveMat);
      mouthMesh.rotation.z = Math.PI;
      mouthGroup.add(mouthMesh);
    } else if (mouthType === 'open') {
      const mGeo = new THREE.SphereGeometry(1.8, 10, 8);
      mGeo.scale(1, 0.8, 0.5);
      const mMat = new THREE.MeshPhongMaterial({ color: 0x331111 });
      const mouth = new THREE.Mesh(mGeo, mMat);
      mouthGroup.add(mouth);
      // Tongue
      const tongGeo = new THREE.SphereGeometry(1, 8, 8);
      tongGeo.scale(1, 0.5, 0.7);
      const tongMat = new THREE.MeshPhongMaterial({ color: 0xcc5555 });
      const tongue = new THREE.Mesh(tongGeo, tongMat);
      tongue.position.set(0, -0.4, 0.2);
      mouthGroup.add(tongue);
    } else if (mouthType === 'grin') {
      const mGeo = new THREE.SphereGeometry(2.5, 10, 8);
      mGeo.scale(1, 0.6, 0.4);
      const mMat = new THREE.MeshPhongMaterial({ color: 0x331111 });
      const mouth = new THREE.Mesh(mGeo, mMat);
      mouthGroup.add(mouth);
    } else if (mouthType === 'cat') {
      // Cat mouth (w shape) - two small arcs
      [-1, 1].forEach(side => {
        const arc = new THREE.TorusGeometry(1.2, 0.35, 6, 8, Math.PI);
        const arcMat = new THREE.MeshPhongMaterial({ color: 0x442222 });
        const arcMesh = new THREE.Mesh(arc, arcMat);
        arcMesh.rotation.z = Math.PI;
        arcMesh.position.x = side * 1.2;
        mouthGroup.add(arcMesh);
      });
    } else if (mouthType === 'o') {
      const oGeo = new THREE.TorusGeometry(1.2, 0.4, 8, 12);
      const oMat = new THREE.MeshPhongMaterial({ color: 0x331111 });
      const oMesh = new THREE.Mesh(oGeo, oMat);
      mouthGroup.add(oMesh);
    }
    group.add(mouthGroup);

    // === ARMS (small stumpy, Fall Guys style) ===
    [-1, 1].forEach(side => {
      const armGeo = new THREE.SphereGeometry(2.2, 8, 6);
      armGeo.scale(0.7, 1.1, 0.7);
      const arm = new THREE.Mesh(armGeo, bodyMat);
      arm.position.set(side * 10, 18, 0);
      arm.rotation.z = side * 0.4;
      arm.castShadow = true;
      arm.name = side < 0 ? 'armL' : 'armR';
      group.add(arm);

      const handGeo = new THREE.SphereGeometry(1.8, 8, 6);
      const hand = new THREE.Mesh(handGeo, bodyMat);
      hand.position.set(side * 12, 14, 0);
      hand.name = side < 0 ? 'handL' : 'handR';
      group.add(hand);
    });

    // === LEGS (short thick, Fall Guys style) ===
    [-1, 1].forEach(side => {
      const legGeo = new THREE.SphereGeometry(3.5, 10, 8);
      legGeo.scale(0.9, 1.4, 0.9);
      const leg = new THREE.Mesh(legGeo, darkMat);
      leg.position.set(side * 4.5, 5, 0);
      leg.castShadow = true;
      leg.name = side < 0 ? 'legL' : 'legR';
      group.add(leg);
    });

    // === FEET (round, chunky) ===
    [-1, 1].forEach(side => {
      const footGeo = new THREE.SphereGeometry(3.5, 10, 8);
      footGeo.scale(1.1, 0.45, 1.3);
      const foot = new THREE.Mesh(footGeo, darkMat);
      foot.position.set(side * 4.5, 1.2, 1);
      foot.castShadow = true;
      foot.name = side < 0 ? 'footL' : 'footR';
      group.add(foot);
    });

    // === SHADOW ===
    const shadowGeo = new THREE.CircleGeometry(8, 16);
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.2;
    shadow.name = 'shadow';
    group.add(shadow);

    // === HAT ===
    buildHat(group, HATS[hatIdx], col);

    // === NICKNAME SPRITE (high-res, bold, readable from far camera) ===
    const nameCanvas = document.createElement('canvas');
    nameCanvas.width = 512;
    nameCanvas.height = 128;
    const nameCtx = nameCanvas.getContext('2d');
    const nameTex = new THREE.CanvasTexture(nameCanvas);
    nameTex.minFilter = THREE.LinearFilter;
    const nameSpriteMat = new THREE.SpriteMaterial({ map: nameTex, transparent: true, depthTest: false });
    const nameSprite = new THREE.Sprite(nameSpriteMat);
    nameSprite.position.y = 46;
    nameSprite.scale.set(36, 9, 1);
    nameSprite.name = 'nameSprite';
    group.add(nameSprite);

    // Store metadata
    group.userData = { faceIdx, hatIdx, color: col, nameTexture: nameTex, nameCanvas, nameCtx, nameSet: false };

    // Scale character - bigger than world so they're visible
    group.scale.set(CHAR_SCALE, CHAR_SCALE, CHAR_SCALE);

    return group;
  }

  function updateNameSprite(group, nickname) {
    if (!nickname || group.userData.nameSet === nickname) return;
    const { nameCtx, nameCanvas, nameTexture } = group.userData;
    nameCtx.clearRect(0, 0, nameCanvas.width, nameCanvas.height);
    // High-res text on 512x128 canvas
    nameCtx.font = 'bold 72px sans-serif';
    nameCtx.textAlign = 'center';
    nameCtx.textBaseline = 'middle';
    const px = 256, py = 64;
    const tw = nameCtx.measureText(nickname).width;
    // Dark pill background
    nameCtx.fillStyle = 'rgba(0,0,0,0.7)';
    const pad = 24;
    const rr = 28;
    roundRect(nameCtx, px - tw / 2 - pad, py - 36, tw + pad * 2, 72, rr);
    nameCtx.fill();
    // White text with thick black outline
    nameCtx.strokeStyle = '#000000';
    nameCtx.lineWidth = 8;
    nameCtx.strokeText(nickname, px, py);
    nameCtx.fillStyle = '#ffffff';
    nameCtx.fillText(nickname, px, py);
    nameTexture.needsUpdate = true;
    group.userData.nameSet = nickname;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function buildHat(group, hatType, bodyCol) {
    const hatGroup = new THREE.Group();
    hatGroup.position.y = 35;
    hatGroup.name = 'hat';

    switch (hatType) {
      case 'party': {
        const coneGeo = new THREE.ConeGeometry(4, 10, 8);
        const coneMat = new THREE.MeshPhongMaterial({ color: 0xff4488 });
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.y = 5;
        hatGroup.add(cone);
        const pomGeo = new THREE.SphereGeometry(1.5, 8, 8);
        const pomMat = new THREE.MeshPhongMaterial({ color: 0xffdd44 });
        hatGroup.add(new THREE.Mesh(pomGeo, pomMat)).position.y = 10.5;
        break;
      }
      case 'crown': {
        const crownGeo = new THREE.CylinderGeometry(5, 6, 4, 5);
        const crownMat = new THREE.MeshPhongMaterial({ color: 0xffd700, specular: 0xffeeaa, shininess: 80 });
        const crown = new THREE.Mesh(crownGeo, crownMat);
        crown.position.y = 2;
        hatGroup.add(crown);
        [0xff3333, 0x3366ff, 0x33ff66].forEach((c, i) => {
          const gem = new THREE.Mesh(
            new THREE.SphereGeometry(0.8, 6, 6),
            new THREE.MeshPhongMaterial({ color: c, shininess: 100 })
          );
          const a = (i / 3) * Math.PI * 2;
          gem.position.set(Math.cos(a) * 4.5, 2, Math.sin(a) * 4.5);
          hatGroup.add(gem);
        });
        break;
      }
      case 'propeller': {
        const beanieGeo = new THREE.SphereGeometry(5.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
        const beanieMat = new THREE.MeshPhongMaterial({ color: 0x3366cc });
        const beanie = new THREE.Mesh(beanieGeo, beanieMat);
        hatGroup.add(beanie);
        const propGroup = new THREE.Group();
        propGroup.position.y = 5;
        propGroup.name = 'propeller';
        const blade1 = new THREE.Mesh(
          new THREE.BoxGeometry(12, 0.5, 2.5),
          new THREE.MeshPhongMaterial({ color: 0xff4444 })
        );
        propGroup.add(blade1);
        const blade2 = new THREE.Mesh(
          new THREE.BoxGeometry(12, 0.5, 2.5),
          new THREE.MeshPhongMaterial({ color: 0x44ff44 })
        );
        blade2.rotation.y = Math.PI / 2;
        propGroup.add(blade2);
        propGroup.add(new THREE.Mesh(
          new THREE.SphereGeometry(1, 8, 8),
          new THREE.MeshPhongMaterial({ color: 0x888888 })
        ));
        hatGroup.add(propGroup);
        break;
      }
      case 'halo': {
        const haloGeo = new THREE.TorusGeometry(6, 1, 8, 24);
        const haloMat = new THREE.MeshPhongMaterial({
          color: 0xffee88, emissive: 0xffee44, emissiveIntensity: 0.5,
          transparent: true, opacity: 0.8,
        });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        halo.rotation.x = -Math.PI / 2;
        halo.position.y = 5;
        hatGroup.add(halo);
        break;
      }
      case 'horns': {
        [-1, 1].forEach(side => {
          const hornGeo = new THREE.ConeGeometry(2, 7, 6);
          const hornMat = new THREE.MeshPhongMaterial({ color: 0xcc2222 });
          const horn = new THREE.Mesh(hornGeo, hornMat);
          horn.position.set(side * 5, 3, 0);
          horn.rotation.z = side * -0.4;
          hatGroup.add(horn);
        });
        break;
      }
      case 'bow': {
        const bowMat = new THREE.MeshPhongMaterial({ color: 0xff66aa });
        [-1, 1].forEach(side => {
          const loopGeo = new THREE.SphereGeometry(3, 8, 8);
          loopGeo.scale(1, 0.6, 0.5);
          const loop = new THREE.Mesh(loopGeo, bowMat);
          loop.position.set(side * 3.5, 0, 0);
          hatGroup.add(loop);
        });
        hatGroup.add(new THREE.Mesh(
          new THREE.SphereGeometry(1.5, 8, 8),
          new THREE.MeshPhongMaterial({ color: 0xcc3377 })
        ));
        break;
      }
      case 'antenna': {
        [-1, 1].forEach(side => {
          const stickGeo = new THREE.CylinderGeometry(0.3, 0.3, 8, 4);
          const stick = new THREE.Mesh(stickGeo, new THREE.MeshPhongMaterial({ color: 0x666666 }));
          stick.position.set(side * 3, 4, 0);
          stick.rotation.z = side * -0.2;
          hatGroup.add(stick);
          const ball = new THREE.Mesh(
            new THREE.SphereGeometry(1.8, 8, 8),
            new THREE.MeshPhongMaterial({ color: side < 0 ? 0x44ff88 : 0xff8844 })
          );
          ball.position.set(side * 4, 8.5, 0);
          ball.name = side < 0 ? 'antennaL' : 'antennaR';
          hatGroup.add(ball);
        });
        break;
      }
      case 'chef': {
        const toqueGeo = new THREE.SphereGeometry(6, 10, 8);
        toqueGeo.scale(1, 1.2, 1);
        const toque = new THREE.Mesh(toqueGeo, new THREE.MeshPhongMaterial({ color: 0xffffff }));
        toque.position.y = 4;
        hatGroup.add(toque);
        break;
      }
      case 'headband': {
        const bandGeo = new THREE.TorusGeometry(6, 1.2, 6, 16, Math.PI);
        const band = new THREE.Mesh(bandGeo, new THREE.MeshPhongMaterial({ color: 0xff3333 }));
        band.rotation.z = Math.PI;
        band.rotation.y = Math.PI / 2;
        hatGroup.add(band);
        break;
      }
    }

    group.add(hatGroup);
  }

  // ─── Character animation ───────────────────────────────────────────────────
  function getAnim(id) {
    if (!charAnims[id]) {
      charAnims[id] = {
        walkPhase: Math.random() * Math.PI * 2,
        wobblePhase: Math.random() * Math.PI * 2,
        idlePhase: Math.random() * Math.PI * 2,
        prevX: 0, prevZ: 0,
        smoothVx: 0, smoothVz: 0,
      };
    }
    return charAnims[id];
  }

  function animateCharacter(group, player, dt, ts) {
    const a = getAnim(player.id);
    const { x: wx, z: wz } = serverToWorld(player.x, player.y);

    // Smooth velocity
    const tvx = wx - a.prevX;
    const tvz = wz - a.prevZ;
    a.smoothVx += (tvx - a.smoothVx) * 0.3;
    a.smoothVz += (tvz - a.smoothVz) * 0.3;
    a.prevX = wx;
    a.prevZ = wz;

    const speed = Math.sqrt(a.smoothVx * a.smoothVx + a.smoothVz * a.smoothVz);

    // Advance phases
    a.walkPhase += speed * WALK_SPEED * dt;
    a.wobblePhase += speed * WOBBLE_FREQ * dt;
    a.idlePhase += IDLE_BOB_SPEED * dt;

    // Position (world-scaled)
    group.position.set(wx, 0, wz);

    // Facing direction
    const fx = player.facingX || 0;
    const fy = player.facingY || 0;
    if (Math.abs(fx) > 0.01 || Math.abs(fy) > 0.01) {
      const targetAngle = Math.atan2(fx, fy);
      let curr = group.rotation.y;
      let diff = targetAngle - curr;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      group.rotation.y += diff * 0.15;
    }

    // Body wobble & bob
    const body = group.getObjectByName('body');
    const belly = group.getObjectByName('belly');
    const wobble = speed > 0.2 ? Math.sin(a.wobblePhase) * WOBBLE_AMP * Math.min(speed * 0.5, 1) : 0;
    const idleBob = speed < 0.3 ? Math.sin(a.idlePhase) * IDLE_BOB_AMP : 0;
    const walkBounce = speed > 0.2 ? Math.abs(Math.sin(a.walkPhase * 2)) * 0.8 : 0;
    const chargeRatio = player.chargeRatio || 0;

    if (body) {
      if (player.teetering) {
        // Frantic wobble when on the edge
        body.rotation.z = Math.sin(ts * 12) * 0.4;
        body.rotation.x = Math.sin(ts * 10 + 1) * 0.25;
        body.position.y = 17 + Math.sin(ts * 8) * 1.5;
        body.scale.set(1, 1, 1);
      } else if (player.charging) {
        // 풍선 부풀기 + 느린 회전 차징 애니메이션
        const scaleXZ = 1 + chargeRatio * 0.3;
        const scaleY = 1 + chargeRatio * 0.4;
        body.scale.set(scaleXZ, scaleY, scaleXZ);
        body.rotation.y = ts * (0.8 + chargeRatio * 2.0);
        // 고주파 떨림 (chargeRatio > 0.6)
        if (chargeRatio > 0.6) {
          const tremor = Math.sin(ts * 25) * chargeRatio * 0.06;
          body.rotation.x = tremor;
          body.rotation.z = tremor;
        } else {
          body.rotation.x = 0;
          body.rotation.z = 0;
        }
        body.position.y = 17 + chargeRatio * 3;
      } else if (player.punching) {
        // HEADBUTT! Aggressive forward lunge
        body.rotation.x = 0.6;
        body.rotation.z = 0;
        body.rotation.y *= 0.85; // 차징 해제 후 보간 리셋
        body.position.y = 17;
        body.scale.set(1.05, 0.95, 1.15);
      } else {
        body.rotation.z = wobble;
        body.rotation.x = 0;
        body.rotation.y *= 0.85; // 차징 해제 후 보간 리셋
        body.position.y = 17 + idleBob + walkBounce;
        if (player.dodging) {
          body.scale.set(1.2, 0.75, 1.2);
        } else {
          const squash = speed > 0.2 ? Math.sin(a.walkPhase * 2) * 0.05 : 0;
          body.scale.set(1 + squash, 1 - squash * 0.5, 1);
        }
      }
    }
    if (belly) {
      if (player.charging) {
        // belly도 body와 동일 scale 적용
        const scaleXZ = 1 + chargeRatio * 0.3;
        const scaleY = 1 + chargeRatio * 0.4;
        belly.scale.set(scaleXZ, scaleY, scaleXZ);
        belly.position.y = 17 + chargeRatio * 3;
        belly.rotation.z = 0;
      } else {
        belly.scale.set(1, 1, 1);
        belly.position.y = 17 + idleBob + walkBounce;
        belly.rotation.z = wobble;
      }
    }

    // Legs walk cycle
    const walkSin = Math.sin(a.walkPhase);
    const legL = group.getObjectByName('legL');
    const legR = group.getObjectByName('legR');
    const footL = group.getObjectByName('footL');
    const footR = group.getObjectByName('footR');
    if (legL && legR) {
      const lift = speed > 0.2 ? WALK_LIFT : 0;
      const stride = speed > 0.2 ? 2.5 : 0;
      legL.position.y = 5 + Math.max(0, walkSin) * lift * 3;
      legL.position.z = walkSin * stride;
      legR.position.y = 5 + Math.max(0, -walkSin) * lift * 3;
      legR.position.z = -walkSin * stride;
    }
    if (footL && footR) {
      const lift = speed > 0.2 ? WALK_LIFT : 0;
      const stride = speed > 0.2 ? 3 : 0;
      footL.position.y = 1.2 + Math.max(0, walkSin) * lift * 2;
      footL.position.z = 1 + walkSin * stride;
      footR.position.y = 1.2 + Math.max(0, -walkSin) * lift * 2;
      footR.position.z = 1 - walkSin * stride;
    }

    // Arms (simple small stumps)
    const armL = group.getObjectByName('armL');
    const armR = group.getObjectByName('armR');
    const handL = group.getObjectByName('handL');
    const handR = group.getObjectByName('handR');
    const isTeetering = player.teetering;
    const isPunching = player.punching;
    const isCharging = player.charging;

    let armSwing = 0;
    if (!isTeetering && !isPunching && !isCharging) {
      armSwing = speed > 0.2 ? walkSin * 0.5 : Math.sin(a.idlePhase * 0.8) * 0.08;
    }

    if (armL) {
      if (isPunching) {
        armL.rotation.x = 0.6; armL.rotation.z = -0.3;
      } else if (isCharging) {
        if (chargeRatio < 0.5) {
          // 팔을 몸에 붙임
          armL.rotation.x = 0.0; armL.rotation.z = -0.15;
        } else {
          // 팔 벌어지면서 고주파 떨림
          const spread = 0.15 + (chargeRatio - 0.5) * 0.8;
          const tremor = Math.sin(ts * 25) * chargeRatio * 0.1;
          armL.rotation.x = tremor; armL.rotation.z = -spread + tremor;
        }
      } else if (isTeetering) {
        armL.rotation.x = Math.sin(ts * 18) * 1.2;
        armL.rotation.z = -0.8 + Math.sin(ts * 14) * 0.5;
      } else {
        armL.rotation.x = -armSwing; armL.rotation.z = -0.4;
      }
      armL.position.y = 18 + idleBob + walkBounce;
    }
    if (armR) {
      if (isPunching) {
        armR.rotation.x = 0.6; armR.rotation.z = 0.3;
      } else if (isCharging) {
        if (chargeRatio < 0.5) {
          // 팔을 몸에 붙임
          armR.rotation.x = 0.0; armR.rotation.z = 0.15;
        } else {
          // 팔 벌어지면서 고주파 떨림
          const spread = 0.15 + (chargeRatio - 0.5) * 0.8;
          const tremor = Math.sin(ts * 25) * chargeRatio * 0.1;
          armR.rotation.x = tremor; armR.rotation.z = spread + tremor;
        }
      } else if (isTeetering) {
        armR.rotation.x = Math.sin(ts * 18 + 2.5) * 1.2;
        armR.rotation.z = 0.8 + Math.sin(ts * 14 + 1.5) * 0.5;
      } else {
        armR.rotation.x = armSwing; armR.rotation.z = 0.4;
      }
      armR.position.y = 18 + idleBob + walkBounce;
    }
    if (handL) {
      if (isTeetering) {
        handL.position.set(-12, 18 + Math.sin(ts * 18) * 4, Math.cos(ts * 18) * 4);
      } else if (isCharging) {
        if (chargeRatio < 0.5) {
          handL.position.set(-10, 14 + idleBob, 0);
        } else {
          const spread = 10 + (chargeRatio - 0.5) * 6;
          const tremor = Math.sin(ts * 25) * chargeRatio * 0.8;
          handL.position.set(-spread, 14 + idleBob + tremor, tremor);
        }
      } else {
        handL.position.set(-12, 14 + idleBob + walkBounce, 0);
      }
    }
    if (handR) {
      if (isTeetering) {
        handR.position.set(12, 18 + Math.sin(ts * 18 + 2.5) * 4, Math.cos(ts * 18 + 2.5) * 4);
      } else if (isCharging) {
        if (chargeRatio < 0.5) {
          handR.position.set(10, 14 + idleBob, 0);
        } else {
          const spread = 10 + (chargeRatio - 0.5) * 6;
          const tremor = Math.sin(ts * 25) * chargeRatio * 0.8;
          handR.position.set(spread, 14 + idleBob + tremor, tremor);
        }
      } else {
        handR.position.set(12, 14 + idleBob + walkBounce, 0);
      }
    }

    // Hat animation
    const chargeYOffset = isCharging ? chargeRatio * 3 : 0;
    const hat = group.getObjectByName('hat');
    if (hat) {
      hat.position.y = 35 + idleBob + walkBounce + chargeYOffset;
      hat.rotation.z = wobble * 0.5;
      const prop = hat.getObjectByName('propeller');
      if (prop) prop.rotation.y += dt * 12;
      const aL = hat.getObjectByName('antennaL');
      const aR = hat.getObjectByName('antennaR');
      if (aL) aL.position.x = -4 + Math.sin(ts * 3) * 1;
      if (aR) aR.position.x = 4 + Math.sin(ts * 3 + 1.5) * 1;
    }

    // Pupils track facing direction (only for round eyes)
    ['eyeL', 'eyeR'].forEach(name => {
      const eyeG = group.getObjectByName(name);
      if (!eyeG) return;
      const pupil = eyeG.getObjectByName('pupil');
      if (pupil) {
        pupil.position.x = fx * 0.7;
        pupil.position.y = -fy * 0.3;
      }
    });

    // Eyes position follow body + 차징 표정 변화
    const eyeL = group.getObjectByName('eyeL');
    const eyeR = group.getObjectByName('eyeR');
    if (eyeL) {
      eyeL.position.y = 24.5 + idleBob + walkBounce + chargeYOffset;
      // chargeRatio > 0.5: 눈 찡그림
      eyeL.scale.y = (isCharging && chargeRatio > 0.5) ? (1 - (chargeRatio - 0.5) * 0.8) : 1;
    }
    if (eyeR) {
      eyeR.position.y = 24.5 + idleBob + walkBounce + chargeYOffset;
      eyeR.scale.y = (isCharging && chargeRatio > 0.5) ? (1 - (chargeRatio - 0.5) * 0.8) : 1;
    }

    // Mouth follows body + 차징 입 표현
    const mouth = group.getObjectByName('mouth');
    if (mouth) {
      mouth.position.y = 20.5 + idleBob + walkBounce + chargeYOffset;
      if (isCharging) {
        // 차징 중 입 다물기, chargeRatio > 0.8이면 입 벌어짐 ("으으으")
        const mouthScaleX = chargeRatio > 0.8 ? 1.3 : 0.6;
        const mouthScaleY = chargeRatio > 0.8 ? 0.5 : 0.3;
        mouth.scale.set(mouthScaleX, mouthScaleY, 1);
      } else {
        mouth.scale.set(
          player.punching ? 1.4 : 1,
          player.punching ? 1.4 : 1,
          1
        );
      }
    }

    // Name sprite
    updateNameSprite(group, player.nickname);
    const nameSprite = group.getObjectByName('nameSprite');
    if (nameSprite) {
      nameSprite.position.y = 46 + idleBob;
    }

    // Shadow
    const shadow = group.getObjectByName('shadow');
    if (shadow) {
      const s = 1 - idleBob * 0.03;
      shadow.scale.set(s, s, s);
    }

    // 삼단계 emissive 글로우: orange -> red -> white-red flash
    if (isCharging && body) {
      const pulseSpeed = 8 + chargeRatio * 12; // 펄스 속도 증가
      const pulse = 0.5 + 0.5 * Math.sin(ts * pulseSpeed);
      body.material.emissive = body.material.emissive || new THREE.Color();
      if (chargeRatio < 0.5) {
        // orange 단계
        body.material.emissive.setRGB(chargeRatio * pulse * 1.0, chargeRatio * pulse * 0.4, 0);
      } else if (chargeRatio < 0.8) {
        // red 단계
        body.material.emissive.setRGB(pulse * 1.0, pulse * 0.1, 0);
      } else {
        // white-red flash 단계
        const flash = 0.5 + 0.5 * Math.sin(ts * 30);
        body.material.emissive.setRGB(1.0, flash * 0.6, flash * 0.4);
      }
      body.material.emissiveIntensity = chargeRatio * 3;
    } else if (body && body.material.emissiveIntensity > 0) {
      body.material.emissiveIntensity *= 0.9; // 서서히 감소
      if (body.material.emissiveIntensity < 0.01) body.material.emissiveIntensity = 0;
    }

    // 차징 전용 파티클 (chargeRatio > 0.3일 때)
    if (isCharging && chargeRatio > 0.3 && Math.random() < chargeRatio * 0.15) {
      const pColor = chargeRatio < 0.5 ? '#ffaa00' : chargeRatio < 0.8 ? '#ff4400' : '#ff0000';
      const pCount = chargeRatio > 0.7 ? 2 : 1;
      spawn3DParticles(player.x, player.y, pCount, pColor, 0.5);
    }

    // Dodge transparency
    if (player.dodging || player.isInvincible) {
      group.traverse(child => {
        if (child.material && child.name !== 'shadow') {
          child.material.transparent = true;
          child.material.opacity = 0.3 + 0.4 * Math.abs(Math.sin(ts * 8));
        }
      });
    } else {
      group.traverse(child => {
        if (child.material && child.name !== 'shadow' && child.material.opacity < 1) {
          child.material.opacity = 1;
        }
      });
    }

    // My player indicator (bright glowing disc + ring + arrow)
    if (player.id === game.myId) {
      // Glowing disc under feet
      let disc = group.getObjectByName('myDisc');
      if (!disc) {
        const discGeo = new THREE.CircleGeometry(16, 32);
        const discMat = new THREE.MeshBasicMaterial({
          color: 0x44ff88, transparent: true, opacity: 0.35,
        });
        disc = new THREE.Mesh(discGeo, discMat);
        disc.rotation.x = -Math.PI / 2;
        disc.name = 'myDisc';
        group.add(disc);
      }
      disc.position.y = 0.4;
      disc.material.opacity = 0.25 + 0.15 * Math.sin(ts * 3);
      const ds = 1 + 0.08 * Math.sin(ts * 3);
      disc.scale.set(ds, ds, ds);

      // Bright ring
      let ring = group.getObjectByName('myRing');
      if (!ring) {
        const ringGeo = new THREE.TorusGeometry(16, 1.8, 8, 32);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x44ff88, transparent: true, opacity: 0.9,
        });
        ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.name = 'myRing';
        group.add(ring);
      }
      ring.position.y = 0.6;
      ring.material.opacity = 0.6 + 0.3 * Math.sin(ts * 5);
      ring.scale.set(ds, ds, ds);

      // Arrow above head
      let arrow = group.getObjectByName('myArrow');
      if (!arrow) {
        const arrowGeo = new THREE.ConeGeometry(3, 6, 4);
        const arrowMat = new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.9 });
        arrow = new THREE.Mesh(arrowGeo, arrowMat);
        arrow.rotation.x = Math.PI;
        arrow.name = 'myArrow';
        group.add(arrow);
      }
      arrow.position.y = 50 + Math.sin(ts * 3) * 2.5;
    }
  }

  // ─── Sync characters with game state ────────────────────────────────────────
  function syncCharacters(dt, ts) {
    const players = game.interpolatedPlayers;
    const currentIds = new Set();

    Object.values(players).forEach(p => {
      currentIds.add(p.id);
      if (!p.alive) {
        if (charGroups[p.id]) {
          scene.remove(charGroups[p.id]);
          delete charGroups[p.id];
        }
        return;
      }

      if (!charGroups[p.id]) {
        charGroups[p.id] = createCharacter3D(p.id, p.color);
        scene.add(charGroups[p.id]);
        const a = getAnim(p.id);
        const { x, z } = serverToWorld(p.x, p.y);
        a.prevX = x;
        a.prevZ = z;
      }

      animateCharacter(charGroups[p.id], p, dt, ts);
    });

    Object.keys(charGroups).forEach(id => {
      if (!currentIds.has(id)) {
        scene.remove(charGroups[id]);
        delete charGroups[id];
        delete charAnims[id];
      }
    });
  }

  // ─── 3D Particles ──────────────────────────────────────────────────────────
  function spawn3DParticles(sx, sy, count, color, speedMult) {
    const { x: wx, z: wz } = serverToWorld(sx, sy);
    const col = new THREE.Color(color || '#ffaa33');
    for (let i = 0; i < count; i++) {
      const geo = new THREE.SphereGeometry(0.4 + Math.random() * 0.8, 4, 4);
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(geo, mat);
      const angle = Math.random() * Math.PI * 2;
      const sp = (Math.random() * 1.2 + 0.4) * (speedMult || 1);
      mesh.position.set(wx, 5 + Math.random() * 8, wz);
      scene.add(mesh);
      particles3d.push({
        mesh,
        vx: Math.cos(angle) * sp,
        vy: Math.random() * 1.5 + 0.8,
        vz: Math.sin(angle) * sp,
        life: 1, decay: 0.015 + Math.random() * 0.01,
      });
    }
  }

  // 360도 충격파 링 이펙트
  function spawnShockwaveRing(sx, sy, count, color, radius, speedMult) {
    const { x: wx, z: wz } = serverToWorld(sx, sy);
    const col = new THREE.Color(color || '#ff4400');
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const geo = new THREE.SphereGeometry(0.6 + Math.random() * 0.4, 4, 4);
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 1 });
      const mesh = new THREE.Mesh(geo, mat);
      const sp = (1.5 + Math.random() * 0.5) * (speedMult || 1);
      mesh.position.set(
        wx + Math.cos(angle) * radius * 0.3,
        5 + Math.random() * 3,
        wz + Math.sin(angle) * radius * 0.3
      );
      scene.add(mesh);
      particles3d.push({
        mesh,
        vx: Math.cos(angle) * sp,
        vy: Math.random() * 0.5 + 0.2,
        vz: Math.sin(angle) * sp,
        life: 1, decay: 0.02 + Math.random() * 0.01,
      });
    }
  }

  function updateParticles3D(dt) {
    for (let i = particles3d.length - 1; i >= 0; i--) {
      const p = particles3d[i];
      p.mesh.position.x += p.vx * dt * 30;
      p.mesh.position.y += p.vy * dt * 30;
      p.mesh.position.z += p.vz * dt * 30;
      p.vy -= dt * 3;
      p.life -= p.decay;
      p.mesh.material.opacity = Math.max(0, p.life);
      const s = p.life;
      p.mesh.scale.set(s, s, s);
      if (p.life <= 0) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        particles3d.splice(i, 1);
      }
    }
  }

  // ─── Elimination Animations ─────────────────────────────────────────────────
  function addElimAnimation(player) {
    const { x: wx, z: wz } = serverToWorld(player.x || 400, player.y || 400);

    // 캐릭터 복제본으로 낙하 애니메이션 생성
    const fallingChar = createCharacter3D(player.id + '_fall', player.color);
    fallingChar.position.set(wx, 0, wz);
    // 방향 설정 (아레나 바깥 방향)
    const dirX = wx;
    const dirZ = wz;
    const dirMag = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
    scene.add(fallingChar);

    elimAnims3d.push({
      mesh: fallingChar,
      isCharFall: true,
      vx: (dirX / dirMag) * 1.5 + (Math.random() - 0.5) * 0.5,
      vy: 2.5,
      vz: (dirZ / dirMag) * 1.5 + (Math.random() - 0.5) * 0.5,
      spinX: (Math.random() - 0.5) * 0.15,
      spinZ: (Math.random() - 0.5) * 0.15,
      armPhase: Math.random() * Math.PI * 2,
      life: 1, decay: 0.008,
      startScale: CHAR_SCALE,
    });

    spawn3DParticles(player.x || 400, player.y || 400, 20, player.color || '#ff4444', 2);
  }

  function updateElimAnims(dt) {
    for (let i = elimAnims3d.length - 1; i >= 0; i--) {
      const a = elimAnims3d[i];

      if (a.isCharFall) {
        // 캐릭터 낙하 애니메이션 — 팔 휘저으며 작아지며 떨어짐
        a.mesh.position.x += a.vx * dt * 20;
        a.mesh.position.y += a.vy * dt * 20;
        a.mesh.position.z += a.vz * dt * 20;
        a.vy -= dt * 4; // 중력

        // 구르기/회전
        a.mesh.rotation.x += a.spinX;
        a.mesh.rotation.z += a.spinZ;

        // 팔 휘젓기 애니메이션
        a.armPhase += dt * 18;
        const armL = a.mesh.getObjectByName('armL');
        const armR = a.mesh.getObjectByName('armR');
        const handL = a.mesh.getObjectByName('handL');
        const handR = a.mesh.getObjectByName('handR');
        if (armL) {
          armL.rotation.x = Math.sin(a.armPhase) * 1.5;
          armL.rotation.z = -1.2 + Math.sin(a.armPhase * 1.3) * 0.6;
        }
        if (armR) {
          armR.rotation.x = Math.sin(a.armPhase + 2) * 1.5;
          armR.rotation.z = 1.2 + Math.sin(a.armPhase * 1.3 + 1.5) * 0.6;
        }
        if (handL) {
          handL.position.set(-14, 18 + Math.sin(a.armPhase) * 6, Math.cos(a.armPhase) * 5);
        }
        if (handR) {
          handR.position.set(14, 18 + Math.sin(a.armPhase + 2) * 6, Math.cos(a.armPhase + 2) * 5);
        }

        // 다리 발버둥
        const legL = a.mesh.getObjectByName('legL');
        const legR = a.mesh.getObjectByName('legR');
        if (legL) legL.position.z = Math.sin(a.armPhase * 1.5) * 4;
        if (legR) legR.position.z = Math.sin(a.armPhase * 1.5 + Math.PI) * 4;

        a.life -= a.decay;

        // 작아지며 사라짐
        const s = a.startScale * a.life;
        a.mesh.scale.set(s, s, s);

        // 투명해짐
        a.mesh.traverse(child => {
          if (child.material) {
            child.material.transparent = true;
            child.material.opacity = Math.max(0, a.life);
          }
        });

        if (a.life <= 0) {
          a.mesh.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
          });
          scene.remove(a.mesh);
          elimAnims3d.splice(i, 1);
        }
      } else {
        // 기존 파티클 애니메이션
        a.mesh.position.x += a.vx * dt * 30;
        a.mesh.position.y += a.vy * dt * 30;
        a.mesh.position.z += a.vz * dt * 30;
        a.vy -= dt * 5;
        a.mesh.rotation.x += a.spin;
        a.mesh.rotation.z += a.spin * 0.7;
        a.life -= a.decay;
        a.mesh.material.opacity = a.life * 0.8;
        const s = a.life;
        a.mesh.scale.set(s, s, s);
        if (a.life <= 0) {
          scene.remove(a.mesh);
          a.mesh.geometry.dispose();
          a.mesh.material.dispose();
          elimAnims3d.splice(i, 1);
        }
      }
    }
  }

  // ─── Game Loop ──────────────────────────────────────────────────────────────
  function startGameLoop() {
    game.running = true;
    game.stateBuffer = [];
    game.interpolatedPlayers = {};
    game.killLogEntries = [];
    Object.keys(charGroups).forEach(id => { scene.remove(charGroups[id]); });
    charGroups = {};
    charAnims = {};
    particles3d.forEach(p => { scene.remove(p.mesh); });
    particles3d = [];
    elimAnims3d.forEach(a => { scene.remove(a.mesh); });
    elimAnims3d = [];
    clock.start();
    requestAnimationFrame(gameLoop);
  }

  function stopGameLoop() { game.running = false; }

  function gameLoop() {
    if (!game.running) return;
    try {
      const dt = Math.min(clock.getDelta(), 0.05);
      const ts = clock.getElapsedTime();

      interpolateState(performance.now());
      syncCharacters(dt, ts);

      if (game.currentState && game.currentState.arena) {
        updateArena(game.currentState.arena, ts);
      }

      updateParticles3D(dt);
      updateElimAnims(dt);
      updateCooldownOverlays();
      updateKillLog(dt * 1000);

      renderer.render(scene, camera);
      sendInputToServer();
    } catch (e) {
      console.error('Game loop error:', e);
    }
    requestAnimationFrame(gameLoop);
  }

  // ─── State Interpolation ───────────────────────────────────────────────────
  function pushServerState(state) {
    const now = performance.now();
    game.stateBuffer.push({ time: now, state });
    while (game.stateBuffer.length > 0 && now - game.stateBuffer[0].time > 1000)
      game.stateBuffer.shift();
    game.currentState = state;
    updateHUD(state);
  }

  function interpolateState(timestamp) {
    if (game.stateBuffer.length < 2) {
      if (game.currentState && game.currentState.players)
        game.currentState.players.forEach(p => { game.interpolatedPlayers[p.id] = { ...p }; });
      return;
    }
    const renderTime = timestamp - INTERPOLATION_DELAY;
    let prev = null, next = null;
    for (let i = 0; i < game.stateBuffer.length - 1; i++) {
      if (game.stateBuffer[i].time <= renderTime && game.stateBuffer[i + 1].time >= renderTime) {
        prev = game.stateBuffer[i]; next = game.stateBuffer[i + 1]; break;
      }
    }
    if (!prev || !next) {
      const latest = game.stateBuffer[game.stateBuffer.length - 1];
      if (latest && latest.state.players)
        latest.state.players.forEach(p => { game.interpolatedPlayers[p.id] = { ...p }; });
      return;
    }
    const td = next.time - prev.time;
    const t = td > 0 ? (renderTime - prev.time) / td : 0;
    const pm = {}, nm = {};
    prev.state.players.forEach(p => pm[p.id] = p);
    next.state.players.forEach(p => nm[p.id] = p);
    new Set([...Object.keys(pm), ...Object.keys(nm)]).forEach(id => {
      const pp = pm[id], np = nm[id];
      if (pp && np) {
        game.interpolatedPlayers[id] = { ...np, x: pp.x + (np.x - pp.x) * t, y: pp.y + (np.y - pp.y) * t };
      } else if (np) game.interpolatedPlayers[id] = { ...np };
      else if (pp) game.interpolatedPlayers[id] = { ...pp };
    });
  }

  // ─── HUD ────────────────────────────────────────────────────────────────────
  function updateHUD(state) {
    const timerEl = document.getElementById('timer');
    const aliveEl = document.getElementById('alive-count');
    const warningEl = document.getElementById('shrink-warning');
    if (timerEl && state.time != null) {
      const s = Math.ceil(state.time);
      timerEl.textContent = s + '초';
      timerEl.classList.toggle('urgent', s <= 10);
    }
    if (aliveEl && state.players) {
      const alive = state.players.filter(p => p.alive).length;
      aliveEl.textContent = `생존: ${alive}/${state.players.length}`;
    }
    if (warningEl && state.arena)
      warningEl.classList.toggle('active', state.arena.radius < 375);
  }

  // ─── Countdown / Kill log / Cooldowns ─────────────────────────────────────
  function showCountdown(count) {
    const overlay = document.getElementById('countdown-overlay');
    if (!overlay) return;
    overlay.innerHTML = '';
    const label = count > 0 ? String(count) : 'GO!';
    const span = document.createElement('span');
    span.className = count > 0 ? 'countdown-number' : 'countdown-number go';
    span.textContent = label;
    overlay.appendChild(span);
    overlay.classList.add('active');
    if (count <= 0) setTimeout(() => { overlay.classList.remove('active'); overlay.innerHTML = ''; }, 800);
  }

  function addKillLogEntry(pn, kn) {
    const msg = kn ? `${kn} → ${pn} 탈락!` : `${pn} 탈락!`;
    game.killLogEntries.push({ msg, life: 4000 });
    if (game.killLogEntries.length > 5) game.killLogEntries.shift();
    updateKillLogDOM();
  }

  function updateKillLog(dtMs) {
    let changed = false;
    for (let i = game.killLogEntries.length - 1; i >= 0; i--) {
      game.killLogEntries[i].life -= dtMs;
      if (game.killLogEntries[i].life <= 0) { game.killLogEntries.splice(i, 1); changed = true; }
    }
    if (changed) updateKillLogDOM();
  }

  function updateKillLogDOM() {
    const el = document.getElementById('kill-log');
    if (!el) return;
    el.innerHTML = game.killLogEntries.map(e => {
      const op = Math.min(1, e.life / 1000);
      return `<div class="kill-entry" style="opacity:${op}">${e.msg}</div>`;
    }).join('');
  }

  function updateCooldownOverlays() {
    const now = Date.now();
    const d = document.getElementById('dash-btn');
    if (d) {
      if (game.punchCharging) {
        const ratio = Math.min(1, (now - game.punchChargeStart) / PUNCH_MAX_CHARGE_MS);
        d.style.background = `linear-gradient(to top, #ff2200 ${ratio * 100}%, rgba(0,240,255,0.25) ${ratio * 100}%)`;
        // 붉은 glow 펄스 (chargeRatio > 0.7)
        if (ratio > 0.7) {
          const glowPulse = 5 + Math.sin(now * 0.01) * 5;
          d.style.boxShadow = `0 0 ${glowPulse + 10}px ${glowPulse}px rgba(255,34,0,${0.4 + ratio * 0.4})`;
        } else {
          d.style.boxShadow = '';
        }
        // 미세 흔들림 (chargeRatio > 0.9)
        if (ratio > 0.9) {
          const shake = (Math.random() - 0.5) * 3;
          d.style.transform = `scale(${1 + ratio * 0.3}) translate(${shake}px, ${shake}px)`;
        } else {
          d.style.transform = `scale(${1 + ratio * 0.3})`;
        }
      } else {
        d.style.background = '';
        d.style.transform = '';
        d.style.boxShadow = '';
      }
    }
    const g = document.getElementById('dodge-btn');
    if (g) g.classList.toggle('on-cooldown', game.dodgeCooldownEnd - now > 0);
  }

  // ─── Touch Controls ─────────────────────────────────────────────────────────
  function setupTouchControls() {
    const zone = document.getElementById('joystick-zone');
    const base = document.getElementById('joystick-base');
    const thumb = document.getElementById('joystick-thumb');
    if (!zone || !base || !thumb) return;

    zone.addEventListener('touchstart', e => {
      e.preventDefault();
      if (game.joystick.active) return;
      const t = e.changedTouches[0];
      game.joystick.active = true;
      game.joystick.touchId = t.identifier;
      game.joystick.originX = t.clientX;
      game.joystick.originY = t.clientY;
      game.joystick.dx = 0; game.joystick.dy = 0;
      const r = zone.getBoundingClientRect();
      base.style.display = 'block';
      base.style.left = (t.clientX - r.left) + 'px';
      base.style.top = (t.clientY - r.top) + 'px';
      thumb.style.transform = 'translate(-50%,-50%)';
    }, { passive: false });

    zone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === game.joystick.touchId) {
          let dx = t.clientX - game.joystick.originX;
          let dy = t.clientY - game.joystick.originY;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > JOYSTICK_MAX_RADIUS) { dx = dx / d * JOYSTICK_MAX_RADIUS; dy = dy / d * JOYSTICK_MAX_RADIUS; }
          game.joystick.dx = dx / JOYSTICK_MAX_RADIUS;
          game.joystick.dy = dy / JOYSTICK_MAX_RADIUS;
          thumb.style.transform = `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`;
        }
      }
    }, { passive: false });

    const end = e => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === game.joystick.touchId) {
          game.joystick.active = false; game.joystick.touchId = null;
          game.joystick.dx = 0; game.joystick.dy = 0;
          base.style.display = 'none';
          thumb.style.transform = 'translate(-50%,-50%)';
        }
      }
    };
    zone.addEventListener('touchend', end, { passive: false });
    zone.addEventListener('touchcancel', end, { passive: false });
  }

  // ─── Buttons + Keyboard ─────────────────────────────────────────────────────
  function setupButtonControls() {
    const dashBtn = document.getElementById('dash-btn');
    const dodgeBtn = document.getElementById('dodge-btn');

    function startPunchCharge() {
      if (game.punchCharging) return;
      game.punchCharging = true;
      game.punchChargeStart = Date.now();
      window.network && window.network.sendPunchStart();
    }
    function releasePunch() {
      if (!game.punchCharging) return;
      const charge = Math.min(1, (Date.now() - game.punchChargeStart) / PUNCH_MAX_CHARGE_MS);
      game.punchCharging = false;
      window.network && window.network.sendPunchRelease(charge);
      const me = game.interpolatedPlayers[game.myId];
      if (me) {
        const count = Math.floor(6 + charge * 14);
        // 360도 충격파 링 + 중심부 폭발 파티클
        const blastColor = charge > 0.6 ? '#ff2200' : '#ff8844';
        spawnShockwaveRing(me.x, me.y, 16 + Math.floor(charge * 16), blastColor, 8, 0.8 + charge * 1.5);
        spawn3DParticles(me.x, me.y, Math.floor(count * 0.5), blastColor, 0.5);
      }
    }
    function triggerDodge() {
      const now = Date.now();
      if (now >= game.dodgeCooldownEnd) {
        window.network && window.network.sendDodge();
        game.dodgeCooldownEnd = now + DODGE_COOLDOWN;
      }
    }

    if (dashBtn) {
      dashBtn.addEventListener('touchstart', e => { e.preventDefault(); startPunchCharge(); }, { passive: false });
      dashBtn.addEventListener('touchend', e => { e.preventDefault(); releasePunch(); }, { passive: false });
      dashBtn.addEventListener('touchcancel', e => { releasePunch(); }, { passive: false });
      dashBtn.addEventListener('mousedown', e => { e.preventDefault(); startPunchCharge(); });
      dashBtn.addEventListener('mouseup', e => { releasePunch(); });
    }
    if (dodgeBtn) {
      dodgeBtn.addEventListener('touchstart', e => { e.preventDefault(); triggerDodge(); }, { passive: false });
      dodgeBtn.addEventListener('click', triggerDodge);
    }

    document.addEventListener('keydown', e => {
      if (!game.running) return;
      if (e.key === 'j' || e.key === 'J' || e.key === ' ') startPunchCharge();
      if (e.key === 'k' || e.key === 'K' || e.key === 'Shift') triggerDodge();
    });
    document.addEventListener('keyup', e => {
      if (e.key === 'j' || e.key === 'J' || e.key === ' ') releasePunch();
    });

    const keys = {};
    document.addEventListener('keydown', e => { keys[e.key] = true; updKb(); });
    document.addEventListener('keyup', e => { keys[e.key] = false; updKb(); });
    function updKb() {
      if (!game.running) return;
      let dx = 0, dy = 0;
      if (keys['w'] || keys['W'] || keys['ArrowUp']) dy -= 1;
      if (keys['s'] || keys['S'] || keys['ArrowDown']) dy += 1;
      if (keys['a'] || keys['A'] || keys['ArrowLeft']) dx -= 1;
      if (keys['d'] || keys['D'] || keys['ArrowRight']) dx += 1;
      const m = Math.sqrt(dx * dx + dy * dy);
      if (m > 1) { dx /= m; dy /= m; }
      game.keyboardDx = dx; game.keyboardDy = dy;
    }
  }

  function sendInputToServer() {
    if (!window.network) return;
    let dx = game.joystick.dx || 0, dy = game.joystick.dy || 0;
    if (game.keyboardDx || game.keyboardDy) { dx = game.keyboardDx; dy = game.keyboardDy; }
    window.network.sendInput(dx, dy);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────
  window.gameRenderer = {
    init, startGameLoop, stopGameLoop, pushServerState,
    showCountdown, addKillLogEntry, addElimAnimation,
    spawnParticles: spawn3DParticles,
  };
})();
