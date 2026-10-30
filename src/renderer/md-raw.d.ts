/** Vite inlines the file's text at build time (the changelog, for What's new — milestone 31).
 * A global declaration file on purpose, as svg-raw.d.ts is. */
declare module '*.md?raw' {
  const content: string;
  export default content;
}
