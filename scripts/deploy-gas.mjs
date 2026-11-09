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
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLASP_USER = 'naha';
const PROJECT_DIR = resolve(ROOT, 'gas-school');

/**
 * clasp 本体の JS（package.json の bin）を探す。見つからなければ null。
 * 探す順: このリポジトリの node_modules → PATH の各フォルダの横の node_modules
 * （Windows の npm -g は %APPDATA%\npm\node_modules、Unix は <prefix>/lib/node_modules）。
 */
export function resolveClaspEntry({ root = ROOT, pathEnv = process.env.PATH || '', exists = existsSync, readJson } = {}) {
    const read = readJson || (p => JSON.parse(readFileSync(p, 'utf8')));
    const dirs = [join(root, 'node_modules')];
    for (const d of pathEnv.split(delimiter).filter(Boolean)) {
        dirs.push(join(d, 'node_modules'), join(d, '..', 'lib', 'node_modules'));
    }
    for (const nm of dirs) {
        const pkgDir = join(nm, '@google', 'clasp');
        const pkgPath = join(pkgDir, 'package.json');
        if (!exists(pkgPath)) continue;
        const bin = read(pkgPath).bin;
        const rel = typeof bin === 'string' ? bin : bin?.clasp;
        if (rel) return resolve(pkgDir, rel);
    }
    return null;
}

/**
 * clasp を動かす命令を組み立てる。shell は使わない（引数はそのまま渡る＝パスに & や空白があっても
 * cmd.exe に解釈されない）。Windows の clasp は .cmd で shell なしでは起動できないので、
 * node で clasp 本体の JS を直接動かす。
 */
export function claspCommand(args, { platform = process.platform, entry = resolveClaspEntry(), nodePath = process.execPath } = {}) {
    if (entry) return { cmd: nodePath, argv: [entry, ...args], options: { shell: false } };
    if (platform === 'win32') {
        throw new Error('clasp が見つかりません（npm i -g @google/clasp を確認してください）');
    }
    return { cmd: 'clasp', argv: args, options: { shell: false } };
}

function clasp(args) {
    const { cmd, argv, options } = claspCommand(args);
    const r = spawnSync(cmd, argv, { ...options, stdio: 'inherit', cwd: ROOT });
    if (r.error) throw r.error;
    if (r.status !== 0) process.exit(r.status ?? 1);
}

function main() {
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
}

// テストから import したときは動かさない
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
