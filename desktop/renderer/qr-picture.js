/*
 * The square on the receive screen: a nearby link, drawn as a QR code.
 *
 * The encoding is not done here. `vendor/qr.js` is Kazuhiko Arase's qrcode-generator, unedited,
 * because the parts of a QR encoder that can be wrong -- Reed-Solomon, the mask penalty -- are wrong
 * in the worst way: the code still scans, as a different string. This file only asks it for a
 * matrix and draws the matrix, which is the part that can be checked by eye and by test.
 *
 * Pure: the encoder is passed in rather than read off `window`, so `qr-picture.test.js` runs it
 * under node against the same vendored file the page loads.
 */

/**
 * The margin, in modules. ISO/IEC 18004 asks for four, and a scanner that cannot find the edge of
 * the code does not read it -- the quiet zone is part of the symbol, not decoration around it.
 */
export const QUIET_ZONE = 4;

/**
 * M, the second of four levels: about 15% of the symbol can be lost and still read.
 *
 * A phone reading a laptop screen sees glare, moire and a hand that is not quite still, and those
 * cost modules. L would give a smaller symbol for the same link and lose the margin that pays for
 * them; Q and H buy robustness a screen does not need, at the price of a denser code that is harder
 * to read from arm's length.
 */
export const ERROR_CORRECTION = 'M';

/**
 * The modules for `text`, as rows of booleans, dark = true.
 *
 * A nearby link is ASCII by construction -- an address, hex, base64url, and a name that is
 * percent-encoded -- and this refuses anything else rather than let the encoder's default byte
 * conversion, which is Latin-1, quietly turn a character into a different one.
 */
export function qrMatrix(qrcode, text) {
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error('a nearby link is ASCII; refusing to encode this');
  const qr = qrcode(0, ERROR_CORRECTION);
  qr.addData(text, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  const rows = [];
  for (let r = 0; r < size; r += 1) {
    const row = [];
    for (let c = 0; c < size; c += 1) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

/**
 * One path for the whole symbol, a run of dark modules per segment, offset by the quiet zone.
 *
 * Runs rather than one square per module, so a version-10 code is a few hundred segments and not
 * three thousand, and `shape-rendering: crispEdges` on the SVG keeps the modules' edges on pixels
 * when the square is scaled.
 */
export function qrPath(matrix) {
  let d = '';
  matrix.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) { c += 1; continue; }
      const start = c;
      while (c < row.length && row[c]) c += 1;
      d += `M${start + QUIET_ZONE} ${r + QUIET_ZONE}h${c - start}v1h${start - c}z`;
    }
  });
  return d;
}

/**
 * The symbol as an SVG element's markup, sized by its container.
 *
 * Dark on light in both themes. Many scanners do not try an inverted code, so a dark-mode square
 * drawn light-on-dark would look right and read as nothing; the pale plate the code sits on is its
 * quiet zone, and it stays pale.
 */
export function qrSvg(matrix, { label }) {
  const extent = matrix.length + QUIET_ZONE * 2;
  const safe = String(label).replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" `
    + `role="img" aria-label="${safe}" shape-rendering="crispEdges">`
    + `<rect width="${extent}" height="${extent}" fill="#ffffff"/>`
    + `<path d="${qrPath(matrix)}" fill="#000000"/></svg>`;
}
