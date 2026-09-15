package com.vibethroughcode.ftree.data

import java.io.File
import java.util.Locale
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * `RecordedDate` held to `site/playground/date-cases.json`, the table `dates.test.mjs` reads too, so
 * the phone, the desktop and the web viewer can never read the same stored date two ways.
 * `app/build.gradle.kts` declares the table as an input to this task.
 */
class DateCasesTest {

    private val root: File = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
        .first { File(it, "settings.gradle.kts").exists() }

    private val table = Json.parseToJsonElement(File(root, "site/playground/date-cases.json").readText()).jsonObject

    @Test
    fun `every stored shape parses and reads the same in Kotlin as in JavaScript`() {
        assertEquals(1, table.getValue("format").jsonPrimitive.int)
        for (case in table.getValue("parse").jsonArray.map { it.jsonObject }) {
            val text = case.getValue("text").jsonPrimitive.content
            val kind = case.getValue("kind").let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val parsed = RecordedDate.parse(text)
            when (kind) {
                null -> assertNull("expected $text to be refused", parsed)
                else -> {
                    val expected = if (kind == "calendar") PartialDate::class else YearlessDate::class
                    assertEquals(text, expected, parsed?.let { it::class })
                    assertEquals(text, case.getValue("serialized").jsonPrimitive.content, parsed!!.serialize())
                    assertEquals(text, case.getValue("display").jsonPrimitive.content, parsed.display(Locale.UK))
                }
            }
        }
    }

    @Test
    fun `compatibility agrees with the table in both directions`() {
        for (pair in table.getValue("compatible").jsonArray.map { it.jsonArray }) {
            val a = RecordedDate.parse(pair[0].jsonPrimitive.content)!!
            val b = RecordedDate.parse(pair[1].jsonPrimitive.content)!!
            val expected = pair[2].jsonPrimitive.boolean
            assertEquals("$a ~ $b", expected, a.isCompatibleWith(b))
            assertEquals("$b ~ $a", expected, b.isCompatibleWith(a))
        }
    }

    @Test
    fun `a calendar date still refuses a yearless one where the question is when`() {
        // Age, seniority and ordering read PartialDate.parse; a birthday with no year is unknown there.
        assertNull(PartialDate.parse("--04-17"))
    }

    @Test
    fun `a yearless date puts the month first where the locale does`() {
        assertEquals("April 17", YearlessDate(4, 17).display(Locale.US))
        assertEquals("17 April", YearlessDate(4, 17).display(Locale.forLanguageTag("en-IN")))
    }
}
