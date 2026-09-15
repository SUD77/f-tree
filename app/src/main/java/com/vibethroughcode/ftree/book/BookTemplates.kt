package com.vibethroughcode.ftree.book

import android.content.Context
import java.time.LocalDate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * The templates the release carries, read from the staged engine (`book/site/book/templates/`) in
 * the order the catalogue gives for the day ([BookCatalog]): what is in season first.
 *
 * Each template is kept as JSON and handed to the composer untouched: the composer is what
 * validates a template (`site/book/template.js`), and it refuses anything it does not understand.
 * A template the catalogue lists but the release does not carry is left out, not an error.
 */
class BookTemplates(private val context: Context) {

    data class Template(val id: String, val name: String, val tier: String, val featured: Boolean, val json: JsonObject)

    suspend fun offered(today: LocalDate): List<Template> = withContext(Dispatchers.IO) {
        val catalog = runCatching { read("catalog.json") }.getOrNull()?.let(BookCatalog::read)
        BookCatalog.listing(catalog, today.toString()).mapNotNull { entry ->
            runCatching { Json.parseToJsonElement(read("${entry.id}.json")).jsonObject }.getOrNull()
                ?.let { Template(entry.id, entry.name, entry.tier, entry.featured, it) }
        }
    }

    private fun read(file: String): String = context.assets.open("$DIRECTORY/$file").bufferedReader().use { it.readText() }

    private companion object {
        const val DIRECTORY = "book/site/book/templates"
    }
}
