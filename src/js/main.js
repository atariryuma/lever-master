/**
 * エントリーポイント
 * ホーム（6年 てこ／5年 ふりこ の切りかえ）・画面の切りかえ・ダイアログ・設定・PWA まわり
 */

import { LeverView } from './view/lever-view.js';
import { LeverView3D, webglAvailable } from './view/lever-view-3d.js';
import { PendulumView } from './view/pendulum-view.js';
import { PendulumView3D } from './view/pendulum-view-3d.js';
import { createBoard, hang } from './engine/lever.js';
import { $, $$, hideBanner, showScreen } from './ui.js';
import { icon, installIcons } from './icons.js';
import { applyVolumes, play, setBgm, unlockAudio } from './audio.js';
import { save, saveSettings, settings } from './storage.js';
import { segmented } from './widgets.js';
import { setupRulesTour } from './rules-tour.js';
import * as lab from './screens/lab.js';
import * as puzzles from './screens/puzzles.js';
import * as battle from './screens/battle.js';
import * as pendLab from './screens/pend-lab.js';
import * as pendPuzzles from './screens/pend-puzzles.js';
import * as pendBattle from './screens/pend-battle.js';

installIcons();

/** GAS（Google Apps Script）版として配信されているか（build-gas.mjs が設定） */
const IS_GAS = Boolean(window.LEVER_GAS);

/* ---------- 単元 ----------
 * ホームは「6年 てこ」と「5年 ふりこ」のハブ。モードのカード・ロゴ・きほんのダイアログが切りかわる
 */
const UNITS = {
    lever: {
        en: 'LEVER MASTER', ja: 'てこマスター', grade: '小6 理科「てこのはたらき」',
        tagline: '重さ <b>×</b> きょり で、てこをつり合わせよう',
        learn: 'dlg-learn', rules: 'dlg-rules', learnLabel: 'てこのきほん',
        modes: [
            { go: 'lab', cls: 'mode-lab', icon: 'flask', name: 'じっけん', desc: 'おもりを自由につるして、つり合うしくみを調べよう' },
            { go: 'puzzles', cls: 'mode-puzzle', icon: 'puzzle', name: 'もんだい', desc: '予想してから手をはなそう。全<span data-count></span>問', progress: puzzles },
            { go: 'setup', cls: 'mode-battle', icon: 'scale', name: 'たいせん', desc: '2〜4人・CPUとも。持ち時間内につり合わせろ。かたむけたらアウト！' },
        ],
    },
    pendulum: {
        en: 'PENDULUM MASTER', ja: 'ふりこマスター', grade: '小5 理科「ふりこの運動」',
        tagline: 'ふりこの <b>長さ</b> で、1往復の時間が決まる',
        learn: 'dlg-learn-pend', rules: 'dlg-rules-pend', learnLabel: 'ふりこのきほん',
        modes: [
            { go: 'pend-lab', cls: 'mode-lab', icon: 'flask', name: 'じっけん', desc: '変える条件は1つだけ。10往復の時間をくらべよう' },
            { go: 'pend-puzzles', cls: 'mode-puzzle', icon: 'puzzle', name: 'もんだい', desc: 'どっちが先に 10往復する？ 予想してからたしかめよう。全<span data-count></span>問', progress: pendPuzzles },
            { go: 'pend-setup', cls: 'mode-battle', icon: 'target', name: 'たいせん', desc: 'ジャスト・タイム。ねらいの時間になる長さを当てろ！ 2〜4人・CPUとも' },
        ],
    },
};
let unit = UNITS[settings.unit] ? settings.unit : 'lever';

/* ---------- てこ・ふりこのビュー ----------
 * 2D（SVG）は常に用意。WebGL が使えれば 3D も作り、ふだんは 3D を使う。
 * ふりこのビューは、はじめてふりこの画面に入るときに作る（最初から WebGL を2つ作らない）
 */
const has3d = webglAvailable() && !new URLSearchParams(location.search).has('2d');
const STAGE = {
    lever: { c3d: '#lever3d', a11y: '#lever-a11y', svg: '#lever', readout: '#readout' },
    pendulum: { c3d: '#pendulum3d', a11y: '#pendulum-a11y', svg: '#pendulum', readout: '#pend-readout' },
};
const views = { lever: null, pendulum: null };
let playUnit = 'lever'; // プレイ画面がどちらの単元か
let view = null; // いま使っているビュー
let active = null; // いまプレイ画面を使っているモード

function viewsFor(u) {
    if (views[u]) return views[u];
    const stage = STAGE[u];
    const v2d = u === 'lever' ? new LeverView($(stage.svg)) : new PendulumView($(stage.svg));
    let v3d = null;
    try {
        if (has3d) {
            v3d = u === 'lever'
                ? new LeverView3D($(stage.c3d), {}, { a11yRoot: $(stage.a11y) })
                : new PendulumView3D($(stage.c3d), {}, { a11yRoot: $(stage.a11y) });
        }
    } catch (err) {
        console.warn('3D view unavailable, falling back to 2D:', err);
        v3d = null;
    }
    if (!v3d) $(stage.c3d).hidden = true;
    views[u] = { v2d, v3d };
    return views[u];
}

const vs = viewsFor('lever');
document.documentElement.classList.toggle('is-3d', Boolean(vs.v3d));
view = vs.v3d ?? vs.v2d;

/** 3D と 図（2D）の切りかえ。handlers を引きついで、画面を描き直す（refresh を持つのはじっけんだけ） */
function setViewKind(kind, { refresh = true } = {}) {
    const u = viewsFor(playUnit);
    const next = kind === '2d' || !u.v3d ? u.v2d : u.v3d;
    if (next !== view) {
        view.cancelDrag?.();
        next.skipKick?.(); // かくれていたあいだの盤面とくらべて、ゆらさない
        // 前の表示の傾きから続ける（かくれていたあいだの古い角度から大きくゆれない）
        next.syncBody?.(view.body);
        if ('timeScale' in next) next.timeScale = view.timeScale ?? 1;
        next.handlers = view.handlers;
        view.handlers = {};
        view = next;
    }
    const is3d = view === u.v3d;
    const stage = STAGE[playUnit];
    $(stage.c3d).hidden = !is3d;
    $(stage.a11y).hidden = !is3d;
    if (is3d) $(stage.svg).setAttribute('hidden', '');
    else $(stage.svg).removeAttribute('hidden'); // SVG 要素には hidden プロパティがない
    const toggle = $('#view-toggle');
    toggle.innerHTML = is3d ? `${icon('chart')}<span>図で見る</span>` : `${icon('cube')}<span>3Dで見る</span>`;
    toggle.setAttribute('aria-label', is3d ? '図（2D）で見る' : '3D で見る');
    if (refresh) active?.refresh?.();
}

/** プレイ画面を単元に合わせる（使わないほうのステージはかくす） */
function showStage(u) {
    for (const [name, stage] of Object.entries(STAGE)) {
        const off = name !== u;
        $(stage.c3d).hidden = off || !viewsFor(u).v3d;
        $(stage.a11y).hidden = off;
        if (off) $(stage.svg).setAttribute('hidden', '');
        $(stage.readout).hidden = off;
    }
}

/* ---------- ホーム画面の 3D デモ ---------- */
const heroes = { lever: null, pendulum: null };

function startHero(u) {
    const canvas = $(u === 'lever' ? '#hero3d' : '#hero3d-pend');
    if (!has3d || heroes[u]) return;
    try {
        if (u === 'lever') {
            const demo = [
                [[-3, 20], [2, 30]],
                [[-6, 10], [-1, 20], [4, 20]],
                [[-4, 30], [5, 10], [3, 10]],
                [[-4, 30], [6, 20]],
                [[-2, 10], [-5, 20], [3, 20], [6, 10]],
            ].map((items, i) => items.reduce((b, [pos, mass], k) => hang(b, pos, { id: `d${i}-${k}`, mass }), createBoard()));
            const hero = new LeverView3D(canvas, {}, { showcase: true });
            hero.setShowcase(demo);
            heroes[u] = hero;
        } else {
            const hero = new PendulumView3D(canvas, {}, { showcase: true });
            hero.setShowcase();
            heroes[u] = hero;
        }
        // 最初の絵がかけてから見せる（まっ黒→急に出る、をなくす）
        requestAnimationFrame(() => requestAnimationFrame(() => canvas.classList.add('is-ready')));
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
        return Boolean(viewsFor(playUnit).v3d);
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
    'pend-lab': params => enterPlay(pendLab, params),
    'pend-puzzles': () => {
        pendPuzzles.renderList(app);
        showScreen('screen-puzzles');
    },
    'pend-puzzle': params => enterPlay(pendPuzzles, params),
    'pend-setup': () => {
        pendBattle.renderSetup(app);
        showScreen('screen-pend-setup');
    },
    'pend-battle': params => enterPlay(pendBattle, params),
};

let viewPref = '3d';

const ROUTE_BGM = {
    home: 'menu', puzzles: 'menu', setup: 'menu', lab: 'study', puzzle: 'study', battle: 'battle',
    'pend-puzzles': 'menu', 'pend-setup': 'menu', 'pend-lab': 'study', 'pend-puzzle': 'study', 'pend-battle': 'battle',
};

let currentRoute = 'home';

function go(route, params = {}) {
    currentRoute = route;
    syncHistory(route);
    for (const u of Object.values(views)) {
        u?.v2d?.cancelDrag?.();
        u?.v3d?.cancelDrag?.();
    }
    if (active) {
        active.leave();
        active = null;
    }
    closeDialogs();
    clearOverlays();
    setBgm(ROUTE_BGM[route] ?? 'menu');
    routes[route](params);
    // 新しい版が届いていたら、遊んでいないときに切りかえる
    if (updateReady) setTimeout(reloadIfIdle, 300);
}

function enterPlay(mode, params) {
    active = mode;
    playUnit = mode.UNIT ?? 'lever';
    const u = viewsFor(playUnit);
    showStage(playUnit);
    if (view !== u.v2d && view !== u.v3d) {
        view.handlers = {};
        view = u.v3d ?? u.v2d;
    }
    // じっけんだけ自由に切りかえ。たいせんは 3D、もんだいは「図で予想 → 3D でたしかめる」でモードが決める
    const isLab = mode.MODE === 'lab' || mode.MODE === 'pend-lab';
    $('#view-toggle').hidden = !u.v3d || !isLab;
    const fixed = { battle: '3d', puzzle: '2d', 'pend-battle': '3d', 'pend-puzzle': '2d' }[mode.MODE];
    setViewKind(fixed ?? viewPref, { refresh: false });
    $('#screen-play').dataset.mode = mode.MODE;
    $('#screen-play').dataset.unit = playUnit;
    const help = $('#play-help');
    const helpId = mode.HELP ?? 'dlg-learn';
    const rules = helpId.startsWith('dlg-rules');
    help.dataset.open = helpId;
    help.innerHTML = icon(rules ? 'help' : 'book');
    help.setAttribute('aria-label', rules ? 'たいせんのあそびかた' : UNITS[playUnit].learnLabel);
    showScreen('screen-play');
    u.v2d.reset?.();
    u.v3d?.reset?.();
    mode.enter(app, params);
    // タイトルはモードが決めるので、決まってから読み上げ用にフォーカスしなおす
    $('#play-title').focus({ preventScroll: true });
}

/** 前の画面のバナー・演出（帯・たたきつけ・紙吹雪）を残さない */
function clearOverlays() {
    hideBanner();
    for (const el of $$('#fx > :not(.fx-vignette)')) el.remove();
}

/** 開いているダイアログを閉じる @returns {boolean} 閉じたものがあったか */
function closeDialogs() {
    const open = $$('dialog[open]');
    for (const d of open) d.close();
    return open.length > 0;
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

/* ---------- ホーム ---------- */

function refreshHome() {
    const u = UNITS[unit];
    const logo = $('.logo-en');
    logo.textContent = u.en;
    logo.dataset.text = u.en;
    $('.logo-ja').textContent = u.ja;
    $('.tagline').innerHTML = u.tagline;
    $('#home-grade').textContent = u.grade;
    $('#modes').dataset.unit = unit;
    $('#modes').innerHTML = u.modes.map((m, i) => {
        const prog = m.progress?.progressSummary();
        const stars = prog?.earned ? `${icon('star', 'star is-on')} ${prog.earned} / ${prog.max}` : '';
        return `
            <button type="button" class="mode-card ${m.cls}" data-go="${m.go}">
                <span class="mode-step">STEP ${i + 1}</span>
                <span class="mode-icon">${icon(m.icon)}</span>
                <span class="mode-name">${m.name}</span>
                <span class="mode-desc">${m.desc.replace('<span data-count></span>', String(prog?.total ?? ''))}</span>
                <span class="mode-progress">${stars}</span>
            </button>`;
    }).join('');
    const learn = $('#home-learn');
    learn.dataset.open = u.learn;
    learn.innerHTML = `${icon('book')}${u.learnLabel}`;
    $('#home-rules').dataset.open = u.rules;
    document.documentElement.dataset.unit = unit;
    // 3D のデモは単元ごと
    startHero(unit);
    $('#hero3d').hidden = unit !== 'lever';
    $('#hero3d-pend').hidden = unit !== 'pendulum';
}

function setupUnitSwitch() {
    segmented($('#unit-switch'), {
        options: [['lever', '6年 てこ', 'lever'], ['pendulum', '5年 ふりこ', 'pendulum']],
        value: unit,
        onChange: v => {
            unit = v;
            settings.unit = v;
            saveSettings();
            refreshHome();
            const head = $('.home-head');
            head.classList.remove('is-switching');
            void head.offsetWidth;
            head.classList.add('is-switching');
        },
    });
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
        const dlg = document.getElementById(openBtn.dataset.open);
        dlg.showModal();
        dlg.dispatchEvent(new Event('sheet-open'));
        return;
    }
    if (e.target.closest('#view-toggle')) {
        play('tap');
        viewPref = view === viewsFor(playUnit).v3d ? '2d' : '3d';
        setViewKind(viewPref);
        return;
    }
    const backBtn = e.target.closest('[data-action="back"]');
    if (backBtn && active) {
        play('tap');
        active.back();
    }
});

/* ---------- ブラウザ・スマホの「戻る」 ----------
 * ホーム以外にいるあいだは、履歴に「見張り」を1つ積んでおく。
 * 戻るジェスチャーでそれが外れたら、アプリの「もどる」ボタンと同じことをする
 * （たいせんなら「やめますか？」をきく）。ホームでの「戻る」だけは、ふつうにアプリを出る。
 */
// 再読みこみしたときは、前の見張りが履歴に残っていることがある（それも見張りとして使う）
let guarded = history.state?.lever === 'guard';
let ignoreNextPop = false;

function pushGuard() {
    if (guarded) return;
    try {
        history.pushState({ lever: 'guard' }, '');
        guarded = true;
    } catch {
        // サンドボックスなどで履歴を使えないときは、何もしない
    }
}

function syncHistory(route) {
    if (route !== 'home') {
        pushGuard();
    } else if (guarded) {
        // アプリのボタンでホームにもどったら見張りを外す（次の「戻る」でアプリを出られるように）
        guarded = false;
        ignoreNextPop = true;
        history.back();
    }
}

/** アプリの「もどる」と同じ */
function goBack() {
    if (closeDialogs()) return;
    if (active) active.back();
    else if (currentRoute !== 'home') go('home');
}

window.addEventListener('popstate', () => {
    if (ignoreNextPop) {
        ignoreNextPop = false;
        return;
    }
    guarded = false;
    if (currentRoute === 'home') return;
    play('tap');
    goBack();
    // まだホームでなければ（たいせんで「つづける」など）、次の「戻る」にそなえて見張りをもどす
    if (currentRoute !== 'home') pushGuard();
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
        if (await confirm('もんだいのきろく（★）をぜんぶ消しますか？（てこ・ふりこ両方）', { yes: 'けす', no: 'けさない' })) {
            save('progress', { stars: {} });
            save('pendProgress', { stars: {} });
            puzzles.reloadProgress();
            pendPuzzles.reloadProgress();
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
    // sw.js 自体もブラウザのキャッシュを使わない（新しい版にすぐ気づけるように）
    const register = () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .then(reg => {
            // ホーム画面のアプリは開きっぱなしで再開されることが多いので、前に出てくるたびに新しい版をたしかめる
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) reg.update().catch(() => {});
            });
        })
        .catch(err => console.warn('SW registration failed:', err));
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    watchForUpdate();
}

/**
 * 新しい版の Service Worker に切りかわったら、ページを読みなおして新しい版にする。
 * 遊んでいる途中は待って、ホーム（か一覧）にいるときに読みなおす
 */
let updateReady = false;
function watchForUpdate() {
    let hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        // はじめてのインストールでは読みなおさない（そのあとの更新では読みなおす）
        if (!hadController) {
            hadController = true;
            return;
        }
        // 開いてすぐ（20秒以内）なら、このページはもうネットから取った新しい版なので読みなおさない
        if (performance.now() < 20000) return;
        updateReady = true;
        reloadIfIdle();
    });
}

function reloadIfIdle() {
    if (updateReady && !active && !document.querySelector('dialog[open]')) location.reload();
}

// 画面の幅が変わったら（回転・リサイズ）、面積図などを今の幅で描きなおす
let readoutWidth = 0;
let refreshFrame = 0;
const readoutObserver = 'ResizeObserver' in window ? new ResizeObserver(([entry]) => {
    const width = Math.round(entry.contentRect.width);
    if (width === readoutWidth) return;
    readoutWidth = width;
    cancelAnimationFrame(refreshFrame);
    refreshFrame = requestAnimationFrame(() => {
        if (active && active.MODE !== 'battle') active.refresh?.();
    });
}) : null;
readoutObserver?.observe($('#readout'));

bindSettings();
setupUnitSwitch();
setupRulesTour();
setupInstallTip();
registerServiceWorker();
go('home');
