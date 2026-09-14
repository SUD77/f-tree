package com.vibethroughcode.ftree.transfer

import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.Person

/** How confident the app is that an imported person is somebody already in the tree. */
enum class MatchTier {
    /** Provably the same person: the file says where they came from and it is someone we hold. */
    CERTAIN,

    /** Same name, dates that agree, and at least one relative in common. */
    STRONG,

    /** Same name and nothing that contradicts it. Could easily be a different person. */
    WEAK,

    /** Nobody here looks like them. */
    NONE,
}

/** Why a match was proposed, so the review screen can show its reasoning rather than a verdict. */
data class MatchEvidence(
    val sameName: Boolean = false,
    val datesAgree: Boolean = false,
    val sharedRelatives: Int = 0,
    val fromSameTree: Boolean = false,
)

data class PersonMatch(
    val importedId: String,
    val localId: String?,
    val tier: MatchTier,
    val evidence: MatchEvidence = MatchEvidence(),
) {
    /**
     * Whether the app merges by default.
     *
     * Only a provable match merges without asking. A strong one is proposed and can be refused; a
     * weak one is proposed as *separate* and must be asked for. The asymmetry is deliberate:
     * wrongly keeping two records apart is a tidy-up, wrongly merging them destroys data.
     */
    val mergesByDefault: Boolean get() = tier == MatchTier.CERTAIN || tier == MatchTier.STRONG

    val needsReview: Boolean get() = tier == MatchTier.STRONG || tier == MatchTier.WEAK
}

/** The graph facts the matcher needs, from either side. */
data class MatchGraph(
    /** Person id to the ids of everyone directly connected to them, whatever the relationship. */
    val neighbours: Map<String, Set<String>>,
)

/**
 * Decides which imported people are already in the tree.
 *
 * Runs in passes. Provable matches are settled first, then those confirmed matches become evidence
 * for their relatives: two people with the same name are far more likely to be the same person when
 * their father already matched. Passes repeat until nothing new is confirmed, bounded so a strange
 * file cannot make this run long.
 *
 * Pure — it is handed both sides as plain data — so every rule here is exhaustively testable.
 */
object DuplicateMatcher {

    private const val MAX_PASSES = 5

    /** An imported person and a person here who share at least one origin key. */
    private data class Pairing(
        val importedId: String,
        /** Position in the file, so equal pairings settle the same way every time. */
        val order: Int,
        val localId: String,
        /** Whether the key they share includes the imported person's own. */
        val ownKey: Boolean,
        val count: Int,
    )

    fun match(
        imported: List<PersonRecord>,
        importedGraph: MatchGraph,
        local: List<Person>,
        localGraph: MatchGraph,
        /**
         * `(treeId, personId)` of an already-known origin, to every local person holding it — more
         * than one when an earlier import left a copy of somebody.
         */
        originIndex: Map<Pair<String, String>, List<String>>,
        sourceTreeId: String,
    ): List<PersonMatch> {
        val localById = local.associateBy { it.id }
        val localByName = local.groupBy { nameKey(it.name) }

        val settled = mutableMapOf<String, PersonMatch>()
        val claimedLocals = mutableSetOf<String>()

        // Pass 0: provable identity. The file records where each person came from, so this is a
        // lookup rather than a judgement.
        //
        // A lookup that can answer with more than one person, though. A stale copy — somebody
        // added again by an import that failed to recognise them — carries the origin of the
        // person it copies, so after it has been imported two people here hold that origin, and a
        // file can even hold both of them. Taking the first key that answers let the copy and the
        // original compete for one person here, and whichever lost was added as new, with the same
        // origin, on every import (#193).
        //
        // So every pairing that shares a key is ranked and settled best first, each person on
        // either side used once. A record's own key — its id, in the tree the file comes from —
        // outranks an origin it only carries: that one is exactly who it is, the others are
        // history. Then more keys in common. Then the person here with fewer keys, who is the more
        // specific match: the original holds only its own origin, a copy holds that and the one
        // it copied.
        val localOrder = local.withIndex().associate { (at, person) -> person.id to at }
        val keysHeld = originIndex.values.flatten().groupingBy { it }.eachCount()

        val pairings = imported.withIndex().flatMap { (order, record) ->
            val own = sourceTreeId to record.id
            val keys = buildSet {
                add(own)
                record.origins.forEach { add(it.treeId to it.personId) }
            }
            val byOwnKey = originIndex[own].orEmpty().toSet()
            keys.flatMap { originIndex[it].orEmpty() }
                .filter { it in localById }
                .groupingBy { it }
                .eachCount()
                .map { (localId, count) ->
                    Pairing(record.id, order, localId, localId in byOwnKey, count)
                }
        }

        pairings
            .sortedWith(
                compareByDescending<Pairing> { it.ownKey }
                    .thenByDescending { it.count }
                    .thenBy { keysHeld.getValue(it.localId) }
                    .thenBy { it.order }
                    .thenBy { localOrder.getValue(it.localId) },
            )
            .forEach { pairing ->
                if (pairing.importedId in settled) return@forEach
                if (pairing.localId in claimedLocals) return@forEach
                claimedLocals += pairing.localId
                settled[pairing.importedId] = PersonMatch(
                    importedId = pairing.importedId,
                    localId = pairing.localId,
                    tier = MatchTier.CERTAIN,
                    evidence = MatchEvidence(fromSameTree = true),
                )
            }

        // Later passes: name plus corroboration, with confirmed matches feeding the next round.
        var pass = 0
        var changed = true
        while (changed && pass < MAX_PASSES) {
            pass++
            changed = false

            imported.filterNot { it.id in settled }.forEach { record ->
                val key = nameKey(record.name) ?: return@forEach
                val candidates = localByName[key].orEmpty().filterNot { it.id in claimedLocals }
                if (candidates.isEmpty()) return@forEach

                val scored = candidates
                    .map { candidate ->
                        candidate to score(record, candidate, importedGraph, localGraph, settled)
                    }
                    .filter { it.second != null }
                    .sortedByDescending { it.second!!.sharedRelatives }

                val best = scored.firstOrNull() ?: return@forEach
                val evidence = best.second!!

                // Two local people with the same name and nothing to tell them apart: proposing
                // either would be a coin toss, so neither is proposed.
                val ambiguous = scored.size > 1 &&
                    scored[1].second!!.sharedRelatives == evidence.sharedRelatives &&
                    evidence.sharedRelatives == 0

                // A shared relative is the corroboration. Dates are not required to be *present*
                // — only not to contradict, which `score` has already established by returning at
                // all. Requiring both to carry a birth date would refuse to match two people who
                // plainly are the same simply because nobody wrote down when they were born.
                if (evidence.sharedRelatives > 0) {
                    settled[record.id] = PersonMatch(
                        record.id,
                        best.first.id,
                        MatchTier.STRONG,
                        evidence,
                    )
                    claimedLocals += best.first.id
                    changed = true
                } else if (!ambiguous) {
                    settled[record.id] = PersonMatch(
                        record.id,
                        best.first.id,
                        MatchTier.WEAK,
                        evidence,
                    )
                    // A weak match does not claim the local person: a better candidate may still
                    // turn up in a later pass.
                }
            }

        }

        return imported.map { record ->
            settled[record.id] ?: PersonMatch(record.id, null, MatchTier.NONE)
        }
    }

    /**
     * Evidence for one candidate pairing, or null when something rules it out.
     *
     * Conflicting birth dates rule it out outright — two people called Raj Kumar born eleven years
     * apart are two people, and merging them would be the single most destructive thing an import
     * could do.
     */
    private fun score(
        record: PersonRecord,
        candidate: Person,
        importedGraph: MatchGraph,
        localGraph: MatchGraph,
        settled: Map<String, PersonMatch>,
    ): MatchEvidence? {
        val importedBirth = PartialDate.parse(record.birthDate)
        val localBirth = PartialDate.parse(candidate.birthDate)
        val bothKnown = importedBirth != null && localBirth != null
        if (bothKnown && !importedBirth.isCompatibleWith(localBirth)) return null

        val importedDeath = PartialDate.parse(record.deathDate)
        val localDeath = PartialDate.parse(candidate.deathDate)
        if (importedDeath != null && localDeath != null &&
            !importedDeath.isCompatibleWith(localDeath)
        ) {
            return null
        }

        val localNeighbours = localGraph.neighbours[candidate.id].orEmpty()
        val shared = importedGraph.neighbours[record.id].orEmpty().count { neighbour ->
            val matchedLocal = settled[neighbour]?.localId
            matchedLocal != null && matchedLocal in localNeighbours
        }

        return MatchEvidence(
            sameName = true,
            // Only claim the dates agree when there were dates to agree; this is shown to the
            // user as reasoning, so it must not overstate what is known.
            datesAgree = bothKnown,
            sharedRelatives = shared,
        )
    }
}
