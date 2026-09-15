package com.vibethroughcode.ftree.data

import java.io.File
import java.time.LocalDate
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * [Occasions] held to `site/playground/occasion-cases.json`, the table `occasions.test.mjs` reads
 * too, so the phone and the desktop list the same days in the same order. `app/build.gradle.kts`
 * declares the table as an input to this task.
 */
class OccasionCasesTest {

    private val root: File = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
        .first { File(it, "settings.gradle.kts").exists() }

    private val table = Json.parseToJsonElement(File(root, "site/playground/occasion-cases.json").readText()).jsonObject

    private fun JsonElement.textOrNull(): String? = if (this is JsonNull) null else jsonPrimitive.content

    private fun cast(rows: JsonElement): List<Person> = rows.jsonArray.map { row ->
        val r = row.jsonArray
        Person(
            id = r[0].jsonPrimitive.content,
            name = r[1].textOrNull(),
            birthDate = r[2].textOrNull(),
            deathDate = r[3].textOrNull(),
            deceased = r[4].jsonPrimitive.boolean,
        )
    }

    private fun Occasion.flat(): List<Any?> = listOf(person.id, kind.name, date.toString(), daysAway, years)

    private fun JsonElement.expected(): List<Any?> {
        val e = jsonArray
        return listOf(
            e[0].jsonPrimitive.content,
            e[1].jsonPrimitive.content,
            e[2].jsonPrimitive.content,
            e[3].jsonPrimitive.int,
            e[4].jsonPrimitive.intOrNull,
        )
    }

    private fun cases(name: String) = table.getValue(name).jsonArray.map { it.jsonObject }

    @Test
    fun `every window lists the days the table lists, in its order`() {
        assertEquals(1, table.getValue("format").jsonPrimitive.int)
        for (case in cases("upcoming")) {
            val why = case.getValue("why").jsonPrimitive.content
            val actual = Occasions.upcoming(
                cast(case.getValue("people")),
                LocalDate.parse(case.getValue("today").jsonPrimitive.content),
                case.getValue("days").jsonPrimitive.int,
            )
            assertEquals(why, (case.getValue("expect") as JsonArray).map { it.expected() }, actual.map { it.flat() })
        }
    }

    @Test
    fun `the next birthday agrees with the table`() {
        for (case in cases("next")) {
            val found = Occasions.next(
                cast(case.getValue("people")),
                LocalDate.parse(case.getValue("today").jsonPrimitive.content),
            )
            val expect = case.getValue("expect")
            assertEquals(
                case.getValue("why").jsonPrimitive.content,
                if (expect is JsonNull) null else expect.expected(),
                found?.flat(),
            )
        }
    }

    @Test
    fun `the census agrees with the table`() {
        for (case in cases("census")) {
            val expect = case.getValue("expect").jsonObject
            assertEquals(
                case.getValue("why").jsonPrimitive.content,
                OccasionCensus(
                    covered = expect.getValue("covered").jsonPrimitive.int,
                    noDay = expect.getValue("noDay").jsonPrimitive.int,
                    presumedDeparted = expect.getValue("presumedDeparted").jsonPrimitive.int,
                ),
                Occasions.census(cast(case.getValue("people")), LocalDate.parse(case.getValue("today").jsonPrimitive.content)),
            )
        }
    }

    @Test
    fun `a reminder morning is a one-day window`() {
        val people = listOf(
            Person(id = "a", name = "A", birthDate = "1990-09-15"),
            Person(id = "b", name = "B", birthDate = "1990-09-16"),
        )
        assertEquals(listOf("a"), Occasions.on(people, LocalDate.of(2026, 9, 15)).map { it.person.id })
    }
}
