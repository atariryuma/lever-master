/**
 * スモークテスト
 * バンドル済みのアプリ（GAS版と同じ IIFE）を jsdom 上で読み込み、
 * 起動と各画面への移動でエラーが出ないことを確認する。
 * jsdom には WebGL が無いので、2D（SVG）表示へのフォールバックも同時に確認できる。
 *
 * @vitest-environment node
 *
 * ⚠️ node 環境で動かし、JSDOM は手動で組む。
 * vitest 既定の jsdom 環境では esbuild が必要とする TextEncoder の不変条件が壊れるため。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, bundleToIife } from '../scripts/bundle.mjs';

function installBrowserStubs(window) {
    // jsdom に無い API
    window.structuredClone = structuredClone;
    window.CSS ??= { escape: s => String(s).replace(/["\\]/g, '\\$&') };
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    window.HTMLCanvasElement.prototype.getContext = () => null; // WebGL なし → 2D 表示
    window.HTMLDialogElement.prototype.showModal = function() {
        this.open = true;
    };
    window.HTMLDialogElement.prototype.close = function() {
        this.open = false;
        this.dispatchEvent(new window.Event('close'));
    };
}

describe('アプリのロード', () => {
    const errors = [];
    let window;
    let tourOpened = false;

    beforeAll(async () => {
        const bundle = await bundleToIife('src/js/main.js');
        const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
        ({ window } = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/' }));
        installBrowserStubs(window);
        window.addEventListener('error', e => errors.push(`window.error: ${e.message}`));
        window.addEventListener('unhandledrejection', e => errors.push(`unhandledrejection: ${e.reason?.message ?? e.reason}`));
        window.console.warn = () => {};

        const run = (label, fn) => {
            try {
                fn();
            } catch (e) {
                errors.push(`${label}: ${e.message}`);
            }
        };
        const click = sel => window.document.querySelector(sel).click();

        run('load', () => window.eval(bundle));
        run('lab', () => {
            click('[data-go="lab"]');
            click('[data-tray="m20"]');
            leverState = {
                hidden: window.document.querySelector('#lever').hasAttribute('hidden'),
                hooks: window.document.querySelectorAll('#lever .hook').length,
            };
            click('[data-action="back"]');
        });
        run('puzzles', () => {
            click('[data-go="puzzles"]');
            click('.puzzle-card[data-id="1"]');
            click('[data-act="hint"]');
            click('[data-action="back"]');
        });
        run('battle', () => {
            click('[data-go="home"]');
            click('[data-go="setup"]');
            click('#btn-start');
            // はじめての対戦では「あそびかた」が開く → 最後のページまで進めて閉じる
            tourOpened = window.document.getElementById('dlg-rules').open;
            for (let i = 0; i < 4; i++) click('#dlg-rules [data-tour="next"]');
        });
        // たいせんは BATTLE! の演出（約1.7秒）と TURN の帯（約1秒）のあと最初のターンへ進む。そこまで待つ
        await new Promise(r => setTimeout(r, 4000));
        battleState = {
            turn: window.document.querySelector('#players .pchip.is-turn') !== null,
            sub: window.document.querySelector('#play-sub').textContent,
        };
        // ---- ふりこ（5年）----
        run('pend-lab', () => {
            click('[data-action="back"]');
            click('#unit-switch [data-value="pendulum"]');
            click('[data-go="pend-lab"]');
            click('#lab-var [data-value="mass"]');
            click('#dock [data-act="go"]');
        });
        pendLab = {
            logo: window.document.querySelector('.logo-en').textContent,
            bobs: window.document.querySelectorAll('#pendulum .bob').length,
            cards: window.document.querySelectorAll('#pend-readout .pside').length,
        };
        run('pend-puzzles', () => {
            click('[data-action="back"]');
            click('[data-go="pend-puzzles"]');
            click('.puzzle-card[data-id="1"]');
            click('#dock [data-choice="a"]');
            click('#dock [data-act="hint"]');
            click('[data-action="back"]');
        });
        run('pend-battle', () => {
            click('[data-go="home"]');
            click('[data-go="pend-setup"]');
            click('#btn-pend-start');
            for (let i = 0; i < 3; i++) click('#dlg-rules-pend [data-tour="next"]');
        });
        await new Promise(r => setTimeout(r, 4000));
    });
    let battleState;
    let pendLab;
    let leverState;

    it('起動・画面移動でエラーが出ない', () => {
        expect(errors).toEqual([]);
    });

    it('WebGL が無いときは 2D 表示になる', () => {
        const doc = window.document;
        expect(doc.documentElement.classList.contains('is-3d')).toBe(false);
        expect(leverState.hidden).toBe(false);
        expect(leverState.hooks).toBe(12);
    });


    it('はじめての対戦では、あそびかたが開き、閉じると始まる', () => {
        expect(tourOpened).toBe(true);
        expect(window.document.getElementById('dlg-rules').open).toBe(false);
    });

    it('たいせんが最初のターンまで進む（演出のあとで止まらない）', () => {
        expect(battleState.turn).toBe(true);
        expect(battleState.sub).toMatch(/のばん|かんがえ中/);
    });

    it('ふりこ：単元を切りかえるとロゴが変わり、じっけんに 2つのふりこと計測パネルが出る', () => {
        expect(pendLab.logo).toBe('PENDULUM MASTER');
        expect(pendLab.bobs).toBe(2);
        expect(pendLab.cards).toBe(2);
    });

    it('ふりこ たいせんが最初のターンまで進む', () => {
        const doc = window.document;
        expect(doc.querySelector('#screen-play').dataset.unit).toBe('pendulum');
        expect(doc.querySelectorAll('#players .pchip').length).toBeGreaterThanOrEqual(2);
        expect(doc.querySelector('#play-sub').textContent).toMatch(/のばん|かんがえ中|にした/);
    });
});
