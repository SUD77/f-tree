package com.vibethroughcode.ftree.entitlement

import java.io.File
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `policy.test.mjs`, for the parts a JVM has no other way to check.
 *
 * The table itself -- `site/book/policy-cases.json` -- is not this file's to own. It is read by
 * `site/book/policy.test.mjs` too, the same way `sample-family.ftree` already feeds a Node test
 * and `CrossLanguageTransferTest` from one file, so a case added on either side is a case both
 * evaluators are held to, without anyone having to remember to port it by hand. `app/build.gradle.kts`
 * declares both JSON files as inputs to this task, the same way it already does for the sample
 * tree, so a change to the table alone does not leave this test looking up to date.
 *
 * Each case becomes its own `assertEquals` call inside one `@Test`, rather than a JUnit test per
 * row (JUnit 4 has no built-in parameterisation as light as `node:test`'s), so a failure still
 * names the case by including it in the assertion message.
 */
class PolicyCasesTest {

    @Serializable
    private data class CaseFile(val format: Int, val cases: List<PolicyCase>)

    @Serializable
    private data class PolicyCase(
        val name: String,
        val policy: JsonElement,
        val request: AccessRequest,
        val context: EntitlementContext,
        val expect: CaseExpect,
    )

    @Serializable
    private data class CaseExpect(val kind: String, val allowance: CaseAllowance? = null, val reason: String? = null)

    @Serializable
    private data class CaseAllowance(val maxGenerations: Int? = null, val remaining: Int? = null)

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Walks up from the working directory until it finds the repository root.
     *
     * Gradle runs a unit test with `user.dir` at the module, an IDE sometimes at the project, and
     * neither is a thing to hard-code. Looking for `settings.gradle.kts` works from both.
     */
    private fun repositoryRoot(): File {
        var directory: File? = File(System.getProperty("user.dir"))
        while (directory != null && !File(directory, "settings.gradle.kts").exists()) {
            directory = directory.parentFile
        }
        return directory ?: error("could not find the repository root from ${System.getProperty("user.dir")}")
    }

    private fun readTable(): CaseFile =
        json.decodeFromString(File(repositoryRoot(), "site/book/policy-cases.json").readText())

    private fun shippedPolicyText(): String = File(repositoryRoot(), "site/book/policy.json").readText()

    /** `"shipped"` means the real file this app ships; anything else is the case's own hypothetical. */
    private fun resolvePolicy(element: JsonElement): Policy? {
        if (element is JsonPrimitive && element.isString && element.content == "shipped") {
            return PolicyLoader.loadPolicy(shippedPolicyText())
        }
        return PolicyLoader.loadPolicy(element)
    }

    private fun expectedDecisionOf(expect: CaseExpect): Decision = when (expect.kind) {
        "allowed" -> Decision.Allowed
        "limited" -> Decision.Limited(
            Allowance(
                maxGenerations = requireNotNull(expect.allowance) { "a Limited case needs an allowance" }.maxGenerations,
                remaining = expect.allowance.remaining,
            ),
            requireNotNull(expect.reason) { "a Limited case needs a reason" },
        )
        "locked" -> Decision.Locked(requireNotNull(expect.reason) { "a Locked case needs a reason" })
        else -> error("policy-cases.json has an expectation kind this test does not understand: ${expect.kind}")
    }

    @Test
    fun `every case in policy-cases json decides the same way in Kotlin as it does in JavaScript`() {
        val table = readTable()
        assertEquals(
            "site/book/policy-cases.json has a format PolicyCasesTest was not written for",
            1,
            table.format,
        )

        for (case in table.cases) {
            val policy = resolvePolicy(case.policy)
            val actual = Entitlements.decide(policy, case.request, case.context)
            assertEquals(case.name, expectedDecisionOf(case.expect), actual)
        }
    }

    @Test
    fun `the shipped policy that ships in assets is itself well-formed`() {
        assertEquals(
            "site/book/policy.json failed PolicyLoader.loadPolicy -- it should never be the unreadable case",
            true,
            PolicyLoader.loadPolicy(shippedPolicyText()) != null,
        )
    }
}
