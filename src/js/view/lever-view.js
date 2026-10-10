/**
 * 実験用てこの SVG ビュー
 *
 * - うでの傾きはバネのアニメーション（左右のはたらきの差に応じて傾く）
 * - 「ささえ」で手でおさえている状態を表現（はなすと結果がわかる）
 * - タップ／ドラッグ／キーボードで、位置やおもりを選べる
 */

import { POSITIONS, chainOf, findWeight, momentOf, positionLabel } from '../engine/lever.js';
import { PLAYER_META } from '../players.js';
import { ghostIcon, heightOf, toneOf, weightShape } from './weight-art.js';
import { setDropZone } from '../widgets.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 1000;
const H = 560;
const PX = 500; // 支点
const PY = 130;
const UNIT = 72; // 目盛り1つ分のきょり
const BEAM_HALF = 462;
const ATTACH_Y = PY + 22; // フックの下端（うでのローカル座標）
const STRING = 16;
const GAP = 2;
const MAX_TILT = 10; // 度
const TILT_SCALE = 50;

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const el = (tag, attrs = {}, parent) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent?.appendChild(node);
    return node;
};

export function tiltFor(diff) {
    return -Math.tanh(diff / TILT_SCALE) * MAX_TILT;
}

/**
 * うでの動き（2D・3D 共通）。少しやわらかいバネで、目標の角度のまわりを何回かゆれてから止まる。
 * k は 60fps を 1 とした経過フレーム数
 */
const STIFF = 0.022;
const DAMP = 0.955;
export function stepSpring(s, k = 1) {
    const delta = s.target - s.angle;
    s.velocity = (s.velocity + delta * STIFF * k) * Math.pow(DAMP, k);
    s.angle += s.velocity * k;
    return Math.abs(delta) > 0.01 || Math.abs(s.velocity) > 0.01;
}

/**
 * つるす・動かす・はずすときの「反動」（度/フレーム）。
 * はたらきの変化が大きいほど強くゆれる。つり合う形になっても、いったん大きくゆれてから静まる
 */
export function kickFor(prevBoard, nextBoard) {
    if (!prevBoard || !nextBoard) return 0;
    const change = momentOf(nextBoard).diff - momentOf(prevBoard).diff;
    return Math.max(-0.9, Math.min(0.9, -change * 0.005));
}

/** 静まった（ほぼ動いていない） */
export const isCalm = s => Math.abs(s.target - s.angle) < 0.12 && Math.abs(s.velocity) < 0.02;

function weightAria(weight, pos) {
    const owner = weight.owner && PLAYER_META[weight.owner]
        ? `${PLAYER_META[weight.owner].name}の`
        : weight.owner === 'neutral' ? 'はじめからある' : '';
    return `${owner}${weight.mass}gのおもり（${positionLabel(pos)}）`;
}

export class LeverView {
    /**
     * @param {SVGSVGElement} svg
     * @param {{ onHookTap?:(pos:number)=>void, onWeightTap?:(id:string,pos:number)=>void,
     *           onDrop?:(source:object,pos:number|null)=>void, onHover?:(pos:number|null)=>void,
     *           canDrag?:(id:string)=>boolean }} handlers
     */
    constructor(svg, handlers = {}) {
        this.svg = svg;
        this.handlers = handlers;
        this.angle = 0;
        this.velocity = 0;
        this.target = 0;
        this.held = null;
        this.weightNodes = new Map();
        this.settleResolvers = [];
        this.drag = null;
        this.wscale = 1; // せまい画面では、おもりを大きく描く
        this.build();
        this.bind();
        this.watchSize();
        this.loop = this.loop.bind(this);
        this.frame = requestAnimationFrame(this.loop);
    }

    build() {
        const svg = this.svg;
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.innerHTML = `
            <defs>
                <linearGradient id="g-wood" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#e2b578"/><stop offset=".55" stop-color="#c98f4c"/><stop offset="1" stop-color="#a86f34"/>
                </linearGradient>
                <linearGradient id="g-floor" gradientUnits="userSpaceOnUse" x1="0" y1="${H - 22}" x2="0" y2="${H + 400}">
                    <stop offset="0" stop-color="#22305a"/><stop offset=".08" stop-color="#151f3d"/><stop offset="1" stop-color="#151f3d" stop-opacity="0"/>
                </linearGradient>
                <linearGradient id="g-metal" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stop-color="#8794a6"/><stop offset=".45" stop-color="#cfd6df"/><stop offset="1" stop-color="#7a8698"/>
                </linearGradient>
            </defs>`;
        // 床は画面のはしまでのばす（svg は overflow: visible）
        el('rect', { class: 'stage-floor', x: -3000, y: H - 22, width: W + 6000, height: 3000 }, svg);

        this.columns = el('g', { class: 'columns' }, svg);
        this.columnNodes = new Map();
        for (const pos of POSITIONS) {
            const x = PX + pos * UNIT;
            const col = el('g', { class: 'column' }, this.columns);
            el('rect', { class: 'column-rect', x: x - UNIT / 2 + 3, y: 24, width: UNIT - 6, height: H - 50, rx: 14 }, col);
            col.mark = el('text', { class: 'column-mark', x, y: H - 40 }, col);
            col.mark.textContent = '✓';
            // となりなどルールで置けない場所
            col.cross = el('text', { class: 'column-x', x, y: H - 78 }, col);
            col.cross.textContent = '✕';
            col.crossLabel = el('text', { class: 'column-x-label', x, y: H - 56 }, col);
            col.crossLabel.textContent = 'となり';
            this.columnNodes.set(pos, col);
        }

        // 台
        const stand = el('g', { class: 'stand' }, svg);
        el('rect', { class: 'stand-post', x: PX - 9, y: PY, width: 18, height: H - 40 - PY }, stand);
        el('path', { class: 'stand-base', d: `M${PX - 90} ${H - 22} L${PX - 60} ${H - 44} H${PX + 60} L${PX + 90} ${H - 22} Z` }, stand);
        el('text', { class: 'stand-label', x: PX, y: H - 54 }, stand).textContent = '支点';

        // 目盛り板（うでといっしょに動く針がさす）
        const gauge = el('g', { class: 'gauge' }, svg);
        const polar = (deg, r) => {
            const a = (deg - 90) * Math.PI / 180;
            return [PX + r * Math.cos(a), PY + r * Math.sin(a)];
        };
        const R = 76;
        const SPAN = 24;
        const [ax, ay] = polar(-SPAN, R);
        const [bx, by] = polar(SPAN, R);
        el('path', { class: 'gauge-plate', d: `M${PX} ${PY} L${ax} ${ay} A${R} ${R} 0 0 1 ${bx} ${by} Z` }, gauge);
        for (let d = -20; d <= 20; d += 5) {
            const [x1, y1] = polar(d, R - 4);
            const [x2, y2] = polar(d, d === 0 ? R - 22 : R - 12);
            el('line', { class: d === 0 ? 'gauge-zero' : 'gauge-tick', x1, y1, x2, y2 }, gauge);
        }

        // ささえ（手でおさえている）
        this.stoppers = el('g', { class: 'stoppers' }, svg);
        for (const sx of [PX - BEAM_HALF + 12, PX + BEAM_HALF - 12]) {
            el('rect', { class: 'stopper', x: sx - 9, y: PY + 11, width: 18, height: H - 33 - PY - 11, rx: 4 }, this.stoppers);
            el('rect', { class: 'stopper-cap', x: sx - 16, y: PY + 11, width: 32, height: 10, rx: 3 }, this.stoppers);
        }

        // うで
        this.beam = el('g', { class: 'beam' }, svg);
        el('rect', { class: 'beam-bar', x: PX - BEAM_HALF, y: PY - 11, width: BEAM_HALF * 2, height: 22, rx: 11 }, this.beam);
        el('line', { class: 'needle', x1: PX, y1: PY, x2: PX, y2: PY - 66 }, this.beam);
        for (const pos of POSITIONS) {
            const x = PX + pos * UNIT;
            el('rect', { class: 'beam-mark', x: x - 1.5, y: PY - 11, width: 3, height: 22 }, this.beam);
            el('path', { class: 'hook', 'data-pos': pos, d: `M${x} ${PY + 11} v5 a5 5 0 1 0 5 5` }, this.beam);
            el('text', { class: 'beam-num', x, y: PY - 20 }, this.beam).textContent = Math.abs(pos);
        }
        this.rulers = el('g', { class: 'rulers' }, this.beam);
        el('circle', { class: 'pivot', cx: PX, cy: PY, r: 9 }, this.beam);

        // キーボード・スクリーンリーダー用の位置ボタン（透明・ポインターは素通し）
        this.targets = el('g', { class: 'targets' }, svg);
        this.targetNodes = new Map();
        for (const pos of POSITIONS) {
            const t = el('rect', {
                class: 'target', x: PX + pos * UNIT - UNIT / 2, y: 0, width: UNIT, height: H,
                tabindex: 0, role: 'button', 'data-pos': pos, 'aria-label': `${positionLabel(pos)}（支点からのきょり ${Math.abs(pos)}）`,
            }, this.targets);
            this.targetNodes.set(pos, t);
        }

        this.strings = el('g', { class: 'strings' }, svg);
        this.weights = el('g', { class: 'weights' }, svg);
    }

    /**
     * 図はよこ長（1000×560）なので、スマホのたて向きでは全体が小さくなる。
     * せまいときは、おもり・数字を大きくして見やすくする
     */
    watchSize() {
        if (!('ResizeObserver' in window)) return;
        new ResizeObserver(() => {
            const { width, height } = this.svg.getBoundingClientRect();
            if (!width) return;
            this.box = { width, height };
            this.fitViewBox();
            const scale = width < 460 ? 1.45 : width < 640 ? 1.25 : 1;
            this.svg.classList.toggle('is-narrow', scale > 1);
            if (scale !== this.wscale) {
                this.wscale = scale;
                this.place();
            }
        }).observe(this.svg);
    }

    /**
     * よこに長い画面（スマホ横向きなど）では、図の下（支点の台・床）を切って、てこを大きく見せる。
     * いちばん長くぶら下がったおもりは、切らずに見せる
     */
    fitViewBox() {
        if (!this.box?.height) return;
        const top = 30;
        const want = W * this.box.height / this.box.width;
        const need = (this.deepest ?? ATTACH_Y + 60) + 40 - top;
        const height = want >= H ? H : Math.min(H - top, Math.max(300, need, want));
        const y = height >= H ? 0 : top;
        const key = `${y} ${height}`;
        if (key === this.viewKey) return;
        this.viewKey = key;
        this.svg.setAttribute('viewBox', `0 ${y} ${W} ${height}`);
        // 下に出す ✓ と ✕ は、見えている範囲の下のほうへ
        const bottom = y + height;
        for (const col of this.columnNodes.values()) {
            col.mark.setAttribute('y', bottom - 40);
            col.cross.setAttribute('y', bottom - 78);
            col.crossLabel.setAttribute('y', bottom - 56);
        }
    }

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

    /**
     * @param {{ board: object, held?: boolean, selectedId?: string|null,
     *           targets?: Map<number,string>, newIds?: Set<string>, hover?: number|null,
     *           interactive?: boolean, chainMoves?: boolean }} view
     *   chainMoves … おもりをつかむと、その下のおもりもいっしょに動く（たいせん）
     */
    render(view) {
        if (this.held === false && view.held === false && !this.noKick && !reduceMotion()) {
            this.velocity += kickFor(this.board, view.board);
        }
        this.noKick = false;
        this.board = view.board;
        this.chainMoves = Boolean(view.chainMoves);
        this.interactive = view.interactive !== false;
        this.svg.classList.toggle('is-interactive', this.interactive);
        this.setHeld(Boolean(view.held));
        this.selectedId = view.selectedId ?? null;
        this.selectedGroup = new Set(this.groupIds(this.selectedId));
        this.targetStates = view.targets ?? new Map();
        this.renderColumns(view.hover ?? null);
        this.renderWeights(view.newIds ?? new Set());
        this.renderRulers();
        this.updateTarget();
        this.place();
    }

    /** いっしょに動くおもりの id（つかんだおもりが先頭） */
    groupIds(id) {
        if (!id) return [];
        // 画面側が「実際にいっしょに動くおもり」を知っているときはそれを使う（たいせんの動かしなおしなど）
        const custom = this.handlers.dragGroup?.(id);
        if (custom) return custom;
        return this.chainMoves && this.board ? chainOf(this.board, id).map(w => w.id) : [id];
    }

    renderColumns(hover) {
        this.hover = hover;
        for (const pos of POSITIONS) {
            const state = this.targetStates.get(pos);
            const col = this.columnNodes.get(pos);
            col.setAttribute('class', `column${state ? ` is-${state}` : ''}${hover === pos ? ' is-hover' : ''}`);
            const t = this.targetNodes.get(pos);
            t.setAttribute('aria-disabled', String(!this.interactive || state === 'blocked'));
        }
    }

    /** 図：支点からのきょりを、ものさしのように示す（うでといっしょに傾く） */
    renderRulers() {
        let html = '';
        for (const side of [-1, 1]) {
            const used = POSITIONS.filter(p => Math.sign(p) === side && this.board[p].length)
                .sort((a, b) => Math.abs(a) - Math.abs(b));
            used.forEach((pos, k) => {
                const y = PY - 44 - k * 16;
                const x0 = PX + side * 40;
                const x1 = PX + pos * UNIT;
                const mid = (x0 + x1) / 2;
                html += `<g class="ruler ruler-${side < 0 ? 'left' : 'right'}">
                    <line x1="${PX}" y1="${y}" x2="${x1}" y2="${y}"/>
                    <line x1="${x1}" y1="${y - 5}" x2="${x1}" y2="${y + 5}"/>
                    <line x1="${x1}" y1="${y + 5}" x2="${x1}" y2="${PY - 11}" class="ruler-drop"/>
                    <text x="${mid}" y="${y - 5}">きょり ${Math.abs(pos)}</text>
                </g>`;
            });
        }
        this.rulers.innerHTML = html;
    }

    setHover(pos) {
        if (pos === this.hover) return;
        this.renderColumns(pos);
        this.handlers.onHover?.(pos);
    }

    renderWeights(newIds) {
        const seen = new Set();
        for (const pos of POSITIONS) {
            for (const weight of this.board[pos]) {
                seen.add(weight.id);
                let node = this.weightNodes.get(weight.id);
                if (!node) {
                    node = el('g', { 'data-id': weight.id }, this.weights);
                    node.inner = el('g', {}, node);
                    this.weightNodes.set(weight.id, node);
                }
                const key = `${weight.mass}|${weight.owner}|${weight.locked}`;
                if (node.key !== key) {
                    node.inner.innerHTML = weightShape(weight);
                    el('rect', { class: 'w-hit', x: -30, y: -6, width: 60, height: heightOf(weight.mass) + 12 }, node.inner);
                    node.key = key;
                }
                const movable = this.interactive && !weight.locked && (this.handlers.canDrag?.(weight.id) ?? false);
                node.setAttribute('class', [
                    'weight', toneOf(weight),
                    this.selectedGroup.has(weight.id) ? 'is-selected' : '',
                    movable ? 'is-movable' : '',
                    this.drag?.ids.includes(weight.id) ? 'is-dragging' : '',
                ].join(' '));
                node.setAttribute('aria-label', weightAria(weight, pos));
                if (movable) {
                    node.setAttribute('tabindex', '0');
                    node.setAttribute('role', 'button');
                } else {
                    node.removeAttribute('tabindex');
                    node.removeAttribute('role');
                }
                if (newIds.has(weight.id) && !reduceMotion()) {
                    node.inner.classList.remove('drop-in');
                    void node.inner.getBBox?.();
                    node.inner.classList.add('drop-in');
                }
            }
        }
        for (const [id, node] of this.weightNodes) {
            if (!seen.has(id)) {
                node.remove();
                this.weightNodes.delete(id);
            }
        }
    }

    setHeld(held) {
        if (held === this.held) return;
        this.held = held;
        this.stoppers.classList.toggle('is-released', !held);
        this.updateTarget();
    }

    updateTarget() {
        if (!this.board) return;
        this.target = this.held ? 0 : tiltFor(momentOf(this.board).diff);
        if (reduceMotion()) {
            this.angle = this.target;
            this.velocity = 0;
        }
    }

    /** 手をはなしていて、うでが静まっている */
    isCalm() {
        return Boolean(this.board) && this.held === false && isCalm(this);
    }

    /** 傾きが落ち着くまで待つ */
    settle() {
        return new Promise(resolve => this.settleResolvers.push(resolve));
    }

    loop(now = performance.now()) {
        this.frame = requestAnimationFrame(this.loop);
        // 経過時間で進める（遅い端末でも、ゆれ方の速さは同じ）
        const k = Math.min(6, (now - (this.lastFrame ?? now)) / (1000 / 60)) || 1;
        this.lastFrame = now;
        if (stepSpring(this, k)) {
            this.place();
        } else if (this.settleResolvers.length) {
            this.angle = this.target;
            this.place();
            this.settleResolvers.splice(0).forEach(r => r());
        }
    }

    attachPoint(pos) {
        const rad = this.angle * Math.PI / 180;
        const lx = pos * UNIT;
        const ly = ATTACH_Y - PY;
        return {
            x: PX + lx * Math.cos(rad) - ly * Math.sin(rad),
            y: PY + lx * Math.sin(rad) + ly * Math.cos(rad),
        };
    }

    /** うでの角度にあわせて、おもりとひもを配置 */
    place() {
        this.beam.setAttribute('transform', `rotate(${this.angle.toFixed(3)} ${PX} ${PY})`);
        if (!this.board) return;
        let strings = '';
        for (const pos of POSITIONS) {
            const stack = this.board[pos];
            if (!stack.length) continue;
            const { x, y } = this.attachPoint(pos);
            let top = y + STRING;
            let lastTop = top;
            for (const weight of stack) {
                const node = this.weightNodes.get(weight.id);
                const s = this.wscale;
                node?.setAttribute('transform', `translate(${x.toFixed(2)} ${top.toFixed(2)})${s !== 1 ? ` scale(${s})` : ''}`);
                lastTop = top;
                top += (heightOf(weight.mass) + GAP) * s;
            }
            strings += `M${x.toFixed(2)} ${y.toFixed(2)} V${(lastTop + 4).toFixed(2)} `;
        }
        if (!this.stringPath) this.stringPath = el('path', { class: 'string' }, this.strings);
        this.stringPath.setAttribute('d', strings);
        // いちばん下のおもりの位置（図を切りすぎないように）
        const deepest = Math.max(ATTACH_Y + 60, ...POSITIONS.map(pos => this.board[pos].reduce(
            (y, w) => y + (heightOf(w.mass) + GAP) * this.wscale, ATTACH_Y + STRING)));
        if (deepest !== this.deepest) {
            this.deepest = deepest;
            this.fitViewBox();
        }
    }

    /* ---------- 入力 ---------- */

    toSvgPoint(clientX, clientY) {
        const pt = this.svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const ctm = this.svg.getScreenCTM();
        return ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
    }

    /** 画面座標から一番近い位置（範囲外なら null） */
    positionAt(clientX, clientY) {
        const rect = this.svg.getBoundingClientRect();
        const pad = 24;
        if (clientX < rect.left - pad || clientX > rect.right + pad
            || clientY < rect.top - pad || clientY > rect.bottom + pad) return null;
        const { x } = this.toSvgPoint(clientX, clientY);
        const n = Math.round((x - PX) / UNIT);
        if (n === 0) return x < PX ? -1 : 1;
        return POSITIONS.includes(n) ? n : null;
    }

    onPointerDown(e) {
        if (!this.interactive || e.button > 0 || this.drag) return;
        const weightNode = e.target.closest?.('.weight');
        const id = weightNode?.dataset.id ?? null;
        this.press = { x: e.clientX, y: e.clientY, id, pointerId: e.pointerId };
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
        if (!(this.handlers.canDrag?.(p.id))) return;
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
        const target = e.target;
        if (target.classList?.contains('target')) {
            const pos = Number(target.dataset.pos);
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.handlers.onHookTap?.(pos);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const i = POSITIONS.indexOf(pos) + (e.key === 'ArrowLeft' ? -1 : 1);
                this.targetNodes.get(POSITIONS[Math.max(0, Math.min(POSITIONS.length - 1, i))])?.focus();
            }
        } else if (target.classList?.contains('weight') && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            const found = findWeight(this.board, target.dataset.id);
            if (found) this.handlers.onWeightTap?.(target.dataset.id, found.pos);
        }
    }

    /** 3D 版の演出 API と同じ形（2D では画面側のエフェクトだけにする） */
    fx() {}

    setDanger() {}

    focusPosition(pos) {
        this.targetNodes.get(pos)?.focus();
    }

    /**
     * ドラッグ開始（トレイからの新しいおもりにも使う）
     * @param {{kind:'weight'|'new', id?:string, weight:object}} source
     */
    startDrag(source, e) {
        if (this.drag) return;
        const scale = this.svg.getBoundingClientRect().width / W;
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        const ids = source.kind === 'weight' ? this.groupIds(source.id) : [];
        const weights = ids.length ? ids.map(id => findWeight(this.board, id).weight) : [source.weight];
        ghost.innerHTML = ghostIcon(weights, Math.max(0.6, scale) * 1.08);
        document.body.appendChild(ghost);
        this.drag = { source, ghost, ids };
        setDropZone(source.kind === 'weight' ? this.handlers.dropLabel?.(source.id) ?? null : null);
        this.handlers.onDragStart?.(source);
        for (const id of ids) this.weightNodes.get(id)?.classList.add('is-dragging');
        if (source.kind === 'new') {
            window.addEventListener('pointermove', this.onPointerMove);
            window.addEventListener('pointerup', this.onPointerUp);
            window.addEventListener('pointercancel', this.onPointerUp);
        }
        this.moveGhost(e.clientX, e.clientY);
        this.setHover(this.positionAt(e.clientX, e.clientY));
    }

    moveGhost(x, y) {
        const g = this.drag?.ghost;
        if (!g) return;
        g.style.transform = `translate(${x}px, ${y}px)`;
    }

    /** うでをすぐに水平にする */
    level() {
        this.target = 0;
        this.angle = 0;
        this.velocity = 0;
        this.place();
    }

    /** 次の描画では反動をつけない（別の画面・別の表示から来たとき、前の盤面とくらべないように） */
    skipKick() {
        this.noKick = true;
    }

    /** モードを切りかえるとき、前のモードの状態を消す */
    reset() {
        this.held = null;
        this.skipKick();
        this.cancelDrag();
        this.target = 0;
        this.angle = 0;
        this.velocity = 0;
        this.settleResolvers?.splice(0).forEach(r => r());
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
        this.handlers.onDragEnd?.();
        this.press = null;
        for (const id of ids) this.weightNodes.get(id)?.classList.remove('is-dragging');
        this.setHover(null);
    }

    endDrag(pos) {
        if (!this.drag) return;
        const { source, ghost, ids } = this.drag;
        ghost.remove();
        this.drag = null;
        setDropZone(null);
        this.handlers.onDragEnd?.();
        this.press = null;
        for (const id of ids) this.weightNodes.get(id)?.classList.remove('is-dragging');
        this.setHover(null);
        this.handlers.onDrop?.(source, pos);
    }
}
