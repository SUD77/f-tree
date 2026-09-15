package com.vibethroughcode.ftree.entitlement

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull

/**
 * The one place the app asks "may this user do this, and how much of it?" -- and, until a policy
 * file says otherwise, the one place that always answers "yes, all of it".
 *
 * Ported from `site/book/policy.js`, case for case, sharing one test table --
 * `site/book/policy-cases.json`, read here by
 * [PolicyCasesTest][com.vibethroughcode.ftree.entitlement.PolicyCasesTest] -- so the two shells
 * can never quietly disagree about what somebody is allowed to do. See `docs/premium.md` for the
 * principle this exists to serve: *gate presentation, never a family's own data.*
 *
 * [decide] is pure: no `Context`, no disk, no clock. Everything it needs arrives already resolved
 * in [policy], [request] and [context], which is what lets the Node test and this JVM test run the
 * exact same inputs through the exact same table.
 *
 * Reasons are stable string codes, read by a caller deciding what to say -- never user copy. See
 * `site/book/policy.js` for what each one means; they are identical here on purpose.
 */
object Entitlements {

    /**
     * `decide(policy, request, context) -> Allowed | Limited(allowance, reason) | Locked(reason)`
     *
     * A `null` policy -- what [PolicyLoader.loadPolicy] returns for anything unreadable, older or
     * newer than this build understands -- decides **Allowed**, not Locked. Every other fallback
     * in this app fails closed; this is the deliberate exception, because what is being protected
     * is a business rule rather than a family's data, and a corrupted or too-new policy file must
     * never take away an export that worked yesterday. Written down again in `docs/premium.md` and
     * exercised in `policy-cases.json`, so the choice is made exactly once.
     */
    fun decide(policy: Policy?, request: AccessRequest, context: EntitlementContext): Decision {
        if (policy == null) return Decision.Allowed

        val knownFeature = policy.rules.any { it.feature == request.feature }
        if (!knownFeature) return Decision.Locked("unknown-feature")

        val rule = selectRule(policy, request, context.plan)
            // A feature the policy knows about, but with no rule for this plan or this request's
            // `when` values: there is nothing to be permissive about, because permission was never
            // expressed either way. Locked, not Allowed -- Allowed must only ever come from a rule
            // that says so.
            ?: return Decision.Locked("unknown-feature")

        return applyGrant(rule, request, context)
    }

    /**
     * Picks the rule that governs one request, out of every rule written for its feature and plan.
     *
     * A rule with a `when` clause is more specific than one without, so it wins whenever both
     * match -- letting a blanket "book.template is free" rule coexist with a narrower "premium
     * templates are locked" one. Order inside `policy.rules` does not matter, only specificity.
     */
    private fun selectRule(policy: Policy, request: AccessRequest, plan: String): Rule? {
        val applicable = policy.rules.filter {
            it.feature == request.feature && it.plan == plan && ruleApplies(it, request)
        }
        return applicable.firstOrNull { it.whenClause != null }
            ?: applicable.firstOrNull { it.whenClause == null }
    }

    /** True when every key `when` names matches that same key on `request`. No `when` matches anything. */
    private fun ruleApplies(rule: Rule, request: AccessRequest): Boolean {
        val whenClause = rule.whenClause ?: return true
        val requestFields = requestAsJson(request)
        return whenClause.all { (key, expected) -> requestFields[key] == expected }
    }

    /** `request`'s fields as JSON values, so a `when` clause can compare against any of them by name. */
    private fun requestAsJson(request: AccessRequest): Map<String, JsonElement> = buildMap {
        put("feature", JsonPrimitive(request.feature))
        request.templateId?.let { put("templateId", JsonPrimitive(it)) }
        request.templateTier?.let { put("templateTier", JsonPrimitive(it)) }
        request.generations?.let { put("generations", JsonPrimitive(it)) }
        request.people?.let { put("people", JsonPrimitive(it)) }
    }

    /** The reason a grant kind produces on its own, before a rule's own `reason` overrides it. */
    private fun defaultReason(kind: String): String = when (kind) {
        "quota" -> "quota-used"
        "scope" -> "generation-scope"
        // A `none` grant with nothing more specific to say. A rule that locks a feature for a
        // reason worth naming -- a premium tier, a sunset feature -- should say so with its own
        // `reason`, e.g. `"premium-template"`.
        else -> "not-included"
    }

    private fun usedCountOf(context: EntitlementContext, feature: String): Int = context.usage[feature] ?: 0

    /**
     * Applies one already-matched rule's grant to a request, producing the decision.
     *
     * These four grant kinds are exactly the ones `docs/premium.md` documents as available to a
     * future policy, even though only `"full"` ships today -- so changing the answer later is
     * editing data in `policy.json`, never this function.
     */
    private fun applyGrant(rule: Rule, request: AccessRequest, context: EntitlementContext): Decision {
        val grant = rule.grant

        if (grant is JsonPrimitive && grant.contentOrNull == "full") return Decision.Allowed

        if (grant is JsonPrimitive && grant.contentOrNull == "none") {
            return Decision.Locked(rule.reason ?: defaultReason("none"))
        }

        if (grant is JsonObject) {
            (grant["quota"] as? JsonObject)?.let { quota ->
                val count = (quota["count"] as? JsonPrimitive)?.intOrNull
                    ?: return Decision.Locked("malformed-rule")
                val remaining = count - usedCountOf(context, request.feature)
                val reason = rule.reason ?: defaultReason("quota")
                return if (remaining <= 0) {
                    Decision.Locked(reason)
                } else {
                    Decision.Limited(Allowance(remaining = remaining), reason)
                }
            }

            (grant["scope"] as? JsonObject)?.let { scope ->
                val maxGenerations = (scope["maxGenerations"] as? JsonPrimitive)?.intOrNull
                    ?: return Decision.Locked("malformed-rule")
                if ((request.generations ?: 0) <= maxGenerations) return Decision.Allowed
                return Decision.Limited(
                    Allowance(maxGenerations = maxGenerations),
                    rule.reason ?: defaultReason("scope"),
                )
            }
        }

        // A grant this evaluator does not recognise. The top-level `format` check in
        // `PolicyLoader` already ruled out a *file* this build cannot read at all, so this is most
        // likely a typo inside an otherwise-legible policy -- and unlike an unreadable file, a
        // malformed rule is never assumed harmless: the one rule that could not be understood
        // stays Locked rather than silently granting what it failed to describe.
        return Decision.Locked("malformed-rule")
    }
}
