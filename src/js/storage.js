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
    sfx: true,
    bgm: true,
    cpuSpeed: 'normal',
});

export const settings = load('settings', { ...DEFAULT_SETTINGS });

export function saveSettings() {
    save('settings', settings);
}
