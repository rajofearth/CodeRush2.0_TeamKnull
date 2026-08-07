# slugify spec

`slugify(input)` converts any string into a URL-safe slug:

1. Coerce `input` to a string and lowercase it.
2. Replace every run of one or more characters that are NOT `a-z` or `0-9`
   with a single hyphen `-`.
3. Strip leading and trailing hyphens.
4. If nothing alphanumeric remains, return the empty string `""`.

Examples:

- `slugify("Hello, World!")` → `"hello-world"`
- `slugify("  --Already--Sluggish--  ")` → `"already-sluggish"`
- `slugify("Multiple   Spaces")` → `"multiple-spaces"`
- `slugify("v2.0 (beta)")` → `"v2-0-beta"`
- `slugify("!!!")` → `""`
