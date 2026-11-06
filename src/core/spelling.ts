/**
 * British spelling (milestone 59): the words US and British English spell
 * differently, and the one function that turns the first into the second.
 *
 * The British catalog (src/locales/en-GB.ts) holds a message only where these
 * rules change it, and a test holds it to them, so the catalog and the rules
 * cannot drift apart. The user guide's British English is this function run
 * over the source guide (src/renderer/user-guide.ts): one guide to keep, and
 * only the words that differ.
 *
 * Words, not patterns, on purpose: "license" the noun is "licence" but the
 * verb is not, so "licensed" is left alone; a level "meter" is a meter in
 * Britain too; a computer "program" is a program. Inline `code` is left as it
 * is — a search filter (`favorite:`), a file name, a flag — and so is a token
 * that is typed or named rather than read: a file name, a path, a flag, a
 * filter written against its value (`favorite:yes`).
 */

/** US spelling → British, in lower case; capitals are matched and kept. */
const WORDS: Record<string, string> = {
  color: 'colour', colors: 'colours', colored: 'coloured', coloring: 'colouring', colorful: 'colourful', colorless: 'colourless',
  recolor: 'recolour', recolors: 'recolours', recolored: 'recoloured', recoloring: 'recolouring',
  gray: 'grey', grays: 'greys', grayed: 'greyed', grayish: 'greyish', grayscale: 'greyscale', 'mid-gray': 'mid-grey',
  center: 'centre', centers: 'centres', centered: 'centred', centering: 'centring',
  favorite: 'favourite', favorites: 'favourites', favorited: 'favourited', favor: 'favour', favors: 'favours',
  theater: 'theatre', theaters: 'theatres',
  license: 'licence', licenses: 'licences',
  behavior: 'behaviour', behaviors: 'behaviours', honor: 'honour', honors: 'honours', neighbor: 'neighbour', neighbors: 'neighbours',
  flavor: 'flavour', flavors: 'flavours', humor: 'humour', harbor: 'harbour', labor: 'labour',
  canceled: 'cancelled', canceling: 'cancelling', labeled: 'labelled', labeling: 'labelling', leveled: 'levelled', leveling: 'levelling',
  modeled: 'modelled', modeling: 'modelling', traveled: 'travelled', traveling: 'travelling', signaled: 'signalled',
  fulfill: 'fulfil', enroll: 'enrol', catalog: 'catalogue', catalogs: 'catalogues', defense: 'defence', offense: 'offence',
  customize: 'customise', customized: 'customised', customizing: 'customising', customization: 'customisation',
  organize: 'organise', organizes: 'organises', organized: 'organised', organizing: 'organising', organization: 'organisation',
  recognize: 'recognise', recognizes: 'recognises', recognized: 'recognised', recognizable: 'recognisable',
  realize: 'realise', realized: 'realised', optimize: 'optimise', optimized: 'optimised', minimize: 'minimise', minimized: 'minimised',
  maximize: 'maximise', maximized: 'maximised', normalize: 'normalise', normalized: 'normalised', prioritize: 'prioritise',
  summarize: 'summarise', visualize: 'visualise', finalize: 'finalise', finalized: 'finalised', apologize: 'apologise',
  synchronize: 'synchronise', synchronized: 'synchronised', analyze: 'analyse', analyzed: 'analysed', analyzing: 'analysing',
  emphasize: 'emphasise', standardize: 'standardise', localize: 'localise', localized: 'localised', localization: 'localisation',
  initialize: 'initialise', initialized: 'initialised', authorize: 'authorise', authorized: 'authorised',
};

// A listed word on its own: not inside a longer word ("colorspace"). Hyphenated prose is prose
// ("dark-gray", "color-coded").
const WORD = new RegExp(`(?<![\\p{L}\\p{N}_])(${Object.keys(WORDS).sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');

/**
 * A token that is typed or named rather than read, and so keeps its spelling: a file name or a
 * path ("color-wash.png", "docs/color.md"), a flag ("--color"), a filter typed against its value
 * ("favorite:yes"), an id with an underscore.
 */
const TYPED = /[./\\_]\p{L}|^--?\p{L}|\p{L}:\S/u;

function keepCase(from: string, to: string): string {
  if (from === from.toUpperCase()) return to.toUpperCase();
  if (from[0] === from[0]!.toUpperCase()) return to[0]!.toUpperCase() + to.slice(1);
  return to;
}

/** Text in British spelling: every listed word changed, keeping its capitals; inline code left as it is. */
export function britishSpelling(text: string): string {
  const prose = (part: string) => part.split(/(\s+)/).map((token) => (TYPED.test(token) ? token : token.replace(WORD, (word) => keepCase(word, WORDS[word.toLowerCase()]!)))).join('');
  // Inline code and a message's placeholders ({license}) are names, not words: left as they are.
  return text.split(/(`[^`]*`|\{\w+\})/).map((part) => (part.startsWith('`') || part.startsWith('{') ? part : prose(part))).join('');
}

/** The listed US spellings still in a text's prose — none, once it is British (what the tests hold the guide and the catalog to). */
export function usSpellingsIn(text: string): string[] {
  const found: string[] = [];
  for (const part of text.split(/(`[^`]*`|\{\w+\})/)) {
    if (part.startsWith('`') || part.startsWith('{')) continue;
    for (const token of part.split(/\s+/)) if (!TYPED.test(token)) for (const m of token.matchAll(WORD)) found.push(m[0]);
  }
  return found;
}
