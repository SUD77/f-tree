package com.vibethroughcode.ftree.entitlement

import android.content.Context

/**
 * How many times each book feature has been used on this device, keyed by feature name
 * (`"book.export"`, `"book.template"`) -- the same by-name rule [KinshipPreferences]
 * [com.vibethroughcode.ftree.data.KinshipPreferences] follows for the setting it stores, so a
 * change to how features are ordered or numbered can never silently reassign somebody's count.
 *
 * Nothing reads [count] yet: the shipped policy grants every feature in full, so no rule ever asks
 * what it says. It is built now so a future quota rule is a data change, not a new place to start
 * counting from zero for everybody already using the app.
 *
 * Local and resettable by design. Clearing app data, or reinstalling, forgets every count -- that
 * is accepted here as a *soft* allowance, not a security boundary this class is pretending to be.
 * See `docs/premium.md`, which writes that down on purpose so nobody discovers it later.
 */
class UsageLedger(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences("book-usage-ledger", Context.MODE_PRIVATE)

    /** How many times [feature] has been recorded as used. Zero for a feature never recorded. */
    fun count(feature: String): Int = prefs.getInt(feature, 0)

    /**
     * Records one more use of [feature]. Called only after a successful save or share -- never
     * speculatively -- so a cancelled export or a share the reader backed out of never counts
     * against them.
     */
    fun record(feature: String) {
        prefs.edit().putInt(feature, count(feature) + 1).apply()
    }
}
