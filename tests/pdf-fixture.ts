/**
 * A PDF writer for the tests (milestone 33): one page, two rectangles, each
 * inside an optional content group — the layers Illustrator writes — with one
 * group off by default. Uncompressed and offset-correct; generated, never
 * shipped. Mirrors what pdf.js is asked to read; nothing in the app writes PDF.
 */

export interface PdfFixtureOptions {
  /** Leave the optional content groups out: a PDF with no layers. */
  withLayers?: boolean;
  /** Page size in points. */
  width?: number;
  height?: number;
}

export function writePdf(options: PdfFixtureOptions = {}): Buffer {
  const withLayers = options.withLayers ?? true;
  const width = options.width ?? 100;
  const height = options.height ?? 50;
  const half = Math.floor(width / 2);
  const content = withLayers
    ? `/OC /oc1 BDC\n1 0 0 rg 0 0 ${half} ${height} re f\nEMC\n/OC /oc2 BDC\n0 0 1 rg ${half} 0 ${half} ${height} re f\nEMC\n`
    : `1 0 0 rg 0 0 ${width} ${height} re f\n`;
  const objects: string[] = [
    withLayers
      ? `<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R 6 0 R] /D << /Order [5 0 R 6 0 R] /OFF [6 0 R] >> >> >>`
      : `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    withLayers
      ? `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /Properties << /oc1 5 0 R /oc2 6 0 R >> >> >>`
      : `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    ...(withLayers ? [`<< /Type /OCG /Name (Backdrop) >>`, `<< /Type /OCG /Name (Mark) >>`] : []),
  ];
  let out = '%PDF-1.5\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
