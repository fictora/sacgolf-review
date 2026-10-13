/* Sac Golf review layer: "Mark up" notes + "Talk to Ted" chat.
 * Only active with a review passcode (?k=... in the link, then remembered on this device).
 * Outside mark-up mode it never intercepts clicks, so the site's own buttons always work.
 * All user/server text is rendered with textContent (no HTML injection). */
(function () {
  "use strict";
  var API = "https://wqnrortftkffmbeugjky.supabase.co/functions/v1/sacgolf-review";
  var LS = "sgReviewKey";
  var qs = new URLSearchParams(location.search);
  var key = qs.get("k");
  try {
    if (key) localStorage.setItem(LS, key);
    else key = localStorage.getItem(LS);
  } catch (e) {}
  var PAGE = (location.pathname.split("/").pop() || "index.html");
  if (!/\.html$/.test(PAGE)) PAGE = "index.html";
  var PAGE_NAMES = { "index.html": "Home", "simulator.html": "Simulator", "book-a-bay.html": "Book a Bay",
    "repairs.html": "The Build Room", "about-sac-golf.html": "About", "contact.html": "Shop / Contact", "shop.html": "Shop (all products)" };

  // ---------- helpers ----------
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function api(body) {
    body.k = key;
    return fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Something went wrong"); return j; }); });
  }
  function ago(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " hr ago";
    return new Date(iso).toLocaleDateString();
  }
  var toastT;
  function toast(msg) {
    var t = document.querySelector(".sgr-toast") || document.body.appendChild(h("div", "sgr-toast sgr"));
    t.textContent = msg;
    t.classList.add("is-on");
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove("is-on"); }, 3200);
  }

  // Links/forms that only work on the real Shopify store.
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("[data-sg-offline]");
    if (a && !markMode) { e.preventDefault(); toast("That part (" + a.getAttribute("data-sg-offline") + ") lives on the real store, not this review copy."); }
  });
  document.addEventListener("submit", function (e) {
    if (e.target.matches && e.target.matches("form[data-sg-offline-form]")) { e.preventDefault(); toast("Forms are switched off in the review copy. Leave a note if something looks off."); }
  }, true);

  if (!key) return; // plain site without the review tools

  // ---------- selector + snippet for a tapped element ----------
  function cssPath(el) {
    var parts = [];
    while (el && el.nodeType === 1 && el !== document.body && parts.length < 8) {
      if (el.id && !/^sgr/.test(el.id) && /^[A-Za-z][\w-]*$/.test(el.id)) { parts.unshift("#" + el.id); break; }
      var tag = el.tagName.toLowerCase(), i = 1, sib = el;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) i++;
      parts.unshift(tag + ":nth-of-type(" + i + ")");
      el = el.parentElement;
    }
    return parts.join(" > ");
  }
  function snippet(el) {
    var t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (!t && el.tagName === "IMG") t = "[image] " + (el.alt || el.src.split("/").pop().split("?")[0]);
    if (!t) { var img = el.querySelector && el.querySelector("img"); if (img) t = "[image] " + (img.alt || ""); }
    return t.slice(0, 160) || "<" + el.tagName.toLowerCase() + ">";
  }
  function findEl(sel) {
    if (!sel) return null;
    try { return document.querySelector(sel); } catch (e) { return null; }
  }

  // ---------- UI shell ----------
  var root = h("div", "sgr sgr-root");
  root.setAttribute("data-sgr", "");
  var dock = h("div", "sgr-dock");
  var bMark = h("button", "sgr-btn sgr-btn--solid", "Mark up");
  var bNotes = h("button", "sgr-btn", "Notes");
  var nBadge = h("span", "sgr-badge"); bNotes.appendChild(nBadge);
  var bTed = h("button", "sgr-btn", "Talk to Ted");
  var tBadge = h("span", "sgr-badge"); bTed.appendChild(tBadge);
  [bMark, bNotes, bTed].forEach(function (b) { b.type = "button"; dock.appendChild(b); });
  root.appendChild(dock);

  var bar = h("div", "sgr-bar");
  bar.appendChild(h("span", "", "Tap anything on the page to leave a note."));
  var bDone = h("button", "sgr-btn sgr-btn--light", "Done"); bDone.type = "button"; bar.appendChild(bDone);
  root.appendChild(bar);

  var hl = h("div", "sgr-hl"); root.appendChild(hl);
  var pinLayer = h("div", "sgr-pins"); document.body.appendChild(pinLayer);

  // Panels
  function panel(title) {
    var p = h("section", "sgr-panel");
    var head = h("header", "sgr-panel__head");
    head.appendChild(h("h3", "sgr-panel__title", title));
    var x = h("button", "sgr-x", "×"); x.type = "button"; x.setAttribute("aria-label", "Close");
    x.onclick = function () { closePanels(); };
    head.appendChild(x);
    p.appendChild(head);
    var body = h("div", "sgr-panel__body"); p.appendChild(body);
    root.appendChild(p);
    return { el: p, body: body, head: head };
  }
  var compose = panel("Leave a note");
  var cTarget = h("div", "sgr-target"); compose.body.appendChild(cTarget);
  var cText = h("textarea", "sgr-input"); cText.rows = 4; cText.maxLength = 2000;
  cText.placeholder = "What should change here? e.g. “Make this say 'Open 7 days'”";
  compose.body.appendChild(cText);
  var cRow = h("div", "sgr-row");
  var cCancel = h("button", "sgr-btn", "Cancel"); cCancel.type = "button";
  var cSend = h("button", "sgr-btn sgr-btn--solid", "Send to Ted"); cSend.type = "button";
  cRow.appendChild(cCancel); cRow.appendChild(cSend); compose.body.appendChild(cRow);

  var notesP = panel("Your notes");
  notesP.body.appendChild(h("p", "sgr-hint", "Ted picks each note up within about a minute, makes the change and republishes. Refresh the page after it says done."));
  var notesList = h("ol", "sgr-list"); notesP.body.appendChild(notesList);

  var chatP = panel("Talk to Ted");
  chatP.body.appendChild(h("p", "sgr-hint", "Ted is Sebastian's guy on the site. Ask anything or tell him what to change."));
  var chatLog = h("div", "sgr-chat"); chatP.body.appendChild(chatLog);
  var chatForm = h("form", "sgr-chatform");
  var chatIn = h("textarea", "sgr-input"); chatIn.rows = 2; chatIn.maxLength = 2000; chatIn.placeholder = "Message Ted…";
  var chatSend = h("button", "sgr-btn sgr-btn--solid", "Send"); chatSend.type = "submit";
  chatForm.appendChild(chatIn); chatForm.appendChild(chatSend); chatP.body.appendChild(chatForm);

  document.body.appendChild(root);

  function closePanels() {
    [compose, notesP, chatP].forEach(function (p) { p.el.classList.remove("is-open"); });
    root.classList.remove("has-panel");
    if (!markMode) pinLayer.classList.remove("is-on");
    poll(true);
  }
  function openPanel(p) {
    [compose, notesP, chatP].forEach(function (q) { if (q !== p) q.el.classList.remove("is-open"); });
    p.el.classList.add("is-open");
    root.classList.add("has-panel");
    poll(true);
  }

  // ---------- mark-up mode ----------
  var markMode = false, picked = null;
  function isOurs(t) { return t.closest && (t.closest("[data-sgr]") || t.closest(".sgr-pins")); }
  function setMark(on) {
    markMode = on;
    document.documentElement.classList.toggle("sgr-marking", on);
    bMark.textContent = on ? "Marking…" : "Mark up";
    pinLayer.classList.toggle("is-on", on);
    if (!on) hl.style.display = "none";
    if (on) { closePanels(); pinLayer.classList.add("is-on"); renderPins(); }
  }
  function outline(el) {
    if (!el) { hl.style.display = "none"; return; }
    var r = el.getBoundingClientRect();
    hl.style.display = "block";
    hl.style.transform = "translate(" + (r.left - 3) + "px," + (r.top - 3) + "px)";
    hl.style.width = r.width + 6 + "px"; hl.style.height = r.height + 6 + "px";
  }
  document.addEventListener("mousemove", function (e) {
    if (!markMode || compose.el.classList.contains("is-open") || isOurs(e.target)) return;
    outline(e.target);
  }, true);
  // Capture-phase: in mark-up mode a tap picks the element instead of following links/buttons.
  function swallow(e) {
    if (!markMode || isOurs(e.target)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.type !== "click") return;
    picked = e.target;
    outline(picked);
    cTarget.textContent = "";
    cTarget.appendChild(h("span", "sgr-eyebrow", "On " + (PAGE_NAMES[PAGE] || PAGE)));
    cTarget.appendChild(h("q", "", snippet(picked)));
    cText.value = "";
    openPanel(compose);
    setTimeout(function () { cText.focus(); }, 50);
  }
  ["click", "submit"].forEach(function (t) {
    document.addEventListener(t, swallow, { capture: true, passive: false });
  });
  bMark.onclick = function () { setMark(!markMode); };
  bDone.onclick = function () { setMark(false); closePanels(); };
  cCancel.onclick = function () { closePanels(); outline(null); };
  cSend.onclick = function () {
    var note = cText.value.trim();
    if (!note) { cText.focus(); return; }
    cSend.disabled = true; cSend.textContent = "Sending…";
    api({ action: "note", page: PAGE, selector: picked ? cssPath(picked) : "", snippet: picked ? snippet(picked) : "", note: note })
      .then(function (j) {
        notes.unshift(j.note); renderNotes(); renderPins();
        closePanels(); outline(null);
        toast("Sent. Ted will pick it up within a minute.");
      })
      .catch(function (err) { toast(err.message); })
      .then(function () { cSend.disabled = false; cSend.textContent = "Send to Ted"; });
  };

  // ---------- notes ----------
  var notes = [], STATUS = { received: "Received", working: "Ted is on it", done: "Done", failed: "Needs Sebastian" };
  function renderNotes() {
    notesList.textContent = "";
    if (!notes.length) notesList.appendChild(h("li", "sgr-empty", "No notes yet. Tap “Mark up”, then tap anything on the page."));
    var open = 0;
    notes.forEach(function (n) {
      if (n.status !== "done" && n.status !== "failed") open++;
      var li = h("li", "sgr-note");
      var top = h("div", "sgr-note__top");
      top.appendChild(h("span", "sgr-chip sgr-chip--" + n.status, STATUS[n.status] || n.status));
      top.appendChild(h("span", "sgr-meta", (PAGE_NAMES[n.page] || n.page) + " · " + ago(n.created_at)));
      li.appendChild(top);
      if (n.snippet) li.appendChild(h("q", "sgr-note__snip", n.snippet));
      li.appendChild(h("p", "sgr-note__text", n.note));
      if (n.ted_reply) { var r = h("p", "sgr-note__reply"); r.appendChild(h("b", "", "Ted: ")); r.appendChild(document.createTextNode(n.ted_reply)); li.appendChild(r); }
      li.onclick = function () {
        if (n.page !== PAGE) { location.href = n.page + "#sgr-note-" + n.id; return; }
        var el = findEl(n.selector);
        if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); pinLayer.classList.add("is-on"); renderPins(); }
      };
      notesList.appendChild(li);
    });
    nBadge.textContent = open ? String(open) : "";
    nBadge.style.display = open ? "" : "none";
  }
  function renderPins() {
    pinLayer.textContent = "";
    if (!pinLayer.classList.contains("is-on")) return;
    notes.filter(function (n) { return n.page === PAGE; }).slice().reverse().forEach(function (n, i) {
      var el = findEl(n.selector); if (!el) return;
      var r = el.getBoundingClientRect();
      var p = h("button", "sgr-pin sgr-pin--" + n.status, String(i + 1));
      p.type = "button"; p.setAttribute("data-sgr", "");
      p.title = n.note;
      p.style.left = Math.max(4, r.left + window.scrollX - 10) + "px";
      p.style.top = Math.max(4, r.top + window.scrollY - 10) + "px";
      p.onclick = function (e) { e.preventDefault(); e.stopPropagation(); openPanel(notesP); };
      pinLayer.appendChild(p);
    });
  }
  window.addEventListener("resize", function () { renderPins(); });
  bNotes.onclick = function () {
    if (notesP.el.classList.contains("is-open")) return closePanels();
    pinLayer.classList.add("is-on"); renderPins(); openPanel(notesP);
  };

  // ---------- chat ----------
  var chat = [], lastChat = 0, seenTed = 0;
  try { seenTed = +localStorage.getItem("sgrSeenTed") || 0; } catch (e) {}
  function renderChat() {
    chatLog.textContent = "";
    if (!chat.length) chatLog.appendChild(h("p", "sgr-empty", "Say hi to Ted."));
    chat.forEach(function (m) {
      var b = h("div", "sgr-msg sgr-msg--" + m.role);
      b.appendChild(h("div", "sgr-msg__body", m.body));
      b.appendChild(h("div", "sgr-meta", (m.role === "ted" ? "Ted" : "You") + " · " + ago(m.created_at)));
      chatLog.appendChild(b);
    });
    var waiting = chat.length && chat[chat.length - 1].role === "mark";
    if (waiting) chatLog.appendChild(h("div", "sgr-typing", "Ted will reply in about a minute…"));
    chatLog.scrollTop = chatLog.scrollHeight;
    var unread = chat.filter(function (m) { return m.role === "ted" && m.id > seenTed; }).length;
    if (chatP.el.classList.contains("is-open")) {
      unread = 0; var maxTed = chat.reduce(function (a, m) { return m.role === "ted" ? Math.max(a, m.id) : a; }, seenTed);
      seenTed = maxTed; try { localStorage.setItem("sgrSeenTed", String(seenTed)); } catch (e) {}
    }
    tBadge.textContent = unread ? String(unread) : ""; tBadge.style.display = unread ? "" : "none";
  }
  bTed.onclick = function () {
    if (chatP.el.classList.contains("is-open")) return closePanels();
    openPanel(chatP); renderChat(); setTimeout(function () { chatIn.focus(); }, 50);
  };
  chatIn.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatForm.requestSubmit ? chatForm.requestSubmit() : chatSend.click(); } });
  chatForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var body = chatIn.value.trim(); if (!body) return;
    chatSend.disabled = true;
    api({ action: "chat", body: body, page: PAGE })
      .then(function (j) { chatIn.value = ""; if (j.message.id > lastChat) { chat.push(j.message); lastChat = j.message.id; } renderChat(); })
      .catch(function (err) { toast(err.message); })
      .then(function () { chatSend.disabled = false; });
  });

  // ---------- polling ----------
  var timer, inflight = false;
  function poll(soon) {
    clearTimeout(timer);
    if (soon) { timer = setTimeout(tick, 300); return; }
    var busy = root.classList.contains("has-panel") || notes.some(function (n) { return n.status === "received" || n.status === "working"; }) ||
      (chat.length && chat[chat.length - 1].role === "mark");
    timer = setTimeout(tick, document.hidden ? 60000 : busy ? 5000 : 20000);
  }
  function tick() {
    if (inflight) return poll();
    inflight = true;
    api({ action: "state", chat_after: lastChat })
      .then(function (j) {
        notes = j.notes || [];
        (j.chat || []).forEach(function (m) { if (m.id > lastChat) { chat.push(m); lastChat = m.id; } });
        renderNotes(); renderPins(); renderChat();
      })
      .catch(function (err) { if (/link/.test(err.message)) { toast(err.message); } })
      .then(function () { inflight = false; poll(); });
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(true); });
  renderNotes(); renderChat();
  tick();

  // Deep link from the notes list on another page.
  var m = /^#sgr-note-(\d+)$/.exec(location.hash);
  if (m) setTimeout(function () {
    var n = notes.filter(function (x) { return String(x.id) === m[1]; })[0];
    var el = n && findEl(n.selector);
    if (el) { el.scrollIntoView({ block: "center" }); pinLayer.classList.add("is-on"); renderPins(); }
  }, 1500);
})();
