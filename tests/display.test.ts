import { describe, expect, it } from 'vitest';
import { audioLabel, categoryLabel, clockLabel, codecLabel, dimensionsLabel, durationLabel, extensionLabel, frameRateLabel, humanize, itemCount, mediaKindLabel, rootLabel, sizeLabel, styleLabel, tagLabel, themeLabel, typeLabel, windowTitle } from '../src/core/display';

describe('humanize and tags', () => {
  it('turns stored slugs into sentence-case words', () => {
    expect(humanize('lower-third')).toBe('Lower third');
    expect(humanize('my_show')).toBe('My show');
    expect(humanize('news')).toBe('News');
    expect(humanize('')).toBe('');
    expect(tagLabel('breaking-news-2026')).toBe('Breaking news 2026');
  });
});

describe('taxonomy labels', () => {
  it('uses the built-in label when there is one and humanizes otherwise', () => {
    expect(typeLabel('lower-third')).toBe('Lower third');
    expect(typeLabel('end-card')).toBe('End card / credits');
    expect(typeLabel('something-new')).toBe('Something new');
    expect(categoryLabel('lower-third')).toBe('Lower third');
    expect(categoryLabel('other')).toBe('Other');
    expect(themeLabel('news')).toBe('News / broadcast');
    expect(themeLabel('my-show')).toBe('My show');
    expect(styleLabel('high-energy')).toBe('High-energy');
  });
});

describe('media facts', () => {
  it('formats kinds, extensions, codecs, dimensions, rates, durations and sizes', () => {
    expect(mediaKindLabel('video')).toBe('Video');
    expect(extensionLabel('.mov')).toBe('MOV');
    expect(extensionLabel('wav')).toBe('WAV');
    expect(codecLabel('prores')).toBe('ProRes');
    expect(codecLabel('h264')).toBe('H.264');
    expect(codecLabel('pcm_s16le')).toBe('PCM 16-bit');
    expect(codecLabel('pcm_s32be')).toBe('PCM 32-bit');
    expect(codecLabel('qtrle')).toBe('QuickTime Animation');
    expect(codecLabel('ffv1')).toBe('FFV1');
    expect(dimensionsLabel(1920, 1080)).toBe('1920 × 1080');
    expect(frameRateLabel(29.97)).toBe('29.97 fps');
    expect(durationLabel(6)).toBe('6 s');
    expect(durationLabel(1.5)).toBe('1.5 s');
    expect(clockLabel(6)).toBe('6 s');
    expect(clockLabel(1.25)).toBe('1.3 s');
    expect(clockLabel(59.9)).toBe('59.9 s');
    expect(clockLabel(60)).toBe('1:00');
    expect(clockLabel(95.4)).toBe('1:35');
    expect(clockLabel(3725)).toBe('1:02:05');
    expect(clockLabel(-1)).toBe('');
    expect(sizeLabel(512)).toBe('512 B');
    expect(sizeLabel(2048)).toBe('2 KB');
    expect(sizeLabel(12.4 * 1024 ** 2)).toBe('12.4 MB');
    expect(sizeLabel(512 * 1024 ** 2)).toBe('512 MB');
    expect(sizeLabel(3 * 1024 ** 3)).toBe('3 GB');
    expect(sizeLabel(2.5 * 1024 ** 3)).toBe('2.5 GB');
    expect(audioLabel('pcm_s16le', 2, 48000)).toBe('PCM 16-bit · 2 ch · 48 kHz');
    expect(audioLabel('aac')).toBe('AAC');
  });
});

describe('rootLabel', () => {
  it('names the bundled root and humanizes user folder names, leaving readable ones alone', () => {
    expect(rootLabel('/app/templates', '/app/templates')).toBe('Built-in templates');
    expect(rootLabel('/Users/x/Footage/News Pack/', '/app/templates')).toBe('News Pack');
    expect(rootLabel('/Users/x/media-library', undefined)).toBe('Media library');
    expect(rootLabel('C:\\Media\\b-roll', undefined)).toBe('B roll');
  });
});

describe('the window title', () => {
  it('names the checkout when run from source, so two copies are told apart', () => {
    expect(windowTitle('/Users/dana/Web/feature-x', false)).toBe('Pulp — feature-x');
    expect(windowTitle('/Users/dana/Web/pulp', false)).toBe('Pulp — pulp');
    // Windows paths and a trailing separator name the same folder.
    expect(windowTitle('D:\\a\\pulp\\release-2', false)).toBe('Pulp — release-2');
    expect(windowTitle('/Users/dana/Web/feature-x/', false)).toBe('Pulp — feature-x');
  });

  it('is the plain name in a packaged build, whatever the path', () => {
    expect(windowTitle('/Applications/Pulp.app/Contents/Resources/app.asar', true)).toBe('Pulp');
  });

  it('falls back to the plain name when there is no folder to name', () => {
    expect(windowTitle('/', false)).toBe('Pulp');
    expect(windowTitle('', false)).toBe('Pulp');
    expect(windowTitle('   ', false)).toBe('Pulp');
  });
});

describe('itemCount', () => {
  it('counts in words, so a browse node can be read as well as seen', () => {
    expect(itemCount(0)).toBe('0 items');
    expect(itemCount(1)).toBe('1 item');
    expect(itemCount(5)).toBe('5 items');
  });
});
