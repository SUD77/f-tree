/*
 * `branchFrom` against the table it shares with the Kotlin.
 *
 * `branch-cases.json` is not this file's table -- it is `app/src/test/java/com/vibethroughcode/
 * ftree/graph/BranchCasesTest.kt`'s table too, and this is the half that reads it in JavaScript.
 * Neither test wrote the sample-family cases by running its own implementation and calling the
 * result correct: they were computed independently from `FamilyGraph.branchFrom`'s Kotlin
 * (`graph/FamilyGraph.kt:43`) against the real `sample-family.ftree`, so a bug that both ports share
 * has nowhere to hide, and a bug that only one has shows up as that one test failing.
 *
 * Two tables inside the one file:
 *
 *   inline        a small hand-built family covering shapes the sample may not: a leaf, someone
 *                 with descendants and no partners, a person at the root, and a remarried
 *                 descendant whose new partner is in but whose stepchild -- no direct `PARENT` edge
 *                 to the bloodline -- is not.
 *
 *   sampleFamily  one case per person in `sample-family.ftree`, so the port is checked against a
 *                 real, awkward family and not only the shapes somebody thought to invent.
 */

import test from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openArchive, parseDocument } from './archive.js';
import { buildGraph, branchFrom } from './model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CASES = path.join(here, 'branch-cases.json');
const FAMILY = path.join(here, 'sample-family.ftree');

async function loadCases() {
  return JSON.parse(await readFile(CASES, 'utf8'));
}

/** `openArchive` wants an ArrayBuffer; `readFile` gives a Buffer over a shared one. */
async function familyGraph() {
  const buffer = await readFile(FAMILY);
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const archive = await openArchive(bytes);
  return buildGraph(parseDocument(await archive.readText('tree.json')));
}

/** Turns `{people, parents, spouses}` into the `{people, relationships}` shape `buildGraph` wants. */
function graphFromInline(spec) {
  return buildGraph({
    people: spec.people.map((id) => ({ id, name: id })),
    relationships: [
      ...spec.parents.map(([from, to]) => ({ from, to, type: 'PARENT' })),
      ...spec.spouses.map(([a, b]) => ({ from: a, to: b, type: 'SPOUSE' })),
    ],
  });
}

const sortedIds = (set) => [...set].sort();

test('branchFrom matches the hand-built shapes', async () => {
  const { inline } = await loadCases();
  const graph = graphFromInline(inline.graph);

  for (const { personId, expectedIds } of inline.cases) {
    assert.deepStrictEqual(
      sortedIds(branchFrom(graph, personId)),
      expectedIds,
      `branchFrom(${personId})`,
    );
  }
});

test('branchFrom matches every person in sample-family.ftree', async () => {
  const { sampleFamily } = await loadCases();
  const graph = await familyGraph();

  for (const { personId, expectedIds } of sampleFamily) {
    assert.deepStrictEqual(
      sortedIds(branchFrom(graph, personId)),
      expectedIds,
      `branchFrom(${personId})`,
    );
  }
});

test('the sample-family table covers everybody in the file', async () => {
  // A table that silently stopped covering a person would keep passing forever.
  const { sampleFamily } = await loadCases();
  const graph = await familyGraph();

  const covered = new Set(sampleFamily.map((c) => c.personId));
  assert.strictEqual(covered.size, graph.people.size, 'one case per person, no duplicates');
  for (const id of graph.people.keys()) {
    assert.ok(covered.has(id), `no branch-cases.json entry for ${id}`);
  }
});

test('a remarried descendant carries the new partner in, and the stepchild stays out', async () => {
  // Stated exactly, not just "matches the table" -- this is the one behaviour the issue exists to
  // pin, so it is worth asserting in words as well as against the JSON.
  const { inline } = await loadCases();
  const graph = graphFromInline(inline.graph);

  const branch = branchFrom(graph, 'sib');
  assert.ok(branch.has('new-spouse'), 'the new partner comes along');
  assert.ok(branch.has('ex-spouse'), 'a former spouse is still a spouse, whatever the subtype');
  assert.ok(branch.has('shared-child'), 'a child sib actually parents is in, direct edge or not');
  assert.ok(!branch.has('stepchild'), "the new partner's child by someone else stays out");
});
