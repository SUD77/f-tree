package com.vibethroughcode.ftree.book

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The templates the release carries, read from the staged engine (`book/site/book/templates/`).
 *
 * Kept as JSON and handed to the composer untouched: the composer is what validates a template
 * (`site/book/template.js`), and it refuses anything it does not understand, so this only needs to
 * know each one's id and name to list it.
 */
class BookTemplates(private val context: Context) {

    data class Template(val id: String, val name: String, val json: JsonObject)

    suspend fun all(): List<Template> = withContext(Dispatchers.IO) {
        val files = context.assets.list(DIRECTORY).orEmpty().filter { it.endsWith(".json") }
        files.mapNotNull { file ->
            runCatching {
                val json = Json.parseToJsonElement(context.assets.open("$DIRECTORY/$file").bufferedReader().use { it.readText() }).jsonObject
                Template(json.getValue("id").jsonPrimitive.content, json.getValue("name").jsonPrimitive.content, json)
            }.getOrNull()
        }.sortedWith(compareBy({ ORDER.indexOf(it.id).let { i -> if (i < 0) Int.MAX_VALUE else i } }, { it.id }))
    }

    private companion object {
        const val DIRECTORY = "book/site/book/templates"
        /** The evergreen template first; the catalogue (#211) takes this over. */
        val ORDER = listOf("heirloom", "diwali")
    }
}
