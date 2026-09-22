/* Candidate questionnaire. Saves progress locally as they type, then posts to the
   site's own endpoint. If that fails it falls back to an email hand-off, so their work is never lost. */
(function () {
  var form = document.getElementById('cform');
  if (!form) return;
  var KEY = 'sv26_cform', TO = 'squamishvoters@gmail.com';
  var done = document.getElementById('fdone'), count = document.getElementById('fcount');
  var WORD = { '2': 'Strongly agree', '1': 'Somewhat agree', '0': 'Mixed / in the middle', '-1': 'Somewhat disagree', '-2': 'Strongly disagree' };

  function read() { var o = {}; new FormData(form).forEach(function (v, k) { o[k] = v; }); return o; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(read())); } catch (e) {} tally(); }
  function restore() {
    var o; try { o = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (o) {
      Object.keys(o).forEach(function (k) {
        var els = form.elements[k]; if (!els) return;
        if (els.length && els[0] && els[0].type === 'radio') { [].forEach.call(els, function (r) { if (r.value === o[k]) r.checked = true; }); }
        else if (els.value !== undefined) els.value = o[k];
      });
    }
    tally();
  }
  function tally() {
    var total = form.querySelectorAll('.fq').length, n = 0;
    form.querySelectorAll('.fq').forEach(function (fs) {
      if (fs.querySelector('input[type=radio]:checked')) { n++; fs.classList.add('answered'); } else fs.classList.remove('answered');
    });
    count.textContent = n + ' of ' + total + ' statements answered. Your progress is saved in this browser.';
  }

  form.addEventListener('change', save);
  form.addEventListener('input', function (e) { if (e.target.tagName === 'TEXTAREA') save(); });
  document.getElementById('fclear').addEventListener('click', function () {
    if (!confirm('Clear everything you have typed on this form?')) return;
    form.reset(); try { localStorage.removeItem(KEY); } catch (e) {}
    tally(); done.hidden = true; form.hidden = false;
  });

  function buildText(o) {
    var out = ['SQUAMISH VOTERS — CANDIDATE QUESTIONNAIRE', '', 'Name: ' + (o.who || ''), 'Email: ' + (o.email || ''), 'Sent: ' + new Date().toLocaleString('en-CA'), ''];
    form.querySelectorAll('.fq').forEach(function (fs, i) {
      var id = fs.getAttribute('data-qid'), v = o[id];
      if (v === undefined || v === '') return;
      out.push((i + 1) + '. ' + fs.querySelector('legend').textContent.replace(/^\s*\d+\s*/, '').trim());
      out.push('   ANSWER: ' + (WORD[v] || v));
      if (o[id + '_note']) out.push('   NOTE: ' + o[id + '_note']);
      out.push('');
    });
    var wrote = false;
    form.querySelectorAll('textarea[name^="w_"]').forEach(function (t) {
      if (!t.value.trim()) return;
      if (!wrote) { out.push('IN THEIR OWN WORDS', ''); wrote = true; }
      out.push(t.closest('label').firstChild.textContent.trim(), t.value.trim(), '');
    });
    return out.join('\n');
  }

  function thanks() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    done.hidden = false; form.hidden = true; done.textContent = '';
    var h = document.createElement('h2'); h.textContent = 'Thank you — your answers are in';
    var p = document.createElement('p'); p.className = 'lede';
    p.textContent = 'They will appear on your profile at squamishvoters.com shortly. If you would like a photo added, email one you own the rights to to ' + TO + '. If anything else on your page is wrong, tell us and we will fix it.';
    var a = document.createElement('a'); a.className = 'btn big'; a.href = '/candidates/'; a.textContent = 'See the candidates page';
    done.append(h, p, a); window.scrollTo(0, 0);
  }

  function emailFallback(text, subject) {
    done.hidden = false; form.hidden = true; done.textContent = '';
    var h = document.createElement('h2'); h.textContent = 'We couldn’t save that automatically — one last step';
    var p = document.createElement('p'); p.className = 'lede';
    p.textContent = 'Nothing has reached us yet, but your answers are safe below. Please send them with the button, or copy them and email them to ' + TO + '.';
    var row = document.createElement('div'); row.className = 'btn-row';
    var mail = document.createElement('a');
    mail.className = 'btn big';
    mail.href = 'mailto:' + TO + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent('My answers are pasted below.\n\n' + text.slice(0, 1200));
    mail.textContent = 'Open my email app →';
    var copy = document.createElement('button');
    copy.type = 'button'; copy.className = 'btn secondary'; copy.textContent = 'Copy my answers';
    copy.onclick = function () {
      var ta = document.getElementById('fout');
      ta.select(); ta.setSelectionRange(0, 99999);
      try { document.execCommand('copy'); copy.textContent = '✓ Copied'; } catch (e) {}
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { copy.textContent = '✓ Copied'; }).catch(function () {});
    };
    var back = document.createElement('button');
    back.type = 'button'; back.className = 'btn secondary'; back.textContent = '← Back to the form';
    back.onclick = function () { done.hidden = true; form.hidden = false; window.scrollTo(0, 0); };
    row.append(mail, copy, back);
    var ta = document.createElement('textarea');
    ta.id = 'fout'; ta.readOnly = true; ta.rows = 18; ta.value = text;
    done.append(h, p, row, ta); window.scrollTo(0, 0);
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var o = read();
    if (!o.who) { alert('Please choose your name from the list first.'); form.elements.who.focus(); return; }
    if (!o.email || o.email.indexOf('@') < 0) { alert('Please add your email so we can check it is really you.'); form.elements.email.focus(); return; }
    var answered = form.querySelectorAll('.fq input[type=radio]:checked').length;
    var wroteSomething = [].some.call(form.querySelectorAll('textarea[name^="w_"]'), function (t) { return t.value.trim(); });
    if (!answered && !wroteSomething) { alert('Please answer at least one statement before sending.'); return; }

    var text = buildText(o), subject = 'Questionnaire — ' + o.who;
    var payload = { who: o.who, email: o.email, answers: {}, notes: {}, writing: {} };
    Object.keys(o).forEach(function (k) {
      if (/^q\d+$/.test(k) && o[k] !== '') payload.answers[k] = o[k];
      else if (/^q\d+_note$/.test(k) && o[k]) payload.notes[k.replace('_note', '')] = o[k];
      else if (k.indexOf('w_') === 0 && o[k]) payload.writing[k.slice(2)] = o[k];
    });

    var btn = document.getElementById('fsubmit');
    btn.disabled = true; btn.textContent = 'Sending…';
    fetch('/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
      .then(function (r) {
        btn.disabled = false; btn.textContent = 'Finish →';
        if (!r || !r.ok) throw new Error('failed');
        thanks();
      })
      .catch(function () {
        btn.disabled = false; btn.textContent = 'Finish →';
        emailFallback(text, subject);
      });
  });

  restore();
})();
