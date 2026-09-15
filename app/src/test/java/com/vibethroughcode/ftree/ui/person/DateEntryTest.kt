package com.vibethroughcode.ftree.ui.person

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * `DateEntry` held to `desktop/renderer/date-entry-cases.json`, the table `date-entry.test.js` reads
 * too, so typing a date works the same way on the phone and on the laptop (#90).
 * `app/build.gradle.kts` declares the table as an input to this task.
 */
class DateEntryTest {

    private val root: File = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
        .first { File(it, "settings.gradle.kts").exists() }

    private val table = Json.parseToJsonElement(File(root, "desktop/renderer/date-entry-cases.json").readText()).jsonObject

    private fun rows(key: String): List<List<String?>> = table.getValue(key).jsonArray.map { row ->
        (row as JsonArray).map { if (it is JsonNull) null else it.jsonPrimitive.content }
    }

    private fun slot(name: String?) = DateSlot.valueOf(name!!.uppercase())

    @Test
    fun `the table is the format this test reads`() {
        assertEquals(1, table.getValue("format").jsonPrimitive.int)
    }

    @Test
    fun `every string the slots can hold survives a round trip`() {
        for (text in table.getValue("roundTrip").jsonArray.map { it.jsonPrimitive.content }) {
            assertEquals(text, DateEntry.decode(text).encode())
        }
    }

    @Test
    fun `typing into a slot fills and moves on as the table says`() {
        for ((before, slot, text, after, focus) in rows("enter")) {
            val edit = DateEntry.enter(DateEntry.decode(before!!), slot(slot), text!!)
            val name = "$before + ${slot}:'$text'"
            assertEquals(name, after, edit.parts.encode())
            assertEquals(name, slot(focus), edit.focus)
        }
    }

    @Test
    fun `backspace in an empty slot steps back through the date`() {
        for ((before, slot, after, focus) in rows("backspace")) {
            val edit = DateEntry.backspace(DateEntry.decode(before!!), slot(slot))
            assertEquals("$before $slot", after, edit.parts.encode())
            assertEquals("$before $slot", slot(focus), edit.focus)
        }
    }

    @Test
    fun `a lone month or day digit is padded when the date is kept`() {
        for ((text, settled) in rows("settle")) assertEquals(text, settled, DateEntry.settle(text!!))
    }

    @Test
    fun `each problem is named and shown only once it is real`() {
        for (row in table.getValue("problem").jsonArray.map { it.jsonArray }) {
            val text = row[0].jsonPrimitive.content
            val expected = row[1].let { if (it is JsonNull) null else DateProblem.valueOf(it.jsonPrimitive.content) }
            val problem = DateEntry.problem(text)
            assertEquals(text, expected, problem)
            if (problem != null) assertEquals(text, row[2].jsonPrimitive.boolean, DateEntry.isFinal(problem, text))
        }
    }

    @Test
    fun `only two calendar dates can be out of order`() {
        for (row in table.getValue("deathBeforeBirth").jsonArray.map { it.jsonArray }) {
            val (birth, death) = row.take(2).map { it.jsonPrimitive.content }
            assertEquals("$birth / $death", row[2].jsonPrimitive.boolean, DateEntry.isDeathBeforeBirth(birth, death))
        }
    }
}
