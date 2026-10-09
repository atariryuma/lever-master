/**
 * てこマスター エントリーポイント
 * 画面の切りかえ・ダイアログ・設定・PWA まわり
 */

import { LeverView } from './view/lever-view.js';
import { $, $$, showScreen } from './ui.js';
import { play, startBgm, stopBgm, unlockAudio } from './audio.js';
import { save, saveSettings, settings } from './storage.js';
import { segmented } from './widgets.js';
import * as lab from './screens/lab.js';
import * as puzzles from './screens/puzzles.js';
import * as battle from './screens/battle.js';

const view = new LeverView($('#lever'));
let active = null; // いまプレイ画面を使っているモード

const app = {
    view,
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

function go(route, params = {}) {
    if (active) {
        active.leave();
        active = null;
    }
    closeDialogs();
    routes[route](params);
}

function enterPlay(mode, params) {
    active = mode;
    $('#screen-play').dataset.mode = mode.MODE;
    const help = $('#play-help');
    const rules = mode.MODE === 'battle';
    help.dataset.open = rules ? 'dlg-rules' : 'dlg-learn';
    help.textContent = rules ? '❓' : '📖';
    help.setAttribute('aria-label', rules ? 'たいせんのルール' : 'てこのきほん');
    showScreen('screen-play');
    mode.enter(app, params);
}

function closeDialogs() {
    for (const d of $$('dialog[open]')) d.close();
}

/** はい/いいえの確認 */
function confirm(title) {
    const dlg = $('#dlg-confirm');
    $('#confirm-title').textContent = title;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise(resolve => {
        dlg.addEventListener('close', () => resolve(dlg.returnValue === 'yes'), { once: true });
    });
}

function refreshHome() {
    const { total, earned, max } = puzzles.progressSummary();
    $('[data-puzzle-count]').textContent = total;
    $('[data-puzzle-progress]').textContent = earned ? `★ ${earned} / ${max}` : '';
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
    const sfx = $('#set-sfx');
    const bgm = $('#set-bgm');
    sfx.checked = settings.sfx;
    bgm.checked = settings.bgm;
    sfx.addEventListener('change', () => {
        settings.sfx = sfx.checked;
        saveSettings();
        play('tap');
    });
    bgm.addEventListener('change', () => {
        settings.bgm = bgm.checked;
        saveSettings();
        if (settings.bgm) {
            unlockAudio();
            startBgm();
        } else {
            stopBgm();
        }
    });
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
        if (await confirm('もんだいの記録（★）をぜんぶ消しますか？')) {
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
    if (standalone || !isIOS) return;
    const tip = $('#install-tip');
    tip.innerHTML = '📲 共有ボタン →「ホーム画面に追加」で、アプリのように全画面で遊べます';
    tip.hidden = false;
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed:', err));
    });
}

bindSettings();
setupInstallTip();
registerServiceWorker();
go('home');
