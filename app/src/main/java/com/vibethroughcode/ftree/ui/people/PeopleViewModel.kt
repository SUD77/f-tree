package com.vibethroughcode.ftree.ui.people

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.Occasion
import com.vibethroughcode.ftree.data.OccasionKind
import com.vibethroughcode.ftree.data.Occasions
import com.vibethroughcode.ftree.data.Person
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Who the list is showing. */
enum class PeopleFilter { EVERYONE, LIVING }

data class PeopleUiState(
    val people: List<Person> = emptyList(),
    val query: String = "",
    val filter: PeopleFilter = PeopleFilter.EVERYONE,
    /** Before the filter, so the count line can say "of N in your tree". */
    val matchCount: Int = 0,
    val loaded: Boolean = false,
    /** The band above the list; null until the whole tree has been read once. */
    val comingUp: ComingUp? = null,
) {
    val isEmptyTree: Boolean get() = loaded && matchCount == 0 && query.isBlank()
    val hasNoMatches: Boolean get() = loaded && people.isEmpty() && query.isNotBlank()
    /** Everybody who matched is dead, which is a different thing from matching nothing. */
    val hasNoneLiving: Boolean
        get() = loaded && people.isEmpty() && matchCount > 0 && filter == PeopleFilter.LIVING
}

/**
 * The family's next 30 days (#230): living birthdays, then the days the departed are remembered on.
 *
 * [next] is filled only when no birthday falls in the window, for the line that says when one does;
 * with no birthday in the window and no [next], nobody living has a day and month recorded.
 */
data class ComingUp(
    val birthdays: List<Occasion>,
    val remembering: List<Occasion>,
    val next: Occasion?,
) {
    companion object {
        fun of(people: List<Person>, today: LocalDate): ComingUp {
            val (birthdays, remembering) = Occasions.upcoming(people, today)
                .partition { it.kind == OccasionKind.BIRTHDAY }
            return ComingUp(
                birthdays = birthdays,
                remembering = remembering,
                next = if (birthdays.isEmpty()) Occasions.next(people, today) else null,
            )
        }
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class PeopleViewModel(
    repository: FamilyRepository,
    private val clock: () -> LocalDateTime = LocalDateTime::now,
) : ViewModel() {

    private val query = MutableStateFlow("")
    val currentQuery: StateFlow<String> = query.asStateFlow()

    private val filter = MutableStateFlow(PeopleFilter.EVERYONE)

    /*
     * Today, so the band rolls over at midnight while the list is open. The wait is a coroutine
     * delay, which stops counting while the phone sleeps, so the screen also calls [onResume]:
     * between them the day is right whenever anyone is looking.
     */
    private val today = MutableStateFlow(clock().toLocalDate())

    init {
        viewModelScope.launch {
            while (true) {
                val now = clock()
                delay(Duration.between(now, now.toLocalDate().plusDays(1).atStartOfDay()).toMillis() + 1_000)
                today.value = clock().toLocalDate()
            }
        }
    }

    /*
     * Coming up is about the whole tree, whatever is being searched for, so it reads everyone
     * rather than the search results.
     */
    private val comingUp = combine(repository.observeAllPeople(), today) { people, day -> ComingUp.of(people, day) }

    /**
     * The list is driven by the database rather than held in memory, and searching swaps the query
     * rather than filtering a loaded list, so a large tree never has to be materialised to find
     * one person.
     */
    private val results = query
        .debounce { if (it.isBlank()) 0L else 180L }
        .flatMapLatest { text ->
            if (text.isBlank()) repository.observeAllPeople() else repository.searchPeople(text)
        }

    /*
     * The filter is applied here rather than in SQL because the rows are already in hand for
     * display, and "no longer living" is a derived property — deceased or a death date — that
     * belongs with the rest of the domain rather than duplicated as a WHERE clause that could
     * drift from it.
     */
    val uiState: StateFlow<PeopleUiState> = combine(results, query, filter, comingUp) { people, text, mode, band ->
        PeopleUiState(
            people = if (mode == PeopleFilter.LIVING) people.filterNot { it.isNoLongerLiving }
            else people,
            query = text,
            filter = mode,
            matchCount = people.size,
            loaded = true,
            comingUp = band,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = PeopleUiState(),
    )

    fun onQueryChange(value: String) {
        query.value = value
    }

    fun onFilterChange(value: PeopleFilter) {
        filter.value = value
    }

    fun onResume() {
        today.value = clock().toLocalDate()
    }
}
