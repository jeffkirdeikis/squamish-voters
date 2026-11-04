// squamishvoters.com/tip/: send the news desk a screenshot, link or note. The picture is shrunk in the browser first.
(() => {
  const f = document.querySelector('[data-tip]');
  if (!f) return;
  const file = f.querySelector('input[type=file]'), prev = f.querySelector('[data-tip-preview]'), msg = f.querySelector('[data-tip-msg]'), btn = f.querySelector('button');
  let image = '';
  const shrink = (blob) => new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); ok(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = no; img.src = URL.createObjectURL(blob);
  });
  file.addEventListener('change', async () => {
    image = ''; prev.hidden = true;
    if (!file.files[0]) return;
    try { image = await shrink(file.files[0]); prev.src = image; prev.hidden = false; } catch { msg.textContent = 'That picture would not open. Try a screenshot (PNG or JPG).'; }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = f.elements.text.value.trim(), link = f.elements.link.value.trim();
    if (!text && !link && !image) { msg.textContent = 'Add a screenshot, a link or a few words.'; return; }
    btn.disabled = true; msg.textContent = 'Sending…';
    try {
      const r = await fetch('/api/tip/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, link, image }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'That did not send. Try again.');
      f.reset(); image = ''; prev.hidden = true;
      msg.textContent = 'Thanks! We got it. If it checks out, it becomes a story.';
    } catch (err) { msg.textContent = err.message; }
    btn.disabled = false;
  });
})();
