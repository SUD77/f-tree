/*
 * The last page: an invitation, not a colophon.
 *
 * A family book is always missing somebody, and the person who notices is usually the one it was
 * sent to. So the last page asks for them - a name, a year, a photograph - and says how: the QR
 * code opens the website, where the app is. That is the whole of f-tree's reach into the world;
 * there is no account to join and nothing is sent anywhere by scanning it.
 *
 * The edition line ("This edition: September 2026") is what makes a second book worth sending.
 */

import { PAGE, rect, path, PathData } from '../format.js';
import { starfield, sparkleData, logo, qrPath } from './art.js';
import { nightGround } from './cover.js';
import { SITE_QR } from '../qr.js';

const { w: W, h: H } = PAGE;

export function closingPage(ctx) {
  const { P, family } = ctx;
  const items = [
    nightGround(ctx),
    starfield(`${family.title} closing`, 200, { x: 0, y: 0, w: W, h: H }, P.star),
    ctx.line(W / 2, 196, 'Is someone missing?', 'display', 42, P.star, { align: 'middle' }),
    ...ctx.lines(W / 2, 240, 'This book grew from our family tree. Add the people it is missing, with a name, a year or a photograph, and the next one will have them.', 'text', 13, P.gold, { width: 400, maxLines: 4, lead: 19, align: 'middle' }).items,
    path(String(sparkleData(W / 2, 360, 16)), { fill: P.star }),
    ctx.line(W / 2, 404, `This edition: ${ctx.now.label}`, 'text', 10, P.mist, { align: 'middle' }),
  ];
  if (ctx.attribution) {
    items.push(rect(W / 2 - 66, 440, 132, 132, { r: 10, fill: P.star }));
    items.push(qrPath(SITE_QR, W / 2 - 56, 450, 112, P.night));
    items.push(ctx.line(W / 2, 604, 'Scan to get f-tree', 'display', 18, P.star, { align: 'middle' }));
    items.push(ctx.line(W / 2, 624, 'Free and private. Your family stays on your phone.', 'text', 11, P.mist, { align: 'middle' }));
    items.push(...logo(W / 2 - 50, 724, 16, P.star, P.gold));
    items.push(ctx.line(W / 2 - 28, 737, 'Made with f-tree', 'text', 10, P.star));
  }
  return ctx.page('Is someone missing?', items);
}
