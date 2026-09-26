# PRD: Product Search / Filter Box on Inventory Page

**Product:** Swag Labs Demo Store (playwright-study sample app)
**Feature:** Client-side product name filter on the Inventory page
**Doc owner:** Ajit Gupta
**Status:** Draft
**Last updated:** 2026-09-26

---

## 1. Summary

Add a lightweight, client-side search/filter input above the product grid on the Inventory page. As the user types, the grid narrows in real time to show only products whose name matches the typed text (case-insensitive, substring match). This is a purely front-end, additive enhancement — it does not touch the existing vendored app bundle, backend, or checkout/cart logic, and is layered on top of the app as an independent script + stylesheet.

## 2. Background & Context

The system under test in this repo is a locally-hosted clone of the SauceLabs "Swag Labs" demo e-commerce site (`sample-app-web/`), used as the target application for a Playwright TypeScript learning/test-automation suite (`src/`, `tests/`).

The Inventory page (`inventory.html`) currently renders a fixed list of 6 products with a "Sort" dropdown (Name A–Z, Name Z–A, Price low–high, Price high–low) but has **no way to narrow the list by typing** — with a small catalog this isn't painful today, but it's the simplest, highest-value, lowest-risk feature we can add on top of the existing static pages:

- The app's core UI (`main.js`) is a minified, pre-built React bundle with no accompanying source — we cannot safely edit its internal component logic.
- However, the HTML pages it's injected into (`index.html`, `inventory.html`, `cart.html`, etc.) are plain static files we control. We can inject a **new, independent** `<script>` + `<link rel="stylesheet">` that operates purely via DOM queries against the rendered product grid, without modifying or rebuilding the bundle.

This makes "search/filter box" the ideal first feature to prototype in this hackathon: it's genuinely new, user-visible functionality, small enough to build and test end-to-end in a short session, and it doubles as a good demonstration target for the QE/test-generation agents this project is building (a fresh feature with no existing test coverage, requiring the agent to reason about a UI contract from scratch).

## 3. Problem Statement

Users landing on the Inventory page with a larger or growing catalog have no fast way to jump to a specific product by name — they must visually scan the grid or rely on Sort, which reorders but never reduces the list. We want an incremental, non-disruptive way to narrow the visible set by typing a product name fragment.

## 4. Goals

- Let a logged-in user filter the visible product list by typing part of a product name.
- Filtering is instant (no page reload, no network call) and reversible (clearing the input restores the full list).
- Filtering composes cleanly with the existing Sort dropdown — sort order is preserved among the filtered results.
- Zero regressions to existing Inventory, Cart, and Checkout flows.
- Implementation is additive-only: no edits to `main.js` / the vendored React bundle.

## Non-Goals

- No fuzzy/typo-tolerant search, no filtering by price/description/category, no backend/API changes.
- No persistence of the filter term across page loads or navigation (resets on reload, consistent with the "no backend" constraint).
- No changes to the Cart, Checkout, or Login flows.
- No accessibility redesign beyond baseline keyboard/reader support described in §8.
- Not building this for the "problem_user" / "performance_glitch_user" edge accounts beyond ensuring the feature doesn't crash for them (see §9 Edge Cases).

## 5. User Stories

| # | As a... | I want to... | So that... |
|---|---------|---------------|------------|
| U1 | Logged-in shopper on the Inventory page | Type part of a product name into a search box | I can quickly find that product without scrolling/scanning |
| U2 | Shopper who mistyped or wants to browse again | Clear the search box (via a clear "×" button or deleting the text) | The full product list reappears immediately |
| U3 | Shopper using Sort + Filter together | Apply a sort order and then filter | The filtered subset stays in the chosen sort order |
| U4 | Shopper searching for something that doesn't exist | See a clear "no results" state instead of a blank/broken page | I understand nothing matched, rather than assuming the app is broken |
| U5 | Keyboard-only or screen-reader user | Reach the search box via Tab and get an accessible label | I'm not excluded from the feature |
| U6 | QA/test-automation agent | Rely on a stable `data-testid` and predictable DOM behavior | I can write reliable Playwright locators and assertions against the feature |

## 6. Functional Requirements

### 6.1 Placement & Structure
- FR1: A search input is rendered directly above the product grid, in the same content region as the existing "Sort" dropdown (`.product_sort_container`), left-aligned, on `inventory.html` only.
- FR2: The input has a placeholder text: `Search products…`.
- FR3: The input carries `data-testid="search-products-input"`.
- FR4: A clear button (`×`) appears inside/adjacent to the input **only when it has non-empty content**, with `data-testid="button-clear-search"`.
- FR5: A results-count / empty-state element is rendered directly below the input, with `data-testid="label-search-results"`, hidden when the input is empty.

### 6.2 Filtering Behavior
- FR6: On every keystroke (debounced, see §7 Performance), the product grid is filtered to show only items whose name (`.inventory_item_name` text content) contains the typed string as a substring, case-insensitive.
- FR7: Matching is substring-based, not "starts with" — e.g. typing `"shirt"` matches both "Sauce Labs Bolt T-Shirt" and "Test.allTheThings() T-Shirt (Red)".
- FR8: Whitespace-only or empty input shows the full, unfiltered list, and hides the results-count element.
- FR9: Filtering only hides/shows existing `.inventory_item` DOM nodes (via a CSS class toggle, e.g. `.filtered-out { display: none; }`) — it does not remove, reorder, or clone nodes, so it never conflicts with the existing Sort feature's DOM reordering.
- FR10: If the currently selected Sort order changes while a filter is active, the filter re-applies to the newly sorted DOM order (i.e., filter state is independent of and outlives sort changes).

### 6.3 Empty / No-Match State
- FR11: If zero products match, hide all product cards and show a message in the `label-search-results` element: `No products found matching "<term>"`.
- FR12: If N products match (N ≥ 1), show: `Showing N of 6 products` in `label-search-results`.

### 6.4 Clearing
- FR13: Clicking the clear button empties the input, hides the clear button, hides the results-count element, and restores all products to visible.
- FR14: Pressing `Escape` while the input is focused performs the same action as FR13.

### 6.5 Session / Navigation
- FR15: Filter state is **not** persisted — navigating away (to Cart, to an item detail page, logging out) and returning to Inventory resets the input to empty and shows the full list.
- FR16: The filter box does not interfere with `localStorage` cart state (`cart-contents`) or the existing session-cookie mechanism used by the test harness's `setSession` helper.

## 7. Non-Functional Requirements

- **Performance:** Filtering must feel instantaneous for the current catalog size (6 items) and remain responsive up to at least 500 items; keystroke handling is debounced at ~150ms to avoid excessive re-renders on fast typing.
- **No network dependency:** All filtering logic runs client-side against already-rendered DOM text content; no additional HTTP requests are introduced.
- **No bundle modification:** Implemented as a new, separately-loaded `filter.js` + `filter.css`, injected via `<script defer>` / `<link>` tags appended to `inventory.html` only. Must not require rebuilding, patching, or otherwise touching `main.js`, `static/js/*.chunk.js`, or any file under `sample-app-web/static/`.
- **Resilience to app markup changes:** Selectors used to find product nodes should prefer existing stable hooks (`data-testid`, or documented CSS classes like `.inventory_item_name`) already relied upon by the current Playwright Page Object Model (`src/pages/inventory.ts`, `src/consts.ts`), rather than brittle structural selectors (e.g., nth-child chains).
- **Browser support:** Must work correctly on the same browser matrix already exercised by the test suite (Chromium 1280×720 / 1920×1080, Firefox, WebKit — see `playwright.config.ts`).

## 8. Accessibility

- A11Y1: The input has an associated accessible label (`aria-label="Search products"` or a visually-hidden `<label>`), so screen readers announce its purpose.
- A11Y2: The clear button has `aria-label="Clear search"`.
- A11Y3: The results-count element uses `aria-live="polite"` so screen reader users are told the result count changes without needing to re-focus.
- A11Y4: The input and clear button are reachable via keyboard `Tab` order, positioned logically after the Sort dropdown and before the first product card.
- A11Y5: Focus outline on the input follows the existing app's visual focus-state conventions (do not suppress `:focus` outlines).

## 9. Edge Cases

| Case | Expected behavior |
|---|---|
| Empty catalog / all items filtered out | Show "No products found" message; grid area collapses gracefully, no layout break |
| Special characters in search term (e.g. `.`, `(`, `)` — relevant since "Test.allTheThings() T-Shirt (Red)" contains them) | Treated as literal characters in a plain substring match, not as regex — must not throw a JS error |
| Very fast typing / rapid backspacing | Debounce prevents flicker or dropped keystrokes; final DOM state always reflects the final input value |
| User is `problem_user` (a seeded account known to have broken images/UI in this demo app) | Filter logic must not assume specific image behavior; it only reads `.inventory_item_name` text, so it should be unaffected — validate this explicitly in testing |
| User is `performance_glitch_user` (seeded account with artificial load delay) | Filter must not fire before the product grid has actually rendered; guard against querying an empty/not-yet-populated grid on page load |
| Filtering, then clicking into an item's detail page, then using browser Back | Filter resets to empty per FR15 — this is expected, not a bug |
| Locked-out user (`locked_out_user`) | N/A — this feature is only reachable post-login, on the Inventory page; locked-out users never reach it |

## 10. Out of Scope / Explicit Non-Requirements

- Persisting search term via query param, cookie, or localStorage.
- Searching by SKU, description, or price.
- Server-side/API-backed search.
- Any changes to `main.js`, the webpack bundle, or the React component tree.
- Mobile-specific responsive redesign (should not visually break on narrow viewports, but a bespoke mobile layout is not required for v1).

## 11. Success Metrics (for this hackathon context)

Since this is a demo/practice app rather than a live product, "success" is defined qualitatively rather than by analytics:

- The feature works correctly across all FRs above on Chromium/Firefox/WebKit per the existing test matrix.
- A generated/authored Playwright test suite for this feature achieves full coverage of FR1–FR16 and the edge cases in §9, with zero flakiness across 3 consecutive local runs.
- The feature can be demoed end-to-end live: type → filter → clear → no-results state → sort+filter combo.
- (Primary hackathon goal) The QE/test-generation agent under development can consume this PRD and correctly produce accurate, non-trivial test cases for the feature without additional hand-holding — this PRD's job is to be a realistic, complete input for that agent.

## 12. Test Case Traceability Hooks

For downstream test-generation, the following stable selectors are the contract this feature must expose:

| Element | `data-testid` |
|---|---|
| Search input | `search-products-input` |
| Clear button | `button-clear-search` |
| Results count / empty-state label | `label-search-results` |

Behavioral contract for automated test generation:
- Given the Inventory page with all 6 seeded products visible, typing a substring of exactly one product's name results in exactly one visible `.inventory_item` and `label-search-results` reading `Showing 1 of 6 products`.
- Given a search term matching zero products, zero `.inventory_item` nodes are visible and `label-search-results` reads `No products found matching "<term>"`.
- Given a non-empty search term, clicking `button-clear-search` restores all 6 products and empties `search-products-input`.
- Given an active sort order (e.g. Price low–high) and an active filter matching 3 products, those 3 products remain visible in price-ascending order.

## 13. Open Questions

1. Should the filter box be added to *only* the Inventory page, or also considered for a future "search within cart" use case? (Current recommendation: Inventory only, for v1.)
2. Do we want the results-count label visible even when the search box is empty (always-on "Showing 6 of 6 products"), or only on active filtering, as specified in FR5/FR8? (Current recommendation: only on active filtering, to minimize visual noise.)
3. Any preference on debounce timing (150ms proposed) — is instant (0ms) filtering acceptable given the small catalog size?

## 14. Appendix: Relevant Existing App Context

- Seeded test accounts (`standard_user`, `locked_out_user`, `problem_user`, `performance_glitch_user`), password `secret_sauce` for all.
- Current product catalog (6 items): Sauce Labs Backpack, Sauce Labs Bike Light, Sauce Labs Bolt T-Shirt, Test.allTheThings() T-Shirt (Red), Sauce Labs Onesie, Sauce Labs Fleece Jacket.
- Existing Inventory page structure/tests live at `sample-app-web/v1/inventory.html` and `tests/inventory.spec.ts` / `src/pages/inventory.ts` respectively — several inventory tests (sorting, cart badge, navigation) are currently unimplemented placeholders (`test.fixme`), independent of this feature.
