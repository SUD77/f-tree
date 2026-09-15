package com.vibethroughcode.ftree.entitlement

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement

/**
 * The on-disk shape of `site/book/policy.json`, ported from `site/book/policy.js`'s `loadPolicy`.
 *
 * Rules as data: the day a feature becomes premium is a change to the JSON, not a new release of
 * every screen that exports. `format` is what lets that change forward -- and what lets an old
 * build refuse a policy shape it was never taught, rather than misreading one.
 *
 * `rules` is deliberately not defaulted to an empty list. A policy file with the key missing
 * entirely fails to decode, which is exactly the "unreadable" case [PolicyLoader.loadPolicy]
 * returns `null` for -- a policy that decoded successfully but happened to have zero rules would
 * instead be a real, if useless, policy, and the two must not be confused: one fails open
 * ([Entitlements.decide] allows everything), the other is simply a policy that locks everything,
 * on purpose.
 */
@Serializable
data class Policy(val format: Int, val rules: List<Rule>) {
    companion object {
        /** The only `format` this build understands. Bumped only alongside a matching evaluator change. */
        const val SUPPORTED_FORMAT = 1
    }
}

/**
 * One line of the policy: for `feature`, on `plan`, grant `grant` -- optionally only `when` the
 * request matches, optionally with its own `reason`.
 *
 * `grant` and `whenClause` stay [JsonElement]/[JsonObject] rather than a typed sealed class,
 * because [Entitlements] is the one place that needs to know the shapes a grant can take, and
 * keeping that knowledge in one pure function is exactly the point of this package -- a JSON
 * structure any future grant kind can also take without a schema migration.
 */
@Serializable
data class Rule(
    val feature: String,
    val plan: String,
    @SerialName("when") val whenClause: JsonObject? = null,
    val grant: JsonElement,
    val reason: String? = null,
)

/**
 * Parses and validates a policy. Never throws.
 *
 * Ported case for case from `loadPolicy` in `site/book/policy.js`: malformed JSON, a missing
 * `rules` array, or a `format` this build does not recognise -- older or newer -- all come back as
 * `null` here exactly as they do there, and `null` means the same thing in both places. See
 * `Entitlements.decide` for what a `null` policy actually decides, and why.
 */
object PolicyLoader {
    private val json = Json { ignoreUnknownKeys = true }

    /** From the raw text of a policy file, e.g. `assets/book/policy.json` via [PolicyAssets]. */
    fun loadPolicy(text: String): Policy? = runCatching {
        json.decodeFromString(Policy.serializer(), text)
    }.getOrNull()?.takeIf { it.format == Policy.SUPPORTED_FORMAT }

    /**
     * From an already-parsed [JsonElement] -- what [PolicyCasesTest][com.vibethroughcode.ftree.entitlement.PolicyCasesTest]
     * has in hand for each case's inline policy, without a needless round trip back through text.
     */
    fun loadPolicy(element: JsonElement): Policy? = runCatching {
        json.decodeFromJsonElement<Policy>(element)
    }.getOrNull()?.takeIf { it.format == Policy.SUPPORTED_FORMAT }
}
