/** Vite inlines the file's text at build time (used for Phosphor's SVGs, ADR 0011). A global
 * declaration file on purpose: a wildcard module pattern only works outside a module file. */
declare module '*.svg?raw' {
  const content: string;
  export default content;
}
