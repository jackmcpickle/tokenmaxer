import type { FC } from 'react';

/** Region swapped in place when a filter changes. */
export const BOARD_ID = 'leaderboard-board';

/** Hero line ("Ranked by … · Last 7 days") kept in sync with the board. */
export const BOARD_SUMMARY_ID = 'board-summary';

/**
 * Progressive enhancement for the leaderboard filters (static HTML path).
 *
 * Every control is a plain link, so the board still works with JS off. With JS
 * on, same-page links are intercepted: the new HTML is fetched, only the board
 * (and the hero summary line) is replaced, and the URL is pushed. Scroll
 * position is untouched, so the page stays exactly where the user clicked.
 *
 * Skips entirely when the board is marked `data-spa-board` — TanStack Start
 * owns navigation there (BoardScript pushState would fight the router).
 *
 * All listeners are delegated on `document` because the board's own markup —
 * including the filter dialogs — is discarded on every swap.
 */
const BOARD_SCRIPT = `(() => {
  var BOARD = '${BOARD_ID}';
  var SUMMARY = '${BOARD_SUMMARY_ID}';
  if (!window.DOMParser || !window.history || !window.fetch) return;

  var seq = 0;

  function board() { return document.getElementById(BOARD); }
  function menu() { return document.querySelector('#board-filters details.board-filter-menu'); }
  function isSpa(el) { return el && el.getAttribute('data-spa-board') === 'true'; }

  function swap(href, push) {
    var el = board();
    if (!el || isSpa(el)) { window.location.href = href; return; }
    var token = ++seq;
    var prevHeight = el.offsetHeight;
    if (prevHeight > 0) el.style.minHeight = prevHeight + 'px';
    el.setAttribute('aria-busy', 'true');
    fetch(href, { headers: { Accept: 'text/html' }, credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('status ' + res.status);
        return res.text();
      })
      .then(function (html) {
        if (token !== seq) return;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var next = doc.getElementById(BOARD);
        if (!next) throw new Error('missing board');
        if (isSpa(next)) { window.location.href = href; return; }
        el.innerHTML = next.innerHTML;
        var nextSummary = doc.getElementById(SUMMARY);
        var summary = document.getElementById(SUMMARY);
        if (nextSummary && summary) summary.innerHTML = nextSummary.innerHTML;
        if (doc.title) document.title = doc.title;
        if (push) window.history.pushState({ board: true }, '', href);
        el.removeAttribute('aria-busy');
        requestAnimationFrame(function () {
          el.style.minHeight = '';
        });
      })
      .catch(function () {
        if (token !== seq) return;
        el.removeAttribute('aria-busy');
        el.style.minHeight = '';
        window.location.href = href;
      });
  }

  document.addEventListener('click', function (e) {
    var el = board();
    if (isSpa(el)) return;

    var target = e.target;
    if (!target || typeof target.closest !== 'function') return;

    var menuEl = menu();
    if (menuEl && menuEl.open && !menuEl.contains(target)) menuEl.open = false;

    var trigger = target.closest('[data-filter-dialog]');
    if (trigger) {
      e.preventDefault();
      var dlg = document.getElementById('filter-dialog-' + trigger.getAttribute('data-filter-dialog'));
      if (menuEl) menuEl.open = false;
      if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
      return;
    }

    if (target.closest('[data-filter-close]')) {
      var closing = target.closest('dialog');
      if (closing) closing.close();
      return;
    }

    if (target.matches && target.matches('dialog.board-filter-dialog')) {
      target.close();
      return;
    }

    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var link = target.closest('a[href]');
    if (!link || link.hasAttribute('download')) return;
    if (link.target && link.target !== '_self') return;
    if (!link.closest('#' + BOARD)) return;

    var url;
    try { url = new URL(link.href, window.location.href); } catch (err) { return; }
    if (url.origin !== window.location.origin) return;
    if (url.pathname !== window.location.pathname) return;

    e.preventDefault();
    var open = link.closest('dialog');
    if (open) open.close();
    swap(url.href, true);
  });

  window.addEventListener('popstate', function () {
    var el = board();
    if (!el || isSpa(el)) return;
    swap(window.location.href, false);
  });
})();`;

export const BoardScript: FC = () => (
    /* eslint-disable-next-line */
    <script dangerouslySetInnerHTML={{ __html: BOARD_SCRIPT }} />
);
