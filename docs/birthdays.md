# Birthdays and remembrance days

Since #90 a birthday can be kept without its year (`--04-17`). The tree can therefore answer the
question families actually ask from one week to the next: *whose birthday is coming up?*
"Coming up" lists the next 30 days (#230). An optional reminder sends a note on the morning (#154).

One set of rules serves both, written twice and held to one table:

| | |
|---|---|
| Kotlin | `app/.../data/Occasions.kt` |
| JavaScript | `site/playground/occasions.js` |
| The table | `site/playground/occasion-cases.json` — read by `OccasionCasesTest.kt` and `occasions.test.mjs` |

Change a rule by changing the table first. Both tests then fail until both ports agree.

## The rules

- **A day needs a month and a day.** `1938-04-17` and `--04-17` fall on 17 April. `1938` and
  `1938-04` have nothing to fall on, so they are not occasions. Reminders tell you how many people
  that leaves out, so it is never a silent omission.
- **The living get birthdays.** The departed get two quieter days: the day they were born ("would
  have been 90") and the day they died (the barsi). "Departed" is the test the chart's own marks
  use: the deceased flag *or* a death date, which may itself have no year.
- **The age turned** is stated only when the year is known. The day of birth is nobody's birthday,
  and a death last week is not yet an anniversary: the first occurrence is always a year later.
- **29 February** falls on **28 February** in a year without one. That keeps it in the person's own
  month, which is where the family already celebrates it.
- **Nobody is wished a happy 111th.** A tree holds many ancestors whose deaths were never recorded,
  and a "living" person who would turn more than 110 is almost surely one of them. They are left
  out of the list and counted in Settings.
- **Past 100 years, a remembrance keeps its day but loses its number.** Nobody says "would have
  been 176" aloud.
- **People with no name are left out.** A placeholder has nobody to wish.
- **Order:** soonest first. On any one day the living come before the remembered, then names
  compare folded to lower case, code unit by code unit, the same way in both languages.

## What is deliberately not stored

Nothing about this travels in a `.ftree`. The list is derived every time it is drawn. The reminder
switch belongs to the device, not the tree. There is no format change and nothing for an older
reader to trip on.

A reminder is **one alarm a day**, not one per person, and it asks the database what the day holds
at the moment it fires. An edit, a delete or an import therefore cannot leave a stale reminder
behind, and there is no schedule to keep in step.
