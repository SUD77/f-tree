/*
 * The advance tables of every font a template may name, keyed as templates name them.
 *
 * The tables themselves are generated from the TTFs the release embeds (tools/font_metrics.mjs);
 * this file only gathers them, so the composer imports one module whatever the template.
 */

import bookDisplay from './book_display.js';
import bookText from './book_text.js';
import bookStrong from './book_strong.js';

export const METRICS = Object.freeze({
  book_display: bookDisplay,
  book_text: bookText,
  book_strong: bookStrong,
});
