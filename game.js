// ═══════════════════════════════════════════════════════
// SEAQUEST — HTML5 Canvas Recreation of Atari 2600 Classic
// Built by 冶妍 (Ye Yan) for 主人's mom 🛠️
// ═══════════════════════════════════════════════════════

(function() {
'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ═══ CONSTANTS ═════════════════════════════════════════
const W = 192, H = 220;
// Scale up rendering for crisp pixels on hi-DPI screens
const SCALE = 3;
canvas.width = W * SCALE;   // 576
canvas.height = H * SCALE;  // 660
ctx.scale(SCALE, SCALE);
ctx.imageSmoothingEnabled = false;
const SURFACE_Y = 30;           // Water surface line
const SEA_FLOOR_Y = 200;        // Sea floor
const PLAY_TOP = SURFACE_Y + 4;
const PLAY_BOTTOM = SEA_FLOOR_Y - 2;
const SUB_SPEED = 1.5;
const TORPEDO_SPEED = 3;
const TORPEDO_COOLDOWN = 25;    // frames between shots
const MAX_DIVERS_HELD = 6;
const OXYGEN_MAX = 2400;        // ~40 seconds at 60fps
const OXYGEN_WARN = 600;        // 10 sec warning

// Colors (Atari 2600 palette approximation)
const C = {
    sky:       '#0a0a2a',
    surface:   '#0088ff',
    waterTop:  '#001177',
    waterMid:  '#000044',
    waterDeep: '#000022',
    floor:     '#2a1a00',
    floorTop:  '#4a3000',
    sub:       '#00ddff',
    subDark:   '#0099bb',
    subBody:   '#00bbdd',
    torpedo:   '#ffff00',
    diver:     '#00ff00',
    diverDark: '#009900',
    shark:     '#888888',
    sharkDark: '#444444',
    sharkFin:  '#666666',
    squid:     '#ff66ff',
    squidDark: '#993399',
    eel:       '#ffaa00',
    eelDark:   '#aa6600',
    oxygen:    '#00ff00',
    oxygenWarn:'#ff0000',
    white:     '#ffffff',
    hud:       '#88ddff',
    hudYellow: '#ffcc00',
    hudRed:    '#ff4444',
    bubble:    'rgba(180,220,255,0.4)',
    seaweed:   '#004400',
    seaweed2:  '#006600',
};

// ═══ AUDIO ════════════════════════════════════════════
let audioCtx = null;
let audioEnabled = false;

function initAudio() {
    if (audioCtx) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioEnabled = true;
    } catch(e) { audioEnabled = false; }
}

function beep(freq, duration, type, volume) {
    if (!audioEnabled || !audioCtx) return;
    type = type || 'square';
    volume = volume || 0.08;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function sweep(freqStart, freqEnd, duration, type, volume) {
    if (!audioEnabled || !audioCtx) return;
    type = type || 'square';
    volume = volume || 0.06;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freqEnd, audioCtx.currentTime + duration);
    gain.gain.setValueAtTime(volume, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

const SFX = {
    shoot:   () => sweep(800, 400, 0.08, 'square', 0.05),
    pickup:  () => { beep(880, 0.05, 'square', 0.08); setTimeout(() => beep(1320, 0.08, 'square', 0.08), 50); },
    surface: () => { beep(523, 0.05); setTimeout(() => beep(659, 0.05), 50); setTimeout(() => beep(784, 0.1), 100); },
    hit:     () => sweep(200, 50, 0.2, 'sawtooth', 0.1),
    death:   () => sweep(400, 40, 0.5, 'sawtooth', 0.12),
    warning: () => beep(440, 0.1, 'square', 0.06),
    bonus:   () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.1, 'square', 0.08), i * 80)); },
};

// ═══ GAME STATE ════════════════════════════════════════
let state = 'title';   // title | playing | dying | gameover
let score = 0;
let highScore = 0;
let lives = 3;
let wave = 1;
let frameCount = 0;
let deathTimer = 0;
let gameoverTimer = 0;
let oxygen = OXYGEN_MAX;
let diversRescued = 0;
let diversHeld = 0;
let diversDelivered = 0; // total delivered to surface
let flashTimer = 0;

// ═══ INPUT ═════════════════════════════════════════════
const keys = {};
window.addEventListener('keydown', e => {
    keys[e.key] = true;
    if (state === 'title' && (e.key === ' ' || e.key === 'Enter')) startGame();
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.key] = false; });

// Touch controls
function setupTouch() {
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouch) {
        document.getElementById('touch-controls').style.display = 'block';
    }
    const btns = document.querySelectorAll('[data-key]');
    btns.forEach(btn => {
        const key = btn.getAttribute('data-key');
        const press = e => { e.preventDefault(); keys[key] = true; };
        const release = e => { e.preventDefault(); keys[key] = false; };
        btn.addEventListener('touchstart', press, { passive: false });
        btn.addEventListener('touchend', release, { passive: false });
        btn.addEventListener('touchcancel', release, { passive: false });
        btn.addEventListener('mousedown', press);
        btn.addEventListener('mouseup', release);
        btn.addEventListener('mouseleave', release);
    });

    // Tap on title/canvas to start
    const tapTarget = document.getElementById('title-screen');
    tapTarget.addEventListener('click', () => { if (state === 'title') startGame(); });
    tapTarget.addEventListener('touchstart', e => { e.preventDefault(); if (state === 'title') startGame(); }, { passive: false });
}
setupTouch();

// ═══ ENTITIES ══════════════════════════════════════════

// ── Submarine ──
const sub = {
    x: 80, y: 100, w: 16, h: 8,
    vx: 0, vy: 0,
    torpedoCooldown: 0,
    alive: true,
    wobble: 0,  // for propeller animation
};

// ── Torpedoes ──
const torpedoes = [];

// ── Divers ──
const divers = [];

// ── Enemies ──
const enemies = [];

// ── Bubbles (visual) ──
const bubbles = [];

// ── Seaweed (visual decoration) ──
const seaweed = [];
function initSeaweed() {
    seaweed.length = 0;
    for (let i = 0; i < 12; i++) {
        seaweed.push({
            x: 8 + Math.random() * (W - 16),
            y: SEA_FLOOR_Y,
            height: 8 + Math.random() * 12,
            sway: Math.random() * Math.PI * 2,
        });
    }
}

// ── Particles ──
const particles = [];

// ═══ SPAWNING ══════════════════════════════════════════
let diverSpawnTimer = 0;
let enemySpawnTimer = 0;
let bubbleSpawnTimer = 0;

function spawnDiver() {
    const fromLeft = Math.random() < 0.5;
    const y = PLAY_TOP + 20 + Math.random() * (PLAY_BOTTOM - PLAY_TOP - 30);
    divers.push({
        x: fromLeft ? -8 : W + 8,
        y: y,
        w: 8, h: 6,
        vx: fromLeft ? 0.3 + Math.random() * 0.3 : -(0.3 + Math.random() * 0.3),
        vy: 0,
        swimFrame: 0,
        carrying: false,
        carried: false,
    });
}

function spawnEnemy() {
    const types = ['shark', 'shark', 'squid', 'eel'];
    const type = types[Math.floor(Math.random() * Math.min(types.length, 1 + Math.floor(wave / 2)))];
    const fromLeft = Math.random() < 0.5;
    let y, vx;

    if (type === 'shark') {
        y = PLAY_TOP + 30 + Math.random() * (PLAY_BOTTOM - PLAY_TOP - 40);
        vx = (fromLeft ? 1 : -1) * (0.6 + Math.random() * 0.4 + wave * 0.05);
    } else if (type === 'squid') {
        y = PLAY_TOP + 10 + Math.random() * (PLAY_BOTTOM - PLAY_TOP - 20);
        vx = (fromLeft ? 0.5 : -0.5) * (0.8 + wave * 0.05);
    } else { // eel
        y = PLAY_TOP + 20 + Math.random() * (PLAY_BOTTOM - PLAY_TOP - 30);
        vx = (fromLeft ? 1.2 : -1.2) * (0.8 + wave * 0.05);
    }

    enemies.push({
        x: fromLeft ? -12 : W + 12,
        y: y,
        w: type === 'shark' ? 14 : type === 'eel' ? 10 : 8,
        h: type === 'shark' ? 6 : type === 'eel' ? 4 : 6,
        vx: vx,
        vy: 0,
        type: type,
        anim: 0,
        baseY: y,
        wobble: Math.random() * Math.PI * 2,
    });
}

function spawnBubble() {
    bubbles.push({
        x: Math.random() * W,
        y: SEA_FLOOR_Y,
        r: 1 + Math.random() * 2,
        vy: -(0.3 + Math.random() * 0.5),
    });
}

function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.5 + Math.random() * 2;
        particles.push({
            x: x, y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 20 + Math.random() * 15,
            maxLife: 35,
            color: color,
        });
    }
}

// ═══ GAME LOGIC ════════════════════════════════════════

function startGame() {
    initAudio();
    state = 'playing';
    score = 0;
    lives = 3;
    wave = 1;
    oxygen = OXYGEN_MAX;
    diversRescued = 0;
    diversHeld = 0;
    diversDelivered = 0;
    sub.x = 80; sub.y = 100;
    sub.alive = true;
    sub.torpedoCooldown = 0;
    torpedoes.length = 0;
    divers.length = 0;
    enemies.length = 0;
    particles.length = 0;
    diverSpawnTimer = 60;
    enemySpawnTimer = 120;
    initSeaweed();
    document.getElementById('title-screen').classList.add('hidden');
}

function killPlayer() {
    if (!sub.alive) return;
    sub.alive = false;
    state = 'dying';
    deathTimer = 90;
    SFX.death();
    spawnParticles(sub.x + sub.w/2, sub.y + sub.h/2, C.sub, 20);
    spawnParticles(sub.x + sub.w/2, sub.y + sub.h/2, C.torpedo, 10);
}

function respawnOrGameOver() {
    lives--;
    if (lives <= 0) {
        state = 'gameover';
        gameoverTimer = 0;
        if (score > highScore) highScore = score;
    } else {
        state = 'playing';
        sub.x = 80; sub.y = 100;
        sub.alive = true;
        sub.torpedoCooldown = 0;
        oxygen = OXYGEN_MAX;
        diversHeld = 0;
    }
}

function update() {
    frameCount++;

    if (state === 'title') return;

    if (state === 'gameover') {
        gameoverTimer++;
        return;
    }

    if (state === 'dying') {
        // Particles still animate
        updateParticles();
        updateBubbles();
        deathTimer--;
        if (deathTimer <= 0) respawnOrGameOver();
        return;
    }

    // ── PLAYING ──

    // Sub movement
    if (sub.alive) {
        sub.vx = 0; sub.vy = 0;
        if (keys['ArrowLeft']) sub.vx = -SUB_SPEED;
        if (keys['ArrowRight']) sub.vx = SUB_SPEED;
        if (keys['ArrowUp']) sub.vy = -SUB_SPEED;
        if (keys['ArrowDown']) sub.vy = SUB_SPEED;
        sub.x += sub.vx;
        sub.y += sub.vy;
        sub.x = Math.max(0, Math.min(W - sub.w, sub.x));
        // Allow sub to reach the surface recharge zone (SURFACE_Y) but not above it
        sub.y = Math.max(SURFACE_Y, Math.min(PLAY_BOTTOM - sub.h, sub.y));

        sub.wobble = (sub.wobble + 0.3) % (Math.PI * 2);

        // Fire torpedo
        if (sub.torpedoCooldown > 0) sub.torpedoCooldown--;
        if (keys[' '] && sub.torpedoCooldown <= 0) {
            const facingRight = !keys['ArrowLeft'] || keys['ArrowRight'];
            torpedoes.push({
                x: facingRight ? sub.x + sub.w : sub.x - 4,
                y: sub.y + sub.h/2 - 1,
                vx: facingRight ? TORPEDO_SPEED : -TORPEDO_SPEED,
                w: 4, h: 2,
                life: 80,
            });
            sub.torpedoCooldown = TORPEDO_COOLDOWN;
            SFX.shoot();
        }

        // Oxygen drain — recharge zone is from top of water to a few pixels below surface
        if (sub.y < SURFACE_Y + 6) {
            // At/near surface — refill
            oxygen = Math.min(OXYGEN_MAX, oxygen + 20);
            // Deliver divers if carrying any
            if (diversHeld > 0) {
                let bonus = diversHeld * 50;
                // Extra bonus for delivering multiple at once
                if (diversHeld >= 3) bonus += (diversHeld - 2) * 50;
                score += bonus;
                SFX.bonus();
                flashTimer = 15;
                spawnParticles(sub.x + sub.w/2, sub.y, C.diver, diversHeld * 4);
                diversDelivered += diversHeld;
                diversHeld = 0;
                // Remove all carried divers from the array
                for (let j = divers.length - 1; j >= 0; j--) {
                    if (divers[j].carried) divers.splice(j, 1);
                }
            }
        } else {
            oxygen--;
        }

        // Oxygen death
        if (oxygen <= 0) {
            oxygen = 0;
            killPlayer();
        }

        // Low oxygen warning
        if (oxygen === OXYGEN_WARN || (oxygen < OXYGEN_WARN && oxygen % 60 === 0)) {
            SFX.warning();
        }
    }

    // Torpedoes
    for (let i = torpedoes.length - 1; i >= 0; i--) {
        const t = torpedoes[i];
        t.x += t.vx;
        t.life--;
        if (t.x < -10 || t.x > W + 10 || t.life <= 0) {
            torpedoes.splice(i, 1);
            continue;
        }
        // Check enemy hits
        for (let j = enemies.length - 1; j >= 0; j--) {
            const e = enemies[j];
            if (rectOverlap(t, e)) {
                spawnParticles(e.x + e.w/2, e.y + e.h/2, C.shark, 8);
                spawnParticles(e.x + e.w/2, e.y + e.h/2, C.white, 4);
                enemies.splice(j, 1);
                torpedoes.splice(i, 1);
                score += 10;
                SFX.hit();
                break;
            }
        }
    }

    // Divers
    diverSpawnTimer--;
    if (diverSpawnTimer <= 0 && divers.length < 3 + Math.floor(wave / 2)) {
        spawnDiver();
        diverSpawnTimer = 120 + Math.random() * 120;
    }
    for (let i = divers.length - 1; i >= 0; i--) {
        const d = divers[i];
        d.swimFrame = (d.swimFrame + 0.15) % (Math.PI * 2);
        if (d.carried) {
            // Follow sub
            d.x = sub.x + sub.w/2 - d.w/2;
            d.y = sub.y - d.h - 1;
        } else {
            d.x += d.vx;
            d.y += Math.sin(d.swimFrame) * 0.3;
            if (d.x < -10 || d.x > W + 10) {
                divers.splice(i, 1);
                continue;
            }
            // Pickup
            if (sub.alive && rectOverlap(sub, d) && diversHeld < MAX_DIVERS_HELD) {
                d.carried = true;
                diversHeld++;
                score += 5;
                SFX.pickup();
            }
        }
    }

    // Enemies
    enemySpawnTimer--;
    if (enemySpawnTimer <= 0) {
        spawnEnemy();
        enemySpawnTimer = Math.max(40, 100 - wave * 5) + Math.random() * 60;
    }
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        e.anim = (e.anim + 0.15) % (Math.PI * 2);
        e.x += e.vx;

        if (e.type === 'squid') {
            e.y = e.baseY + Math.sin(e.wobble + frameCount * 0.05) * 10;
        } else if (e.type === 'eel') {
            e.y = e.baseY + Math.sin(e.wobble + frameCount * 0.08) * 15;
        }

        if (e.x < -16 || e.x > W + 16) {
            enemies.splice(i, 1);
            continue;
        }
        // Collision with sub
        if (sub.alive && rectOverlap(sub, e)) {
            killPlayer();
        }
    }

    // Bubbles
    bubbleSpawnTimer--;
    if (bubbleSpawnTimer <= 0) {
        spawnBubble();
        bubbleSpawnTimer = 8 + Math.random() * 12;
    }
    updateBubbles();

    // Particles
    updateParticles();

    // Wave progression
    if (diversDelivered >= 6 * wave) {
        wave++;
    }

    // Flash timer
    if (flashTimer > 0) flashTimer--;
}

function updateBubbles() {
    for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.y += b.vy;
        if (b.y < SURFACE_Y) bubbles.splice(i, 1);
    }
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05;
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function rectOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
}

// ═══ RENDERING ═════════════════════════════════════════

function render() {
    // Background gradient
    drawBackground();

    // Seaweed
    drawSeaweed();

    // Bubbles
    drawBubbles();

    // Divers
    divers.forEach(drawDiver);

    // Torpedoes
    torpedoes.forEach(drawTorpedo);

    // Enemies
    enemies.forEach(drawEnemy);

    // Submarine
    if (state === 'playing' || state === 'dying') {
        if (sub.alive) drawSub();
    }

    // Particles
    drawParticles();

    // HUD
    drawHUD();

    // Flash overlay
    if (flashTimer > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flashTimer / 30})`;
        ctx.fillRect(0, 0, W, H);
    }

    // Game over
    if (state === 'gameover') drawGameOver();
}

function drawBackground() {
    // Sky
    ctx.fillStyle = C.sky;
    ctx.fillRect(0, 0, W, SURFACE_Y);

    // Water gradient (manual bands)
    ctx.fillStyle = C.waterTop;
    ctx.fillRect(0, SURFACE_Y, W, 40);
    ctx.fillStyle = C.waterMid;
    ctx.fillRect(0, SURFACE_Y + 40, W, 40);
    ctx.fillStyle = C.waterDeep;
    ctx.fillRect(0, SURFACE_Y + 80, W, SEA_FLOOR_Y - SURFACE_Y - 80);

    // Water surface line with wave effect
    ctx.fillStyle = C.surface;
    for (let x = 0; x < W; x += 2) {
        const waveH = 1 + Math.sin(x * 0.15 + frameCount * 0.05) * 0.5;
        ctx.fillRect(x, SURFACE_Y - waveH, 2, 2);
    }
    // Surface sparkle
    if (frameCount % 4 < 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        for (let i = 0; i < 6; i++) {
            ctx.fillRect((i * 37 + frameCount * 0.5) % W, SURFACE_Y - 1, 1, 1);
        }
    }

    // Sea floor
    ctx.fillStyle = C.floor;
    ctx.fillRect(0, SEA_FLOOR_Y, W, H - SEA_FLOOR_Y);
    ctx.fillStyle = C.floorTop;
    ctx.fillRect(0, SEA_FLOOR_Y, W, 2);
}

function drawSeaweed() {
    seaweed.forEach(s => {
        const sway = Math.sin(s.sway + frameCount * 0.03) * 2;
        ctx.fillStyle = C.seaweed;
        for (let i = 0; i < s.height; i += 2) {
            const offset = (i / s.height) * sway;
            ctx.fillRect(s.x + offset, s.y - i, 2, 2);
        }
        ctx.fillStyle = C.seaweed2;
        ctx.fillRect(s.x, s.y - 2, 2, 2);
    });
}

function drawBubbles() {
    ctx.fillStyle = C.bubble;
    bubbles.forEach(b => {
        ctx.fillRect(b.x, b.y, b.r, b.r);
    });
}

function drawSub() {
    const sx = Math.round(sub.x);
    const sy = Math.round(sub.y);
    const w = sub.w;  // 16

    // Propeller (animated, behind sub on left)
    ctx.fillStyle = C.subDark;
    if (Math.floor(frameCount / 3) % 2 === 0) {
        ctx.fillRect(sx - 3, sy + 1, 2, 1);
        ctx.fillRect(sx - 3, sy + 5, 2, 1);
        ctx.fillRect(sx - 2, sy + 3, 2, 1);
    } else {
        ctx.fillRect(sx - 3, sy + 2, 2, 1);
        ctx.fillRect(sx - 3, sy + 4, 2, 1);
        ctx.fillRect(sx - 2, sy + 0, 2, 1);
        ctx.fillRect(sx - 2, sy + 6, 2, 1);
    }

    // Conning tower (taller, with windows)
    ctx.fillStyle = C.sub;
    ctx.fillRect(sx + 5, sy - 3, 5, 3);
    ctx.fillStyle = C.subDark;
    ctx.fillRect(sx + 6, sy - 2, 1, 1);
    ctx.fillRect(sx + 8, sy - 2, 1, 1);

    // Periscope (L-shape going up and right)
    ctx.fillStyle = C.sub;
    ctx.fillRect(sx + 7, sy - 6, 1, 3);
    ctx.fillRect(sx + 7, sy - 6, 3, 1);

    // Main body — top half (light)
    ctx.fillStyle = C.sub;
    ctx.fillRect(sx, sy, w, 4);

    // Bottom half (darker — two-tone like the reference)
    ctx.fillStyle = C.subDark;
    ctx.fillRect(sx, sy + 4, w, 3);

    // Rounded nose (right side)
    ctx.fillStyle = C.sub;
    ctx.fillRect(sx + w, sy + 1, 1, 2);
    ctx.fillStyle = C.subDark;
    ctx.fillRect(sx + w, sy + 4, 1, 2);

    // Rounded tail cap (left side)
    ctx.fillRect(sx - 1, sy + 1, 1, 5);

    // Portholes — 3 round windows (not single pixels)
    // Each porthole is a 3x3 circle approximation
    for (let i = 0; i < 3; i++) {
        const px = sx + 2 + i * 5;
        const py = sy + 2;
        // Light rim
        ctx.fillStyle = C.sub;
        ctx.fillRect(px, py - 1, 3, 1);
        ctx.fillRect(px, py + 2, 3, 1);
        ctx.fillRect(px - 1, py, 1, 2);
        ctx.fillRect(px + 3, py, 1, 2);
        // Dark glass center
        ctx.fillStyle = '#001133';
        ctx.fillRect(px, py, 3, 2);
        // Small highlight
        ctx.fillStyle = 'rgba(100,180,255,0.5)';
        ctx.fillRect(px + 1, py, 1, 1);
    }

    // Body seam line between top and bottom halves
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(sx, sy + 4, w, 1);
}

function drawTorpedo(t) {
    ctx.fillStyle = C.torpedo;
    const tx = Math.round(t.x);
    const ty = Math.round(t.y);
    ctx.fillRect(tx, ty, t.w, t.h);
    // Trail
    ctx.fillStyle = 'rgba(255,255,0,0.3)';
    if (t.vx > 0) ctx.fillRect(tx - 2, ty + 1, 2, 1);
    else ctx.fillRect(tx + t.w, ty + 1, 2, 1);
}

function drawDiver(d) {
    const dx = Math.round(d.x);
    const dy = Math.round(d.y);
    const dir = d.vx > 0 ? 1 : -1;
    const swim = Math.floor(d.swimFrame * 2) % 2 === 0;

    // Horizontal swimming pose facing right (or mirrored for left)
    // Body: lime green suit, horizontal
    ctx.fillStyle = '#88dd44';
    ctx.fillRect(dx + 1, dy + 2, 4, 3);  // torso

    // Head: blocky helmet facing direction
    ctx.fillStyle = '#88dd44';
    ctx.fillRect(dx + 5, dy + 1, 2, 3);
    // Helmet visor (dark)
    ctx.fillStyle = '#225522';
    ctx.fillRect(dx + 6, dy + 2, 1, 1);

    // Air tank on back (dark green block)
    ctx.fillStyle = '#336633';
    ctx.fillRect(dx, dy + 1, 1, 4);

    // Arms reaching forward (alternating stroke)
    ctx.fillStyle = '#88dd44';
    if (swim) {
        ctx.fillRect(dx + 6, dy, 1, 1);      // arm up-forward
        ctx.fillRect(dx + 7, dy + 2, 1, 1);  // arm forward
    } else {
        ctx.fillRect(dx + 6, dy + 4, 1, 1);  // arm down
        ctx.fillRect(dx + 7, dy + 2, 1, 1);  // arm forward
    }

    // Legs kicking back
    ctx.fillStyle = '#88dd44';
    if (swim) {
        ctx.fillRect(dx - 1, dy + 1, 2, 1);  // leg up
        ctx.fillRect(dx - 1, dy + 4, 2, 1);  // leg down
    } else {
        ctx.fillRect(dx - 1, dy + 2, 2, 2);  // legs together
    }

    // Flippers (dark green, angled)
    ctx.fillStyle = '#336633';
    if (swim) {
        ctx.fillRect(dx - 2, dy + 1, 1, 1);
        ctx.fillRect(dx - 2, dy + 5, 1, 1);
    } else {
        ctx.fillRect(dx - 2, dy + 2, 1, 2);
    }

    // Bubble trail (going up-left from tank)
    if (swim) {
        ctx.fillStyle = 'rgba(200,230,255,0.4)';
        ctx.fillRect(dx - 1, dy, 1, 1);
        ctx.fillRect(dx, dy - 1, 1, 1);
    }
}

function drawEnemy(e) {
    const ex = Math.round(e.x);
    const ey = Math.round(e.y);
    const dir = e.vx > 0 ? 1 : -1;

    if (e.type === 'shark') {
        // Body
        ctx.fillStyle = C.shark;
        ctx.fillRect(ex + 2, ey + 1, e.w - 4, e.h - 2);
        ctx.fillStyle = C.sharkDark;
        ctx.fillRect(ex + 2, ey + e.h - 2, e.w - 4, 1);
        // Head
        ctx.fillStyle = C.shark;
        if (dir > 0) {
            ctx.fillRect(ex + e.w - 2, ey + 2, 2, 2);
        } else {
            ctx.fillRect(ex, ey + 2, 2, 2);
        }
        // Tail
        ctx.fillStyle = C.sharkDark;
        const tailFrame = Math.floor(e.anim * 2) % 2;
        if (dir > 0) {
            if (tailFrame) { ctx.fillRect(ex, ey, 2, 2); ctx.fillRect(ex, ey + e.h - 2, 2, 2); }
            else { ctx.fillRect(ex, ey + 1, 1, e.h - 2); }
        } else {
            if (tailFrame) { ctx.fillRect(ex + e.w - 2, ey, 2, 2); ctx.fillRect(ex + e.w - 2, ey + e.h - 2, 2, 2); }
            else { ctx.fillRect(ex + e.w - 1, ey + 1, 1, e.h - 2); }
        }
        // Fin
        ctx.fillStyle = C.sharkFin;
        ctx.fillRect(ex + e.w/2 - 1, ey - 1, 2, 1);
        // Eye
        ctx.fillStyle = C.white;
        if (dir > 0) ctx.fillRect(ex + e.w - 3, ey + 2, 1, 1);
        else ctx.fillRect(ex + 2, ey + 2, 1, 1);

    } else if (e.type === 'squid') {
        const tentacleWave = Math.floor(e.anim * 3) % 3;
        // Head/dome
        ctx.fillStyle = C.squid;
        ctx.fillRect(ex + 1, ey, e.w - 2, 3);
        ctx.fillRect(ex + 2, ey - 1, e.w - 4, 1);
        ctx.fillStyle = C.squidDark;
        ctx.fillRect(ex + 2, ey + 2, e.w - 4, 1);
        // Tentacles
        ctx.fillStyle = C.squid;
        for (let t = 0; t < 3; t++) {
            const tLen = 1 + ((tentacleWave + t) % 3);
            ctx.fillRect(ex + 1 + t * 2, ey + 3, 1, tLen);
        }
        // Eye
        ctx.fillStyle = C.white;
        ctx.fillRect(ex + e.w/2 - 1, ey + 1, 1, 1);

    } else { // eel
        const segLen = 3;
        const numSeg = 3;
        for (let s = 0; s < numSeg; s++) {
            const wave = Math.sin(e.wobble + frameCount * 0.1 + s * 0.8) * 2;
            const segX = ex + (dir > 0 ? s * segLen : (numSeg - 1 - s) * segLen);
            const segY = ey + wave;
            ctx.fillStyle = s === 0 ? C.eel : C.eelDark;
            ctx.fillRect(segX, segY, segLen, e.h);
        }
        // Eye
        ctx.fillStyle = C.white;
        if (dir > 0) ctx.fillRect(ex + segLen - 1, ey + 1, 1, 1);
        else ctx.fillRect(ex + (numSeg - 1) * segLen, ey + 1, 1, 1);
    }
}

function drawParticles() {
    particles.forEach(p => {
        const alpha = p.life / p.maxLife;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    });
    ctx.globalAlpha = 1;
}

function drawHUD() {
    // Score (top left)
    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = C.hud;
    ctx.fillText('SCORE', 2, 7);
    ctx.fillStyle = C.white;
    ctx.fillText(String(score).padStart(5, '0'), 2, 16);

    // High score
    ctx.fillStyle = C.hudYellow;
    ctx.fillText('HI', 50, 7);
    ctx.fillStyle = C.white;
    ctx.fillText(String(highScore).padStart(5, '0'), 50, 16);

    // Wave
    ctx.fillStyle = C.hud;
    ctx.fillText('WAVE', 100, 7);
    ctx.fillStyle = C.white;
    ctx.fillText(String(wave), 100, 16);

    // Lives
    ctx.fillStyle = C.hud;
    ctx.textAlign = 'right';
    ctx.fillText('LIVES', W - 2, 7);
    for (let i = 0; i < lives; i++) {
        // Mini sub icons
        ctx.fillStyle = C.sub;
        ctx.fillRect(W - 6 - i * 8, 10, 5, 3);
        ctx.fillStyle = C.subDark;
        ctx.fillRect(W - 6 - i * 8, 13, 5, 1);
    }

    // Oxygen bar
    const barX = 2;
    const barY = 22;
    const barW = W - 4;
    const barH = 3;
    const fillRatio = oxygen / OXYGEN_MAX;

    ctx.fillStyle = C.waterDeep;
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = oxygen < OXYGEN_WARN ? C.oxygenWarn : C.oxygen;
    const fillW = Math.ceil(barW * fillRatio);
    ctx.fillRect(barX, barY, fillW, barH);

    // Divers held indicator (below lives, top right)
    if (diversHeld > 0) {
        ctx.textAlign = 'right';
        ctx.fillStyle = C.diver;
        ctx.font = 'bold 8px "Courier New", monospace';
        ctx.fillText('🤿 ' + diversHeld + '/' + MAX_DIVERS_HELD, W - 2, 19);
    }

    // Low oxygen warning text
    if (oxygen < OXYGEN_WARN && oxygen > 0 && Math.floor(frameCount / 15) % 2 === 0) {
        ctx.textAlign = 'center';
        ctx.fillStyle = C.hudRed;
        ctx.font = 'bold 10px "Courier New", monospace';
        ctx.fillText('LOW OXYGEN!', W/2, SURFACE_Y + 20);
    }
}

function drawGameOver() {
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, H/2 - 30, W, 60);

    ctx.textAlign = 'center';
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.fillStyle = C.hudRed;
    ctx.fillText('GAME OVER', W/2, H/2 - 10);

    ctx.font = 'bold 8px "Courier New", monospace';
    ctx.fillStyle = C.hud;
    ctx.fillText('SCORE: ' + score, W/2, H/2 + 4);
    if (score >= highScore && score > 0) {
        ctx.fillStyle = C.hudYellow;
        ctx.fillText('★ NEW HIGH SCORE ★', W/2, H/2 + 14);
    }

    if (gameoverTimer > 90 && Math.floor(gameoverTimer / 30) % 2 === 0) {
        ctx.fillStyle = C.white;
        ctx.fillText('TAP TO RESTART', W/2, H/2 + 26);
    }

    gameoverTimer++;
    if (gameoverTimer > 90 && (keys[' '] || keys['Enter'])) {
        state = 'title';
        document.getElementById('title-screen').classList.remove('hidden');
    }
}

// Tap to restart from gameover
canvas.addEventListener('click', () => {
    if (state === 'gameover' && gameoverTimer > 90) {
        state = 'title';
        document.getElementById('title-screen').classList.remove('hidden');
    }
});

// ═══ MAIN LOOP ═════════════════════════════════════════
function resizeCanvas() {
    const wrapper = document.getElementById('game-wrapper');
    const aspect = W / H;
    let w = window.innerWidth;
    let h = window.innerHeight;

    if (w / h > aspect) {
        canvas.style.height = h + 'px';
        canvas.style.width = (h * aspect) + 'px';
    } else {
        canvas.style.width = w + 'px';
        canvas.style.height = (w / aspect) + 'px';
    }
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 100));
resizeCanvas();

function loop() {
    update();
    render();
    requestAnimationFrame(loop);
}

// Start render loop even on title screen (for animated background)
initSeaweed();
loop();

})();
