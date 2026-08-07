# formatPrice spec

`formatPrice(amount)` renders a number as a US dollar string with **exactly two
decimal places**, always prefixed with `$`.

Examples:

- `formatPrice(2.5)` → `"$2.50"` (never `"$2.5"`)
- `formatPrice(10)` → `"$10.00"`
- `formatPrice(0)` → `"$0.00"`
