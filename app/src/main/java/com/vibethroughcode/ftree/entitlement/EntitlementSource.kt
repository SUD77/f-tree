package com.vibethroughcode.ftree.entitlement

/**
 * Which plan a reader is on, as far as [Entitlements.decide] is concerned.
 *
 * A seam, not a feature: an offline-signed licence that turns this into something a person can
 * actually buy is explicitly out of scope for #156 (see its design comment on the issue). What
 * exists today is the one implementation that makes the seam provable rather than theoretical.
 */
interface EntitlementSource {
    val plan: String
}

/**
 * Everybody, on every build, today. There is no account and no backend to ask instead (the app's
 * own promise, `strings.xml:216`), so "free" is not a default guess -- it is the only plan that
 * could possibly be true.
 */
object FreeForEveryone : EntitlementSource {
    override val plan: String = "free"
}
