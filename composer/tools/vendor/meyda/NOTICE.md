# Meyda, for the audio comparison only

`meyda.min.js` is the browser build of [Meyda](https://meyda.js.org/) 5.6.3,
taken unchanged from the npm package `meyda-5.6.3.tgz`. Its sha512, checked
on 2026-10-13, matched the registry's:
`fAdwfzIi1WDoL0idUQvCD7dZ7EN74FYH83G+jZQO3Nr9yOEBtzFvcMg2KLdLlu6psSP8XFlO0kYynG5o/E681Q==`.
The file's sha256 is
`cc5f9581fe1feb9d52d20a2cac14fc264bd22100bbffe3a83e0fd72cd0a8cf2b`.

It is MIT-licensed (`LICENSE.md`, copied from the same package). It is used by
`tools/audio-compare.html` only (T26) and is not served to the composer's
page. If the comparison earns it a place in the composer, it moves to
`public/vendor/` as its own task.

Known in this version: its `spectralFlux` is marked in its own source as
having "major issues" (Meyda issue #852). The comparison reports what it
returns rather than relying on it.
