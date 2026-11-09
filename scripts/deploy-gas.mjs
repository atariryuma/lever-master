/**
 * GAS 版（gas-school）を clasp で push / redeploy する
 *
 *   node scripts/deploy-gas.mjs push    … push だけ（npm run push:gas）
 *   node scripts/deploy-gas.mjs deploy  … push のあと、決まったデプロイを差しかえる（npm run deploy:gas）
 *
 * npm の scripts は Windows では cmd.exe で動くので、`$PWD` や `$npm_package_config_*` が展開されない。
 * そのため、パスとデプロイ ID はここで組み立てる。
 * 学校のアカウントの clasp の資格情報の名前は naha（clasp login --user naha）。
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLASP_USER = 'naha';
const PROJECT_DIR = resolve(ROOT, 'gas-school');

function clasp(args) {
    const isWin = process.platform === 'win32';
    // Windows の clasp は .cmd なので shell 経由で動かす。そのとき空白をふくむ引数は自分で囲む
    const argv = isWin ? args.map(a => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)) : args;
    const r = spawnSync('clasp', argv, { stdio: 'inherit', cwd: ROOT, shell: isWin });
    if (r.error) throw r.error;
    if (r.status !== 0) process.exit(r.status ?? 1);
}

const mode = process.argv[2];
if (mode !== 'push' && mode !== 'deploy') {
    console.error('使い方: node scripts/deploy-gas.mjs push|deploy');
    process.exit(2);
}

const base = ['--user', CLASP_USER, '-P', PROJECT_DIR];
clasp([...base, 'push', '-f']);

if (mode === 'deploy') {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
    const deploymentId = pkg.config?.gasDeploymentId;
    if (!deploymentId) {
        console.error('[deploy-gas] package.json の config.gasDeploymentId がありません');
        process.exit(1);
    }
    clasp([...base, 'redeploy', deploymentId, '--description', 'sync from src']);
}
