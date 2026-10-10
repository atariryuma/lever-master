/**
 * てこマスター エントリーポイント
 * 画面の切りかえ・ダイアログ・設定・PWA まわり
 */

import { LeverView } from './view/lever-view.js';
import { LeverView3D, webglAvailable } from './view/lever-view-3d.js';
import { createBoard, hang } from './engine/lever.js';
import { $, $$, hideBanner, showScreen } from './ui.js';
import { icon, installIcons } from './icons.js';
import { applyVolumes, play, setBgm, unlockAudio } from './audio.js';
import { save, saveSettings, settings } from './storage.js';
import { segmented } from './widgets.js';
import * as lab from './screens/lab.js';
import * as puzzles from './screens/puzzles.js';
import * as battle from './screens/battle.js';

installIcons();

/** GAS（Google Apps Script）版として配信されているか（build-gas.mjs が設定） */
const IS_GAS = Boolean(window.LEVER_GAS);

/** 2D（SVG）は常に用意。WebGL が使えれば 3D も作り、ふだんは 3D を使う */
const views = createViews();
let view = views.v3d ?? views.v2d;
let active = null; // いまプレイ画面を使っているモード

function createViews() {
    const v2d = new LeverView($('#lever'));
    let v3d = null;
    try {
        if (webglAvailable() && !new URLSearchParams(location.search).has('2d')) {
            v3d = new LeverView3D($('#lever3d'), {}, { a11yRoot: $('#lever-a11y') });
            document.documentElement.classList.add('is-3d');
            startHero(LeverView3D);
        }
    } catch (err) {
        console.warn('3D view unavailable, falling back to 2D:', err);
        v3d = null;
        document.documentElement.classList.remove('is-3d');
    }
    if (!v3d) $('#lever3d').hidden = true;
    return { v2d, v3d };
}

/** 3D と 図（2D）の切りかえ。handlers を引きついで、画面を描き直す（refresh を持つのはじっけんだけ） */
function setViewKind(kind, { refresh = true } = {}) {
    const next = kind === '2d' || !views.v3d ? views.v2d : views.v3d;
    if (next !== view) {
        view.cancelDrag?.();
        next.skipKick?.(); // かくれていたあいだの盤面とくらべて、ゆらさない
        // 前の表示の傾きから続ける（かくれていたあいだの古い角度から大きくゆれない）
        next.angle = view.angle;
        next.velocity = view.velocity;
        next.handlers = view.handlers;
        view.handlers = {};
        view = next;
    }
    const is3d = view === views.v3d;
    $('#lever3d').hidden = !is3d;
    $('#lever-a11y').hidden = !is3d;
    if (is3d) $('#lever').setAttribute('hidden', '');
    else $('#lever').removeAttribute('hidden'); // SVG 要素には hidden プロパティがない
    const toggle = $('#view-toggle');
    toggle.innerHTML = is3d ? `${icon('chart')}<span>図で見る</span>` : `${icon('cube')}<span>3Dで見る</span>`;
    toggle.setAttribute('aria-label', is3d ? '図（2D）で見る' : '3D で見る');
    if (refresh) active?.refresh?.();
}

/** ホーム画面の 3D デモ（つり合う例と、かたむく例を順番に見せる） */
function startHero(LeverView3D) {
    const demo = [
        [[-3, 20], [2, 30]],
        [[-6, 10], [-1, 20], [4, 20]],
        [[-4, 30], [5, 10], [3, 10]],
        [[-4, 30], [6, 20]],
        [[-2, 10], [-5, 20], [3, 20], [6, 10]],
    ].map((items, i) => items.reduce((b, [pos, mass], k) => hang(b, pos, { id: `d${i}-${k}`, mass }), createBoard()));
    try {
        const hero = new LeverView3D($('#hero3d'), {}, { showcase: true });
        hero.setShowcase(demo);
    } catch (err) {
        console.warn('hero disabled:', err);
    }
}

const app = {
    get view() {
        return view;
    },
    /** 3D が使えるか（もんだいの「図で予想 → 3D でたしかめる」用） */
    get has3d() {
        return Boolean(views.v3d);
    },
    /** モードから表示を切りかえる（描き直しはモード側で行う） */
    setView: kind => setViewKind(kind, { refresh: false }),
    go,
    confirm,
};

const routes = {
    home: () => {
        refreshHome();
        showScreen('screen-home');
    },
    lab: params => enterPlay(lab, params),
    puzzles: () => {
        puzzles.renderList(app);
        showScreen('screen-puzzles');
    },
    puzzle: params => enterPlay(puzzles, params),
    setup: () => {
        battle.renderSetup(app);
        showScreen('screen-setup');
    },
    battle: params => enterPlay(battle, params),
};

let viewPref = '3d';

const ROUTE_BGM = { home: 'menu', puzzles: 'menu', setup: 'menu', lab: 'study', puzzle: 'study', battle: 'battle' };

function go(route, params = {}) {
    for (const v of Object.values(views)) v?.cancelDrag?.();
    if (active) {
        active.leave();
        active = null;
    }
    closeDialogs();
    clearOverlays();
    setBgm(ROUTE_BGM[route] ?? 'menu');
    routes[route](params);
}

function enterPlay(mode, params) {
    active = mode;
    // じっけんだけ自由に切りかえ。たいせんは 3D、もんだいは「図で予想 → 3D でたしかめる」でモードが決める
    $('#view-toggle').hidden = !views.v3d || mode.MODE !== 'lab';
    setViewKind({ battle: '3d', puzzle: '2d' }[mode.MODE] ?? viewPref, { refresh: false });
    $('#screen-play').dataset.mode = mode.MODE;
    const help = $('#play-help');
    const rules = mode.MODE === 'battle';
    help.dataset.open = rules ? 'dlg-rules' : 'dlg-learn';
    help.innerHTML = icon(rules ? 'help' : 'book');
    help.setAttribute('aria-label', rules ? 'たいせんのルール' : 'てこのきほん');
    showScreen('screen-play');
    for (const v of Object.values(views)) v?.reset?.();
    mode.enter(app, params);
}

/** 前の画面のバナー・演出（帯・たたきつけ・紙吹雪）を残さない */
function clearOverlays() {
    hideBanner();
    for (const el of $$('#fx > :not(.fx-vignette)')) el.remove();
}

function closeDialogs() {
    for (const d of $$('dialog[open]')) d.close();
}

/**
 * はい/いいえの確認。ボタンの文字は質問に合わせる（ふだんは「たいせんをやめる？」用）
 * @param {string} title
 * @param {{ yes?: string, no?: string }} [labels]
 */
function confirm(title, { yes = 'やめる', no = 'つづける' } = {}) {
    const dlg = $('#dlg-confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-yes').textContent = yes;
    $('#confirm-no').textContent = no;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise(resolve => {
        dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true });
    });
}

function refreshHome() {
    const { total, earned, max } = puzzles.progressSummary();
    $('[data-puzzle-count]').textContent = total;
    $('[data-puzzle-progress]').innerHTML = earned ? `${icon('star', 'star is-on')} ${earned} / ${max}` : '';
}

/* ---------- イベント ---------- */

document.addEventListener('click', e => {
    const goBtn = e.target.closest('[data-go]');
    if (goBtn) {
        play('tap');
        go(goBtn.dataset.go);
        return;
    }
    const openBtn = e.target.closest('[data-open]');
    if (openBtn) {
        play('tap');
        document.getElementById(openBtn.dataset.open).showModal();
        return;
    }
    if (e.target.closest('#view-toggle')) {
        play('tap');
        viewPref = view === views.v3d ? '2d' : '3d';
        setViewKind(viewPref);
        return;
    }
    const backBtn = e.target.closest('[data-action="back"]');
    if (backBtn && active) {
        play('tap');
        active.back();
    }
});

// ダイアログの外側をタップしたら閉じる
for (const dlg of $$('dialog.sheet')) {
    dlg.addEventListener('click', e => {
        if (e.target === dlg && dlg.id !== 'dlg-result' && dlg.id !== 'dlg-confirm') dlg.close();
    });
}

// 結果画面は Esc で消さない（ボタンで次へ）
$('#dlg-result').addEventListener('cancel', e => e.preventDefault());

// 最初の操作で音を有効にする（iOS など）
window.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
window.addEventListener('keydown', unlockAudio, { once: true, capture: true });

/* ---------- せってい ---------- */

function bindSettings() {
    const bindVolume = (input, key, onChange) => {
        input.value = String(Math.round(settings[key] * 100));
        const label = input.closest('.slider').querySelector('output');
        const show = () => {
            label.textContent = input.value === '0' ? 'OFF' : input.value;
        };
        show();
        input.addEventListener('input', () => {
            settings[key] = Number(input.value) / 100;
            show();
            unlockAudio();
            applyVolumes();
            onChange?.();
        });
        input.addEventListener('change', saveSettings);
    };
    bindVolume($('#set-sfx'), 'sfxVolume', () => play('tap'));
    bindVolume($('#set-bgm'), 'bgmVolume');
    segmented($('#set-speed'), {
        name: 'speed',
        options: [['slow', 'ゆっくり'], ['normal', 'ふつう'], ['fast', 'はやい']],
        value: settings.cpuSpeed,
        onChange: v => {
            settings.cpuSpeed = v;
            saveSettings();
        },
    });
    $('#btn-reset-progress').addEventListener('click', async () => {
        $('#dlg-settings').close();
        if (await confirm('もんだいの記録（★）をぜんぶ消しますか？', { yes: 'けす', no: 'けさない' })) {
            save('progress', { stars: {} });
            puzzles.reloadProgress();
            refreshHome();
        }
    });
}

/* ---------- PWA ---------- */

function setupInstallTip() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (IS_GAS || standalone || !isIOS) return;
    const tip = $('#install-tip');
    tip.innerHTML = `${icon('phone')}共有ボタン →「ホーム画面に追加」で、アプリのように全画面で遊べます`;
    tip.hidden = false;
}

function registerServiceWorker() {
    // GAS 版はサンドボックス iframe 配信のため Service Worker を登録できない
    if (IS_GAS || !('serviceWorker' in navigator) || location.protocol === 'file:') return;
    const register = () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed:', err));
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
}

bindSettings();
setupInstallTip();
registerServiceWorker();
go('home');
