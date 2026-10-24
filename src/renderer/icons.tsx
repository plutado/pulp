/**
 * The icon set (ADR 0011): Phosphor, MIT, inlined as SVG text at build time so only
 * the icons named here ship, with no font, no fetch and no CSP change. Every SVG
 * carries fill="currentColor", so icons follow text roles and states. Three sizes
 * (docs/ui-style.md): 16 inline and in chips, 20 in toolbars, 24 in the transport.
 * Regular weight is "off", fill is "on" (favorite, pressed, active).
 */

import arrowClockwise from '@phosphor-icons/core/assets/regular/arrow-clockwise.svg?raw';
import arrowsLeftRight from '@phosphor-icons/core/assets/regular/arrows-left-right.svg?raw';
import caretDown from '@phosphor-icons/core/assets/regular/caret-down.svg?raw';
import caretLeft from '@phosphor-icons/core/assets/regular/caret-left.svg?raw';
import caretRight from '@phosphor-icons/core/assets/regular/caret-right.svg?raw';
import caretUp from '@phosphor-icons/core/assets/regular/caret-up.svg?raw';
import checkCircle from '@phosphor-icons/core/assets/regular/check-circle.svg?raw';
import checkerboard from '@phosphor-icons/core/assets/regular/checkerboard.svg?raw';
import copy from '@phosphor-icons/core/assets/regular/copy.svg?raw';
import clock from '@phosphor-icons/core/assets/regular/clock.svg?raw';
import dotsSixVertical from '@phosphor-icons/core/assets/regular/dots-six-vertical.svg?raw';
import downloadSimple from '@phosphor-icons/core/assets/regular/download-simple.svg?raw';
import exportIcon from '@phosphor-icons/core/assets/regular/export.svg?raw';
import filmStrip from '@phosphor-icons/core/assets/regular/film-strip.svg?raw';
import folder from '@phosphor-icons/core/assets/regular/folder.svg?raw';
import frameCorners from '@phosphor-icons/core/assets/regular/frame-corners.svg?raw';
import folderPlus from '@phosphor-icons/core/assets/regular/folder-plus.svg?raw';
import hardDrive from '@phosphor-icons/core/assets/regular/hard-drive.svg?raw';
import image from '@phosphor-icons/core/assets/regular/image.svg?raw';
import imageSquare from '@phosphor-icons/core/assets/regular/image-square.svg?raw';
import info from '@phosphor-icons/core/assets/regular/info.svg?raw';
import magnifyingGlass from '@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw';
import musicNotes from '@phosphor-icons/core/assets/regular/music-notes.svg?raw';
import packageIcon from '@phosphor-icons/core/assets/regular/package.svg?raw';
import palette from '@phosphor-icons/core/assets/regular/palette.svg?raw';
import question from '@phosphor-icons/core/assets/regular/question.svg?raw';
import repeat from '@phosphor-icons/core/assets/regular/repeat.svg?raw';
import rows from '@phosphor-icons/core/assets/regular/rows.svg?raw';
import squaresFour from '@phosphor-icons/core/assets/regular/squares-four.svg?raw';
import tag from '@phosphor-icons/core/assets/regular/tag.svg?raw';
import pause from '@phosphor-icons/core/assets/regular/pause.svg?raw';
import play from '@phosphor-icons/core/assets/regular/play.svg?raw';
import playCircle from '@phosphor-icons/core/assets/regular/play-circle.svg?raw';
import shapes from '@phosphor-icons/core/assets/regular/shapes.svg?raw';
import slidersHorizontal from '@phosphor-icons/core/assets/regular/sliders-horizontal.svg?raw';
import sortAscending from '@phosphor-icons/core/assets/regular/sort-ascending.svg?raw';
import speakerHigh from '@phosphor-icons/core/assets/regular/speaker-high.svg?raw';
import speakerSlash from '@phosphor-icons/core/assets/regular/speaker-slash.svg?raw';
import spinner from '@phosphor-icons/core/assets/regular/spinner.svg?raw';
import stack from '@phosphor-icons/core/assets/regular/stack.svg?raw';
import star from '@phosphor-icons/core/assets/regular/star.svg?raw';
import starFill from '@phosphor-icons/core/assets/fill/star-fill.svg?raw';
import textAa from '@phosphor-icons/core/assets/regular/text-aa.svg?raw';
import trash from '@phosphor-icons/core/assets/regular/trash.svg?raw';
import uploadSimple from '@phosphor-icons/core/assets/regular/upload-simple.svg?raw';
import warning from '@phosphor-icons/core/assets/regular/warning.svg?raw';
import x from '@phosphor-icons/core/assets/regular/x.svg?raw';

const ICONS = {
  'arrow-clockwise': arrowClockwise,
  'arrows-left-right': arrowsLeftRight,
  'caret-down': caretDown,
  'caret-left': caretLeft,
  'caret-right': caretRight,
  'caret-up': caretUp,
  'check-circle': checkCircle,
  checkerboard,
  clock,
  copy,
  'dots-six-vertical': dotsSixVertical,
  'download-simple': downloadSimple,
  export: exportIcon,
  'film-strip': filmStrip,
  folder,
  'folder-plus': folderPlus,
  'frame-corners': frameCorners,
  'hard-drive': hardDrive,
  image,
  'image-square': imageSquare,
  info,
  'magnifying-glass': magnifyingGlass,
  'music-notes': musicNotes,
  package: packageIcon,
  palette,
  pause,
  question,
  play,
  'play-circle': playCircle,
  repeat,
  rows,
  shapes,
  'sliders-horizontal': slidersHorizontal,
  'sort-ascending': sortAscending,
  'speaker-high': speakerHigh,
  'speaker-slash': speakerSlash,
  spinner,
  'squares-four': squaresFour,
  stack,
  star,
  'star-fill': starFill,
  tag,
  'text-aa': textAa,
  trash,
  'upload-simple': uploadSimple,
  warning,
  x,
} as const;

export type IconName = keyof typeof ICONS;
export type IconSize = 16 | 20 | 24;

export function isIconName(name: string): name is IconName {
  return name in ICONS;
}

/** The SVG markup at a size, decorative (aria-hidden); the host element carries the accessible name. */
export function iconSvg(name: IconName, size: IconSize = 16): string {
  return ICONS[name].replace('<svg ', `<svg class="icon" width="${size}" height="${size}" aria-hidden="true" focusable="false" `);
}

export function iconElement(name: IconName, size: IconSize = 16): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = iconSvg(name, size);
  return template.content.firstElementChild as SVGSVGElement;
}

/** Puts the icon first inside the host, replacing one that is already there (state swaps). */
export function setIcon(host: Element, name: IconName, size: IconSize = 16): void {
  const next = iconElement(name, size);
  const current = host.querySelector(':scope > svg.icon');
  if (current) current.replaceWith(next);
  else host.prepend(next);
}

/** Static markup declares icons with data-icon (and data-icon-size); this fills them in once. */
export function mountIcons(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-icon]')) {
    const name = el.dataset.icon ?? '';
    if (!isIconName(name)) continue;
    const size = Number(el.dataset.iconSize ?? 16) as IconSize;
    setIcon(el, name, size);
  }
}

/** The same thing for Preact-rendered regions. */
export function Icon({ name, size = 16 }: { name: IconName; size?: IconSize }) {
  return <span class="icon-wrap" dangerouslySetInnerHTML={{ __html: iconSvg(name, size) }} />;
}

/** Type-group icons for templates and kind icons for media, used as empty-thumbnail placeholders and in the tree. */
export const TYPE_GROUP_ICONS: Record<string, IconName> = {
  titles: 'text-aa',
  backgrounds: 'image-square',
  transitions: 'arrows-left-right',
  overlays: 'stack',
  elements: 'shapes',
  video: 'film-strip',
  stills: 'image',
  music: 'music-notes',
  sfx: 'speaker-high',
};

/** One icon per scope kind, shared by the tree, the icon rail and the scope chip (type and group scopes use their group's icon). */
export function scopeIcon(kind: string | undefined, group: string | undefined): IconName {
  switch (kind) {
    case 'favorites': return 'star';
    case 'recent': return 'clock';
    case 'built-in':
    case 'pack': return 'package';
    case 'folder': return 'folder';
    case 'type':
    case 'group': return group ? (TYPE_GROUP_ICONS[group] ?? 'shapes') : 'shapes';
    case 'untyped': return 'question';
    case 'theme': return 'tag';
    case 'style': return 'palette';
    default: return 'folder';
  }
}

export const MEDIA_KIND_ICONS: Record<string, IconName> = {
  video: 'film-strip',
  image: 'image',
  audio: 'music-notes',
};
