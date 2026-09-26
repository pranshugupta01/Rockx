/* Inventory search/filter — additive-only, zero edits to main.js.
   Implements FR1–FR16, §6 empty/no-match, §8 a11y, §9 edge cases. */
(function () {
    'use strict';

    var DEBOUNCE_MS = 150;
    var TOTAL_CATALOG_SIZE = 6;
    var debounceTimer = null;

    var inventoryContainer = null;
    var input = null;
    var clearBtn = null;
    var label = null;

    /* Wait until the React-rendered product grid is actually populated —
       guards against empty grid on slow loads (performance_glitch_user, §9). */
    function waitForItems(cb, attempts) {
        attempts = attempts || 0;
        var items = inventoryContainer
            ? inventoryContainer.querySelectorAll('.inventory_item')
            : [];
        if (items.length > 0) {
            cb(items);
        } else if (attempts < 40) {
            setTimeout(function () { waitForItems(cb, attempts + 1); }, 50);
        } else {
            cb([]);
        }
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function buildMarkup() {
        var row = document.createElement('div');
        row.className = 'search_filter_row';

        var labelEl = document.createElement('label');
        labelEl.className = 'search_filter_visually_hidden';
        labelEl.htmlFor = 'search-products-input';
        labelEl.textContent = 'Search products';
        labelEl.style.cssText =
            'position:absolute;width:1px;height:1px;padding:0;margin:-1px;' +
            'overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;';

        input = document.createElement('input');
        input.type = 'search';
        input.id = 'search-products-input';
        input.setAttribute('data-testid', 'search-products-input');
        input.setAttribute('aria-label', 'Search products');
        input.setAttribute('autocomplete', 'off');
        input.placeholder = 'Search products\u2026';

        clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.id = 'button-clear-search';
        clearBtn.setAttribute('data-testid', 'button-clear-search');
        clearBtn.setAttribute('aria-label', 'Clear search');
        clearBtn.textContent = '\u00d7';
        clearBtn.hidden = true;

        row.appendChild(input);
        row.appendChild(clearBtn);

        var wrapper = document.createElement('div');
        wrapper.className = 'search_filter_container';
        wrapper.appendChild(labelEl);
        wrapper.appendChild(row);

        label = document.createElement('div');
        label.id = 'label-search-results';
        label.setAttribute('data-testid', 'label-search-results');
        label.setAttribute('aria-live', 'polite');
        label.setAttribute('role', 'status');
        label.hidden = true;
        wrapper.appendChild(label);

        return wrapper;
    }

    function mount() {
        inventoryContainer = document.querySelector('#inventory_container');
        if (!inventoryContainer) return;

        var existing = document.querySelector('.search_filter_container');
        if (existing) existing.parentNode.removeChild(existing);

        var sortContainer = inventoryContainer.querySelector('.product_sort_container');
        var wrapper = buildMarkup();

        if (sortContainer && sortContainer.parentNode === inventoryContainer) {
            sortContainer.parentNode.insertBefore(wrapper, sortContainer);
        } else {
            inventoryContainer.insertBefore(wrapper, inventoryContainer.firstChild);
        }

        wireEvents();
    }

    function wireEvents() {
        input.addEventListener('input', function () {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(applyFilter, DEBOUNCE_MS);
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' || e.keyCode === 27) {
                e.preventDefault();
                clearAll();
            }
        });

        clearBtn.addEventListener('click', function () {
            input.focus();
            clearAll();
        });
    }

    function clearAll() {
        input.value = '';
        clearBtn.hidden = true;
        applyFilter();
        input.focus();
    }

    function setResultsText(matched) {
        if (!input.value || !input.value.trim()) {
            label.hidden = true;
            label.textContent = '';
            return;
        }
        label.hidden = false;
        if (matched === 0) {
            label.textContent =
                'No products found matching "' + escapeHtml(input.value) + '"';
        } else {
            label.textContent =
                'Showing ' + matched + ' of ' + TOTAL_CATALOG_SIZE + ' products';
        }
    }

    function applyFilter() {
        var raw = input.value || '';
        var term = raw.trim().toLowerCase();

        clearBtn.hidden = raw.length === 0;

        if (!term) {
            var all = inventoryContainer
                ? inventoryContainer.querySelectorAll('.inventory_item')
                : [];
            for (var i = 0; i < all.length; i++) {
                all[i].classList.remove('filtered-out');
            }
            label.hidden = true;
            label.textContent = '';
            return;
        }

        waitForItems(function (items) {
            var matched = 0;
            for (var j = 0; j < items.length; j++) {
                var item = items[j];
                var nameEl = item.querySelector('.inventory_item_name');
                var name = nameEl ? (nameEl.textContent || '').toLowerCase() : '';
                /* FR7: substring match. FR9: literal, NOT regex — special
                   characters in the term are matched as literal substrings
                   (e.g. ".", "("), so we do NOT construct a RegExp here. */
                if (name.indexOf(term) !== -1) {
                    item.classList.remove('filtered-out');
                    matched++;
                } else {
                    item.classList.add('filtered-out');
                }
            }
            /* FR10: filter survives sort reordering. Sort changes only
               rearrange the same .inventory_item nodes in the DOM — our
               visibility classes persist across that reordering. */
            setResultsText(matched);
        });
    }

    /* Sort dropdown change keeps item nodes but reorders them — re-apply
       filter so a user who changes sort mid-filter doesn't see a stale
       filtered-but-out-of-order view (FR10). */
    function watchSort() {
        var sortEl = inventoryContainer
            ? inventoryContainer.querySelector('.product_sort_container')
            : null;
        if (!sortEl) return;
        sortEl.addEventListener('change', function () {
            if (input && input.value.trim()) {
                setTimeout(applyFilter, 0);
            }
        });
    }

    function init() {
        mount();
        watchSort();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
