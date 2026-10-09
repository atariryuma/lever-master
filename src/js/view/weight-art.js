/**
 * おもりの絵（SVG）。てこの上・トレイ・ドラッグ中のゴーストで共通に使う
 */

import { PLAYER_META } from '../players.js';

const SIZES = {
    10: { w: 36, h: 30 },
    20: { w: 42, h: 38 },
    30: { w: 48, h: 46 },
};

export const LOOP = 8; // 上の輪っかの高さ
export const sizeOf = mass => SIZES[mass] ?? SIZES[10];
export const heightOf = mass => LOOP + sizeOf(mass).h;

/** 色の種類を決めるクラス */
export function toneOf(weight) {
    if (weight.locked) return 'w-locked';
    if (weight.owner === 'neutral') return 'w-neutral';
    if (weight.owner && PLAYER_META[weight.owner]) return `w-${weight.owner}`;
    return `w-m${weight.mass}`;
}

function labelOf(weight) {
    if (weight.owner && PLAYER_META[weight.owner]) return PLAYER_META[weight.owner].symbol;
    return `${weight.mass}g`;
}

/** (0,0) を輪っかの上端とするおもりの図形 */
export function weightShape(weight) {
    const { w, h } = sizeOf(weight.mass);
    const isSymbol = weight.owner && PLAYER_META[weight.owner];
    const fontSize = isSymbol ? 18 : weight.mass >= 30 ? 16 : 14;
    return `
        <circle class="w-loop" cx="0" cy="${LOOP / 2}" r="${LOOP / 2 - 0.5}" />
        <rect class="w-body" x="${-w / 2}" y="${LOOP}" width="${w}" height="${h}" rx="7" />
        <rect class="w-shine" x="${-w / 2 + 5}" y="${LOOP + 4}" width="${w - 10}" height="${Math.max(4, h * 0.18)}" rx="3" />
        <text class="w-label" x="0" y="${LOOP + h / 2 + 1}" font-size="${fontSize}">${labelOf(weight)}</text>`;
}

/** 単体の <svg>（トレイやゴースト用） */
export function weightIcon(weight, scale = 1) {
    const { w } = sizeOf(weight.mass);
    const vw = 52;
    const vh = heightOf(30) + 4;
    return `<svg class="weight-icon" viewBox="${-vw / 2} -2 ${vw} ${vh}" width="${vw * scale}" height="${vh * scale}" aria-hidden="true" data-w="${w}">
        <g class="weight ${toneOf(weight)}">${weightShape(weight)}</g></svg>`;
}
