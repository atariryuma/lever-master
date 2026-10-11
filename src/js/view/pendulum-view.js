/**
 * ふりこの SVG ビュー（図）
 *
 * PendulumView3D と同じ使い方ができる:
 *   render({ pendulums, selectedId, interactive, highlight }) / handlers / timeScale / fx()
 *
 * - ふりこの動きは physics.js（stepSwing）で進める。ふれている最中の状態（swing）は
 *   渡された pendulum オブジェクトの中にあり、画面側（screens）がそのまま読める
 * - おもりを横にドラッグして持ち上げる（ふれはばは 10・20・30° にそろう）→ はなすとふれる
 * - 左にものさし（0〜100cm）。止まっているときは、糸に長さ、支点にふれはばの角度を出す
 */

import { AMPLITUDES, CONDITION_META, COUNT, snapAmplitude } from '../engine/pendulum.js';
import { stepSwing, swingAngleDeg } from '../engine/physics.js';
import { PLAYER_META } from '../players.js';
import { heightOf, sizeOf, toneOf, weightShape } from './weight-art.js';

const NS = 'http://www.w3.org/2000/svg';
const H = 560;
const PY = 64; // 支点（横棒）の高さ
const SCALE = 4; // 1cm = 4px（100cm = 400px）
const RULER_X = 58;
const LOOP = 8; // weight-art の輪っかの高さ
const ARC_R = 64;

const el = (tag, attrs = {}, parent) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent?.appendChild(node);
    return node;
};

/** 画面に描く角度（度。右がプラス） */
export function angleOf(p) {
    if (p.phase === 'held') return p.side * p.amplitude;
    if (p.phase === 'swinging' && p.swing) return swingAngleDeg(p.swing);
    return 0;
}

/** ふれているあいだの往復の回数（10 で止める）。ふれていなければ null */
export function cycleCount(p) {
    const n = p.swing?.cycles ?? 0;
    if (!(p.phase === 'swinging' || (p.phase === 'stopped' && n))) return null;
    return Math.min(n, COUNT);
}

/**
 * ふりこの上の名札の文字。ふれているあいだは往復の回数（1, 2, … 10）をラップカウンターのように出す。
 * 横に長いラベルをふりこのそばに出すと、ふりこが多いときに となりと重なるので、回数は名札の中だけ。
 * 時間は下の計測パネルに出る
 */
export function tagLabel(p) {
    const n = cycleCount(p);
    if (n !== null) return String(n);
    return p.owner && PLAYER_META[p.owner] ? PLAYER_META[p.owner].symbol : p.label;
}

export function pendulumAria(p) {
    const who = p.owner && PLAYER_META[p.owner] ? `${PLAYER_META[p.owner].name}の` : `${p.label} の`;
    const cond = p.secret ? '長さはないしょ' : `長さ${p.length}cm・${p.mass}g・ふれはば${p.amplitude}°`;
    const state = p.phase === 'swinging' ? 'ふれている' : p.phase === 'held' ? '持ち上げている。手をはなす' : '持ち上げて手をはなす';
    return `${who}ふりこ（${cond}）：${state}`;
}

/** ふりこの色（A/B はてこの左右の色、プレイヤーはその色） */
export function colorVarOf(p, index = 0) {
    if (p.owner && PLAYER_META[p.owner]) return `--${p.owner}`;
    return ['--glow-left', '--glow-right', '--m20', '--m30'][index % 4];
}

/** 名札：回数を数えているときは数字、10往復したら完了の色 */
function syncTag(node, p) {
    node.tagText.textContent = tagLabel(p);
    const n = cycleCount(p);
    node.tag.classList.toggle('is-counting', n !== null);
    node.tag.classList.toggle('is-complete', n === COUNT);
}

export class PendulumView {
    /**
     * @param {SVGSVGElement} svg
     * @param {{ onBobDrag?:(id:string, amplitude:number, side:number)=>void, onBobRelease?:(id:string)=>void,
     *           onBobTap?:(id:string)=>void, canDrag?:(id:string)=>boolean, onCycle?:(p:object, n:number)=>void,
     *           onFrame?:(dt:number)=>void }} handlers
     */
    constructor(svg, handlers = {}) {
        this.svg = svg;
        this.handlers = handlers;
        this.items = [];
        this.nodes = new Map();
        this.timeScale = 1;
        this.time = 0;
        this.interactive = true;
        this.selectedId = null;
        this.highlight = new Map();
        this.drag = null;
        this.W = 1000;
        this.build();
        this.bind();
        this.watchSize();
        this.loop = this.loop.bind(this);
        this.frame = requestAnimationFrame(this.loop);
    }

    build() {
        const svg = this.svg;
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.innerHTML = `
            <defs>
                <linearGradient id="g-pfloor" gradientUnits="userSpaceOnUse" x1="0" y1="${H - 22}" x2="0" y2="${H + 400}">
                    <stop offset="0" stop-color="#22305a"/><stop offset=".08" stop-color="#151f3d"/><stop offset="1" stop-color="#151f3d" stop-opacity="0"/>
                </linearGradient>
                <linearGradient id="g-pmetal" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stop-color="#8794a6"/><stop offset=".45" stop-color="#cfd6df"/><stop offset="1" stop-color="#7a8698"/>
                </linearGradient>
            </defs>`;
        el('rect', { class: 'stage-floor', x: -3000, y: H - 22, width: 7000, height: 3000 }, svg);
        this.stand = el('g', { class: 'pend-stand' }, svg);
        this.ruler = el('g', { class: 'pend-ruler' }, svg);
        this.layer = el('g', { class: 'pend-items' }, svg);
        this.setViewBox(1000);
    }

    setViewBox(W) {
        this.W = W;
        this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        // 台：横棒と両はしの柱
        this.stand.innerHTML = '';
        const x0 = 96;
        const x1 = W - 14;
        el('rect', { class: 'pend-post', x: x0 - 8, y: PY - 6, width: 16, height: H - 22 - PY + 6 }, this.stand);
        el('rect', { class: 'pend-post', x: x1 - 8, y: PY - 6, width: 16, height: H - 22 - PY + 6 }, this.stand);
        el('rect', { class: 'pend-bar', x: x0 - 20, y: PY - 11, width: x1 - x0 + 40, height: 18, rx: 6 }, this.stand);
        el('path', { class: 'stand-base', d: `M${x0 - 40} ${H - 22} L${x0 - 26} ${H - 40} H${x0 + 26} L${x0 + 40} ${H - 22} Z` }, this.stand);
        el('path', { class: 'stand-base', d: `M${x1 - 40} ${H - 22} L${x1 - 26} ${H - 40} H${x1 + 26} L${x1 + 40} ${H - 22} Z` }, this.stand);
        // ものさし（0〜100cm）
        this.ruler.innerHTML = '';
        el('line', { x1: RULER_X, y1: PY, x2: RULER_X, y2: PY + 100 * SCALE, class: 'pend-ruler-line' }, this.ruler);
        for (let cm = 0; cm <= 100; cm += 5) {
            const y = PY + cm * SCALE;
            const major = cm % 25 === 0;
            el('line', { x1: RULER_X - (major ? 12 : cm % 10 === 0 ? 8 : 4), y1: y, x2: RULER_X, y2: y, class: major ? 'pend-tick-major' : 'pend-tick' }, this.ruler);
            if (major) {
                const t = el('text', { x: RULER_X - 16, y: y + 5, class: 'pend-ruler-text' }, this.ruler);
                t.textContent = cm === 0 ? '0' : `${cm}`;
            }
        }
        const unit = el('text', { x: RULER_X - 16, y: PY + 100 * SCALE + 26, class: 'pend-ruler-text pend-ruler-unit' }, this.ruler);
        unit.textContent = 'cm';
        this.layoutDirty = true;
    }

    watchSize() {
        if (!('ResizeObserver' in window)) return;
        new ResizeObserver(() => {
            const { width, height } = this.svg.getBoundingClientRect();
            if (!width || !height) return;
            // たて長の画面では図を細くして（ふりこどうしを近づけて）、大きく見せる
            const W = Math.max(600, Math.min(1000, Math.round((width / height) * H)));
            this.svg.classList.toggle('is-narrow', width < 560);
            if (W !== this.W) {
                this.setViewBox(W);
                this.layout();
                this.place();
            }
        }).observe(this.svg);
    }

    /** 支点の x 座標をならべる */
    layout() {
        const n = Math.max(1, this.items.length);
        const left = 118;
        const right = this.W - 44;
        const spacing = (right - left) / n;
        this.pivots = this.items.map((_p, i) => left + spacing * (i + 0.5));
        this.layoutDirty = false;
    }

    /**
     * @param {{ pendulums: object[], selectedId?: string|null, interactive?: boolean, highlight?: Map<string,string> }} view
     *   pendulums は engine/pendulum.js の Pendulum。ふれている状態（swing）はこの中で進める（コピーしない）
     */
    render(view) {
        this.items = view.pendulums;
        this.interactive = view.interactive !== false;
        this.selectedId = view.selectedId ?? null;
        this.highlight = view.highlight ?? new Map();
        this.svg.classList.toggle('is-interactive', this.interactive);
        this.layout();
        this.syncNodes();
        this.place();
    }

    syncNodes() {
        const seen = new Set();
        this.items.forEach((p, i) => {
            seen.add(p.id);
            let node = this.nodes.get(p.id);
            if (!node) {
                node = el('g', { class: 'pend', 'data-id': p.id }, this.layer);
                node.guide = el('line', { class: 'pend-guide' }, node);
                node.center = el('line', { class: 'pend-center' }, node);
                node.arc = el('path', { class: 'pend-arc' }, node);
                node.arcText = el('text', { class: 'pend-arc-text' }, node);
                node.rot = el('g', {}, node);
                node.string = el('line', { class: 'string pend-string', x1: 0, y1: 0, x2: 0, y2: 10 }, node.rot);
                node.bob = el('g', { class: 'weight bob', role: 'button', tabindex: 0, 'data-id': p.id }, node.rot);
                node.bobInner = el('g', {}, node.bob);
                node.pivot = el('circle', { class: 'pend-pivot', r: 7, cx: 0, cy: 0 }, node);
                node.tag = el('g', { class: 'pend-tag' }, node);
                node.tagCircle = el('circle', { r: 15, cx: 0, cy: -34 }, node.tag);
                node.tagText = el('text', { x: 0, y: -34 }, node.tag);
                node.lenText = el('text', { class: 'pend-len' }, node);
                this.nodes.set(p.id, node);
            }
            const key = `${p.mass}|${p.owner}`;
            if (node.key !== key) {
                node.bobInner.innerHTML = weightShape({ id: p.id, mass: p.mass, owner: p.owner });
                el('rect', { class: 'w-hit', x: -34, y: -8, width: 68, height: heightOf(p.mass) + 16 }, node.bobInner);
                node.key = key;
            }
            const state = this.highlight.get(p.id);
            node.setAttribute('class', [
                'pend', p.phase === 'held' ? 'is-held' : '', p.phase === 'swinging' ? 'is-swinging' : '',
                p.id === this.selectedId ? 'is-selected' : '', state ? `is-${state}` : '',
            ].filter(Boolean).join(' '));
            node.style.setProperty('--pc', `var(${colorVarOf(p, i)})`);
            node.bob.setAttribute('class', `weight bob ${toneOf({ mass: p.mass, owner: p.owner })}${this.canDrag(p.id) ? ' is-movable' : ''}`);
            node.bob.setAttribute('aria-label', pendulumAria(p));
            node.bob.setAttribute('tabindex', this.interactive ? '0' : '-1');
            syncTag(node, p);
            node.lenText.textContent = p.secret ? '？' : `${p.length}${CONDITION_META.length.unit}`;
            node.classList.toggle('is-secret', Boolean(p.secret));
        });
        for (const [id, node] of this.nodes) {
            if (!seen.has(id)) {
                node.remove();
                this.nodes.delete(id);
            }
        }
    }

    canDrag(id) {
        return this.interactive && (this.handlers.canDrag?.(id) ?? true);
    }

    /** 角度に合わせて、糸・おもり・ラベルを置く */
    place() {
        if (this.layoutDirty) this.layout();
        this.items.forEach((p, i) => {
            const node = this.nodes.get(p.id);
            if (!node) return;
            const px = this.pivots[i];
            const a = angleOf(p);
            const L = p.length * SCALE;
            const { h } = sizeOf(p.mass);
            const top = L - (LOOP + h / 2); // 輪っかの上端まで（長さは おもりの中心まで）
            node.setAttribute('transform', `translate(${px.toFixed(2)} ${PY})`);
            // SVG の rotate は時計回りが正なので、右（プラス）へふるには符号を反転する
            node.rot.setAttribute('transform', `rotate(${(-a).toFixed(3)})`);
            node.string.setAttribute('y2', top.toFixed(2));
            node.bob.setAttribute('transform', `translate(0 ${top.toFixed(2)})`);
            const still = p.phase === 'rest' || p.phase === 'held';
            // 長さ（糸のまん中）
            const rad = (a * Math.PI) / 180;
            const mx = (L / 2) * Math.sin(rad);
            const my = (L / 2) * Math.cos(rad);
            node.lenText.setAttribute('x', (mx + 12).toFixed(1));
            node.lenText.setAttribute('y', (my + 5).toFixed(1));
            node.lenText.style.display = still ? '' : 'none';
            // ものさしへの案内線（まっすぐ下がっているときだけ）
            node.guide.style.display = p.phase === 'rest' && !p.secret ? '' : 'none';
            node.guide.setAttribute('x1', (RULER_X - px).toFixed(1));
            node.guide.setAttribute('x2', 0);
            node.guide.setAttribute('y1', L.toFixed(1));
            node.guide.setAttribute('y2', L.toFixed(1));
            // ふれはば：中心線と角度の弧
            const showArc = p.phase === 'held' || (p.phase === 'swinging' && this.drag?.id === p.id);
            node.center.style.display = showArc ? '' : 'none';
            node.center.setAttribute('y2', L.toFixed(1));
            node.arc.style.display = showArc ? '' : 'none';
            node.arcText.style.display = showArc ? '' : 'none';
            if (showArc) {
                const ex = ARC_R * Math.sin(rad);
                const ey = ARC_R * Math.cos(rad);
                node.arc.setAttribute('d', `M0 ${ARC_R} A${ARC_R} ${ARC_R} 0 0 ${a > 0 ? 0 : 1} ${ex.toFixed(1)} ${ey.toFixed(1)}`);
                const tx = (ARC_R + 22) * Math.sin(rad / 2);
                const ty = (ARC_R + 22) * Math.cos(rad / 2);
                node.arcText.setAttribute('x', tx.toFixed(1));
                node.arcText.setAttribute('y', (ty + 5).toFixed(1));
                node.arcText.textContent = `${p.amplitude}°`;
            }
        });
    }

    /* ---------- ループ ---------- */

    isVisible() {
        return this.svg.isConnected && !this.svg.hasAttribute('hidden') && !document.hidden;
    }

    loop(now = performance.now()) {
        this.frame = requestAnimationFrame(this.loop);
        const dt = Math.min(0.1, (now - (this.lastFrame ?? now)) / 1000) || 1 / 60;
        this.lastFrame = now;
        if (!this.isVisible()) return;
        this.advance(dt);
    }

    /** ふれているふりこを進める（2D・3D で同じ） */
    advance(dt) {
        const step = dt * this.timeScale;
        this.time += step;
        let moving = false;
        for (const p of this.items) {
            if (p.phase !== 'swinging' || !p.swing) continue;
            moving = true;
            const done = stepSwing(p.swing, p, step);
            if (done) {
                const node = this.nodes.get(p.id);
                if (node) syncTag(node, p);
                this.handlers.onCycle?.(p, p.swing.cycles);
            }
        }
        if (moving || this.drag) this.place();
        this.handlers.onFrame?.(step);
    }

    /* ---------- 入力 ---------- */

    bind() {
        this.onPointerDown = this.onPointerDown.bind(this);
        this.onPointerMove = this.onPointerMove.bind(this);
        this.onPointerUp = this.onPointerUp.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.svg.addEventListener('pointerdown', this.onPointerDown);
        this.svg.addEventListener('keydown', this.onKeyDown);
    }

    destroy() {
        cancelAnimationFrame(this.frame);
        this.cancelDrag();
        this.svg.removeEventListener('pointerdown', this.onPointerDown);
        this.svg.removeEventListener('keydown', this.onKeyDown);
    }

    toSvgPoint(clientX, clientY) {
        const pt = this.svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const ctm = this.svg.getScreenCTM();
        return ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
    }

    /** 指の位置から、支点を中心にした角度（度。右がプラス） */
    angleAt(id, clientX, clientY) {
        const i = this.items.findIndex(p => p.id === id);
        if (i < 0) return 0;
        const { x, y } = this.toSvgPoint(clientX, clientY);
        const dx = x - this.pivots[i];
        const dy = Math.max(20, y - PY);
        return (Math.atan2(dx, dy) * 180) / Math.PI;
    }

    onPointerDown(e) {
        if (!this.interactive || e.button > 0 || this.drag) return;
        const id = e.target.closest?.('.bob')?.dataset.id ?? null;
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
        // 動かし方：'swing'＝横に持ち上げる、'length'＝上下で長さ、'auto'＝最初に動いた向きで決める
        const want = this.handlers.dragMode?.(p.id) ?? 'swing';
        const vertical = Math.abs(e.clientY - p.y) > Math.abs(e.clientX - p.x);
        const mode = want === 'auto' ? (vertical ? 'length' : 'swing') : want;
        this.drag = { id: p.id, mode };
        this.svg.classList.add('is-dragging');
        this.handlers.onDragStart?.(p.id);
        this.dragTo(e.clientX, e.clientY);
    }

    dragTo(clientX, clientY) {
        if (this.drag.mode === 'length') {
            // おもりの中心が指の高さに来る長さ（ものさしの目盛りと同じ）
            const { y } = this.toSvgPoint(clientX, clientY);
            this.handlers.onBobLength?.(this.drag.id, (y - PY) / SCALE);
            return;
        }
        const a = this.angleAt(this.drag.id, clientX, clientY);
        const side = a < 0 ? -1 : 1;
        this.handlers.onBobDrag?.(this.drag.id, snapAmplitude(a), side);
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
            this.svg.classList.remove('is-dragging');
            if (e.type === 'pointercancel') this.handlers.onDragCancel?.(id);
            else if (mode === 'length') this.handlers.onLengthEnd?.(id);
            else this.handlers.onBobRelease?.(id);
            return;
        }
        if (!p || e.type === 'pointercancel') return;
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) return;
        this.handlers.onBobTap?.(p.id);
    }

    onKeyDown(e) {
        const bob = e.target.closest?.('.bob');
        if (!bob) return;
        const id = bob.dataset.id;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.handlers.onBobTap?.(id);
        } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.canDrag(id) && (this.handlers.dragMode?.(id) ?? 'swing') !== 'swing') {
            // 上下の矢印で長さ
            e.preventDefault();
            const p = this.items.find(q => q.id === id);
            this.handlers.onBobLength?.(id, p.length + (e.key === 'ArrowDown' ? 1 : -1), { step: true });
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            // 矢印でふれはばを変える（持ち上げる）
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
        this.svg.classList.remove('is-dragging');
        this.handlers.onDragCancel?.(id);
    }

    focusBob(id) {
        this.nodes.get(id)?.bob.focus();
    }

    /** 3D 版の演出 API と同じ形（図では、おもりを一瞬光らせるだけ） */
    fx(kind, { id } = {}) {
        if (kind === 'count' || kind === 'done') {
            const node = this.nodes.get(id);
            if (!node) return;
            node.bob.classList.remove('is-pulse');
            void node.bob.getBBox?.();
            node.bob.classList.add('is-pulse');
        }
    }

    setDanger() {}

    /** モードを切りかえるとき、前のモードの状態を消す */
    reset() {
        this.cancelDrag();
        this.timeScale = 1;
        this.highlight = new Map();
        this.selectedId = null;
    }
}
