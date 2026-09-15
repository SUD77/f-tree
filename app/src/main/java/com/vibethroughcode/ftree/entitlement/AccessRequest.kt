package com.vibethroughcode.ftree.entitlement

import kotlinx.serialization.Serializable

/**
 * What is being asked for. `feature` is the only field every request has; the rest describe it
 * closely enough for a policy rule's `when` clause and grant to answer precisely rather than with
 * a plain yes or no -- how many generations a book export covers, which template and tier a book
 * asks for.
 *
 * `@Serializable` is here for [PolicyCasesTest][com.vibethroughcode.ftree.entitlement.PolicyCasesTest],
 * which decodes a request straight out of `policy-cases.json` -- the same table
 * `site/book/policy.test.mjs` reads -- rather than because production code ever serialises one.
 */
@Serializable
data class AccessRequest(
    val feature: String,
    val templateId: String? = null,
    val templateTier: String? = null,
    val generations: Int? = null,
    val people: Int? = null,
)

/**
 * The rest of what a decision needs, and nothing more: which plan the caller is on -- from an
 * [EntitlementSource] -- and how much of each feature they have already used -- from a
 * [UsageLedger]. `Entitlements` never reads either of those directly; it only ever sees this.
 */
@Serializable
data class EntitlementContext(val plan: String, val usage: Map<String, Int> = emptyMap())
