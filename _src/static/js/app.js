/* ==========================================================================
   Lunar Landing Site Navigator — shared UI
   Navigation, search, TOC, code copy, reveal, tabs. No external requests
   except fetching the locally built search index.
   ========================================================================== */
(function () {
  "use strict";

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const docEl = document.documentElement;

  /* ---------- header, progress, drawer ---------- */
  const header = $(".site-header");
  const progress = $(".scroll-progress span");
  let ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      const y = window.scrollY || docEl.scrollTop;
      if (header) header.classList.toggle("is-scrolled", y > 12);
      if (progress) {
        const max = docEl.scrollHeight - window.innerHeight;
        progress.style.width = (max > 0 ? Math.min(100, (y / max) * 100) : 0) + "%";
      }
      ticking = false;
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const drawer = $("#mobileDrawer");
  const scrim = $(".drawer-scrim");
  const menuBtn = $("[data-menu-open]");
  let lastFocus = null;

  function setDrawer(open) {
    if (!drawer) return;
    if (open) lastFocus = document.activeElement;
    drawer.hidden = !open;
    if (scrim) scrim.hidden = !open;
    drawer.classList.toggle("is-open", open);
    if (menuBtn) menuBtn.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
    if (open) {
      const close = $("[data-menu-close]", drawer);
      if (close) close.focus();
    } else if (lastFocus) {
      lastFocus.focus();
    }
  }
  $$("[data-menu-open]").forEach((b) => b.addEventListener("click", () => setDrawer(true)));
  $$("[data-menu-close]").forEach((b) => b.addEventListener("click", () => setDrawer(false)));

  /* ---------- Arabic-aware text normalisation ---------- */
  function normalize(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[\u064B-\u0652\u0670\u0640]/g, "") // harakat + tatweel
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      .replace(/[^\w\u0600-\u06FF]+/g, " ")
      .trim();
  }
  function tokens(q) {
    return normalize(q).split(/\s+/).filter((t) => t.length > 1 || /[0-9]/.test(t));
  }
  function escapeReg(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function highlight(text, terms) {
    const frag = document.createDocumentFragment();
    if (!terms.length) {
      frag.appendChild(document.createTextNode(text));
      return frag;
    }
    // highlight on the original string using loose word boundaries
    const re = new RegExp("(" + terms.map(escapeReg).join("|") + ")", "gi");
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = document.createElement("mark");
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return frag;
  }

  /* ---------- search index loader ---------- */
  let searchIndex = null;
  let searchPromise = null;

  function loadIndex() {
    if (searchIndex) return Promise.resolve(searchIndex);
    if (searchPromise) return searchPromise;
    searchPromise = fetch("assets/data/search.json", { cache: "force-cache" })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then((data) => {
        searchIndex = data.map((e) => {
          e._n = normalize(e.h + " " + e.p + " " + e.x);
          return e;
        });
        return searchIndex;
      })
      .catch((err) => {
        searchPromise = null;
        throw err;
      });
    return searchPromise;
  }

  function search(q, limit) {
    return loadIndex().then((idx) => {
      const terms = tokens(q);
      if (!terms.length) return [];
      const hits = [];
      idx.forEach((e) => {
        const hn = normalize(e.h + " " + e.p);
        let score = 0;
        let all = true;
        terms.forEach((t) => {
          if (hn.indexOf(t) !== -1) {
            score += e.k === "page" ? 9 : 7;
            if (hn.split(/\s+/).indexOf(t) !== -1) score += 3;
          } else if (e._n.indexOf(t) !== -1) {
            score += 2;
          } else {
            all = false;
          }
        });
        if (!all) return;
        if (normalize(e.h) === normalize(q)) score += 20;
        // prefer section entries over page-level duplicate
        if (e.k !== "page") score += 1;
        hits.push({ e: e, score: score });
      });
      hits.sort((a, b) => b.score - a.score || a.e.p.localeCompare(b.e.p, "ar"));
      return hits.slice(0, limit || 10).map((h) => h.e);
    });
  }

  /* ---------- modal search ---------- */
  const modal = $("#searchModal");
  const input = $("#searchInput");
  const resultsBox = $("#searchResults");
  let modalHits = [];
  let modalSel = -1;
  let modalLastFocus = null;
  let modalToken = 0;

  function openSearch() {
    if (!modal) return;
    modalLastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    if (input) {
      input.value = "";
      input.focus();
    }
    renderSearchEmpty();
  }
  function closeSearch() {
    if (!modal) return;
    modal.hidden = true;
    document.body.style.overflow = "";
    if (modalLastFocus) modalLastFocus.focus();
  }

  function renderSearchEmpty(msg) {
    if (!resultsBox) return;
    resultsBox.innerHTML =
      '<div class="search-empty"><p class="kicker">بحث سريع</p>' +
      "<p>" +
      (msg || "اكتب كلمة مثل «شاكليتون»، «الطاقة»، «MOON_ME»، أو «ميزانية الوصلة».") +
      "</p>" +
      '<div class="search-suggest">' +
      ["شاكليتون", "الإضاءة", "SPICE", "الاتصالات", "القطب"].map((q) => '<button type="button" data-q="' + q + '">' + q + "</button>").join("") +
      "</div></div>";
  }

  function renderModalResults(items, q) {
    if (!resultsBox) return;
    resultsBox.innerHTML = "";
    modalSel = -1;
    if (!items.length) {
      renderSearchEmpty("لا نتائج مطابقة. جرّب كلمة أقل تحديدًا أو صيغة إنجليزية.");
      return;
    }
    const terms = tokens(q);
    items.forEach((e, i) => {
      const a = document.createElement("a");
      a.className = "sr-item";
      a.href = e.u + (e.a ? "#" + e.a : "");
      a.dataset.i = i;
      const top = document.createElement("div");
      top.className = "sr-top";
      const page = document.createElement("span");
      page.className = "sr-page";
      page.textContent = e.p;
      const kind = document.createElement("span");
      kind.className = "sr-page";
      kind.textContent = e.k === "page" ? "صفحة" : "قسم";
      top.append(page, kind);
      const strong = document.createElement("strong");
      strong.appendChild(highlight(e.h, terms));
      const p = document.createElement("p");
      p.appendChild(highlight(e.x || "", terms));
      a.append(top, strong, p);
      a.addEventListener("click", closeSearch);
      a.addEventListener("mouseenter", () => selectModal(i));
      resultsBox.appendChild(a);
    });
  }

  function selectModal(i) {
    const items = $$(".sr-item", resultsBox);
    if (!items.length) return;
    if (modalSel >= 0 && items[modalSel]) items[modalSel].classList.remove("is-sel");
    modalSel = Math.max(0, Math.min(items.length - 1, i));
    if (items[modalSel]) {
      items[modalSel].classList.add("is-sel");
      items[modalSel].scrollIntoView({ block: "nearest" });
    }
  }

  let searchTimer = null;
  function runModalSearch() {
    if (!input) return;
    const q = input.value.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) {
      renderSearchEmpty();
      return;
    }
    if (resultsBox) resultsBox.innerHTML = '<div class="loading"><span class="spinner"></span> جارٍ البحث…</div>';
    const my = ++modalToken;
    searchTimer = setTimeout(() => {
      search(q, 12)
        .then((items) => {
          if (my !== modalToken) return;
          modalHits = items;
          renderModalResults(items, q);
        })
        .catch(() => {
          if (my !== modalToken) return;
          if (resultsBox)
            resultsBox.innerHTML =
              '<div class="error-box"><b>تعذّر تحميل فهرس البحث.</b> تأكد من فتح الموقع عبر خادم محلي (وليس file://) ثم أعد المحاولة.</div>';
        });
    }, 120);
  }

  if (modal) {
    $$("[data-search-open]").forEach((b) => b.addEventListener("click", openSearch));
    $$("[data-search-close]").forEach((b) => b.addEventListener("click", closeSearch));
    if (input) input.addEventListener("input", runModalSearch);
    document.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-q]");
      if (b && resultsBox && resultsBox.contains(b)) {
        input.value = b.dataset.q;
        input.focus();
        runModalSearch();
      }
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && !modal.hidden) {
        ev.preventDefault();
        closeSearch();
      } else if ((ev.ctrlKey || ev.metaKey) && (ev.key === "k" || ev.key === "K")) {
        ev.preventDefault();
        if (modal.hidden) openSearch();
        else closeSearch();
      } else if (ev.key === "/" && modal.hidden && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        ev.preventDefault();
        openSearch();
      } else if (!modal.hidden && resultsBox) {
        if (ev.key === "ArrowDown") {
          ev.preventDefault();
          selectModal(modalSel + 1);
        } else if (ev.key === "ArrowUp") {
          ev.preventDefault();
          selectModal(modalSel < 0 ? 0 : modalSel - 1);
        } else if (ev.key === "Enter" && modalSel >= 0) {
          ev.preventDefault();
          const el = $$(".sr-item", resultsBox)[modalSel];
          if (el) {
            closeSearch();
            window.location.href = el.href;
          }
        }
      }
    });
  }

  /* ---------- full search page ---------- */
  const pageInput = $("#searchPageInput");
  if (pageInput) {
    const pageResults = $("#searchPageResults");
    const pageStatus = $("#searchPageStatus");
    const pageEmpty = $("#searchPageEmpty");
    let pageToken = 0;

    function setStatus(txt, isError) {
      if (!pageStatus) return;
      pageStatus.innerHTML = isError
        ? '<span class="red">' + txt + "</span>"
        : '<span class="dim">' + txt + "</span>";
    }

    function runPageSearch(q, push) {
      const query = (q || "").trim();
      if (push !== false) {
        const url = new URL(window.location.href);
        if (query) url.searchParams.set("q", query);
        else url.searchParams.delete("q");
        history.replaceState(null, "", url.toString());
      }
      if (!query || query.length < 2) {
        pageResults.innerHTML = "";
        if (pageEmpty) pageEmpty.hidden = false;
        setStatus("اكتب حرفين على الأقل.");
        return;
      }
      if (pageEmpty) pageEmpty.hidden = true;
      pageResults.innerHTML = '<div class="loading"><span class="spinner"></span> جارٍ البحث في كل الصفحات…</div>';
      setStatus("يبحث في العناوين والنصوص…");
      const my = ++pageToken;
      search(query, 80)
        .then((items) => {
          if (my !== pageToken) return;
          pageResults.innerHTML = "";
          if (!items.length) {
            pageResults.innerHTML = '<div class="glossary-empty">لا نتائج مطابقة. جرّب مرادفًا عربيًا أو مصطلحًا إنجليزيًا.</div>';
            setStatus("0 نتيجة.");
            return;
          }
          const terms = tokens(query);
          items.forEach((e) => {
            const a = document.createElement("a");
            a.className = "search-result";
            a.href = e.u + (e.a ? "#" + e.a : "");
            const pg = document.createElement("span");
            pg.className = "sr-page";
            pg.textContent = e.p + " · " + (e.k === "page" ? "صفحة" : "قسم");
            const h3 = document.createElement("h3");
            h3.appendChild(highlight(e.h, terms));
            const p = document.createElement("p");
            p.appendChild(highlight(e.x || "", terms));
            a.append(pg, h3, p);
            pageResults.appendChild(a);
          });
          setStatus(items.length + " نتيجة.");
        })
        .catch(() => {
          if (my !== pageToken) return;
          pageResults.innerHTML =
            '<div class="error-box"><b>تعذّر تحميل فهرس البحث.</b> شغّل الموقع عبر خادم محلي ثم أعد تحميل الصفحة.</div>';
          setStatus("خطأ في التحميل.", true);
        });
    }

    const initial = new URLSearchParams(window.location.search).get("q") || "";
    if (initial) pageInput.value = initial;
    runPageSearch(initial, false);
    let t = null;
    pageInput.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => runPageSearch(pageInput.value, true), 160);
    });
    pageInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        clearTimeout(t);
        runPageSearch(pageInput.value, true);
      }
    });
    $$("[data-page-q]").forEach((b) =>
      b.addEventListener("click", () => {
        pageInput.value = b.dataset.pageQ;
        pageInput.focus();
        runPageSearch(pageInput.value, true);
      })
    );
  }

  /* ---------- TOC active state ---------- */
  const tocLinks = $$(".toc a");
  if (tocLinks.length) {
    const targets = tocLinks
      .map((a) => {
        const id = a.getAttribute("href").slice(1);
        return { a: a, el: document.getElementById(id) };
      })
      .filter((x) => x.el);
    let tocTick = false;
    function updateToc() {
      if (tocTick) return;
      tocTick = true;
      requestAnimationFrame(() => {
        const y = window.scrollY + 120;
        let current = targets[0];
        targets.forEach((t) => {
          if (t.el.offsetTop <= y) current = t;
        });
        tocLinks.forEach((a) => a.classList.remove("is-active"));
        if (current) current.a.classList.add("is-active");
        tocTick = false;
      });
    }
    window.addEventListener("scroll", updateToc, { passive: true });
    updateToc();
  }

  /* ---------- copy page link ---------- */
  $$("[data-copy-link]").forEach((b) => {
    b.addEventListener("click", () => {
      const url = window.location.href.split("#")[0];
      copy(url, b, "⧉", "✓");
    });
  });

  function copy(text, btn, oldLabel, newLabel) {
    const done = () => {
      if (!btn) return;
      const prev = btn.textContent;
      btn.textContent = newLabel;
      setTimeout(() => (btn.textContent = prev || oldLabel), 1300);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback());
    } else fallback();

    function fallback() {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        done();
      } catch (e) {
        /* no-op */
      }
      document.body.removeChild(ta);
    }
  }

  /* ---------- code copy buttons ---------- */
  $$(".prose pre").forEach((pre) => {
    if ($(".copy-code", pre)) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-code";
    btn.textContent = "نسخ";
    btn.addEventListener("click", () => {
      const code = pre.querySelector("code");
      copy(code ? code.textContent : pre.textContent, btn, "نسخ", "تم");
    });
    pre.appendChild(btn);
  });

  /* ---------- reveal on scroll ---------- */
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("is-in");
            io.unobserve(en.target);
          }
        });
      },
      { rootMargin: "0px 0px -60px 0px", threshold: 0.08 }
    );
    $$(".reveal").forEach((el) => io.observe(el));
  } else {
    $$(".reveal").forEach((el) => el.classList.add("is-in"));
  }

  /* ---------- generic tabs ---------- */
  $$("[data-tabs]").forEach((root) => {
    const buttons = $$("[data-tab]", root);
    const panels = $$("[data-tab-panel]", root);
    buttons.forEach((b) => {
      b.addEventListener("click", () => {
        const key = b.dataset.tab;
        buttons.forEach((x) => {
          x.classList.toggle("is-active", x === b);
          x.setAttribute("aria-selected", String(x === b));
        });
        panels.forEach((p) => {
          p.hidden = p.dataset.tabPanel !== key;
        });
      });
    });
  });

  /* ---------- external links safety + current year ---------- */
  $$('a[href^="http"]').forEach((a) => {
    if (!a.target) a.target = "_blank";
    a.rel = (a.rel || "") + " noopener noreferrer";
  });

  /* ---------- expose helpers to labs.js ---------- */
  window.LLSN = window.LLSN || {};
  window.LLSN.normalize = normalize;
  window.LLSN.copy = copy;
  window.LLSN.fetchJSON = function (url, opts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (opts && opts.timeout) || 9000);
    return fetch(url, { cache: "force-cache", signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status + " — " + url);
        return r.json();
      })
      .finally(() => clearTimeout(timer));
  };
})();
