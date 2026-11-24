# The leap-year rule

Most people learn that a leap year comes every four years. That is almost right, and the "almost" is the interesting part: it is why the year 2000 had a 29 February, 1900 did not, and 2100 will not. :cite[src-wiki-leap-year]

## A year is not a whole number of days

::anchor{#a-tropical-year}

The calendar exists to keep the months in step with the seasons. The seasons repeat with the *tropical year*, the time from one March equinox to the next, which lasts about 365.2422 days. :cite[src-wiki-tropical-year]

A calendar of exactly 365 days is therefore about a quarter of a day too short. Each year the equinox arrives roughly six hours later on the calendar, and the error adds up. :cite[src-wiki-tropical-year]

::guess{#g-drift}

After about 124 years the calendar would be a whole month out of step, since $30 / 0.2422 \approx 124$. Within a few centuries, the calendar would show midsummer when the weather said spring. :general[This follows from dividing 30 days by the yearly error.]

## The Julian fix

::anchor{#a-julian}

Julius Caesar's calendar reform, which took effect in 45 BC, added one extra day every four years. That makes the average year exactly 365.25 days long. :cite[src-britannica-gregorian]

The Julian year is closer, but now about 11 minutes too *long*. Eleven minutes a year sounds harmless, but it adds up to a full day roughly every 128 years. :cite[src-britannica-gregorian]

By the sixteenth century the drift had reached about ten days, and the spring equinox, which the church used to set the date of Easter, was falling around 11 March instead of 21 March. :cite[src-britannica-gregorian]

## The Gregorian rule

::anchor{#a-gregorian-rule}

In 1582 Pope Gregory XIII introduced the calendar most of the world uses today. It made two changes. First, ten days were dropped at once: Thursday 4 October 1582 was followed by Friday 15 October. Second, the leap-year rule was refined to skip three leap days every four centuries. :cite[src-britannica-gregorian]

The rule has three parts. :cite[src-wiki-leap-year]

1. A year divisible by 4 is a leap year. :cite[src-wiki-leap-year]
2. Except a year divisible by 100, which is not. :cite[src-wiki-leap-year]
3. Except a year divisible by 400, which is a leap year after all. :cite[src-wiki-leap-year]

So 2024 is a leap year by the first part, 1900 is not because of the second, and 2000 is because of the third. :cite[src-wiki-leap-year]

::misconception{#m-every-four}

::guess{#g-1900}

The rule fits in one line of code, and it is a classic programming exercise exactly because the simple version is wrong. :general[Leap-year bugs are a well-known class of software error.]

```python
def is_leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
```

The code tests exactly the three parts of the rule, in order. :general[This is the standard implementation of the Gregorian rule.]

The year 2000 was the first time the 400-year exception had applied since 1600. Some software that knew only the "every four years" rule happened to get 2000 right by accident, while software that knew the century rule but not the 400-year exception got it wrong. :general[Both kinds of bug were widely reported around 2000.]

## How close it gets

::anchor{#a-accuracy}

Out of every 400 years, the Gregorian rule has 97 leap years instead of 100, so the average year works out as follows. :cite[src-wiki-leap-year]

$$
365 + \frac{1}{4} - \frac{1}{100} + \frac{1}{400} = 365.2425 \text{ days.}
$$

That is about 27 seconds longer than the tropical year. :cite[src-wiki-leap-year]

At that rate the calendar drifts by one day in roughly 3,200 years. :uncertain[Exact figures vary, because the tropical year itself changes slowly and Earth's rotation is gradually slowing.] For anyone alive today, and for many generations to come, the error is far too small to notice. :cite[src-wiki-tropical-year]

Not every country switched in 1582. Britain and its colonies changed in 1752, by which time they had to drop eleven days, so that Wednesday 2 September was followed by Thursday 14 September, and some countries waited until the twentieth century. Russia switched in 1918, which is why the October Revolution of 1917 fell in November by the Gregorian calendar, and Greece switched in 1923. :cite[src-britannica-gregorian]

Leap years solve a problem of fractions. The seasons do not care how many days we count, so the calendar has to borrow a day now and then to keep up. The Gregorian calendar borrows just often enough that, for practical purposes, the months stay where the seasons put them. :general[This is a summary of the lesson.]
