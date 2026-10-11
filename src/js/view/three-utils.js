/**
 * Three.js の共通部品（てこ・ふりこの 3D ビューで使う）
 *   - CSS 変数からの色の読み取り（色の定義は styles.css に一本化）
 *   - 文字・光・グリッドのテクスチャ
 *   - おもりのメッシュ（てこにつるす・ふりこのおもり で共通）
 *   - 火花・衝撃波のパーティクル
 */

import {
    AdditiveBlending, CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial,
    MeshStandardMaterial, RingGeometry, SRGBColorSpace, Sprite, SpriteMaterial, TorusGeometry, Vector3,
} from '../../vendor/three.js';
import { PLAYER_META } from '../players.js';

export const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function webglAvailable() {
    try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2') || c.getContext('webgl');
        gl?.getExtension('WEBGL_lose_context')?.loseContext(); // しらべるだけなので、すぐ返す
        return Boolean(gl);
    } catch {
        return false;
    }
}

/** CSS 変数から色を読む */
export function cssColor(name, fallback = '#ffffff') {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    try {
        return new Color(v || fallback);
    } catch {
        return new Color(fallback);
    }
}

/** プレイヤー・おもりの色をまとめて読む */
export function readColors() {
    const c = name => cssColor(name);
    return {
        p1: c('--p1'), p2: c('--p2'), p3: c('--p3'), p4: c('--p4'),
        m10: c('--m10'), m20: c('--m20'), m30: c('--m30'),
        neutral: c('--w-neutral'), locked: c('--w-locked'),
        accent: c('--accent'), ok: c('--ok'), danger: c('--danger'), warn: c('--warn'), gold: c('--gold'),
        left: c('--glow-left'), right: c('--glow-right'),
    };
}

export function toneKey(weight) {
    if (weight.locked) return 'locked';
    if (weight.owner === 'neutral') return 'neutral';
    if (weight.owner && PLAYER_META[weight.owner]) return weight.owner;
    return `m${weight.mass}`;
}

export function labelOf(weight) {
    if (weight.owner && PLAYER_META[weight.owner]) return PLAYER_META[weight.owner].symbol;
    return `${weight.mass}g`;
}

const textures = new Map();
export function textTexture(text, { size = 128, color = '#ffffff', font = '900 64px Orbitron, "BIZ UDPGothic", sans-serif', glow = null } = {}) {
    const key = `${text}|${size}|${color}|${font}|${glow}`;
    if (textures.has(key)) return textures.get(key);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (glow) {
        ctx.shadowColor = glow;
        ctx.shadowBlur = size / 10;
    }
    ctx.fillStyle = color;
    ctx.fillText(text, size / 2, size / 2 + size * 0.03);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    textures.set(key, tex);
    return tex;
}

/** 文字のスプライト（text が変わるたびに作りなおさなくてよいように、setText を持つ） */
export function textSprite(text, opts = {}, scale = 0.5) {
    const sprite = new Sprite(new SpriteMaterial({ map: textTexture(text, opts), transparent: true, depthWrite: false }));
    sprite.scale.set(scale, scale, 1);
    sprite.userData.text = text;
    sprite.userData.setText = next => {
        if (next === sprite.userData.text) return;
        sprite.userData.text = next;
        sprite.material.map = textTexture(next, opts);
        sprite.material.needsUpdate = true;
    };
    return sprite;
}

export function radialTexture(inner, outer) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    return tex;
}

export function gridTexture(color, cells = 36) {
    const size = 1024;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (let i = 0; i <= cells; i++) {
        const x = (i / cells) * size;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.moveTo(0, x);
        ctx.lineTo(size, x);
        ctx.stroke();
    }
    // 中心から外へ消えていく
    const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.6)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}

/**
 * メッシュを外して GPU の資源を返す。
 * 文字のテクスチャ（textTexture）は使い回しているので dispose しない。
 */
export function disposeMesh(group) {
    group.parent?.remove(group);
    const materials = new Set();
    group.traverse(o => {
        o.geometry?.dispose();
        if (o.material) materials.add(o.material);
    });
    for (const m of materials) m.dispose();
}

/* ---------- おもり ---------- */

export const LOOP_H = 0.12;
export const BOB_SIZES = { 10: { r: 0.25, h: 0.4 }, 20: { r: 0.3, h: 0.48 }, 30: { r: 0.34, h: 0.56 } };
export const bobSize = mass => BOB_SIZES[mass] ?? BOB_SIZES[10];
export const bobHeight = mass => LOOP_H + bobSize(mass).h;

/**
 * おもりのメッシュ。(0,0,0) が輪っかの上端。
 * userData: { id, body, halo, hit, mass, drop, offset }
 */
export function makeWeightMesh(weight, colors) {
    const { r, h } = bobSize(weight.mass);
    const color = colors[toneKey(weight)] ?? colors.m10;
    const g = new Group();
    const body = new Mesh(new CylinderGeometry(r, r, h, 32), new MeshStandardMaterial({
        color, metalness: 0.55, roughness: 0.3, emissive: color.clone().multiplyScalar(0.18), transparent: true,
    }));
    body.position.y = -LOOP_H - h / 2;
    body.castShadow = true;
    const lid = new Mesh(new CylinderGeometry(r * 0.55, r * 0.8, 0.06, 32), body.material);
    lid.position.y = -LOOP_H - 0.02;
    const loop = new Mesh(new TorusGeometry(0.05, 0.016, 8, 16), new MeshStandardMaterial({
        color: 0xc7d0ea, metalness: 0.9, roughness: 0.25,
    }));
    loop.position.y = -0.05;
    const label = new Sprite(new SpriteMaterial({
        map: textTexture(labelOf(weight), {
            font: weight.owner && PLAYER_META[weight.owner] ? '900 76px sans-serif' : '900 44px Orbitron, sans-serif',
        }),
        transparent: true, depthTest: false,
    }));
    label.renderOrder = 2;
    label.scale.set(r * 2.1, r * 2.1, 1);
    label.position.set(0, -LOOP_H - h / 2, r + 0.02);
    const halo = new Mesh(new TorusGeometry(r + 0.08, 0.03, 8, 40), new MeshBasicMaterial({ color: 0xffffff }));
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -LOOP_H - h / 2;
    halo.visible = false;
    const hit = new Mesh(new CylinderGeometry(r + 0.12, r + 0.12, h + 0.3, 12), new MeshBasicMaterial({ visible: false }));
    hit.position.y = -LOOP_H - h / 2;
    g.add(body, lid, loop, label, halo, hit);
    g.userData = { id: weight.id, body, halo, hit, mass: weight.mass, drop: 0, offset: 0 };
    hit.userData.weightId = weight.id;
    return g;
}

/* ---------- 火花・衝撃波 ---------- */

export class Effects {
    constructor(scene) {
        this.scene = scene;
        this.particles = [];
        this.waves = [];
        this.glowTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    }

    burst(origin, color, count, speed, gravity = 6) {
        for (let i = 0; i < count; i++) {
            const sprite = new Sprite(new SpriteMaterial({
                map: this.glowTex, color, transparent: true, blending: AdditiveBlending, depthWrite: false,
            }));
            const size = 0.12 + Math.random() * 0.22;
            sprite.scale.set(size, size, 1);
            sprite.position.copy(origin);
            const dir = new Vector3(Math.random() - 0.5, Math.random() * 0.9 - 0.2, Math.random() - 0.5).normalize();
            this.scene.add(sprite);
            const v = dir.multiplyScalar(speed * (0.4 + Math.random()));
            this.particles.push({ sprite, v, life: 0, max: 0.6 + Math.random() * 0.6, gravity });
        }
    }

    wave(origin, color, flat = false, grow = flat ? 9 : 7) {
        const ring = new Mesh(new RingGeometry(0.85, 1, 64), new MeshBasicMaterial({
            color, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide,
        }));
        ring.position.copy(origin);
        if (flat) ring.rotation.x = -Math.PI / 2;
        this.scene.add(ring);
        this.waves.push({ ring, life: 0, max: flat ? 0.9 : 0.7, grow });
    }

    step(dt) {
        this.particles = this.particles.filter(p => {
            p.life += dt;
            if (p.life >= p.max) {
                this.scene.remove(p.sprite);
                p.sprite.material.dispose();
                return false;
            }
            p.v.y -= p.gravity * dt;
            p.v.multiplyScalar(Math.pow(0.97, dt * 60));
            p.sprite.position.addScaledVector(p.v, dt);
            p.sprite.material.opacity = 1 - p.life / p.max;
            return true;
        });
        this.waves = this.waves.filter(w => {
            w.life += dt;
            const t = w.life / w.max;
            if (t >= 1) {
                this.scene.remove(w.ring);
                w.ring.geometry.dispose();
                w.ring.material.dispose();
                return false;
            }
            const scale = 0.3 + (1 - Math.pow(1 - t, 3)) * w.grow;
            w.ring.scale.set(scale, scale, scale);
            w.ring.material.opacity = 1 - t;
            return true;
        });
    }

    clear() {
        for (const p of this.particles) {
            this.scene.remove(p.sprite);
            p.sprite.material.dispose();
        }
        for (const w of this.waves) {
            this.scene.remove(w.ring);
            w.ring.geometry.dispose();
            w.ring.material.dispose();
        }
        this.particles = [];
        this.waves = [];
    }
}
