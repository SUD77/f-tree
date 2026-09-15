package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.transfer.ExportJson
import com.vibethroughcode.ftree.transfer.RelationshipRecord
import com.vibethroughcode.ftree.transfer.TreeDocument
import java.io.File
import java.util.zip.ZipInputStream
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * `FamilyGraph.branchFrom` against the table it shares with the JavaScript port.
 *
 * `branch-cases.json` is not this test's table -- it is `site/playground/branch.test.mjs`'s table
 * too, and this is the half that reads it in Kotlin. Neither test wrote the sample-family cases by
 * running its own implementation and calling the result correct: they were computed independently
 * from this file's algorithm against the real `sample-family.ftree` (see `branch.test.mjs`'s
 * header), so a bug that both ports share has nowhere to hide.
 *
 * `app/build.gradle.kts`'s `branchCrossLanguageInputs` block tells Gradle that
 * `site/playground/branch-cases.json` and `site/playground/model.js` are real inputs to this task,
 * the same way it already does for `CrossLanguageTransferTest` and the nearby JS -- without it, this
 * test would go stale exactly when a change to either file made it matter.
 */
class BranchCasesTest {

    @Serializable
    private data class BranchCases(val inline: InlineCases, val sampleFamily: List<Case>)

    @Serializable
    private data class InlineCases(val graph: InlineGraph, val cases: List<Case>)

    @Serializable
    private data class InlineGraph(
        val people: List<String>,
        val parents: List<List<String>>,
        val spouses: List<List<String>>,
    )

    @Serializable
    private data class Case(val personId: String, val expectedIds: List<String>)

    private fun repositoryRoot(): File {
        var directory = File(System.getProperty("user.dir"))
        while (!File(directory, "settings.gradle.kts").exists()) {
            directory = directory.parentFile ?: error("could not find the repository root")
        }
        return directory
    }

    private fun loadCases(): BranchCases {
        val file = File(repositoryRoot(), "site/playground/branch-cases.json")
        return ExportJson.decodeFromString(file.readText())
    }

    /** The real thing: twenty-three people, twenty-seven relationships and four photographs. */
    private fun sampleTree(): File = File(repositoryRoot(), "site/playground/sample-family.ftree")

    /** Reads a `.ftree` archive the same way `TreeImporter.readDocument` does. */
    private fun readDocument(archive: File): TreeDocument {
        ZipInputStream(archive.inputStream().buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (entry.name == TreeDocument.ENTRY_JSON) {
                    return ExportJson.decodeFromString(String(zip.readBytes()))
                }
                zip.closeEntry()
            }
        }
        error("no ${TreeDocument.ENTRY_JSON} entry in $archive")
    }

    private fun childrenOf(graph: InlineGraph): (String) -> List<String> {
        val map = graph.parents.groupBy({ it[0] }, { it[1] })
        return { map[it].orEmpty() }
    }

    private fun spousesOf(graph: InlineGraph): (String) -> List<String> {
        val map = mutableMapOf<String, MutableList<String>>()
        graph.spouses.forEach { (a, b) ->
            map.getOrPut(a) { mutableListOf() } += b
            map.getOrPut(b) { mutableListOf() } += a
        }
        return { map[it].orEmpty() }
    }

    private fun childrenOf(relationships: List<RelationshipRecord>): (String) -> List<String> {
        val map = relationships.filter { it.type == "PARENT" }.groupBy({ it.from }, { it.to })
        return { map[it].orEmpty() }
    }

    private fun spousesOf(relationships: List<RelationshipRecord>): (String) -> List<String> {
        val map = mutableMapOf<String, MutableList<String>>()
        relationships.filter { it.type == "SPOUSE" }.forEach { r ->
            map.getOrPut(r.from) { mutableListOf() } += r.to
            map.getOrPut(r.to) { mutableListOf() } += r.from
        }
        return { map[it].orEmpty() }
    }

    @Test
    fun `branchFrom matches the hand-built shapes`() = runTest {
        val cases = loadCases().inline
        val childrenOf = childrenOf(cases.graph)
        val spousesOf = spousesOf(cases.graph)

        cases.cases.forEach { case ->
            val branch = FamilyGraph.branchFrom(case.personId, childrenOf, spousesOf)
            assertEquals(case.personId, case.expectedIds.toSet(), branch)
        }
    }

    @Test
    fun `branchFrom matches every person in sample-family ftree`() = runTest {
        val cases = loadCases().sampleFamily
        val document = readDocument(sampleTree())
        val childrenOf = childrenOf(document.relationships)
        val spousesOf = spousesOf(document.relationships)

        cases.forEach { case ->
            val branch = FamilyGraph.branchFrom(case.personId, childrenOf, spousesOf)
            assertEquals(case.personId, case.expectedIds.toSet(), branch)
        }
    }

    @Test
    fun `the sample-family table covers everybody in the file`() = runTest {
        // A table that silently stopped covering a person would keep passing forever.
        val cases = loadCases().sampleFamily
        val document = readDocument(sampleTree())

        val covered = cases.map { it.personId }.toSet()
        assertEquals(document.people.size, covered.size)
        document.people.forEach { assertTrue("no branch-cases.json entry for ${it.id}", it.id in covered) }
    }
}
