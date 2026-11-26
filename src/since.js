// Home: the "in 6 days" countdown on the next meeting card, worked out on the reader's own clock.
// (This file once ran the "Since your last visit" box and the hero "New" line; Jeff had both removed on Nov 26 2026.)
(function () {
  Array.prototype.forEach.call(document.querySelectorAll('[data-until]'), function (u) {
    var p = u.getAttribute('data-until').split('-'), t = new Date(), n = Math.round((new Date(+p[0], +p[1] - 1, +p[2]) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 864e5);
    if (n >= 0) u.textContent = ' · ' + (n === 0 ? 'today' : n === 1 ? 'tomorrow' : 'in ' + n + ' days');
  });
})();
