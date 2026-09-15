package com.vibethroughcode.ftree.entitlement

import android.content.Context

/**
 * Where the shipped policy actually lives once packaged: `assets/book/policy.json`, staged by
 * Gradle straight from `site/book/policy.json` (see `app/build.gradle.kts`) so there is exactly
 * one copy of the file in git.
 *
 * The only Android-touching file in this package on purpose: [Policy], [Rule] and [PolicyLoader]
 * stay plain Kotlin so `PolicyCasesTest` runs as an ordinary JVM test, with nothing here to stub.
 */
object PolicyAssets {
    private const val ASSET_PATH = "book/policy.json"

    /**
     * Null if the asset is missing, unreadable, or fails [PolicyLoader.loadPolicy]'s own checks --
     * in every case, [Entitlements.decide] treats that exactly as it treats any other unreadable
     * policy: Allowed, never Locked.
     */
    fun loadShippedPolicy(context: Context): Policy? = runCatching {
        context.assets.open(ASSET_PATH).bufferedReader().use { it.readText() }
    }.getOrNull()?.let(PolicyLoader::loadPolicy)
}
