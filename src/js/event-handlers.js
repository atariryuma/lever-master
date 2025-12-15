/**
 * イベントハンドラーモジュール
 * HTML要素のイベントリスナーを一元管理
 *
 * ベストプラクティス:
 * - HTMLのonclick属性は使用しない（セキュリティ、保守性の問題）
 * - イベント委譲を適切に使用
 * - モジュールスコープで関数を管理
 */

import { DOM_IDS } from './constants.js';

/**
 * すべてのイベントリスナーを初期化
 * @param {Object} handlers - ハンドラー関数のオブジェクト
 */
export function initializeEventListeners(handlers) {
    // スプラッシュ画面
    const splash = document.getElementById(DOM_IDS.SPLASH_SCREEN);
    if (splash) {
        splash.addEventListener('click', (event) => {
            if (handlers.dismissSplash) handlers.dismissSplash(event);
        });
    }

    // ゲームモード選択ボタン（イベント委譲）
    const startOverlay = document.getElementById(DOM_IDS.START_OVERLAY);
    if (startOverlay) {
        startOverlay.addEventListener('click', (event) => {
            const modeBtn = event.target.closest('.mode-btn');
            if (modeBtn) {
                const mode = modeBtn.classList.contains('mode1') ? 'cpu1' :
                    modeBtn.classList.contains('mode2') ? 'pvp2' :
                        modeBtn.classList.contains('mode3') ? 'pvp3' : 'pvp4';
                if (handlers.startGame) handlers.startGame(mode);
            }
        });
    }

    // サウンドボタン
    const soundBtn = document.getElementById(DOM_IDS.SOUND_BTN);
    if (soundBtn) {
        soundBtn.addEventListener('click', () => {
            if (handlers.toggleSound) handlers.toggleSound();
        });
    }

    const startSoundBtn = document.getElementById(DOM_IDS.START_SOUND_BTN);
    if (startSoundBtn) {
        startSoundBtn.addEventListener('click', () => {
            if (handlers.toggleStartSound) handlers.toggleStartSound();
        });
    }

    // ヘルプ・学習モーダル
    const helpBtns = document.querySelectorAll('.help');
    helpBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (handlers.openHelp) handlers.openHelp();
        });
    });

    const learnBtns = document.querySelectorAll('.learn');
    learnBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (handlers.openLearn) handlers.openLearn();
        });
    });

    // モーダル閉じるボタン（イベント委譲）
    document.addEventListener('click', (event) => {
        if (event.target.classList.contains('help-close')) {
            if (handlers.closeHelp) handlers.closeHelp();
        }
        if (event.target.matches('#learn-modal .help-close')) {
            if (handlers.closeLearn) handlers.closeLearn();
        }
        if (event.target.classList.contains('install-close')) {
            if (handlers.closeInstallGuide) handlers.closeInstallGuide();
        }
    });

    // 終了ボタン
    const exitBtn = document.getElementById('exit-btn');
    if (exitBtn) {
        exitBtn.addEventListener('click', () => {
            if (handlers.confirmExit) handlers.confirmExit();
        });
    }

    // 終了モーダル内のボタン
    const exitModal = document.getElementById('exit-modal');
    if (exitModal) {
        exitModal.addEventListener('click', (event) => {
            if (event.target.textContent === 'EXIT' && event.target.classList.contains('result-btn')) {
                if (handlers.exitGame) handlers.exitGame();
            }
            if (event.target.classList.contains('help-close')) {
                if (handlers.closeExitModal) handlers.closeExitModal();
            }
        });
    }

    // リトライボタン
    document.addEventListener('click', (event) => {
        if (event.target.classList.contains('result-btn') &&
            event.target.textContent === 'RETRY') {
            if (handlers.backToStart) handlers.backToStart();
        }
    });

    // ゲーム内アクションボタン
    const btnPass = document.getElementById(DOM_IDS.BTN_PASS);
    if (btnPass) {
        btnPass.addEventListener('click', () => {
            if (handlers.passMove) handlers.passMove();
        });
    }

    const btnRedo = document.getElementById(DOM_IDS.BTN_REDO);
    if (btnRedo) {
        btnRedo.addEventListener('click', () => {
            if (handlers.redoHang) handlers.redoHang();
        });
    }

    // ヒント閉じるボタン
    const hintClose = document.querySelector('.hint-close');
    if (hintClose) {
        hintClose.addEventListener('click', () => {
            if (handlers.hideHint) handlers.hideHint();
        });
    }
}
