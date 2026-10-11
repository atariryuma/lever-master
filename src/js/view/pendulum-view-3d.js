/**
 * ふりこの 3D ビュー（Three.js）
 *
 * PendulumView（SVG 版）と同じ使い方ができる:
 *   render({ pendulums, selectedId, interactive, highlight }) / handlers / timeScale / fx()
 *
 * - 横棒から糸でおもりがぶら下がる。動きは physics.js（stepSwing）
 * - おもりをドラッグして持ち上げ、はなすとふれる。持ち上げ中は中心線と角度の弧を出す
 * - 左の柱にものさし（0〜100cm）
 * - キーボード・読み上げ用に、透明なボタンをおもりの位置に重ねる
 */

import {
    AdditiveBlending, AmbientLight, BoxGeometry, Color, CylinderGeometry, DirectionalLight, DoubleSide, Group,
    HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, Plane, PlaneGeometry,
    PointLight, Raycaster, RingGeometry, Scene, ShadowMaterial, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
} from '../../vendor/three.js';
import { AMPLITUDES, createPendulum, snapAmplitude } from '../engine/pendulum.js';
import { createSwing, stepSwing } from '../engine/physics.js';
import { angleOf, colorVarOf, cycleCount, pendulumAria, tagLabel } from './pendulum-view.js';
import {
    Effects, LOOP_H, bobSize, cssColor, disposeMesh, gridTexture, makeWeightMesh, radialTexture, readColors, reduceMotion,
    showcaseThrottle, textSprite,
} from './three-utils.js';

const UNIT_PER_CM = 0.05; // 100cm = 5
const BAR_Y = 2.9;
const FLOOR_Y = -3.4;
const ARC_R = 0.95;

export class PendulumView3D {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {object} handlers PendulumView と同じ
     * @param {{ a11yRoot?: HTMLElement|null, showcase?: boolean }} options
     */
    constructor(canvas, handlers = {}, { a11yRoot = null, showcase = false } = {}) {
        this.canvas = canvas;
        this.handlers = handlers;
        this.a11yRoot = a11yRoot;
        this.showcase = showcase;
        this.items = [];
        this.nodes = new Map();
        this.timeScale = 1;
        this.time = 0;
        this.interactive = true;
        this.selectedId = null;
        this.highlight = new Map();
        this.drag = null;
        this.shake = 0;
        this.zoom = 0;
        this.colors = readColors();
        this.raycaster = new Raycaster();
        this.plane = new Plane(new Vector3(0, 0, 1), 0);

        this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
        this.renderer.outputColorSpace = SRGBColorSpace;
        // ホームのデモ（飾り）は影なし。毎フレームの影の計算をはぶいて、スクロールを軽く
        this.renderer.shadowMap.enabled = !showcase;
        this.skipFrame = showcase ? showcaseThrottle(canvas) : null;
        this.renderer.shadowMap.type = PCFShadowMap;
        this.scene = new Scene();
        this.camera = new PerspectiveCamera(32, 1, 0.1, 200);
        this.effects = new Effects(this.scene);
        this.build();
        if (a11yRoot) {
            a11yRoot.innerHTML = '';
            this.buttons = new Map();
        }
        this.bind();
        this.resize();
        this.loop = this.loop.bind(this);
        this.last = performance.now();
        this.frame = requestAnimationFrame(this.loop);
    }

    /* ======================== シーン ======================== */

    build() {
        const { scene, colors } = this;
        scene.add(new HemisphereLight(0xb8c8ff, 0x101428, 1.1));
        scene.add(new AmbientLight(0x6070a0, 0.35));
        const key = new DirectionalLight(0xffffff, 2.2);
        key.position.set(4, 9, 8);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        Object.assign(key.shadow.camera, { left: -9, right: 9, top: 7, bottom: -6, near: 1, far: 30 });
        key.shadow.radius = 4;
        scene.add(key);
        const rimL = new PointLight(colors.left, 14, 16);
        rimL.position.set(-6, 1, 3);
        const rimR = new PointLight(colors.right, 14, 16);
        rimR.position.set(6, 1, 3);
        scene.add(rimL, rimR);

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
        const pool = new Mesh(new PlaneGeometry(12, 10), new MeshBasicMaterial({
            map: radialTexture('rgba(80,170,255,0.35)', 'rgba(80,170,255,0)'), transparent: true, depthWrite: false, blending: AdditiveBlending,
        }));
        pool.rotation.x = -Math.PI / 2;
        pool.position.y = FLOOR_Y + 0.02;
        scene.add(pool);

        this.metal = new MeshStandardMaterial({ color: 0x8b97b8, metalness: 0.85, roughness: 0.28 });
        this.dark = new MeshStandardMaterial({ color: 0x2a3352, metalness: 0.7, roughness: 0.35 });
        this.stand = new Group();
        scene.add(this.stand);
        this.rulerGroup = new Group();
        scene.add(this.rulerGroup);
        this.layer = new Group();
        scene.add(this.layer);
        this.lookAt = new Vector3(0, 0, 0);
        this.camDist = 14;
        this.camY = 0;
        this.buildStand(2);
    }

    /** 台（ふりこの数と画面の向きで横はばが変わる。たて長の画面では近づけて、大きく見せる） */
    buildStand(n) {
        const narrow = this.camera.aspect < 0.9;
        const spacing = (n <= 2 ? 3.4 : n === 3 ? 2.8 : 2.3) * (narrow ? 0.72 : 1);
        const halfW = (spacing * n) / 2 + (narrow ? 0.7 : 0.9);
        this.standNarrow = narrow;
        this.spacing = spacing;
        this.halfW = halfW;
        while (this.stand.children.length) disposeMesh(this.stand.children[0]);
        while (this.rulerGroup.children.length) disposeMesh(this.rulerGroup.children[0]);
        const bar = new Mesh(new BoxGeometry(halfW * 2 + 0.6, 0.22, 0.3), this.metal);
        bar.position.y = BAR_Y;
        bar.castShadow = true;
        this.stand.add(bar);
        const glow = new Mesh(new BoxGeometry(halfW * 2 + 0.4, 0.03, 0.03), new MeshBasicMaterial({ color: this.colors.accent }));
        glow.position.set(0, BAR_Y + 0.12, 0.15);
        this.stand.add(glow);
        for (const sign of [-1, 1]) {
            const x = sign * halfW;
            const post = new Mesh(new CylinderGeometry(0.1, 0.13, BAR_Y - FLOOR_Y, 20), this.metal);
            post.position.set(x, (BAR_Y + FLOOR_Y) / 2, 0);
            post.castShadow = true;
            const base = new Mesh(new CylinderGeometry(0.7, 0.85, 0.18, 32), this.dark);
            base.position.set(x, FLOOR_Y + 0.09, 0);
            base.castShadow = true;
            base.receiveShadow = true;
            this.stand.add(post, base);
        }
        // ものさし（左の柱のとなりに、0〜100cm。数字は線の右）
        const rx = -halfW + 0.55;
        const line = new Mesh(new BoxGeometry(0.03, 100 * UNIT_PER_CM, 0.02), new MeshBasicMaterial({ color: 0xaab6d6 }));
        line.position.set(rx, BAR_Y - (100 * UNIT_PER_CM) / 2, 0.1);
        this.rulerGroup.add(line);
        for (let cm = 0; cm <= 100; cm += 5) {
            const major = cm % 25 === 0;
            const len = major ? 0.3 : cm % 10 === 0 ? 0.2 : 0.11;
            const tick = new Mesh(new BoxGeometry(len, major ? 0.03 : 0.02, 0.02), new MeshBasicMaterial({
                color: major ? 0xeaf0ff : 0xaab6d6,
            }));
            tick.position.set(rx + len / 2, BAR_Y - cm * UNIT_PER_CM, 0.1);
            this.rulerGroup.add(tick);
            if (major) {
                const label = textSprite(String(cm), { color: '#dce6ff', glow: 'rgba(120,180,255,0.6)' }, 0.5);
                label.position.set(rx + 0.62, BAR_Y - cm * UNIT_PER_CM, 0.1);
                this.rulerGroup.add(label);
            }
        }
        const unit = textSprite('cm', { color: '#9fb0d8', font: '700 56px Orbitron, sans-serif' }, 0.5);
        unit.position.set(rx + 0.62, BAR_Y - 100 * UNIT_PER_CM - 0.4, 0.1);
        this.rulerGroup.add(unit);
        this.frameCamera(true);
    }

    pivotX(i) {
        const n = this.items.length;
        return (i - (n - 1) / 2) * this.spacing + 0.7; // ものさしのぶん、少し右へ
    }

    makeNode(p, i) {
        const g = new Group();
        g.position.set(this.pivotX(i), BAR_Y, (i - (this.items.length - 1) / 2) * 0.12);
        const pivot = new Mesh(new CylinderGeometry(0.08, 0.08, 0.36, 16), new MeshStandardMaterial({
            color: 0xffd34d, emissive: 0x6b4d00,
        }));
        pivot.rotation.x = Math.PI / 2;
        g.add(pivot);
        const rot = new Group();
        g.add(rot);
        const string = new Mesh(new CylinderGeometry(0.012, 0.012, 1, 6), new MeshBasicMaterial({ color: 0xaab6d6 }));
        rot.add(string);
        const center = new Mesh(new BoxGeometry(0.012, 1, 0.012), new MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 0.35,
        }));
        center.visible = false;
        g.add(center);
        const arc = new Mesh(new RingGeometry(ARC_R - 0.03, ARC_R, 32, 1, 0, 0.1), new MeshBasicMaterial({
            color: this.colors.warn, side: DoubleSide, transparent: true, opacity: 0.9,
        }));
        arc.visible = false;
        g.add(arc);
        const arcText = textSprite('20°', {
            color: '#fbbf24', font: '900 60px Orbitron, sans-serif', glow: 'rgba(251,191,36,0.7)',
        }, 0.55);
        arcText.visible = false;
        g.add(arcText);
        const colorVar = colorVarOf(p, i);
        // 名札：ふだんは記号、ふれているあいだは往復の回数（1〜10）
        const tag = textSprite(tagLabel(p), {
            color: cssColor(colorVar).getStyle(), font: '900 76px Orbitron, sans-serif', glow: 'rgba(255,255,255,0.4)',
        }, 0.7);
        tag.position.set(0, 0.62, 0.2);
        g.add(tag);
        const ring = new Mesh(new RingGeometry(0.3, 0.36, 40), new MeshBasicMaterial({
            color: cssColor(colorVar), side: DoubleSide,
        }));
        ring.position.set(0, 0.62, 0.15);
        g.add(ring);
        const lenText = textSprite(`${p.length}cm`, {
            color: '#dce6ff', font: '900 50px Orbitron, sans-serif', size: 256, glow: 'rgba(120,180,255,0.6)',
        }, 1.2);
        g.add(lenText);
        this.layer.add(g);
        g.userData = { rot, string, center, arc, arcText, tag, ring, lenText, bob: null, key: null };
        return g;
    }

    syncNodes() {
        const seen = new Set();
        this.items.forEach((p, i) => {
            seen.add(p.id);
            let g = this.nodes.get(p.id);
            if (!g) {
                g = this.makeNode(p, i);
                this.nodes.set(p.id, g);
            }
            g.position.set(this.pivotX(i), BAR_Y, (i - (this.items.length - 1) / 2) * 0.12);
            const d = g.userData;
            const key = `${p.mass}|${p.owner}`;
            if (d.key !== key) {
                if (d.bob) disposeMesh(d.bob);
                d.bob = makeWeightMesh({ id: p.id, mass: p.mass, owner: p.owner }, this.colors);
                d.bob.userData.hit.userData.pendId = p.id;
                d.rot.add(d.bob);
                d.key = key;
            }
            d.lenText.userData.setText(p.secret ? '？' : `${p.length}cm`);
            d.bob.userData.body.material.opacity = p.secret ? 0.35 : 1;
            const state = this.highlight.get(p.id);
            d.bob.userData.halo.visible = p.phase === 'held' || p.id === this.selectedId || state === 'first';
            const haloColor = state === 'first' ? this.colors.gold : state === 'done' ? this.colors.ok : new Color(0xffffff);
            d.bob.userData.halo.material.color.copy(haloColor);
            d.bob.userData.body.material.emissiveIntensity = p.id === this.selectedId || state ? 2.2 : 1;
            this.syncTag(d, p);
            if (this.buttons) this.syncButton(p);
        });
        for (const [id, g] of this.nodes) {
            if (!seen.has(id)) {
                disposeMesh(g);
                this.nodes.delete(id);
                this.buttons?.get(id)?.remove();
                this.buttons?.delete(id);
            }
        }
    }

    syncButton(p) {
        let b = this.buttons.get(p.id);
        if (!b) {
            b = document.createElement('button');
            b.type = 'button';
            b.className = 'a11y-weight';
            b.dataset.id = p.id;
            this.a11yRoot.appendChild(b);
            this.buttons.set(p.id, b);
        }
        b.setAttribute('aria-label', pendulumAria(p));
        b.tabIndex = this.interactive ? 0 : -1;
    }

    /* ======================== 描画データ ======================== */

    render(view) {
        this.items = view.pendulums;
        this.interactive = view.interactive !== false;
        this.selectedId = view.selectedId ?? null;
        this.highlight = view.highlight ?? new Map();
        this.canvas.classList.toggle('is-interactive', this.interactive);
        if (this.items.length !== this.standFor) {
            this.standFor = this.items.length;
            this.buildStand(this.items.length);
        }
        this.syncNodes();
        this.place();
    }

    canDrag(id) {
        return this.interactive && (this.handlers.canDrag?.(id) ?? true);
    }

    /** 名札：回数を数えているときは数字、10往復したら少し大きく */
    syncTag(d, p) {
        // ホームのデモは飾りなので、回数ではなく名前（A・B・C）のまま
        d.tag.userData.setText(this.showcase ? p.label : tagLabel(p));
        const done = cycleCount(p) === 10;
        const s = done ? 0.85 : 0.7;
        d.tag.scale.set(s, s, 1);
        d.ring.scale.setScalar(done ? 1.2 : 1);
    }

    place() {
        this.items.forEach(p => {
            const g = this.nodes.get(p.id);
            if (!g) return;
            const d = g.userData;
            const a = angleOf(p);
            const rad = (a * Math.PI) / 180;
            const L = p.length * UNIT_PER_CM;
            const { h } = bobSize(p.mass);
            d.rot.rotation.z = rad; // 右（プラス）へふる
            const top = L - (LOOP_H + h / 2); // 輪っかの上端まで（長さは おもりの中心まで）
            d.string.scale.y = Math.max(0.01, top);
            d.string.position.y = -top / 2;
            d.bob.position.y = -top;
            const still = p.phase === 'rest' || p.phase === 'held';
            d.lenText.visible = still;
            d.lenText.position.set((L / 2) * Math.sin(rad) + 0.55, -(L / 2) * Math.cos(rad), 0.2);
            const showArc = p.phase === 'held' || (p.phase === 'swinging' && this.drag?.id === p.id);
            d.center.visible = showArc;
            d.center.scale.y = L;
            d.center.position.y = -L / 2;
            d.arc.visible = showArc;
            d.arcText.visible = showArc;
            if (showArc) {
                // 真下（−π/2）から糸の向きまでの弧
                const start = a > 0 ? -Math.PI / 2 : -Math.PI / 2 + rad;
                d.arc.geometry.dispose();
                d.arc.geometry = new RingGeometry(ARC_R - 0.03, ARC_R, 32, 1, start, Math.max(0.01, Math.abs(rad)));
                d.arcText.userData.setText(`${p.amplitude}°`);
                d.arcText.position.set((ARC_R + 0.35) * Math.sin(rad / 2), -(ARC_R + 0.35) * Math.cos(rad / 2), 0.2);
            }
        });
    }

    /* ======================== ループ ======================== */

    isVisible() {
        return this.canvas.isConnected && this.canvas.offsetParent !== null && !document.hidden;
    }

    loop(now) {
        this.frame = requestAnimationFrame(this.loop);
        if (this.skipFrame?.(now)) return; // デモ：スクロール中・画面の外・30fps をこえるフレームは描かない
        const dt = Math.min(0.1, (now - this.last) / 1000 || 0.016);
        this.last = now;
        if (!this.isVisible()) return;
        if (this.showcase) this.stepShowcase(dt);
        this.advance(dt);
        this.effects.step(dt);
        this.stepCamera(dt);
        this.renderer.render(this.scene, this.camera);
        if (this.buttons) this.placeButtons();
    }

    advance(dt) {
        const step = dt * this.timeScale;
        this.time += step;
        for (const p of this.items) {
            if (p.phase !== 'swinging' || !p.swing) continue;
            const done = stepSwing(p.swing, p, step);
            if (done) {
                const g = this.nodes.get(p.id);
                if (g) this.syncTag(g.userData, p);
                this.handlers.onCycle?.(p, p.swing.cycles);
            }
        }
        this.place();
        this.handlers.onFrame?.(step);
    }

    stepCamera(dt) {
        const k = dt * 60;
        this.shake *= Math.pow(0.9, k);
        this.zoom *= Math.pow(0.88, k);
        const sx = (Math.random() - 0.5) * this.shake;
        const orbit = this.showcase ? Math.sin(this.time * 0.22) * 0.3 : Math.sin(this.time * 0.15) * 0.035;
        const dist = this.camDist + this.zoom;
        this.camera.position.set(Math.sin(orbit) * dist + this.lookAt.x + sx, this.camY + 1.2, Math.cos(orbit) * dist);
        this.camera.lookAt(this.lookAt.x + sx * 0.3, this.camY, 0);
    }

    /* ======================== サイズ・カメラ ======================== */

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        const w = Math.max(1, rect.width);
        const h = Math.max(1, rect.height);
        const mobile = Math.min(w, h) < 500;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.showcase ? 1.25 : mobile ? 1.5 : 2));
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        if (this.standFor && (this.camera.aspect < 0.9) !== this.standNarrow) {
            this.buildStand(this.standFor);
            this.syncNodes();
            this.place();
        }
        this.frameCamera(true);
    }

    /** 台ぜんたい（横棒〜床）が入るように */
    frameCamera() {
        const top = BAR_Y + 1.0;
        const bottom = this.showcase ? FLOOR_Y : FLOOR_Y + 0.1;
        const halfH = (top - bottom) / 2 + 0.2;
        const halfW = this.halfW + (this.showcase ? 0.6 : 1.0);
        const vfov = (this.camera.fov * Math.PI) / 180;
        const byWidth = halfW / (Math.tan(vfov / 2) * this.camera.aspect);
        const byHeight = halfH / Math.tan(vfov / 2);
        this.camDist = Math.max(byWidth, byHeight) + 0.8;
        this.camY = (top + bottom) / 2 - 0.2;
        this.lookAt.set(0.1, this.camY, 0);
    }

    /* ======================== 入力 ======================== */

    bind() {
        this.onPointerDown = this.onPointerDown.bind(this);
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerUp = this.onPointerUp.bind(this);
        this.onA11y = this.onA11y.bind(this);
        this.canvas.addEventListener('pointerdown', this.onPointerDown);
        this.canvas.addEventListener('pointermove', e => {
            if (this.drag || !this.interactive || e.pointerType === 'touch') return;
            const id = this.pick(e.clientX, e.clientY);
            const mode = id ? this.handlers.dragMode?.(id) ?? 'swing' : null;
            this.canvas.style.cursor = id && this.canDrag(id) ? (mode === 'length' ? 'ns-resize' : 'grab') : '';
        });
        this.a11yRoot?.addEventListener('click', this.onA11y);
        this.a11yRoot?.addEventListener('keydown', this.onA11y);
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

    pick(clientX, clientY) {
        this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
        const hits = [...this.nodes.values()].map(g => g.userData.bob?.userData.hit).filter(Boolean);
        return this.raycaster.intersectObjects(hits, false)[0]?.object.userData.pendId ?? null;
    }

    /** 指の位置から、支点を中心にした角度（度。右がプラス） */
    angleAt(id, clientX, clientY) {
        const g = this.nodes.get(id);
        if (!g) return 0;
        this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
        const p = new Vector3();
        if (!this.raycaster.ray.intersectPlane(this.plane, p)) return 0;
        const dx = p.x - g.position.x;
        const dy = Math.max(0.2, g.position.y - p.y);
        return (Math.atan2(dx, dy) * 180) / Math.PI;
    }

    onPointerDown(e) {
        if (!this.interactive || e.button > 0 || this.drag) return;
        const id = this.pick(e.clientX, e.clientY);
        if (!id) return;
        this.press = { x: e.clientX, y: e.clientY, id };
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('pointercancel', this.onPointerUp);
    }

    onPointerMove(e) {
        if (this.drag) {
            this.dragTo(e.clientX, e.clientY);
            return;
        }
        const p = this.press;
        if (!p || Math.hypot(e.clientX - p.x, e.clientY - p.y) < 8) return;
        if (!this.canDrag(p.id)) return;
        const want = this.handlers.dragMode?.(p.id) ?? 'swing';
        const vertical = Math.abs(e.clientY - p.y) > Math.abs(e.clientX - p.x);
        const mode = want === 'auto' ? (vertical ? 'length' : 'swing') : want;
        this.drag = { id: p.id, mode };
        this.canvas.style.cursor = mode === 'length' ? 'ns-resize' : 'grabbing';
        this.handlers.onDragStart?.(p.id);
        this.dragTo(e.clientX, e.clientY);
    }

    dragTo(clientX, clientY) {
        if (this.drag.mode === 'length') {
            const g = this.nodes.get(this.drag.id);
            this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
            const hit = new Vector3();
            if (g && this.raycaster.ray.intersectPlane(this.plane, hit)) {
                this.handlers.onBobLength?.(this.drag.id, (g.position.y - hit.y) / UNIT_PER_CM);
            }
            return;
        }
        const a = this.angleAt(this.drag.id, clientX, clientY);
        this.handlers.onBobDrag?.(this.drag.id, snapAmplitude(a), a < 0 ? -1 : 1);
    }

    onPointerUp(e) {
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerUp);
        const p = this.press;
        this.press = null;
        if (this.drag) {
            const { id, mode } = this.drag;
            this.drag = null;
            this.canvas.style.cursor = '';
            if (e.type === 'pointercancel') this.handlers.onDragCancel?.(id);
            else if (mode === 'length') this.handlers.onLengthEnd?.(id);
            else this.handlers.onBobRelease?.(id);
            return;
        }
        if (!p || e.type === 'pointercancel') return;
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) return;
        this.handlers.onBobTap?.(p.id);
    }

    onA11y(e) {
        const b = e.target.closest?.('button.a11y-weight');
        if (!b || !this.interactive) return;
        const id = b.dataset.id;
        if (e.type === 'click') {
            this.handlers.onBobTap?.(id);
        } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.canDrag(id) && (this.handlers.dragMode?.(id) ?? 'swing') !== 'swing') {
            e.preventDefault();
            const p = this.items.find(q => q.id === id);
            this.handlers.onBobLength?.(id, p.length + (e.key === 'ArrowDown' ? 1 : -1), { step: true });
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const p = this.items.find(q => q.id === id);
            if (!p || !this.canDrag(id)) return;
            const i = AMPLITUDES.indexOf(p.amplitude);
            const next = AMPLITUDES[Math.max(0, Math.min(AMPLITUDES.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))];
            this.handlers.onBobDrag?.(id, next, p.side);
        }
    }

    cancelDrag() {
        this.press = null;
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerUp);
        if (!this.drag) return;
        const { id } = this.drag;
        this.drag = null;
        this.canvas.style.cursor = '';
        this.handlers.onDragCancel?.(id);
    }

    focusBob(id) {
        this.buttons?.get(id)?.focus();
    }

    project(v) {
        const rect = this.canvas.getBoundingClientRect();
        const p = v.clone().project(this.camera);
        return { x: (p.x * 0.5 + 0.5) * rect.width, y: (-p.y * 0.5 + 0.5) * rect.height };
    }

    placeButtons() {
        const v = new Vector3();
        for (const [id, b] of this.buttons) {
            const g = this.nodes.get(id);
            if (!g?.userData.bob) continue;
            g.userData.bob.getWorldPosition(v);
            v.y -= 0.3;
            const c = this.project(v);
            b.style.cssText = `left:${c.x - 22}px;top:${c.y - 22}px`;
        }
    }

    /* ======================== 演出 ======================== */

    /**
     * @param {'release'|'count'|'done'|'first'|'win'} kind
     */
    fx(kind, opts = {}) {
        if (reduceMotion()) return;
        const g = opts.id ? this.nodes.get(opts.id) : null;
        const color = opts.color ? new Color(opts.color) : this.colors.accent;
        const bobPos = () => {
            const v = new Vector3();
            g.userData.bob.getWorldPosition(v);
            v.y -= 0.35;
            return v;
        };
        if (kind === 'release') {
            this.zoom = -0.4;
        } else if (kind === 'count' && g) {
            this.effects.burst(bobPos(), color, 10, 1.6, 3);
        } else if (kind === 'done' && g) {
            this.effects.burst(bobPos(), this.colors.ok, 36, 4);
            this.effects.wave(bobPos(), this.colors.ok, false, 1.4);
            this.zoom = -0.7;
        } else if (kind === 'first' && g) {
            this.effects.burst(bobPos(), this.colors.gold, 40, 4.5);
            this.effects.wave(bobPos(), this.colors.gold, false, 1.8);
            this.shake = 0.15;
        } else if (kind === 'win') {
            for (let i = 0; i < 6; i++) {
                const p = new Vector3((Math.random() - 0.5) * 10, 2 + Math.random() * 2, (Math.random() - 0.5) * 3);
                const c = [this.colors.p1, this.colors.p2, this.colors.p3, this.colors.p4, this.colors.ok, color][i];
                this.effects.burst(p, c, 30, 4, 4);
            }
        }
    }

    setDanger() {}

    reset() {
        this.cancelDrag();
        this.timeScale = 1;
        this.highlight = new Map();
        this.selectedId = null;
        this.effects.clear();
        this.shake = 0;
        this.zoom = 0;
    }

    /* ======================== ホーム画面のデモ ======================== */

    setShowcase() {
        this.demo = {
            t: 99,
            items: [25, 50, 100].map((length, i) => createPendulum({ id: `d${i}`, label: 'ABC'[i], length, mass: [10, 20, 30][i], amplitude: 20, phase: 'held' })),
        };
        this.render({ pendulums: this.demo.items, interactive: false });
    }

    stepShowcase(dt) {
        const d = this.demo;
        if (!d) return;
        d.t += dt;
        if (d.t > 11) {
            // 持ち上げて、そろえてはなす
            d.t = 0;
            for (const p of d.items) {
                p.phase = 'held';
                p.swing = null;
            }
            this.render({ pendulums: d.items, interactive: false });
        } else if (d.t > 1.2 && d.items[0].phase === 'held') {
            for (const p of d.items) {
                p.phase = 'swinging';
                p.swing = createSwing(p);
            }
            this.render({ pendulums: d.items, interactive: false });
        }
    }
}
