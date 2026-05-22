// Flappy Bird - Web Recreation (exact match to Godot version)
// Optimized for iOS & Android

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

// ─── Godot viewport constants ───
const GAME_W = 480, GAME_H = 854;

// ─── Physics (from player.gd) ───
const GRAVITY = 980;
const FLAP_FORCE = -340;
const FLAP_ANGULAR_FORCE = -8;
const MAX_ROT_UP = -30 * Math.PI / 180;
const MAX_ROT_DOWN = 90 * Math.PI / 180;
const FALLING_ANG_VEL = 5;

// ─── Obstacle (from obstacle.gd / obstacle_spawner.gd) ───
const OBS_SPEED = -215;
const SPAWN_X = 700;
const SPAWNER_Y = 400;
const SPAWN_MIN_Y = -250;
const SPAWN_MAX_Y = 120;
const SPAWN_INTERVAL = 1.5;
const OBS_REMOVE_X = -200;

// ─── Ground (from ground.tscn) ───
const GROUND_Y = 686;
const GROUND_SCROLL_SPEED = 216;
const GROUND_TILE_W = 216;

// ─── Player start (from game.tscn) ───
const PLAYER_START_X = 77, PLAYER_START_Y = 391;
const BIRD_RADIUS = 19;

// ─── Scaling ───
let scale = 1, offsetX = 0, offsetY = 0;

function resize() {
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    scale = Math.min(cw / GAME_W, ch / GAME_H);
    canvas.width = Math.floor(GAME_W * scale);
    canvas.height = Math.floor(GAME_H * scale);
    offsetX = Math.floor((cw - canvas.width) / 2);
    offsetY = Math.floor((ch - canvas.height) / 2);
    canvas.style.position = 'absolute';
    canvas.style.left = offsetX + 'px';
    canvas.style.top = offsetY + 'px';
    ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 100));
resize();

// ─── iOS Audio Context unlock ───
let audioUnlocked = false;
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    // Create and resume AudioContext (required for iOS Safari)
    if (AudioContext) {
        audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }
    // Play a silent buffer to unlock audio on iOS
    const silentSound = new Audio();
    silentSound.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    silentSound.volume = 0;
    silentSound.play().then(() => silentSound.pause()).catch(() => {});
    // Pre-warm all game sounds
    Object.values(sounds).forEach(s => {
        if (s) { s.load(); }
    });
}

// ─── Asset loading ───
const images = {}, sounds = {};
let assetsLoaded = 0, totalAssets = 0;

function loadImage(name, src) {
    totalAssets++;
    const img = new Image();
    img.onload = () => { assetsLoaded++; };
    img.onerror = () => { console.warn('Failed to load', src); assetsLoaded++; };
    img.src = src;
    images[name] = img;
}

function loadSound(name, src) {
    totalAssets++;
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.addEventListener('canplaythrough', () => { assetsLoaded++; }, { once: true });
    audio.addEventListener('error', () => { console.warn('Failed to load', src); assetsLoaded++; }, { once: true });
    // Timeout fallback — mobile may never fire canplaythrough
    setTimeout(() => {
        if (!audio.readyState) assetsLoaded++;
    }, 3000);
    sounds[name] = audio;
}

function playSound(name) {
    if (!audioUnlocked) return;
    const s = sounds[name];
    if (!s) return;
    const clone = s.cloneNode();
    clone.volume = s.volume;
    clone.play().catch(() => {});
}

loadImage('background', 'assets/textures/background.png');
loadImage('bird', 'assets/textures/bird.png');
loadImage('pipe', 'assets/textures/pipe.png');
loadImage('ground', 'assets/textures/ground.png');
loadImage('message', 'assets/textures/message.png');
loadImage('gameover', 'assets/textures/gameover.png');

loadSound('wing', 'assets/audio/wing.wav');
loadSound('hit', 'assets/audio/hit.wav');
loadSound('point', 'assets/audio/point.wav');
loadSound('die', 'assets/audio/die.wav');
loadSound('swoosh', 'assets/audio/swoosh.wav');

// ─── Game state ───
let gameState = 'ready';
let score = 0;
let highScore = parseInt(localStorage.getItem('flappy_high_score') || '0');

// ─── Bird ───
const bird = {
    x: PLAYER_START_X, y: PLAYER_START_Y,
    vy: 0, rotation: 0, angularVel: 0,
    frame: 1, animTimer: 0, animFrames: [1, 2, 1, 0],
    animIndex: 0, spriteOffsetY: -5, flapAnimTimer: -1
};

// ─── Obstacles ───
let obstacles = [];
let spawnTimer = 0;

// ─── Ground scroll ───
let groundScrollX = 0;

// ─── Game Over UI ───
let gameOverAlpha = 0;
let startMsgAlpha = 1;
let deathTimer = 0;
let showGameOver = false;

// ─── Idle bob ───
let idleTimer = 0;

function resetGame() {
    bird.x = PLAYER_START_X;
    bird.y = PLAYER_START_Y;
    bird.vy = 0;
    bird.rotation = 0;
    bird.angularVel = 0;
    bird.frame = 1;
    bird.animTimer = 0;
    bird.animIndex = 0;
    bird.spriteOffsetY = -5;
    bird.flapAnimTimer = -1;
    obstacles = [];
    spawnTimer = 0;
    groundScrollX = 0;
    score = 0;
    gameState = 'ready';
    gameOverAlpha = 0;
    startMsgAlpha = 1;
    deathTimer = 0;
    showGameOver = false;
    idleTimer = 0;
}

// ─── Input handling (mobile-optimized) ───
let inputPressed = false;

function getGameCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: (clientX - rect.left) / scale,
        y: (clientY - rect.top) / scale
    };
}

function isRetryButton(gx, gy) {
    const panelY = GAME_H / 2 - 216;
    const btnX = GAME_W / 2 - 102;
    const btnY = panelY + 216 + 67.5;
    return gx >= btnX && gx <= btnX + 204 && gy >= btnY && gy <= btnY + 71;
}

function onInput() {
    unlockAudio();
    if (gameState === 'dead' && showGameOver) return;
    inputPressed = true;
}

// Prevent all default mobile behaviors on canvas
function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

// Touch events (primary for mobile)
canvas.addEventListener('touchstart', (e) => {
    preventDefaults(e);
    unlockAudio();

    if (gameState === 'dead' && showGameOver) {
        const touch = e.touches[0];
        const gc = getGameCoords(touch.clientX, touch.clientY);
        if (isRetryButton(gc.x, gc.y)) {
            resetGame();
        }
        return;
    }
    inputPressed = true;
}, { passive: false });

canvas.addEventListener('touchmove', preventDefaults, { passive: false });
canvas.addEventListener('touchend', preventDefaults, { passive: false });

// Mouse events (desktop fallback)
canvas.addEventListener('mousedown', (e) => {
    preventDefaults(e);
    unlockAudio();

    if (gameState === 'dead' && showGameOver) {
        const gc = getGameCoords(e.clientX, e.clientY);
        if (isRetryButton(gc.x, gc.y)) {
            resetGame();
        }
        return;
    }
    inputPressed = true;
});

// Keyboard (desktop)
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        unlockAudio();
        onInput();
    }
});

// Prevent zoom gestures & context menu
document.addEventListener('gesturestart', preventDefaults, { passive: false });
document.addEventListener('gesturechange', preventDefaults, { passive: false });
document.addEventListener('gestureend', preventDefaults, { passive: false });
canvas.addEventListener('contextmenu', preventDefaults);

// Prevent double-tap zoom on iOS
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
}, { passive: false });

// Prevent pull-to-refresh
document.body.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) e.preventDefault();
}, { passive: false });

// ─── Collision detection ───
function circleRectCollision(cx, cy, r, rx, ry, rw, rh) {
    const closestX = Math.max(rx, Math.min(cx, rx + rw));
    const closestY = Math.max(ry, Math.min(cy, ry + rh));
    const dx = cx - closestX, dy = cy - closestY;
    return (dx * dx + dy * dy) < (r * r);
}

// ─── Update ───
function update(dt) {
    if (dt > 0.1) dt = 0.1;

    if (gameState === 'ready') {
        idleTimer += dt;
        const bobPeriod = 0.8;
        const t = (idleTimer % bobPeriod) / bobPeriod;
        bird.spriteOffsetY = -5 + 10 * (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

        bird.animTimer += dt;
        if (bird.animTimer >= 0.1) {
            bird.animTimer -= 0.1;
            bird.animIndex = (bird.animIndex + 1) % bird.animFrames.length;
            bird.frame = bird.animFrames[bird.animIndex];
        }

        if (inputPressed) {
            gameState = 'playing';
            bird.vy = FLAP_FORCE;
            bird.angularVel = FLAP_ANGULAR_FORCE;
            bird.spriteOffsetY = 0;
            bird.flapAnimTimer = 0;
            playSound('wing');
        }
        inputPressed = false;
        return;
    }

    if (gameState === 'playing') {
        if (startMsgAlpha > 0) {
            startMsgAlpha -= dt * 2;
            if (startMsgAlpha < 0) startMsgAlpha = 0;
        }

        if (inputPressed) {
            bird.vy = FLAP_FORCE;
            bird.angularVel = FLAP_ANGULAR_FORCE;
            bird.flapAnimTimer = 0;
            playSound('wing');
            inputPressed = false;
        }

        bird.vy += GRAVITY * dt;
        bird.y += bird.vy * dt;

        if (bird.rotation <= MAX_ROT_UP) {
            bird.rotation = MAX_ROT_UP;
            bird.angularVel = 0;
        }

        if (bird.vy > 0) {
            if (bird.rotation <= MAX_ROT_DOWN) {
                bird.angularVel = FALLING_ANG_VEL;
            } else {
                bird.angularVel = 0;
            }
        }

        bird.rotation += bird.angularVel * dt;
        if (bird.rotation > MAX_ROT_DOWN) bird.rotation = MAX_ROT_DOWN;

        if (bird.flapAnimTimer >= 0) {
            bird.flapAnimTimer += dt;
            const flapFrames = [2, 1, 0, 1];
            const fi = Math.floor(bird.flapAnimTimer / 0.1);
            if (fi < 4) {
                bird.frame = flapFrames[fi];
                bird.spriteOffsetY = 0;
            } else {
                bird.flapAnimTimer = -1;
                bird.frame = 1;
            }
        }

        spawnTimer += dt;
        if (spawnTimer >= SPAWN_INTERVAL) {
            spawnTimer -= SPAWN_INTERVAL;
            const randY = SPAWN_MIN_Y + Math.random() * (SPAWN_MAX_Y - SPAWN_MIN_Y);
            obstacles.push({
                x: SPAWN_X,
                y: SPAWNER_Y + randY,
                speed: OBS_SPEED,
                scored: false
            });
        }

        for (let i = obstacles.length - 1; i >= 0; i--) {
            const obs = obstacles[i];
            obs.x += obs.speed * dt;

            if (obs.x < OBS_REMOVE_X) {
                obstacles.splice(i, 1);
                continue;
            }

            const pipeW = images.pipe ? images.pipe.width : 52;
            const pipeH = images.pipe ? images.pipe.height : 320;
            const halfPipeW = pipeW / 2;

            const topPipeX = obs.x - halfPipeW;
            const topPipeBottomY = obs.y - 300 + pipeH / 2;
            const topPipeTopY = topPipeBottomY - 2472;
            if (circleRectCollision(bird.x, bird.y, BIRD_RADIUS,
                topPipeX, topPipeTopY, pipeW, 2472)) {
                doBirdDie();
            }

            const botPipeX = obs.x - halfPipeW;
            const botPipeTopY = obs.y + 300 - pipeH / 2;
            if (circleRectCollision(bird.x, bird.y, BIRD_RADIUS,
                botPipeX, botPipeTopY, pipeW, pipeH)) {
                doBirdDie();
            }

            if (!obs.scored && bird.x >= obs.x + 28 - 10 && bird.x <= obs.x + 28 + 10) {
                obs.scored = true;
                score++;
                playSound('point');
            }
        }

        if (bird.y + BIRD_RADIUS >= GROUND_Y) {
            bird.y = GROUND_Y - BIRD_RADIUS;
            doBirdDie();
        }

        if (bird.y - BIRD_RADIUS < 0) {
            bird.y = BIRD_RADIUS;
            bird.vy = 0;
        }

        groundScrollX -= GROUND_SCROLL_SPEED * dt;
        if (groundScrollX <= -GROUND_TILE_W) groundScrollX += GROUND_TILE_W;

        inputPressed = false;
    }

    if (gameState === 'dead') {
        bird.vy += GRAVITY * dt;
        bird.y += bird.vy * dt;
        bird.rotation += bird.angularVel * dt;
        if (bird.rotation > MAX_ROT_DOWN) bird.rotation = MAX_ROT_DOWN;
        if (bird.vy > 0) bird.angularVel = FALLING_ANG_VEL;

        if (bird.y + BIRD_RADIUS >= GROUND_Y) {
            bird.y = GROUND_Y - BIRD_RADIUS;
            bird.vy = 0;
        }

        deathTimer += dt;
        if (deathTimer >= 0.5 && !showGameOver) {
            showGameOver = true;
            playSound('swoosh');
        }
        if (showGameOver && gameOverAlpha < 1) {
            gameOverAlpha += dt * 2;
            if (gameOverAlpha > 1) gameOverAlpha = 1;
        }

        inputPressed = false;
    }
}

function doBirdDie() {
    if (gameState !== 'playing') return;
    gameState = 'dead';
    playSound('hit');
    for (const obs of obstacles) obs.speed = 0;
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('flappy_high_score', highScore.toString());
    }
    deathTimer = 0;
}

// ─── Draw ───
function draw() {
    ctx.save();
    ctx.scale(scale, scale);

    if (images.background && images.background.complete) {
        ctx.drawImage(images.background, 0, 0, GAME_W, GAME_H);
    } else {
        ctx.fillStyle = '#70c5ce';
        ctx.fillRect(0, 0, GAME_W, GAME_H);
    }

    for (const obs of obstacles) drawPipe(obs);
    drawGround();
    drawBird();

    if (gameState !== 'dead' || !showGameOver) drawScore();
    if (gameState === 'ready' || startMsgAlpha > 0) drawStartMessage();
    if (showGameOver) drawGameOverScreen();

    ctx.restore();
}

function drawBird() {
    const img = images.bird;
    if (!img || !img.complete) return;
    const frameW = img.width / 3;
    const frameH = img.height;
    ctx.save();
    ctx.translate(bird.x, bird.y);
    ctx.rotate(bird.rotation);
    ctx.drawImage(img,
        bird.frame * frameW, 0, frameW, frameH,
        -frameW / 2, -frameH / 2 + bird.spriteOffsetY, frameW, frameH
    );
    ctx.restore();
}

function drawPipe(obs) {
    const img = images.pipe;
    if (!img || !img.complete) return;
    const pw = img.width, ph = img.height;
    ctx.save();
    ctx.translate(obs.x, obs.y - 300);
    ctx.scale(1, -1);
    ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);
    ctx.restore();
    ctx.drawImage(img, obs.x - pw / 2, obs.y + 300 - ph / 2, pw, ph);
}

function drawGround() {
    const img = images.ground;
    if (!img || !img.complete) return;
    const gw = img.width;
    const startX = Math.floor(groundScrollX);
    for (let x = startX; x < GAME_W + gw; x += gw) {
        ctx.drawImage(img, x, GROUND_Y);
    }
}

function drawScore() {
    ctx.save();
    ctx.font = '48px FlappyFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#000';
    ctx.lineJoin = 'round';
    ctx.strokeText(score.toString(), GAME_W / 2, 50);
    ctx.fillStyle = '#fff';
    ctx.fillText(score.toString(), GAME_W / 2, 50);
    ctx.restore();
}

function drawStartMessage() {
    const img = images.message;
    if (!img || !img.complete) return;
    ctx.save();
    ctx.globalAlpha = startMsgAlpha;
    const mw = 276, mh = 400;
    ctx.drawImage(img, GAME_W / 2 - mw / 2, GAME_H / 2 - 308, mw, mh);
    ctx.restore();
}

function drawGameOverScreen() {
    ctx.save();
    ctx.globalAlpha = gameOverAlpha;

    const panelW = 356, panelH = 397;
    const panelX = GAME_W / 2 - panelW / 2;
    const panelY = GAME_H / 2 - 216;

    ctx.fillStyle = 'rgba(40, 40, 40, 0.85)';
    ctx.beginPath();
    roundRect(ctx, panelX, panelY, panelW, panelH, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const goImg = images.gameover;
    if (goImg && goImg.complete) {
        const goW = 288, goH = 63;
        ctx.drawImage(goImg, panelX + panelW / 2 - goW / 2, panelY + 44, goW, goH);
    }

    ctx.font = '48px FlappyFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#000';
    ctx.lineJoin = 'round';

    const scoreTxt = 'SCORE: ' + score;
    const scoreY = panelY + 216 - 43;
    ctx.strokeText(scoreTxt, GAME_W / 2, scoreY);
    ctx.fillStyle = '#fff';
    ctx.fillText(scoreTxt, GAME_W / 2, scoreY);

    const bestTxt = 'BEST: ' + highScore;
    const bestY = panelY + 216 + 21;
    ctx.strokeText(bestTxt, GAME_W / 2, bestY);
    ctx.fillStyle = '#fff';
    ctx.fillText(bestTxt, GAME_W / 2, bestY);

    const btnW = 204, btnH = 71;
    const btnX = GAME_W / 2 - btnW / 2;
    const btnY = panelY + 216 + 67.5;

    ctx.fillStyle = '#5a8a3c';
    ctx.beginPath();
    roundRect(ctx, btnX, btnY, btnW, btnH, 8);
    ctx.fill();
    ctx.strokeStyle = '#3d6228';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.font = '48px FlappyFont, sans-serif';
    ctx.lineWidth = 16;
    ctx.strokeStyle = '#000';
    ctx.strokeText('RETRY', GAME_W / 2, btnY + btnH / 2);
    ctx.fillStyle = '#fff';
    ctx.fillText('RETRY', GAME_W / 2, btnY + btnH / 2);

    ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
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

// ─── Visibility API — pause when tab hidden ───
let paused = false;
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        paused = true;
    } else {
        paused = false;
        lastTime = 0; // reset dt to avoid huge jump
    }
});

// ─── Game loop ───
let lastTime = 0;

function gameLoop(timestamp) {
    if (paused) {
        lastTime = 0;
        requestAnimationFrame(gameLoop);
        return;
    }

    const dt = lastTime ? (timestamp - lastTime) / 1000 : 1 / 60;
    lastTime = timestamp;

    if (assetsLoaded >= totalAssets) {
        update(dt);
        draw();
    } else {
        ctx.save();
        ctx.scale(scale, scale);
        ctx.fillStyle = '#70c5ce';
        ctx.fillRect(0, 0, GAME_W, GAME_H);
        ctx.font = '24px sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText('Loading...', GAME_W / 2, GAME_H / 2);
        ctx.restore();
    }

    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
