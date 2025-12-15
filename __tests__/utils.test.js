/**
 * ユーティリティ関数のテスト
 * カラー変換機能をテスト
 */

import { describe, it, expect } from 'vitest';
import { hexToCSS, hexToRGBA } from '../src/js/utils.js';

describe('hexToCSS', () => {
    it('16進数カラーをCSS形式に変換する', () => {
        expect(hexToCSS(0xff5577)).toBe('#ff5577');
        expect(hexToCSS(0x00f5ff)).toBe('#00f5ff');
        expect(hexToCSS(0xffffff)).toBe('#ffffff');
        expect(hexToCSS(0x000000)).toBe('#000000');
    });

    it('小さい値でも6桁にパディングされる', () => {
        expect(hexToCSS(0x000001)).toBe('#000001');
        expect(hexToCSS(0x00000f)).toBe('#00000f');
        expect(hexToCSS(0x0000ff)).toBe('#0000ff');
    });

    it('nullの場合デフォルト値を返す', () => {
        expect(hexToCSS(null)).toBe('#000000');
    });

    it('undefinedの場合デフォルト値を返す', () => {
        expect(hexToCSS(undefined)).toBe('#000000');
    });
});

describe('hexToRGBA', () => {
    it('16進数カラーをRGBA形式に変換する', () => {
        expect(hexToRGBA(0xff5577, 1)).toBe('rgba(255,85,119,1)');
        expect(hexToRGBA(0x00f5ff, 1)).toBe('rgba(0,245,255,1)');
        expect(hexToRGBA(0xffffff, 1)).toBe('rgba(255,255,255,1)');
        expect(hexToRGBA(0x000000, 1)).toBe('rgba(0,0,0,1)');
    });

    it('アルファ値を正しく適用する', () => {
        expect(hexToRGBA(0xff5577, 0.5)).toBe('rgba(255,85,119,0.5)');
        expect(hexToRGBA(0x00f5ff, 0)).toBe('rgba(0,245,255,0)');
        expect(hexToRGBA(0xff5577, 0.75)).toBe('rgba(255,85,119,0.75)');
    });

    it('アルファ値のデフォルトは1', () => {
        expect(hexToRGBA(0xff5577)).toBe('rgba(255,85,119,1)');
    });

    it('CSS形式の16進数文字列も処理できる', () => {
        expect(hexToRGBA('#ff5577', 1)).toBe('rgba(255,85,119,1)');
        expect(hexToRGBA('#00f5ff', 0.8)).toBe('rgba(0,245,255,0.8)');
    });

    it('nullの場合デフォルト値を返す', () => {
        expect(hexToRGBA(null, 0.5)).toBe('rgba(0,0,0,0.5)');
    });

    it('undefinedの場合デフォルト値を返す', () => {
        expect(hexToRGBA(undefined, 0.7)).toBe('rgba(0,0,0,0.7)');
    });
});
