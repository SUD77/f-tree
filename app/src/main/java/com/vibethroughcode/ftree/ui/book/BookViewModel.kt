package com.vibethroughcode.ftree.ui.book

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.Picture
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vibethroughcode.ftree.book.Book
import com.vibethroughcode.ftree.book.BookComposer
import com.vibethroughcode.ftree.book.BookFailure
import com.vibethroughcode.ftree.book.BookPrinter
import com.vibethroughcode.ftree.book.BookTemplates
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.entitlement.AccessRequest
import com.vibethroughcode.ftree.entitlement.Decision
import com.vibethroughcode.ftree.entitlement.EntitlementContext
import com.vibethroughcode.ftree.entitlement.EntitlementSource
import com.vibethroughcode.ftree.entitlement.Entitlements
import com.vibethroughcode.ftree.entitlement.Policy
import com.vibethroughcode.ftree.entitlement.UsageLedger
import com.vibethroughcode.ftree.transfer.TreeExporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.time.LocalDate

/** What the reader has chosen on the book screen. */
data class BookOptions(
    val templateId: String = "heirloom",
    /** Null means "the title the book derives" - the family's own surname. */
    val title: String? = null,
    val branch: Boolean = false,
    val photos: Boolean = true,
    val livingDates: Boolean = false,
)

data class TemplateChoice(val id: String, val name: String, val cover: Picture?)

data class BookUiState(
    val loading: Boolean = true,
    /** Nobody in the tree: there is nothing to make a book of. */
    val empty: Boolean = false,
    val options: BookOptions = BookOptions(),
    val templates: List<TemplateChoice> = emptyList(),
    /** Whose branch the screen was opened for, if it was. */
    val branchOf: String? = null,
    /** Whether anybody in the tree has a photograph, so the switch can say so when nobody does. */
    val hasPhotos: Boolean = false,
    val book: Book? = null,
    val pages: List<Picture> = emptyList(),
    val estimateBytes: Long = 0,
    val composing: Boolean = false,
    val busy: BookAction? = null,
    val failure: BookFailure? = null,
    val decision: Decision = Decision.Allowed,
    /** A one-off message: "Saved ...". Cleared once shown. */
    val notice: BookNotice? = null,
)

enum class BookAction { SHARING, SAVING }

sealed interface BookNotice {
    data class Saved(val fileName: String) : BookNotice
    data class Failed(val failure: BookFailure) : BookNotice
}

/**
 * The family book screen: composes the book as the reader changes it, and writes it when they
 * share or save it.
 *
 * The book is laid out by [BookComposer], the same composer the desktop runs, so this holds only
 * choices and results. Every export path asks the policy switch first ([Entitlements.decide]);
 * today it always answers "everything", and the day it doesn't, that is a change to the policy,
 * not to this screen. Only a book that was actually shared or saved is counted.
 */
@OptIn(FlowPreview::class)
class BookViewModel(
    private val exporter: TreeExporter,
    private val repository: FamilyRepository,
    private val printer: BookPrinter,
    private val composer: BookComposer,
    private val templates: BookTemplates,
    private val policy: Policy?,
    private val entitlements: EntitlementSource,
    private val ledger: UsageLedger,
    private val contentResolver: ContentResolver,
    private val scopePersonId: String?,
    private val today: () -> LocalDate = LocalDate::now,
) : ViewModel() {

    private val _state = MutableStateFlow(BookUiState(options = BookOptions(branch = scopePersonId != null)))
    val state: StateFlow<BookUiState> = _state.asStateFlow()

    private val options = MutableStateFlow(_state.value.options)
    private var document: JsonElement? = null
    private var templateJson: Map<String, JsonObject> = emptyMap()
    private var photoOf: Map<String, String?> = emptyMap()
    private val photoCache = mutableMapOf<Pair<String, Int>, Bitmap>()
    private var photos: Map<String, Bitmap> = emptyMap()

    init {
        viewModelScope.launch {
            val people = repository.allPeople()
            if (people.isEmpty()) {
                _state.update { it.copy(loading = false, empty = true) }
                return@launch
            }
            photoOf = people.associate { it.id to it.photoId }
            val branchOf = scopePersonId?.let { id -> people.firstOrNull { it.id == id }?.name?.trim()?.split(Regex("\\s+"))?.firstOrNull() }
            document = Json.parseToJsonElement(exporter.documentJson())
            val list = templates.all()
            templateJson = list.associate { it.id to it.json }
            _state.update {
                it.copy(branchOf = branchOf, hasPhotos = people.any { p -> p.photoId != null }, templates = list.map { t -> TemplateChoice(t.id, t.name, null) })
            }

            // The book first, the template choices' small covers after it: the reader is looking at
            // the book, and the composer takes one request at a time.
            launch { options.debounce(180).distinctUntilChanged().collect { compose(it) } }
            launch { drawCovers() }
        }
    }

    fun setTemplate(id: String) = change { it.copy(templateId = id) }
    fun setTitle(title: String) = change { it.copy(title = title) }
    fun resetTitle() = change { it.copy(title = null) }
    fun setBranch(branch: Boolean) = change { it.copy(branch = branch) }
    fun setPhotos(on: Boolean) = change { it.copy(photos = on) }
    fun setLivingDates(on: Boolean) = change { it.copy(livingDates = on) }
    fun noticeShown() = _state.update { it.copy(notice = null) }
    fun retry() = viewModelScope.launch { compose(options.value) }

    private fun change(transform: (BookOptions) -> BookOptions) {
        val next = transform(options.value)
        options.value = next
        _state.update { it.copy(options = next) }
    }

    private fun decide(opts: BookOptions): Decision = Entitlements.decide(
        policy,
        AccessRequest(feature = FEATURE, templateId = opts.templateId, templateTier = "free", people = photoOf.size),
        EntitlementContext(plan = entitlements.plan, usage = mapOf(FEATURE to ledger.count(FEATURE))),
    )

    private fun input(opts: BookOptions, allowance: JsonObject): String? {
        val doc = document ?: return null
        val template = templateJson[opts.templateId] ?: templateJson.values.firstOrNull() ?: return null
        return buildJsonObject {
            put("doc", doc)
            putJsonObject("options") {
                put("now", today().toString())
                put("photos", opts.photos)
                put("livingDates", opts.livingDates)
                opts.title?.trim()?.takeIf { it.isNotEmpty() }?.let { put("title", it) }
                if (opts.branch && scopePersonId != null) putJsonObject("scope") {
                    put("kind", "branch")
                    put("personId", scopePersonId)
                } else putJsonObject("scope") { put("kind", "everyone") }
            }
            put("template", template)
            put("allowance", allowance)
        }.toString()
    }

    private suspend fun compose(opts: BookOptions) {
        val decision = decide(opts)
        val allowance = buildJsonObject {
            (decision as? Decision.Limited)?.allowance?.maxGenerations?.let { put("maxGenerations", it) }
        }
        val json = input(opts, allowance) ?: return
        _state.update { it.copy(composing = true, failure = null, decision = decision) }
        try {
            val book = composer.compose(json)
            photos = photosFor(book)
            val pages = withContext(Dispatchers.Default) { printer.pictures(book, photos) }
            _state.update {
                it.copy(loading = false, composing = false, book = book, pages = pages, estimateBytes = estimate(book))
            }
        } catch (failure: BookFailure) {
            _state.update { it.copy(loading = false, composing = false, failure = failure) }
        }
    }

    /** Portraits are decoded once per size and kept while the screen is open. */
    private suspend fun photosFor(book: Book): Map<String, Bitmap> {
        val wanted = book.photos.associate { it.id to it.px }
        val missing = book.copy(photos = book.photos.filter { (it.id to it.px) !in photoCache })
        printer.loadPhotos(missing) { photoOf[it] }.forEach { (id, bitmap) -> photoCache[id to wanted.getValue(id)] = bitmap }
        return wanted.mapNotNull { (id, px) -> photoCache[id to px]?.let { id to it } }.toMap()
    }

    /** Each template's cover, drawn with this family, for the template choices. */
    private suspend fun drawCovers() {
        val opts = options.value
        val covers = templateJson.keys.associateWith { id ->
            val json = input(opts.copy(templateId = id, photos = false), buildJsonObject {}) ?: return@associateWith null
            runCatching { composer.compose(json) }.getOrNull()?.let { book ->
                withContext(Dispatchers.Default) { printer.pictures(book.copy(pages = book.pages.take(1)), emptyMap()).firstOrNull() }
            }
        }
        _state.update { s -> s.copy(templates = s.templates.map { it.copy(cover = covers[it.id]) }) }
    }

    /**
     * Writes the book for the share sheet and returns where it is. Counted as used only here, once
     * the file exists - a book the reader backed out of is not one they made.
     */
    suspend fun prepareShare(): Uri? = act(BookAction.SHARING) { book ->
        printer.writeForSharing(book, photos).also { ledger.record(FEATURE) }
    }

    /** Writes the book to wherever the reader chose in the system's save dialog. */
    fun saveTo(uri: Uri) {
        viewModelScope.launch {
            act(BookAction.SAVING) { book ->
                withContext(Dispatchers.IO) {
                    contentResolver.openOutputStream(uri, "w")?.use { printer.writePdf(book, photos, it) }
                        ?: throw BookFailure.Script("the chosen place could not be written to")
                }
                ledger.record(FEATURE)
                _state.update { it.copy(notice = BookNotice.Saved(book.fileName)) }
            }
        }
    }

    private suspend fun <T> act(action: BookAction, work: suspend (Book) -> T): T? {
        val book = state.value.book ?: return null
        if (state.value.decision is Decision.Locked) return null
        _state.update { it.copy(busy = action) }
        return try {
            work(book)
        } catch (failure: BookFailure) {
            _state.update { it.copy(notice = BookNotice.Failed(failure)) }
            null
        } catch (e: java.io.IOException) {
            _state.update { it.copy(notice = BookNotice.Failed(BookFailure.Script(e.message ?: "the file could not be written"))) }
            null
        } finally {
            _state.update { it.copy(busy = null) }
        }
    }

    override fun onCleared() {
        composer.close()
        photoCache.clear()
    }

    companion object {
        const val FEATURE = "book.export"

        /**
         * About how large the PDF will be. Android's PdfDocument keeps photographs losslessly, so
         * this is `site/book/compose.js`'s estimateBytes with `lossless: true`, kept in step with it.
         */
        fun estimate(book: Book): Long =
            420_000L + book.pages.size * 18_000L + book.photos.sumOf { (it.px.toLong() * it.px * 18) / 10 }
    }
}
