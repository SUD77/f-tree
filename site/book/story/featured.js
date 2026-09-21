/*
 * The featured person: who a storybook is told around.
 *
 * "The story of one person, told through the family they belong to" (docs/storybook-plan.md) needs
 * an answer to "which one?" on every book, including the many books nobody ever picks a person for.
 * `resolveFeatured` is that answer, tried in order:
 *
 *   1. `options.featured`, when that id is still in the family after scope and the allowance have
 *      cut it down - a book opened from a person, or a screen that lets the reader choose, asks for
 *      exactly them;
 *   2. the branch root, when the book was scoped to one person's branch - opening "Family book from
 *      Ankit" means the book is about Ankit, whether or not anybody set `options.featured`;
 *   3. `mostConnected` (`site/playground/focus.js`) among people with a recorded name - the same
 *      good guess the desktop's chart uses when nobody has chosen anybody, restricted to somebody
 *      the book can actually name;
 *   4. nobody - an empty tree, or one with not a single named person, has no one to feature. The
 *      story planner (#251) is what turns that into a cover, a "waiting for its family" page and
 *      the closing; this module only says there is nobody to draw the rest of the book around.
 *
 * `family` is `readFamily`'s result (`../family.js`): scope and the allowance are already applied
 * to `family.byId` and `family.graph`; this never re-derives either, and never calls `relate()`
 * (`../../playground/model.js:614`) - that is two ancestor walks plus a whole-graph BFS per call,
 * and this runs before any real story planning, on every book, so it stays to one O(V) pass.
 */

import { mostConnected } from '../../playground/focus.js';

/**
 * @param family  `readFamily(doc, options, allowance)`'s result
 * @param options the same options `composeBook` was given
 * @returns a person id, or `null` when nobody in scope can be featured
 */
export function resolveFeatured(family, options = {}) {
  if (!family.people.length) return null;   // an empty tree: nobody to feature

  const asked = options.featured;
  if (typeof asked === 'string' && family.byId.has(asked)) return asked;

  const scope = options.scope;
  if (scope?.kind === 'branch' && family.byId.has(scope.personId)) return scope.personId;

  return mostConnected(family.graph, (id) => Boolean(family.byId.get(id)?.name));
}
