/** localStorage の安全なラッパー（プライベートモード等で使えなくても動く） */

const PREFIX = 'levermaster:v2:';

export function load(key, fallback) {
    try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw === null ? fallback : { ...fallback, ...JSON.parse(raw) };
    } catch {
        return fallback;
    }
}

export function save(key, value) {
    try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
        // 保存できなくてもゲームは続ける
    }
}

export const DEFAULT_SETTINGS = Object.freeze({
    sfxVolume: 0.8,
    bgmVolume: 0.6,
    cpuSpeed: 'normal',
});

export const settings = load('settings', { ...DEFAULT_SETTINGS });
// 以前の ON/OFF 設定からの移行
if (settings.sfx === false) settings.sfxVolume = 0;
if (settings.bgm === false) settings.bgmVolume = 0;
delete settings.sfx;
delete settings.bgm;

export function saveSettings() {
    save('settings', settings);
}
