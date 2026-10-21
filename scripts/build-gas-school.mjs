/**
 * 学校（naha-okinawa.ed.jp）の Google アカウント用の GAS 版
 *
 * 中身は個人アカウント版（gas/）とまったく同じ。npm run build:gas の結果をコピーするだけ。
 * ちがうのは gas-school/appsscript.json の公開範囲だけ（"DOMAIN" = 学校のアカウントの人だけ開ける）。
 * デプロイには、学校のアカウントで clasp にログインしておく（clasp login --user school）。
 */

import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ROOT } from './bundle.mjs';

for (const file of ['index.html', 'Code.js']) {
    await copyFile(resolve(ROOT, 'gas', file), resolve(ROOT, 'gas-school', file));
}
console.log('[build-gas-school] gas/ の index.html と Code.js を gas-school/ にコピーしました');
