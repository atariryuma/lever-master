/**
 * パフォーマンスモニタリングユーティリティ
 *
 * 使用方法:
 * 1. PerformanceMonitor.mark('operation-start')
 * 2. ... 処理 ...
 * 3. PerformanceMonitor.measure('operation', 'operation-start')
 * 4. PerformanceMonitor.logStats() でレポート表示
 */

class PerformanceMonitor {
    constructor() {
        this.enabled = true;
        this.measurements = new Map();
        this.frameCount = 0;
        this.totalFrameTime = 0;
        this.lastFrameTime = performance.now();
        this.worstFrameTime = 0;
        this.memorySnapshots = [];
    }

    /**
     * パフォーマンスマークを設定
     * @param {string} name - マーク名
     */
    mark(name) {
        if (!this.enabled) return;
        try {
            performance.mark(name);
        } catch (e) {
            console.warn('Performance mark failed:', name, e);
        }
    }

    /**
     * パフォーマンス測定を実行
     * @param {string} name - 測定名
     * @param {string} startMark - 開始マーク名
     * @param {string} [endMark] - 終了マーク名（省略時は現在時刻）
     * @returns {number|null} 測定時間（ミリ秒）
     */
    measure(name, startMark, endMark) {
        if (!this.enabled) return null;

        try {
            const measureName = `${name}-measure`;

            // 測定実行
            if (endMark) {
                performance.measure(measureName, startMark, endMark);
            } else {
                performance.measure(measureName, startMark);
            }

            // 測定結果取得
            const entries = performance.getEntriesByName(measureName);
            if (entries.length > 0) {
                const duration = entries[entries.length - 1].duration;

                // 統計情報を蓄積
                if (!this.measurements.has(name)) {
                    this.measurements.set(name, {
                        count: 0,
                        total: 0,
                        min: Infinity,
                        max: -Infinity,
                        avg: 0,
                    });
                }

                const stats = this.measurements.get(name);
                stats.count++;
                stats.total += duration;
                stats.min = Math.min(stats.min, duration);
                stats.max = Math.max(stats.max, duration);
                stats.avg = stats.total / stats.count;

                // 測定データをクリア（メモリ節約）
                performance.clearMarks(startMark);
                if (endMark) performance.clearMarks(endMark);
                performance.clearMeasures(measureName);

                return duration;
            }
        } catch (e) {
            console.warn('Performance measure failed:', name, e);
        }

        return null;
    }

    /**
     * フレーム時間を記録（アニメーションループから呼び出す）
     */
    recordFrame() {
        if (!this.enabled) return;

        const now = performance.now();
        const frameTime = now - this.lastFrameTime;
        this.lastFrameTime = now;

        this.frameCount++;
        this.totalFrameTime += frameTime;
        this.worstFrameTime = Math.max(this.worstFrameTime, frameTime);
    }

    /**
     * メモリ使用量を記録（利用可能な場合）
     */
    recordMemory() {
        if (!this.enabled) return;

        // performance.memory は Chrome のみ
        if (performance.memory) {
            this.memorySnapshots.push({
                timestamp: Date.now(),
                usedJSHeapSize: performance.memory.usedJSHeapSize,
                totalJSHeapSize: performance.memory.totalJSHeapSize,
                jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
            });

            // 最新100件のみ保持
            if (this.memorySnapshots.length > 100) {
                this.memorySnapshots.shift();
            }
        }
    }

    /**
     * パフォーマンス統計をコンソールに出力
     */
    logStats() {
        if (!this.enabled) return;

        console.log('===== Performance Statistics =====');

        // 測定統計
        if (this.measurements.size > 0) {
            console.log('\n[Operation Times]');
            for (const [name, stats] of this.measurements) {
                console.log(`  ${name}:`);
                console.log(`    Count: ${stats.count}`);
                console.log(`    Avg:   ${stats.avg.toFixed(2)}ms`);
                console.log(`    Min:   ${stats.min.toFixed(2)}ms`);
                console.log(`    Max:   ${stats.max.toFixed(2)}ms`);
            }
        }

        // フレーム統計
        if (this.frameCount > 0) {
            const avgFrameTime = this.totalFrameTime / this.frameCount;
            const avgFPS = 1000 / avgFrameTime;
            console.log('\n[Frame Performance]');
            console.log(`  Frames:         ${this.frameCount}`);
            console.log(`  Avg Frame Time: ${avgFrameTime.toFixed(2)}ms`);
            console.log(`  Avg FPS:        ${avgFPS.toFixed(1)}`);
            console.log(`  Worst Frame:    ${this.worstFrameTime.toFixed(2)}ms`);
        }

        // メモリ統計
        if (this.memorySnapshots.length > 0) {
            const latest = this.memorySnapshots[this.memorySnapshots.length - 1];
            const usedMB = (latest.usedJSHeapSize / 1024 / 1024).toFixed(2);
            const totalMB = (latest.totalJSHeapSize / 1024 / 1024).toFixed(2);
            const limitMB = (latest.jsHeapSizeLimit / 1024 / 1024).toFixed(2);

            console.log('\n[Memory Usage]');
            console.log(`  Used:  ${usedMB} MB`);
            console.log(`  Total: ${totalMB} MB`);
            console.log(`  Limit: ${limitMB} MB`);
        }

        console.log('\n==================================');
    }

    /**
     * 統計をリセット
     */
    reset() {
        this.measurements.clear();
        this.frameCount = 0;
        this.totalFrameTime = 0;
        this.worstFrameTime = 0;
        this.memorySnapshots = [];
        this.lastFrameTime = performance.now();
        performance.clearMarks();
        performance.clearMeasures();
    }

    /**
     * モニタリングを有効/無効化
     * @param {boolean} enabled
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.reset();
        }
    }
}

// シングルトンインスタンスを作成
const monitor = new PerformanceMonitor();

// URLパラメータで有効/無効を切り替え
// 例: ?perfmon=1 で有効化
if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const enableParam = urlParams.get('perfmon');

    // デフォルトは無効、?perfmon=1 または localStorage設定で有効化
    const enabledByUrl = enableParam === '1' || enableParam === 'true';
    const enabledByStorage = localStorage.getItem('perfmon-enabled') === '1';

    monitor.setEnabled(enabledByUrl || enabledByStorage);

    // デバッグ用にウィンドウオブジェクトに公開
    window.perfMonitor = monitor;

    // 便利なコンソールコマンド
    window.enablePerfMon = () => {
        localStorage.setItem('perfmon-enabled', '1');
        monitor.setEnabled(true);
        console.log('✅ Performance monitoring enabled (saved to localStorage)');
    };

    window.disablePerfMon = () => {
        localStorage.removeItem('perfmon-enabled');
        monitor.setEnabled(false);
        console.log('❌ Performance monitoring disabled');
    };

    if (monitor.enabled) {
        console.log('📊 Performance monitoring is ACTIVE');
        console.log('   Use window.perfMonitor.logStats() to view stats');
        console.log('   Use window.disablePerfMon() to disable');
    }
}

// ES Module対応
export default monitor;
