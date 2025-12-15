/**
 * エラーハンドリングモジュール
 * エラーの一元管理とユーザーへの適切な通知
 *
 * ベストプラクティス:
 * - エラーを隠蔽せず、適切にログ記録
 * - ユーザーフレンドリーなエラーメッセージ
 * - 開発環境と本番環境で異なる動作
 */

/**
 * エラーレベル
 * @enum {string}
 */
export const ErrorLevel = {
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical',
};

/**
 * エラーメッセージを表示
 * @param {string} message - ユーザー向けメッセージ
 * @param {ErrorLevel} level - エラーレベル
 * @param {number} duration - 表示時間(ms)、0で手動クローズ
 */
export function showErrorMessage(message, level = ErrorLevel.ERROR, duration = 5000) {
    // DOM要素を作成
    const errorDiv = document.createElement('div');
    errorDiv.className = `error-notification error-${level}`;
    errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        max-width: 400px;
        padding: 16px 20px;
        background: ${getBackgroundColor(level)};
        border: 2px solid ${getBorderColor(level)};
        border-radius: 8px;
        color: white;
        font-family: 'M PLUS Rounded 1c', sans-serif;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideInRight 0.3s ease-out;
    `;

    errorDiv.innerHTML = `
        <div style="display: flex; align-items: start; gap: 12px;">
            <span style="font-size: 20px;">${getIcon(level)}</span>
            <div style="flex: 1;">
                <div style="font-weight: bold; margin-bottom: 4px;">${getLevelText(level)}</div>
                <div>${message}</div>
            </div>
            <button type="button" style="background: none; border: none; color: white; cursor: pointer; font-size: 20px; line-height: 1; padding: 0;" aria-label="Close">✕</button>
        </div>
    `;

    // CSS アニメーション定義（初回のみ）
    if (!document.getElementById('error-notification-styles')) {
        const style = document.createElement('style');
        style.id = 'error-notification-styles';
        style.textContent = `
            @keyframes slideInRight {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            @keyframes slideOutRight {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(errorDiv);

    // 閉じるボタン
    const closeBtn = errorDiv.querySelector('button');
    closeBtn.addEventListener('click', () => {
        removeNotification(errorDiv);
    });

    // 自動クローズ
    if (duration > 0) {
        setTimeout(() => {
            removeNotification(errorDiv);
        }, duration);
    }
}

/**
 * 通知を削除
 * @param {HTMLElement} element - 削除する要素
 */
function removeNotification(element) {
    element.style.animation = 'slideOutRight 0.3s ease-in';
    setTimeout(() => {
        if (element.parentNode) {
            element.parentNode.removeChild(element);
        }
    }, 300);
}

/**
 * エラーレベルに応じた背景色を取得
 * @param {ErrorLevel} level - エラーレベル
 * @returns {string} 背景色
 */
function getBackgroundColor(level) {
    switch (level) {
        case ErrorLevel.INFO:
            return 'rgba(0, 200, 255, 0.9)';
        case ErrorLevel.WARNING:
            return 'rgba(255, 149, 0, 0.9)';
        case ErrorLevel.ERROR:
            return 'rgba(255, 51, 102, 0.9)';
        case ErrorLevel.CRITICAL:
            return 'rgba(200, 0, 0, 0.9)';
        default:
            return 'rgba(100, 100, 100, 0.9)';
    }
}

/**
 * エラーレベルに応じたボーダー色を取得
 * @param {ErrorLevel} level - エラーレベル
 * @returns {string} ボーダー色
 */
function getBorderColor(level) {
    switch (level) {
        case ErrorLevel.INFO:
            return '#00ccff';
        case ErrorLevel.WARNING:
            return '#ff9500';
        case ErrorLevel.ERROR:
            return '#ff3366';
        case ErrorLevel.CRITICAL:
            return '#cc0000';
        default:
            return '#666666';
    }
}

/**
 * エラーレベルに応じたアイコンを取得
 * @param {ErrorLevel} level - エラーレベル
 * @returns {string} アイコン
 */
function getIcon(level) {
    switch (level) {
        case ErrorLevel.INFO:
            return 'ℹ️';
        case ErrorLevel.WARNING:
            return '⚠️';
        case ErrorLevel.ERROR:
            return '❌';
        case ErrorLevel.CRITICAL:
            return '🚨';
        default:
            return '❓';
    }
}

/**
 * エラーレベルに応じたテキストを取得
 * @param {ErrorLevel} level - エラーレベル
 * @returns {string} レベルテキスト
 */
function getLevelText(level) {
    switch (level) {
        case ErrorLevel.INFO:
            return '情報';
        case ErrorLevel.WARNING:
            return '警告';
        case ErrorLevel.ERROR:
            return 'エラー';
        case ErrorLevel.CRITICAL:
            return '重大なエラー';
        default:
            return 'お知らせ';
    }
}

/**
 * エラーをログに記録（開発環境では詳細、本番では簡潔）
 * @param {Error|string} error - エラーオブジェクトまたはメッセージ
 * @param {Object} context - 追加のコンテキスト情報
 */
export function logError(error, context = {}) {
    const isDevelopment = window.location.hostname === 'localhost' ||
                         window.location.hostname === '127.0.0.1';

    if (isDevelopment) {
        console.error('Error:', error);
        if (Object.keys(context).length > 0) {
            console.error('Context:', context);
        }
        if (error instanceof Error && error.stack) {
            console.error('Stack:', error.stack);
        }
    } else {
        // 本番環境では簡潔なログ
        console.error(error instanceof Error ? error.message : error);
    }
}

/**
 * 非同期処理を安全にラップ
 * @param {Function} asyncFn - 非同期関数
 * @param {string} errorMessage - エラー時のユーザー向けメッセージ
 * @returns {Promise} ラップされた非同期関数
 */
export async function safeAsync(asyncFn, errorMessage = 'エラーが発生しました') {
    try {
        return await asyncFn();
    } catch (error) {
        logError(error, { function: asyncFn.name });
        showErrorMessage(errorMessage, ErrorLevel.ERROR);
        return null;
    }
}

/**
 * グローバルエラーハンドラーを設定
 */
export function setupGlobalErrorHandler() {
    window.addEventListener('error', (event) => {
        logError(event.error, {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
        });
        event.preventDefault();
    });

    window.addEventListener('unhandledrejection', (event) => {
        logError(event.reason, { type: 'Unhandled Promise Rejection' });
        event.preventDefault();
    });
}
