/**
 * 実験用てこの 3D ビュー（Three.js）
 *
 * LeverView（SVG 版）と同じ使い方ができる:
 *   render(view) / settle() / startDrag(source, e) / positionAt(x, y) / handlers
 *
 * - うではバネで傾き、つるしたおもりは振り子のようにゆれる
 * - 「ささえ」が下がると手をはなした合図。落ち着いたら、つり合い→緑、かたむき→重い側が赤く光る
 * - キーボード・読み上げ用に、透明なボタンを 3D の位置に重ねて置く
 */

import {
    AdditiveBlending, AmbientLight, BoxGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight,
    DoubleSide, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera,
    Plane, PlaneGeometry, PointLight, Points, PointsMaterial, BufferGeometry, Float32BufferAttribute,
    Raycaster, Scene, ShadowMaterial, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace,
    TorusGeometry, Vector2, Vector3, WebGLRenderer, ConeGeometry, RingGeometry, PCFShadowMap,
} from '../../vendor/three.js';
import { POSITIONS, chainOf, findWeight, isBalanced, momentOf, positionLabel } from '../engine/lever.js';
import { PLAYER_META } from '../players.js';
import { isCalm, kickFor, stepSpring, tiltFor } from './lever-view.js';
import { ghostIcon } from './weight-art.js';
import { setDropZone } from '../widgets.js';

const UNIT = 1;
const BEAM_HALF = 6.62;
const HOOK_Y = -0.3; // うでのローカル座標でのフックの位置
const STRING = 0.26;
const GAP = 0.05;
const FLOOR_Y = -6.3;
const LOOP_H = 0.12;
const SIZES = { 10: { r: 0.25, h: 0.4 }, 20: { r: 0.3, h: 0.48 }, 30: { r: 0.34, h: 0.56 } };
const sizeOf = mass => SIZES[mass] ?? SIZES[10];
const heightOf = mass => LOOP_H + sizeOf(mass).h;

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * うでの回転（Three.js のラジアン）
 * this.angle は SVG と同じ「時計回りが正（右が下がる）」の度数。
 * Three.js の rotation.z は反時計回りが正なので、符号を反転する。
 */
export const beamRotationZ = angleDeg => (-angleDeg * Math.PI) / 180;

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

/** CSS 変数から色を読む（色の定義は styles.css に一本化） */
function cssColor(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    try {
        return new Color(v || fallback);
    } catch {
        return new Color(fallback);
    }
}

function toneKey(weight) {
    if (weight.locked) return 'locked';
    if (weight.owner === 'neutral') return 'neutral';
    if (weight.owner && PLAYER_META[weight.owner]) return weight.owner;
    return `m${weight.mass}`;
}

function labelOf(weight) {
    if (weight.owner && PLAYER_META[weight.owner]) return PLAYER_META[weight.owner].symbol;
    return `${weight.mass}g`;
}

function weightAria(weight, pos) {
    const owner = weight.owner && PLAYER_META[weight.owner]
        ? `${PLAYER_META[weight.owner].name}の`
        : weight.owner === 'neutral' ? 'はじめからある' : '';
    return `${owner}${weight.mass}gのおもり（${positionLabel(pos)}）`;
}

/**
 * おもりのメッシュを外して GPU の資源を返す。
 * 文字のテクスチャ（textTexture）は使い回しているので dispose しない。
 */
function disposeMesh(group) {
    group.parent?.remove(group);
    const materials = new Set();
    group.traverse(o => {
        o.geometry?.dispose();
        if (o.material) materials.add(o.material);
    });
    for (const m of materials) m.dispose();
}

const textures = new Map();
function textTexture(text, { size = 128, color = '#ffffff', font = '900 64px Orbitron, "BIZ UDPGothic", sans-serif', glow = null } = {}) {
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

function radialTexture(inner, outer) {
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

function gridTexture(color, cells = 36) {
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

export class LeverView3D {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {object} handlers
     * @param {{ a11yRoot?: HTMLElement|null, showcase?: boolean }} options
     */
    constructor(canvas, handlers = {}, { a11yRoot = null, showcase = false } = {}) {
        this.canvas = canvas;
        this.handlers = handlers;
        this.a11yRoot = a11yRoot;
        this.showcase = showcase;
        this.angle = 0;
        this.velocity = 0;
        this.target = 0;
        this.held = null;
        this.board = null;
        this.interactive = false;
        this.selectedId = null;
        this.selectedGroup = new Set();
        this.targetStates = new Map();
        this.hover = null;
        this.meshes = new Map();
        this.swing = Object.fromEntries(POSITIONS.map(p => [p, { a: 0, v: 0 }]));
        this.settleResolvers = [];
        this.drag = null;
        this.flash = null;
        this.shake = 0;
        this.time = 0;
        this.zoom = 0; // マイナスで寄る（一瞬のパンチ）
        this.focus = 0; // 判定中のカメラの寄り（0〜1）
        this.focusGoal = 0;
        this.danger = 0;
        this.dangerGoal = 0;
        this.particles = [];
        this.waves = [];
        this.raycaster = new Raycaster();
        this.plane = new Plane(new Vector3(0, 0, 1), 0);
        this.colors = this.readColors();

        this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
        this.renderer.outputColorSpace = SRGBColorSpace;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = PCFShadowMap;
        this.scene = new Scene();
        this.camera = new PerspectiveCamera(32, 1, 0.1, 200);

        this.build();
        if (a11yRoot) this.buildA11y();
        this.bind();
        this.resize();
        this.loop = this.loop.bind(this);
        this.last = performance.now();
        this.frame = requestAnimationFrame(this.loop);
    }

    readColors() {
        const c = name => cssColor(name, '#ffffff');
        return {
            p1: c('--p1'), p2: c('--p2'), p3: c('--p3'), p4: c('--p4'),
            m10: c('--m10'), m20: c('--m20'), m30: c('--m30'),
            neutral: c('--w-neutral'), locked: c('--w-locked'),
            accent: c('--accent'), ok: c('--ok'), danger: c('--danger'), warn: c('--warn'),
            left: c('--glow-left'), right: c('--glow-right'),
        };
    }

    /* ======================== シーン ======================== */

    build() {
        const { scene, colors } = this;

        scene.add(new HemisphereLight(0xb8c8ff, 0x101428, 1.1));
        scene.add(new AmbientLight(0x6070a0, 0.35));
        const key = new DirectionalLight(0xffffff, 2.2);
        key.position.set(5, 10, 9);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        Object.assign(key.shadow.camera, { left: -9, right: 9, top: 6, bottom: -9, near: 1, far: 30 });
        key.shadow.radius = 4;
        scene.add(key);
        const rimL = new PointLight(colors.left, 18, 16);
        rimL.position.set(-7, 2, 3);
        const rimR = new PointLight(colors.right, 18, 16);
        rimR.position.set(7, 2, 3);
        scene.add(rimL, rimR);
        this.rims = [[rimL, colors.left], [rimR, colors.right]];
        this.alarm = new PointLight(colors.danger, 0, 30);
        this.alarm.position.set(0, 3, 6);
        scene.add(this.alarm);

        // 床（グリッドが中心から外へフェード）
        const floor = new Mesh(new PlaneGeometry(64, 64), new MeshBasicMaterial({
            map: gridTexture('rgba(110,190,255,0.55)'), transparent: true, depthWrite: false,
        }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = FLOOR_Y;
        scene.add(floor);
        const shadow = new Mesh(new PlaneGeometry(28, 16), new ShadowMaterial({ opacity: 0.45 }));
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = FLOOR_Y + 0.01;
        shadow.receiveShadow = true;
        scene.add(shadow);
        const pool = new Mesh(new PlaneGeometry(10, 10), new MeshBasicMaterial({
            map: radialTexture('rgba(80,170,255,0.35)', 'rgba(80,170,255,0)'), transparent: true,
            depthWrite: false, blending: AdditiveBlending,
        }));
        pool.rotation.x = -Math.PI / 2;
        pool.position.y = FLOOR_Y + 0.02;
        scene.add(pool);

        // ほこりのような光の粒
        if (!reduceMotion()) {
            const n = 140;
            const pts = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) {
                pts[i * 3] = (Math.random() - 0.5) * 30;
                pts[i * 3 + 1] = FLOOR_Y + Math.random() * 14;
                pts[i * 3 + 2] = -4 - Math.random() * 10;
            }
            const geo = new BufferGeometry();
            geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
            this.dust = new Points(geo, new PointsMaterial({
                color: 0x9fd8ff, size: 0.06, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false,
            }));
            scene.add(this.dust);
        }

        // 台
        const metal = new MeshStandardMaterial({ color: 0x8b97b8, metalness: 0.85, roughness: 0.28 });
        const dark = new MeshStandardMaterial({ color: 0x2a3352, metalness: 0.7, roughness: 0.35 });
        const post = new Mesh(new CylinderGeometry(0.11, 0.15, -FLOOR_Y - 0.1, 24), metal);
        post.position.y = FLOOR_Y / 2 - 0.05;
        post.castShadow = true;
        scene.add(post);
        const base = new Mesh(new CylinderGeometry(1.25, 1.45, 0.22, 48), dark);
        base.position.y = FLOOR_Y + 0.11;
        base.castShadow = true;
        base.receiveShadow = true;
        scene.add(base);
        const baseRing = new Mesh(new TorusGeometry(1.36, 0.035, 12, 96), new MeshBasicMaterial({ color: colors.accent }));
        baseRing.rotation.x = Math.PI / 2;
        baseRing.position.y = FLOOR_Y + 0.23;
        scene.add(baseRing);
        const prism = new Mesh(new ConeGeometry(0.34, 0.5, 3), metal);
        prism.position.y = -0.2;
        prism.rotation.y = Math.PI / 6;
        scene.add(prism);

        // 目盛り板（支点のうしろ）
        const gauge = new Group();
        gauge.position.set(0, 0, -0.32);
        const plate = new Mesh(new RingGeometry(0.15, 1.15, 48, 1, Math.PI / 2 - 0.42, 0.84), new MeshBasicMaterial({
            color: 0x18213d, transparent: true, opacity: 0.85, side: DoubleSide,
        }));
        gauge.add(plate);
        for (let d = -20; d <= 20; d += 5) {
            const a = (d * Math.PI) / 180;
            const len = d === 0 ? 0.32 : 0.16;
            const tick = new Mesh(new PlaneGeometry(d === 0 ? 0.05 : 0.025, len), new MeshBasicMaterial({
                color: d === 0 ? colors.ok : 0x7d8bb3,
            }));
            const r = 1.08 - len / 2;
            tick.position.set(Math.sin(a) * r, Math.cos(a) * r, 0.01);
            tick.rotation.z = -a;
            gauge.add(tick);
        }
        scene.add(gauge);

        // ささえ（手でおさえている）
        this.stoppers = new Group();
        const stopMat = new MeshStandardMaterial({ color: 0x3a4670, metalness: 0.5, roughness: 0.4, transparent: true });
        this.stopMat = stopMat;
        for (const x of [-BEAM_HALF + 0.28, BEAM_HALF - 0.28]) {
            const h = -FLOOR_Y - 0.16;
            const s = new Mesh(new BoxGeometry(0.2, h, 0.3), stopMat);
            s.position.set(x, FLOOR_Y + h / 2, 0);
            s.castShadow = true;
            const cap = new Mesh(new BoxGeometry(0.5, 0.08, 0.42), stopMat);
            cap.position.set(x, -0.2, 0);
            this.stoppers.add(s, cap);
        }
        scene.add(this.stoppers);
        this.stopY = 0;

        // うで
        this.beam = new Group();
        scene.add(this.beam);
        const beamMat = new MeshStandardMaterial({ color: 0x9aa6c8, metalness: 0.9, roughness: 0.22 });
        const bar = new Mesh(new BoxGeometry(BEAM_HALF * 2, 0.26, 0.42), beamMat);
        bar.castShadow = true;
        this.beam.add(bar);
        this.glowLeft = new MeshBasicMaterial({ color: colors.left });
        this.glowRight = new MeshBasicMaterial({ color: colors.right });
        for (const [mat, sign] of [[this.glowLeft, -1], [this.glowRight, 1]]) {
            const strip = new Mesh(new BoxGeometry(BEAM_HALF - 0.45, 0.035, 0.03), mat);
            strip.position.set(sign * (BEAM_HALF / 2 + 0.1), 0.06, 0.215);
            this.beam.add(strip);
        }
        const centerMat = new MeshBasicMaterial({ color: 0xffd34d });
        const center = new Mesh(new BoxGeometry(0.5, 0.035, 0.03), centerMat);
        center.position.set(0, 0.06, 0.215);
        this.beam.add(center);
        const ends = new SphereGeometry(0.17, 24, 16);
        for (const [mat, sign] of [[this.glowLeft, -1], [this.glowRight, 1]]) {
            const cap = new Mesh(ends, mat);
            cap.position.x = sign * BEAM_HALF;
            this.beam.add(cap);
        }
        const pivot = new Mesh(new CylinderGeometry(0.13, 0.13, 0.5, 24), new MeshStandardMaterial({
            color: 0xffd34d, emissive: 0x6b4d00, metalness: 0.6, roughness: 0.3,
        }));
        pivot.rotation.x = Math.PI / 2;
        this.beam.add(pivot);
        const needle = new Mesh(new BoxGeometry(0.05, 1.0, 0.02), new MeshBasicMaterial({ color: colors.danger }));
        needle.position.set(0, 0.55, -0.28);
        this.beam.add(needle);

        const hookMat = new MeshStandardMaterial({ color: 0xc7d0ea, metalness: 0.9, roughness: 0.25 });
        const hookGeo = new TorusGeometry(0.06, 0.018, 8, 20);
        this.markers = new Map();
        for (const pos of POSITIONS) {
            const x = pos * UNIT;
            const tick = new Mesh(new BoxGeometry(0.03, 0.27, 0.44), new MeshBasicMaterial({ color: 0x4c5a86 }));
            tick.position.x = x;
            this.beam.add(tick);
            const hook = new Mesh(hookGeo, hookMat);
            hook.position.set(x, HOOK_Y + 0.06, 0);
            this.beam.add(hook);
            const num = new Sprite(new SpriteMaterial({
                map: textTexture(String(Math.abs(pos)), { color: '#dce6ff', glow: 'rgba(120,180,255,0.6)' }),
                transparent: true, depthWrite: false,
            }));
            num.scale.set(0.5, 0.5, 1);
            num.position.set(x, 0.5, 0);
            this.beam.add(num);

            // 置ける場所のマーカー（光の輪と柱）
            const marker = new Group();
            marker.position.set(x, HOOK_Y, 0);
            const ring = new Mesh(new TorusGeometry(0.3, 0.025, 8, 40), new MeshBasicMaterial({
                color: colors.accent, transparent: true, opacity: 0, depthWrite: false,
            }));
            ring.rotation.x = Math.PI / 2;
            ring.position.y = -0.12;
            const pillar = new Mesh(new CylinderGeometry(0.34, 0.34, 4.2, 24, 1, true), new MeshBasicMaterial({
                color: colors.accent, transparent: true, opacity: 0, depthWrite: false,
                side: DoubleSide, blending: AdditiveBlending,
            }));
            pillar.position.y = -2.2;
            const check = new Sprite(new SpriteMaterial({
                map: textTexture('✓', { color: '#4ade80', font: '900 90px sans-serif', glow: 'rgba(74,222,128,0.8)' }),
                transparent: true, opacity: 0, depthWrite: false,
            }));
            check.scale.set(0.55, 0.55, 1);
            check.position.y = -4.1;
            marker.add(ring, pillar, check);
            marker.userData = { ring, pillar, check };
            this.beam.add(marker);
            this.markers.set(pos, marker);
        }

        // 位置ごとのおもりの束（ふりこのように回転させる）
        this.stacks = new Map();
        for (const pos of POSITIONS) {
            const g = new Group();
            const string = new Mesh(new CylinderGeometry(0.012, 0.012, 1, 6), new MeshBasicMaterial({ color: 0xaab6d6 }));
            string.visible = false;
            g.add(string);
            g.userData.string = string;
            scene.add(g);
            this.stacks.set(pos, g);
        }

        // ドラッグ中のプレビュー
        this.preview = null;
        this.camTarget = new Vector3(0, -2.3, 0);
        this.lookAt = new Vector3();
        this.glowTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    }

    buildA11y() {
        const root = this.a11yRoot;
        root.innerHTML = '';
        this.targetButtons = new Map();
        for (const pos of POSITIONS) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'a11y-target';
            b.dataset.pos = pos;
            b.setAttribute('aria-label', `${positionLabel(pos)}（支点からのきょり ${Math.abs(pos)}）`);
            root.appendChild(b);
            this.targetButtons.set(pos, b);
        }
        this.weightButtons = new Map();
    }

    /* ======================== 描画データ ======================== */

    render(view) {
        const prevBoard = this.board;
        if (this.held === false && view.held === false && !this.noKick && !reduceMotion()) {
            this.velocity += kickFor(prevBoard, view.board);
        }
        this.noKick = false;
        this.board = view.board;
        this.chainMoves = Boolean(view.chainMoves);
        this.interactive = view.interactive !== false;
        this.canvas.classList.toggle('is-interactive', this.interactive);
        this.selectedId = view.selectedId ?? null;
        this.selectedGroup = new Set(this.groupIds(this.selectedId));
        this.targetStates = view.targets ?? new Map();
        if (view.hover !== undefined) this.hover = view.hover;
        this.syncWeights(prevBoard, view.newIds ?? new Set());
        this.setHeld(Boolean(view.held));
        this.updateTarget();
        this.syncA11y();
    }

    /** いっしょに動くおもりの id（つかんだおもりが先頭） */
    groupIds(id) {
        if (!id) return [];
        // 画面側が「実際にいっしょに動くおもり」を知っているときはそれを使う（たいせんの動かしなおしなど）
        const custom = this.handlers.dragGroup?.(id);
        if (custom) return custom;
        return this.chainMoves && this.board ? chainOf(this.board, id).map(w => w.id) : [id];
    }

    makeWeightMesh(weight) {
        const { r, h } = sizeOf(weight.mass);
        const color = this.colors[toneKey(weight)] ?? this.colors.m10;
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

    syncWeights(prevBoard, newIds) {
        const prevPos = new Map();
        if (prevBoard) for (const pos of POSITIONS) for (const w of prevBoard[pos]) prevPos.set(w.id, pos);
        const seen = new Set();
        for (const pos of POSITIONS) {
            const changed = this.syncStack(pos, prevPos, newIds, seen);
            if (changed && !reduceMotion()) this.swing[pos].v += (Math.random() < 0.5 ? -1 : 1) * 0.05;
        }
        for (const [id, mesh] of this.meshes) {
            if (!seen.has(id)) {
                disposeMesh(mesh);
                this.meshes.delete(id);
            }
        }
    }

    /** 1か所分のおもりを上から順に並べる @returns {boolean} 中身が変わったか */
    syncStack(pos, prevPos, newIds, seen) {
        const stack = this.stacks.get(pos);
        let y = -STRING;
        let changed = false;
        for (const weight of this.board[pos]) {
            seen.add(weight.id);
            const mesh = this.meshFor(weight);
            if (mesh.parent !== stack || prevPos.get(weight.id) !== pos) changed = true;
            stack.add(mesh);
            mesh.userData.offset = y;
            mesh.position.set(0, y, 0);
            if (newIds.has(weight.id) && !reduceMotion()) mesh.userData.drop = 1;
            y -= heightOf(weight.mass) + GAP;
            const selected = this.selectedGroup.has(weight.id);
            mesh.userData.halo.visible = selected;
            mesh.userData.body.material.emissiveIntensity = selected ? 3 : 1;
            mesh.userData.body.material.opacity = this.drag?.ids.includes(weight.id) ? 0.25 : 1;
        }
        const string = stack.userData.string;
        const last = this.board[pos].at(-1);
        const len = last ? -y - heightOf(last.mass) - GAP : 0;
        string.visible = Boolean(last);
        string.scale.y = Math.max(0.01, len);
        string.position.y = -len / 2;
        return changed;
    }

    meshFor(weight) {
        const key = `${weight.mass}|${weight.owner}|${weight.locked}`;
        let mesh = this.meshes.get(weight.id);
        if (mesh && mesh.userData.key !== key) {
            disposeMesh(mesh);
            mesh = null;
        }
        if (!mesh) {
            mesh = this.makeWeightMesh(weight);
            mesh.userData.key = key;
            this.meshes.set(weight.id, mesh);
        }
        return mesh;
    }

    setHeld(held) {
        if (held === this.held) return;
        const wasHeld = this.held;
        this.held = held;
        this.resetGlow();
        // 「ささえ → はなす」に変わったときだけ、落ち着いたあとに結果を光で見せる
        if (wasHeld === true && !held) this.awaitingVerdict = true;
    }

    updateTarget() {
        if (!this.board) return;
        this.target = this.held ? 0 : tiltFor(momentOf(this.board).diff);
        if (reduceMotion()) {
            this.angle = this.target;
            this.velocity = 0;
        }
    }

    settle() {
        return new Promise(resolve => this.settleResolvers.push(resolve));
    }

    /** 手をはなしていて、うでも、ぶら下がったおもりも静まっている */
    isCalm() {
        if (!this.board || this.held !== false || !isCalm(this)) return false;
        return Object.values(this.swing).every(s => Math.abs(s.a) < 0.06 && Math.abs(s.v) < 0.12);
    }

    /** 次の描画では反動をつけない（別の画面・別の表示から来たとき、前の盤面とくらべないように） */
    skipKick() {
        this.noKick = true;
    }

    /** モードを切りかえるとき、前のモードの状態（ささえ・判定の光・警告・カメラの寄り）を消す */
    reset() {
        this.held = null;
        this.skipKick();
        this.awaitingVerdict = false;
        this.resetGlow();
        this.focusGoal = 0;
        this.dangerGoal = 0;
        this.shake = 0;
        this.zoom = 0;
        this.hover = null;
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
        this.selectedId = null;
        this.selectedGroup = new Set();
        this.cancelDrag();
        for (const s of Object.values(this.swing)) {
            s.a = 0;
            s.v = 0;
        }
        this.level();
        this.settleResolvers.splice(0).forEach(r => r());
    }

    /** うでをすぐに水平にする（図から切りかえた直後に、前の傾きが残らないように） */
    level() {
        this.target = 0;
        this.angle = 0;
        this.velocity = 0;
        this.beam.rotation.z = 0;
    }

    /* ======================== ループ ======================== */

    isVisible() {
        return this.canvas.isConnected && this.canvas.offsetParent !== null && !document.hidden;
    }

    loop(now) {
        this.frame = requestAnimationFrame(this.loop);
        const dt = Math.min(0.1, (now - this.last) / 1000 || 0.016); // 遅い端末でも、ゆれ方の速さは同じ
        this.last = now;
        if (!this.isVisible()) {
            if (this.settleResolvers.length) this.finishSettle();
            return;
        }
        this.time += dt;
        if (this.showcase) this.stepShowcase(dt);
        this.step(dt);
        this.renderer.render(this.scene, this.camera);
        if (this.a11yRoot) this.placeA11y();
    }

    step(dt) {
        const k = dt * 60;
        const angVel = this.stepBeam(dt, k);
        this.stepStoppers(dt);
        this.stepStacks(dt, k, angVel);
        this.stepGlow(dt);
        this.stepMarkers();
        this.updatePreview();
        this.stepEffects(dt);
        if (this.dust) this.dust.rotation.y = Math.sin(this.time * 0.05) * 0.2;
        this.stepCamera(k);
    }

    /** うで（バネで目標の角度へ） @returns {number} 角速度（度/秒） */
    stepBeam(dt, k) {
        const prev = this.angle;
        if (!stepSpring(this, k)) {
            this.angle = this.target;
            this.velocity = 0;
            if (this.settleResolvers.length || this.awaitingVerdict) this.finishSettle();
        }
        this.beam.rotation.z = beamRotationZ(this.angle);
        // ふりこ用の角速度は Three.js の向き（反時計回りが正）で返す
        return -(this.angle - prev) / Math.max(dt, 1e-3);
    }

    stepStoppers(dt) {
        const goal = this.held ? 0 : -1.4;
        this.stopY += (goal - this.stopY) * Math.min(1, dt * 7);
        this.stoppers.position.y = this.stopY;
        this.stopMat.opacity = Math.max(0, 1 + this.stopY / 1.4);
        this.stoppers.visible = this.stopMat.opacity > 0.02;
    }

    /** おもりの束はフックからふりこのようにぶら下がる */
    stepStacks(dt, k, angVel) {
        const p = new Vector3();
        const still = reduceMotion();
        for (const pos of POSITIONS) {
            const stack = this.stacks.get(pos);
            p.set(pos * UNIT, HOOK_Y, 0);
            this.beam.localToWorld(p);
            stack.position.copy(p);
            const s = this.swing[pos];
            if (!still) {
                const acc = -9.8 / 1.6 * Math.sin(s.a) - (angVel * Math.PI / 180) * Math.abs(pos) * 0.04;
                s.v = (s.v + acc * dt) * Math.pow(0.985, k);
                s.a = Math.max(-0.5, Math.min(0.5, s.a + s.v * dt * 4));
            }
            stack.rotation.z = s.a;
            for (const mesh of stack.children) {
                const d = mesh.userData;
                if (!d?.drop) continue;
                d.drop = Math.max(0, d.drop - dt * 3.2);
                mesh.position.y = d.offset + d.drop * d.drop * 1.4;
            }
        }
    }

    /** はなしたあと：つり合い→両うでが緑、かたむき→重いほうが赤く点滅 */
    stepGlow(dt) {
        if (!this.flash) return;
        this.flash.t += dt;
        const pulse = 0.5 + 0.5 * Math.sin(this.flash.t * 8);
        const amount = Math.min(1, this.flash.t * 3) * (0.6 + 0.4 * pulse);
        for (const [mat, side] of [[this.glowLeft, 'left'], [this.glowRight, 'right']]) {
            const base = this.colors[side];
            const tint = this.flash.kind === 'equal' ? this.colors.ok : this.flash.kind === side ? this.colors.danger : base;
            mat.color.copy(base).lerp(tint, amount);
        }
        if (this.flash.t > 2.4) this.resetGlow();
    }

    /** 置ける場所：光の輪（ヒントは緑＋✓、ポインターの下は光の柱） */
    stepMarkers() {
        for (const pos of POSITIONS) {
            const { ring, pillar, check } = this.markers.get(pos).userData;
            const state = this.targetStates.get(pos);
            const hover = this.hover === pos;
            const blocked = state === 'blocked';
            const color = blocked ? this.colors.danger : state === 'hint' ? this.colors.ok : this.colors.accent;
            ring.material.color.copy(color);
            pillar.material.color.copy(color);
            const breathe = 0.75 + 0.25 * Math.sin(this.time * 3 + pos);
            let ringOpacity = state ? 0.5 * breathe : 0;
            let pillarOpacity = state === 'hint' ? 0.06 : 0;
            if (blocked) ringOpacity = hover ? 0.6 : 0;
            if (hover) pillarOpacity = blocked ? 0.04 : 0.14;
            if (hover && !blocked) ringOpacity = 1;
            ring.material.opacity = ringOpacity;
            pillar.material.opacity = pillarOpacity;
            check.material.opacity = state === 'hint' ? 0.9 : 0;
        }
    }

    stepCamera(k) {
        this.frameCamera();
        this.shake *= Math.pow(0.9, k);
        this.zoom *= Math.pow(0.88, k);
        this.focus += (this.focusGoal - this.focus) * Math.min(1, 0.08 * k);
        const sx = (Math.random() - 0.5) * this.shake;
        const sy = (Math.random() - 0.5) * this.shake;
        const orbit = this.showcase ? Math.sin(this.time * 0.25) * 0.35 : Math.sin(this.time * 0.18) * 0.04;
        // 判定中は支点（針）へぐっと寄る
        const dist = this.camDist * (1 - 0.32 * this.focus) + this.zoom;
        const lookY = this.camTarget.y + (0.2 - this.camTarget.y) * 0.55 * this.focus;
        const lift = this.camLift * (1 - 0.5 * this.focus);
        this.camera.position.set(Math.sin(orbit) * dist + sx, lookY + lift + sy, Math.cos(orbit) * dist);
        this.lookAt.set(sx * 0.3, lookY, 0);
        this.camera.lookAt(this.lookAt);
    }

    finishSettle() {
        this.angle = this.target;
        this.velocity = 0;
        if (this.awaitingVerdict && this.board && !this.held) {
            this.awaitingVerdict = false;
            const m = momentOf(this.board);
            const kind = m.diff === 0 ? 'equal' : m.diff > 0 ? 'left' : 'right';
            if (!this.showcase) {
                this.flash = { kind, t: 0 };
                if (kind !== 'equal' && !reduceMotion()) this.shake = 0.25;
            }
        } else {
            this.awaitingVerdict = false;
        }
        this.settleResolvers.splice(0).forEach(r => r());
    }

    resetGlow() {
        this.flash = null;
        this.glowLeft.color.copy(this.colors.left);
        this.glowRight.color.copy(this.colors.right);
    }

    updatePreview() {
        const want = this.drag && this.hover !== null && this.targetStates.get(this.hover) !== 'blocked';
        if (!want) {
            if (this.preview) this.preview.visible = false;
            return;
        }
        const weight = this.drag.source.weight;
        const key = `${weight.mass}|${weight.owner}|${weight.locked}`;
        if (this.preview?.userData.key !== key) {
            if (this.preview) disposeMesh(this.preview);
            this.preview = this.makeWeightMesh(weight);
            this.preview.userData.key = key;
            this.preview.userData.body.material.opacity = 0.45;
        }
        const stack = this.stacks.get(this.hover);
        if (this.preview.parent !== stack) stack.add(this.preview);
        let y = -STRING;
        for (const w of this.board[this.hover]) {
            if (w.id === this.drag.source.id) continue;
            y -= heightOf(w.mass) + GAP;
        }
        this.preview.position.y = y + Math.sin(this.time * 6) * 0.03;
        this.preview.visible = true;
    }

    /* ======================== サイズ・カメラ ======================== */

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const w = Math.max(1, rect.width);
        const h = Math.max(1, rect.height);
        const mobile = Math.min(w, h) < 500;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.frameCamera(true);
    }

    /**
     * いまの盤面がちょうど収まるようにカメラを合わせる（おもりが深く下がるほど引く）
     * @param {boolean} snap true ならすぐに合わせる（false はなめらかに追う）
     */
    frameCamera(snap = false) {
        let depth = 0;
        for (const pos of POSITIONS) {
            const d = (this.board?.[pos] ?? []).reduce((sum, w) => sum + heightOf(w.mass) + GAP, 0);
            depth = Math.max(depth, d);
        }
        const top = 1.25;
        const lowest = this.showcase ? FLOOR_Y + 0.4 : Math.min(-2.6, HOOK_Y - STRING - depth - 1.1);
        const bottom = Math.max(FLOOR_Y + 0.2, lowest);
        const halfW = this.showcase ? 7.6 : 7.3;
        const halfH = (top - bottom) / 2 + 0.35;
        const vfov = (this.camera.fov * Math.PI) / 180;
        const dist = Math.max(halfW / (Math.tan(vfov / 2) * this.camera.aspect), halfH / Math.tan(vfov / 2)) + 1.2;
        const centerY = (top + bottom) / 2;
        const lift = this.showcase ? 3.2 : 1.6 + (centerY < -2 ? 0.6 : 0);
        if (snap || this.camDist === undefined) {
            this.camDist = dist;
            this.camLift = lift;
            this.camTarget.y = centerY;
            return;
        }
        this.camDist += (dist - this.camDist) * 0.06;
        this.camLift += (lift - this.camLift) * 0.06;
        this.camTarget.y += (centerY - this.camTarget.y) * 0.06;
    }

    /* ======================== 入力 ======================== */

    bind() {
        this.onPointerDown = this.onPointerDown.bind(this);
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerUp = this.onPointerUp.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onHoverMove = this.onHoverMove.bind(this);
        this.canvas.addEventListener('pointerdown', this.onPointerDown);
        this.canvas.addEventListener('pointermove', this.onHoverMove);
        this.canvas.addEventListener('pointerleave', () => {
            if (!this.drag) this.setHover(null, true);
        });
        this.a11yRoot?.addEventListener('keydown', this.onKeyDown);
        // 透明ボタンはポインターを通さないので、click はキーボードや読み上げソフトから届く
        this.onA11yClick = this.onA11yClick.bind(this);
        this.a11yRoot?.addEventListener('click', this.onA11yClick);
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.canvas);
        this.canvas.addEventListener('webglcontextlost', e => e.preventDefault());
    }

    destroy() {
        cancelAnimationFrame(this.frame);
        this.cancelDrag();
        this.resizeObserver.disconnect();
        this.renderer.dispose();
    }

    ndc(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        return new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    }

    pickWeight(clientX, clientY) {
        this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
        const hits = [];
        for (const mesh of this.meshes.values()) hits.push(mesh.userData.hit);
        const hit = this.raycaster.intersectObjects(hits, false)[0];
        return hit?.object.userData.weightId ?? null;
    }

    positionAt(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const pad = 24;
        if (clientX < rect.left - pad || clientX > rect.right + pad
            || clientY < rect.top - pad || clientY > rect.bottom + pad) return null;
        this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
        const p = new Vector3();
        if (!this.raycaster.ray.intersectPlane(this.plane, p)) return null;
        this.beam.worldToLocal(p);
        if (Math.abs(p.x) > BEAM_HALF + 0.6) return null;
        const n = Math.round(p.x / UNIT);
        if (n === 0) return p.x < 0 ? -1 : 1;
        return POSITIONS.includes(n) ? n : null;
    }

    setHover(pos, notify = true) {
        if (pos === this.hover) return;
        this.hover = pos;
        if (notify) this.handlers.onHover?.(pos);
    }

    onHoverMove(e) {
        if (this.drag || !this.interactive || e.pointerType === 'touch') return;
        const id = this.pickWeight(e.clientX, e.clientY);
        const movable = id && this.handlers.canDrag?.(id);
        this.canvas.style.cursor = movable ? 'grab' : this.targetStates.size ? 'pointer' : '';
        this.setHover(this.targetStates.size ? this.positionAt(e.clientX, e.clientY) : null);
    }

    onPointerDown(e) {
        if (!this.interactive || e.button > 0 || this.drag) return;
        const id = this.pickWeight(e.clientX, e.clientY);
        this.press = { x: e.clientX, y: e.clientY, id };
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('pointercancel', this.onPointerUp);
    }

    onPointerMove(e) {
        if (this.drag) {
            this.moveGhost(e.clientX, e.clientY);
            this.setHover(this.positionAt(e.clientX, e.clientY));
            return;
        }
        const p = this.press;
        if (!p || !p.id) return;
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 8) return;
        if (!this.handlers.canDrag?.(p.id)) return;
        const found = findWeight(this.board, p.id);
        if (!found || found.weight.locked) return;
        this.startDrag({ kind: 'weight', id: p.id, weight: found.weight }, e);
    }

    onPointerUp(e) {
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerUp);
        if (this.drag) {
            // タッチが中断された（OS のジェスチャーなど）ときは「外へ出した」ではなく、取りやめ
            if (e.type === 'pointercancel') this.cancelDrag();
            else this.endDrag(this.positionAt(e.clientX, e.clientY));
            return;
        }
        const p = this.press;
        this.press = null;
        if (!p || e.type === 'pointercancel') return;
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) return;
        if (p.id) {
            const found = findWeight(this.board, p.id);
            if (found) {
                this.handlers.onWeightTap?.(p.id, found.pos);
                return;
            }
        }
        const pos = this.positionAt(e.clientX, e.clientY);
        if (pos !== null) this.handlers.onHookTap?.(pos);
    }

    onKeyDown(e) {
        const t = e.target;
        if (!t.classList.contains('a11y-target') || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault();
        const i = POSITIONS.indexOf(Number(t.dataset.pos)) + (e.key === 'ArrowLeft' ? -1 : 1);
        this.targetButtons.get(POSITIONS[Math.max(0, Math.min(POSITIONS.length - 1, i))])?.focus();
    }

    onA11yClick(e) {
        const t = e.target.closest('button');
        if (!t || !this.interactive) return;
        if (t.classList.contains('a11y-target')) {
            this.handlers.onHookTap?.(Number(t.dataset.pos));
        } else if (t.classList.contains('a11y-weight')) {
            const found = findWeight(this.board, t.dataset.id);
            if (found) this.handlers.onWeightTap?.(t.dataset.id, found.pos);
        }
    }

    focusPosition(pos) {
        this.targetButtons?.get(pos)?.focus();
    }

    startDrag(source, e) {
        if (this.drag) return;
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        const ids = source.kind === 'weight' ? this.groupIds(source.id) : [];
        const weights = ids.length ? ids.map(id => findWeight(this.board, id).weight) : [source.weight];
        ghost.innerHTML = ghostIcon(weights, 1.1);
        document.body.appendChild(ghost);
        this.drag = { source, ghost, ids };
        setDropZone(source.kind === 'weight' ? this.handlers.dropLabel?.(source.id) ?? null : null);
        this.setGroupOpacity(ids, 0.25);
        if (source.kind === 'new') {
            window.addEventListener('pointermove', this.onPointerMove);
            window.addEventListener('pointerup', this.onPointerUp);
            window.addEventListener('pointercancel', this.onPointerUp);
        }
        this.moveGhost(e.clientX, e.clientY);
        this.setHover(this.positionAt(e.clientX, e.clientY));
    }

    setGroupOpacity(ids, opacity) {
        for (const id of ids) {
            const m = this.meshes.get(id);
            if (m) m.userData.body.material.opacity = opacity;
        }
    }

    moveGhost(x, y) {
        if (this.drag) this.drag.ghost.style.transform = `translate(${x}px, ${y}px)`;
    }

    /** 押したまま（まだドラッグになっていない）を取りやめる。手番が変わったあとに、前の押しが効かないように */
    cancelPress() {
        this.press = null;
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerUp);
    }

    /** ドラッグを取りやめる（onDrop は呼ばない。時間切れなど） */
    cancelDrag() {
        this.cancelPress();
        if (!this.drag) return;
        const { ghost, ids } = this.drag;
        ghost.remove();
        this.drag = null;
        setDropZone(null);
        this.press = null;
        this.setGroupOpacity(ids, 1);
        this.setHover(null);
    }

    endDrag(pos) {
        if (!this.drag) return;
        const { source, ghost, ids } = this.drag;
        ghost.remove();
        this.drag = null;
        setDropZone(null);
        this.press = null;
        this.setGroupOpacity(ids, 1);
        this.setHover(null);
        this.handlers.onDrop?.(source, pos);
    }

    /* ======================== アクセシビリティ ======================== */

    syncA11y() {
        if (!this.a11yRoot) return;
        for (const [pos, b] of this.targetButtons) {
            const state = this.targetStates.get(pos);
            b.disabled = false;
            b.setAttribute('aria-disabled', String(!this.interactive || state === 'blocked'));
            b.tabIndex = this.interactive ? 0 : -1;
        }
        const seen = new Set();
        for (const pos of POSITIONS) {
            for (const w of this.board[pos]) {
                const movable = this.interactive && !w.locked && (this.handlers.canDrag?.(w.id) ?? false);
                if (!movable) continue;
                seen.add(w.id);
                let b = this.weightButtons.get(w.id);
                if (!b) {
                    b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'a11y-weight';
                    b.dataset.id = w.id;
                    this.a11yRoot.appendChild(b);
                    this.weightButtons.set(w.id, b);
                }
                b.setAttribute('aria-label', weightAria(w, pos));
                b.setAttribute('aria-pressed', String(w.id === this.selectedId));
            }
        }
        for (const [id, b] of this.weightButtons) {
            if (!seen.has(id)) {
                b.remove();
                this.weightButtons.delete(id);
            }
        }
    }

    project(v) {
        const rect = this.canvas.getBoundingClientRect();
        const p = v.clone().project(this.camera);
        return { x: (p.x * 0.5 + 0.5) * rect.width, y: (-p.y * 0.5 + 0.5) * rect.height };
    }

    placeA11y() {
        if (!this.board) return;
        const v = new Vector3();
        const height = this.canvas.clientHeight;
        const bottom = Math.min(height - 4, this.project(new Vector3(0, FLOOR_Y + 0.6, 0)).y);
        for (const [pos, b] of this.targetButtons) {
            v.set(pos * UNIT, 0.5, 0);
            this.beam.localToWorld(v);
            const top = this.project(v);
            v.set((pos + 0.5) * UNIT, 0, 0);
            this.beam.localToWorld(v);
            const w = Math.abs(this.project(v).x - top.x) * 2;
            const y = Math.max(0, top.y - 10);
            b.style.cssText = `left:${top.x - w / 2}px;top:${y}px;width:${w}px;height:${Math.max(40, bottom - y)}px`;
        }
        for (const [id, b] of this.weightButtons) {
            const mesh = this.meshes.get(id);
            if (!mesh) continue;
            mesh.getWorldPosition(v);
            v.y -= 0.35;
            const c = this.project(v);
            b.style.cssText = `left:${c.x - 22}px;top:${c.y - 22}px`;
        }
    }

    /* ======================== 演出 ======================== */

    /**
     * 演出を出す
     * @param {'hang'|'safe'|'out'|'judge'|'judgeEnd'|'win'|'turn'} kind
     * @param {{ pos?: number, side?: 'left'|'right', color?: string }} opts
     */
    fx(kind, opts = {}) {
        if (reduceMotion() && kind !== 'judge' && kind !== 'judgeEnd') return;
        const color = opts.color ? new Color(opts.color) : this.colors.accent;
        if (kind === 'hang' && opts.pos !== undefined) {
            const p = new Vector3(opts.pos * UNIT, HOOK_Y, 0);
            this.beam.localToWorld(p);
            this.burst(p, color, 18, 3.2);
            this.zoom = -0.6;
            this.shake = Math.max(this.shake, 0.08);
        } else if (kind === 'safe') {
            const p = new Vector3(0, 0, 0.3);
            this.wave(p, this.colors.ok, false, 4.5);
            this.burst(p, this.colors.ok, 40, 5);
            this.flash = { kind: 'equal', t: 0 };
            this.zoom = -1.2;
        } else if (kind === 'out') {
            this.shake = 0.7;
            this.zoom = 1.4;
            if (!opts.side) {
                // 時間切れ：てこは動かさず、支点から赤い火花
                this.burst(new Vector3(0, 0, 0.3), this.colors.danger, 40, 5);
                return;
            }
            const sign = opts.side === 'left' ? 1 : -1; // 度（時計回りが正）: 左が重い → 左が下がる → 負
            this.velocity += -sign * 1.2;
            const end = new Vector3(-sign * BEAM_HALF, 0, 0);
            this.beam.localToWorld(end);
            this.burst(end, this.colors.danger, 50, 6);
            this.wave(end, this.colors.danger, false, 2.6);
            this.flash = { kind: opts.side, t: 0 };
        } else if (kind === 'judge') {
            this.focusGoal = 1;
        } else if (kind === 'judgeEnd') {
            this.focusGoal = 0;
        } else if (kind === 'turn') {
            this.wave(new Vector3(0, FLOOR_Y + 0.25, 0), color, true);
        } else if (kind === 'win') {
            for (let i = 0; i < 6; i++) {
                const p = new Vector3((Math.random() - 0.5) * 12, 3 + Math.random() * 2, (Math.random() - 0.5) * 3);
                const c = [this.colors.p1, this.colors.p2, this.colors.p3, this.colors.p4, this.colors.ok, color][i];
                this.burst(p, c, 30, 4, 4);
            }
        }
    }

    /** 危険度（0〜1）：赤い警告灯がうなる */
    setDanger(level) {
        this.dangerGoal = Math.max(0, Math.min(1, level));
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

    stepEffects(dt) {
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
        // 警告灯
        this.danger += (this.dangerGoal - this.danger) * Math.min(1, dt * 4);
        const pulse = 0.5 + 0.5 * Math.sin(this.time * (6 + this.danger * 6));
        this.alarm.intensity = this.danger * (20 + 60 * pulse);
        for (const [light, base] of this.rims) light.color.copy(base).lerp(this.colors.danger, this.danger * 0.7 * pulse);
    }

    /* ======================== ホーム画面のデモ ======================== */

    /** @param {object[]} boards デモで順番に見せる盤面 */
    setShowcase(boards) {
        this.demo = { boards, i: -1, t: 99 };
    }

    stepShowcase(dt) {
        const d = this.demo;
        if (!d) return;
        d.t += dt;
        if (d.t < 3.6) return;
        d.t = 0;
        d.i = (d.i + 1) % d.boards.length;
        const board = d.boards[d.i];
        const prev = this.board;
        const newIds = new Set();
        for (const pos of POSITIONS) for (const w of board[pos]) if (!prev || !findWeight(prev, w.id)) newIds.add(w.id);
        this.render({ board, held: false, interactive: false, newIds });
        if (!isBalanced(board) && !reduceMotion()) this.velocity += 0.2;
    }
}
