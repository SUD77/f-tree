package com.vibethroughcode.ftree.entitlement

/**
 * The answer to "may this user do this, and how much of it?" -- see [Entitlements.decide].
 *
 * A boolean is not enough: [Limited] carries what *is* allowed, which is what lets an export offer
 * "one generation is free -- here it is" rather than a bare refusal.
 */
sealed interface Decision {
    /** The whole of what was asked for. */
    data object Allowed : Decision

    /** Part of what was asked for, plus [reason] -- a stable code, never copy shown to a reader. */
    data class Limited(val allowance: Allowance, val reason: String) : Decision

    /** None of what was asked for, plus [reason] -- a stable code, never copy shown to a reader. */
    data class Locked(val reason: String) : Decision
}

/**
 * What a [Decision.Limited] actually grants. Both fields are optional because the two grant kinds
 * that produce a [Decision.Limited] each fill in only the one that means something for them: a
 * quota fills [remaining], a generation scope fills [maxGenerations]. Neither is ever guessed at
 * by a caller -- whichever is present is exactly what the policy said.
 */
data class Allowance(val maxGenerations: Int? = null, val remaining: Int? = null)
