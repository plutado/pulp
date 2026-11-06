/**
 * Finding the interface's words still written straight into the code (milestone 59),
 * for tests/i18n.test.ts. Each source file is parsed with the TypeScript compiler and
 * every string, template literal and piece of JSX text is looked at where it sits:
 *
 * - **Prose anywhere**: two or more words that read as a sentence or a name — a capital,
 *   punctuation, or three words and more. A CSS class list or an id does not.
 * - **Anything with a letter in a place the interface reads**: an element's text, a
 *   `label`, `title`, `hint`, `detail` or `description`, an accessible name or a tooltip,
 *   a line for the tray, JSX text. So a one-word button is found as a sentence is.
 *
 * Not looked at: imports, a call that logs or writes to the terminal, selectors and
 * event and channel names, CSS classes, a literal type, a property's own name.
 *
 * What is not the interface's — a command line's words, a diagnostic for a template's
 * author, library content, SQL and markup — is exempt by a stated reason: a whole file
 * in tests/i18n-exempt.json, or one string by an `i18n-exempt(<reason>)` comment on its
 * line or the line before. docs/translating.md says which is which.
 */

import ts from 'typescript';

export const EXEMPT_REASONS = ['terminal', 'diagnostic', 'content', 'technical'] as const;
export type ExemptReason = (typeof EXEMPT_REASONS)[number];

export interface Finding {
  line: number;
  text: string;
}

const LETTER = /\p{L}/u;

/** Two or more words that read as words for a person, not as an identifier list. */
export function isProse(text: string): boolean {
  const plain = text.replace(/\$\{[^}]*\}/g, 'X');
  const words = plain.match(/\p{L}[\p{L}'’]+/gu) ?? [];
  if (words.length < 2 || !/\s/.test(plain)) return false;
  if (/[A-Z]/.test(plain) || /[.!?…,:;—–()"“”]/.test(plain)) return true;
  return words.length >= 3;
}

/** A callee whose string arguments are not the interface's words. */
const QUIET_CALLEES = /^(console\.\w+|log\w*|\w+\.log\w*|debug|warn|process\.std(out|err)\.write|require|import|\w*[Qq]uerySelector(All)?|\w*\.?getElementById|\w*\.matches|\w*\.closest|\w*\.?addEventListener|\w*\.?removeEventListener|\w*\.setProperty|\w*\.?createElement(NS)?|\w*\.classList\.\w+|ipc(Main|Renderer)\.\w+|\w*\.?webContents\.send|\w*\.send|new RegExp|RegExp|\w*\.?matchMedia|\w*\.?postMessage|\w*\.?getAttribute|\w*\.?hasAttribute|\w*\.?removeAttribute|\w*\.?toggleAttribute|\w*\.?dispatchEvent|new (Custom)?Event|\w*\.?fetch|\w*\.?execJavaScript|\w*\.?executeJavaScript|\w*\.endsWith|\w*\.startsWith|\w*\.includes|\w*\.split|\w*\.replace(All)?|\w*\.join|\w*\.indexOf|\w*\.prepare|\w*\.exec|\w*\.run|\w*\.all|\w*\.get|spawn|execFile|nodeRunner|runForBuffer|runWithInput\w*)$/;

/** Property names and attributes whose value the interface reads. */
const SINK_PROPS = new Set(['label', 'title', 'hint', 'detail', 'description', 'placeholder', 'summary', 'note', 'tip', 'listAs', 'message', 'textContent', 'ariaLabel', 'innerText', 'alt', 'heading', 'body', 'caption', 'prompt', 'cta', 'action', 'status', 'warning', 'reason', 'subtitle', 'emptyText']);
const SINK_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'data-tip', 'alt', 'aria-description', 'aria-roledescription', 'aria-valuetext']);
/** Functions whose string argument goes to the window as a line a person reads. */
const SINK_CALLS = /^(sayInTray|say|sayNote|trayNote|sayRefused|setStatus|announce|confirm|alert|showError|note)$/;
/** Property names whose value is never words: classes, ids, keys, kinds. */
const QUIET_PROPS = new Set(['className', 'class', 'id', 'key', 'kind', 'type', 'role', 'command', 'accelerator', 'icon', 'tone', 'value', 'name', 'mime', 'encoder', 'codec', 'family', 'ext', 'extension', 'extensions', 'scheme', 'channel', 'selector', 'href', 'src', 'url', 'path', 'file', 'folder', 'tag', 'tags', 'filter', 'shape', 'cursor', 'align', 'dir', 'lang', 'mode', 'style', 'format', 'pixelFormat', 'color', 'unit', 'sort', 'group', 'whenFlag', 'enabledBy', 'checkedBy', 'arg', 'source', 'target', 'slug', 'recipe', 'args', 'codecArgs', 'preset', 'presetId', 'aspect', 'license', 'spdx']);

function propertyNameOf(node: ts.Node): string | undefined {
  const p = node.parent;
  if (ts.isPropertyAssignment(p) && p.initializer === node) return p.name.getText().replace(/['"]/g, '');
  if (ts.isBinaryExpression(p) && p.right === node && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const left = p.left.getText();
    return left.slice(left.lastIndexOf('.') + 1).replace(/^dataset\./, '');
  }
  return undefined;
}

/** The node a literal's value really lands in, past the ternaries, `??`, `||`, parentheses and `+` it is built with. */
function landing(node: ts.Node): ts.Node {
  let at = node;
  for (;;) {
    const p = at.parent;
    if (!p) return at;
    if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || (ts.isConditionalExpression(p) && p.condition !== at)) at = p;
    else if (ts.isBinaryExpression(p) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.PlusToken].includes(p.operatorToken.kind)) at = p;
    else if (ts.isTemplateSpan(p) || ts.isTemplateExpression(p)) at = p;
    else return at;
  }
}

function calleeOf(call: ts.CallExpression | ts.NewExpression): string {
  const text = call.expression.getText();
  return ts.isNewExpression(call) ? `new ${text}` : text;
}

type Verdict = 'quiet' | 'sink' | 'neutral';

function contextOf(node: ts.Node): Verdict {
  const at = landing(node);
  const p = at.parent;
  if (!p) return 'neutral';
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isLiteralTypeNode(p)) return 'quiet';
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)) && p.name === at) return 'quiet';
  if (ts.isElementAccessExpression(p) && p.argumentExpression === at) return 'quiet';
  if (ts.isCaseClause(p) || (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind))) return 'quiet';
  if (ts.isJsxAttribute(p.parent ?? p) || ts.isJsxAttribute(p)) {
    const attr = (ts.isJsxAttribute(p) ? p : (p.parent as ts.JsxAttribute)).name.getText();
    if (SINK_ATTRS.has(attr)) return 'sink';
    return 'quiet';
  }
  if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) {
    const attr = p.parent.name.getText();
    return SINK_ATTRS.has(attr) ? 'sink' : 'quiet';
  }
  if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
    const callee = calleeOf(p);
    if (/(^|\.)setAttribute$/.test(callee)) {
      const name = p.arguments?.[0];
      if (name === at) return 'quiet';
      return name && ts.isStringLiteral(name) && SINK_ATTRS.has(name.text) ? 'sink' : 'quiet';
    }
    if (SINK_CALLS.test(callee.slice(callee.lastIndexOf('.') + 1))) return 'sink';
    if (QUIET_CALLEES.test(callee)) return 'quiet';
    return 'neutral';
  }
  const prop = propertyNameOf(at);
  if (prop !== undefined) {
    if (QUIET_PROPS.has(prop) || /^(data-|on[A-Z])/.test(prop)) return 'quiet';
    if (SINK_PROPS.has(prop) || prop === 'tip') return 'sink';
  }
  return 'neutral';
}

/** The literal's own words, with its template parts as `${…}`. */
function literalText(node: ts.Node, source: ts.SourceFile): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.getText(source).slice(1, -1);
  if (ts.isJsxText(node)) return node.getText(source);
  return '';
}

function exemptByComment(lines: string[], line: number): boolean {
  return /i18n-exempt\((terminal|diagnostic|content|technical)\)/.test(lines[line - 1] ?? '') || /i18n-exempt\((terminal|diagnostic|content|technical)\)/.test(lines[line - 2] ?? '');
}

/** Every string in a file that is the interface's words and is not in the catalog. */
export function findWords(file: string, text: string): Finding[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = text.split('\n');
  const found: Finding[] = [];
  const visit = (node: ts.Node) => {
    const isLiteral = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node);
    if (isLiteral || ts.isJsxText(node)) {
      const words = literalText(node, source);
      if (LETTER.test(words.replace(/\$\{[^}]*\}/g, ''))) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        let hit = false;
        if (ts.isJsxText(node)) hit = words.trim() !== '';
        else {
          const verdict = contextOf(node);
          if (verdict === 'sink') hit = true;
          else if (verdict === 'neutral') hit = isProse(words);
        }
        if (hit && !exemptByComment(lines, line)) found.push({ line, text: words.trim().replace(/\s+/g, ' ').slice(0, 100) });
      }
      // A template's own parts are expressions: their strings are looked at on their own.
      if (!ts.isTemplateExpression(node)) return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
