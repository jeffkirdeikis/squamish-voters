// "Council is live now" strip under the site header: shows while a District of Squamish meeting is streaming on YouTube
// (api/council-live.js checks the channel). Checks again every two minutes while the page is open.
(function () {
  var bar = document.querySelector('[data-council-live]');
  if (!bar || !window.fetch) return;
  var title = bar.querySelector('[data-cl-title]');
  function check() {
    fetch('/api/council-live/').then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.live) {
        bar.href = d.url;
        title.textContent = d.title || '';
        bar.hidden = false;
      } else bar.hidden = true;
    }).catch(function () {});
  }
  check();
  setInterval(function () { if (!document.hidden) check(); }, 120000);
})();
