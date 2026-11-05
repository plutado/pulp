/**
 * The interface's words in British English (milestone 59): only what differs
 * from US English, the source (src/locales/en-US.ts) — colour, grey, centre,
 * favourite, theatre, licence, customise — and US English for everything else.
 * The search field's filter keywords (`favorite:`) are syntax, not words, and
 * stay as they are typed in every language.
 */

import type { Catalog } from '../core/i18n';

export const enGB: Catalog = {
  'ui.chip-favorites.aria-label': 'Favourites',
  'ui.chip-favorites.data-tip': 'Favourites only',
  'ui.chip-favorites.favorites': 'Favourites',
  'ui.bg-gray.aria-label': 'Grey background',
  'ui.bg-gray.data-tip': 'Mid-grey: the neutral a soft edge is judged against',
  'ui.bg-custom.aria-label': 'Custom background colour',
  'ui.bg-custom.data-tip': 'A colour of your own',
  'ui.theater.aria-label': 'Theatre: hide the results',
  'ui.theater.data-tip': 'Theatre: the stage takes the window (T)',
  'ui.opt-lut-field.data-tip': 'A .cube colour grade over the whole render, applied before the preset\'s colour conversion',
  'ui.opt-tint-field.recolor': 'Recolour',
  'ui.opt-tint-on.aria-label': 'Recolour the picture',
  'ui.opt-tint-on.data-tip': 'Render the picture\'s luminance in one colour, alpha kept — to match a palette',
  'ui.opt-tint.aria-label': 'Recolour colour',
  'ui.opt-matte-field.data-tip': 'A second file beside the render with the alpha as grey, for codecs and editors without alpha',
  'ui.start-screen.browse-customize-and-render-motion': 'Browse, customise and render motion-graphics templates.',
  'ui.settings-dialog.how-the-window-looks-every': 'How the window looks — every window, the start screen and the dialogs at once. The stage’s checkerboard follows it too; a chosen black, white, grey or custom background and what a template draws stay as they are. Also in View → Appearance.',
  'ui.key-title': 'Key out a colour',
  'ui.key-dialog.the-color-becomes-transparency-and': 'The colour becomes transparency and its cast is washed from what remains. Pick it from the frame on the left, or choose it below; the result is written beside the original as an alpha clip, its sound kept.',
  'ui.key-plain.title': 'Choose the colour here',
  'ui.key-plain.alt': 'A frame of the clip; choosing a point on it picks the colour to key out',
  'ui.key-keyed.alt': 'The same frame with the colour keyed out',
  'ui.key-dialog.color': 'Colour',
  'ui.pack-export-fields.an-spdx-license-identifier-e.title': 'An SPDX licence identifier, e.g. CC0-1.0 or MIT',
  'ui.pack-export-fields.license': 'Licence',
  'menu.layer.exposeColor': 'Make Colour a Parameter',
  'menu.view.theater': 'Theatre',
};
