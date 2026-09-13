const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/10Q9Jf9pCdMtjbniAbOygajM1v3B6xC39a-bNmUnfyiw/export?format=csv&gid=923709619";

const COL = {
  timestamp: "Timestamp",
  type: "Type of feedback",
  describe: "Describe the game",
  stage: "Current development stage",
  buildLink: "Play test build Link",
  goalsHigh: "What is your high level goal for this playtest?",
  goalsDetail: "Describe your goal for this playtest in detail?",
  playtester: "What kind of playtester would your prefer?",
  instructions: "Special instructions for the playtest",
  prerequisites:
    "Any other prerequisite or materials needed for playtesting the game?",
  devName: "Dev Name",
  discord: "Discord username to ping",
};

const statusEl = document.getElementById("status");
const gridEl = document.getElementById("grid");
const modalEl = document.getElementById("modal");
const modalCloseEl = document.getElementById("modal-close");
const modalBadgesEl = document.getElementById("modal-badges");
const modalTitleEl = document.getElementById("modal-title");
const modalMetaEl = document.getElementById("modal-meta");
const modalHeaderActionsEl = document.getElementById("modal-header-actions");
const modalBodyEl = document.getElementById("modal-body");
const modalActionsEl = document.getElementById("modal-actions");

/** @type {Map<string, object>} */
const itemsById = new Map();

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = (cells[index] ?? "").trim();
    });
    return obj;
  });
}

function toId(timestamp) {
  const match = timestamp.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/
  );
  if (!match) {
    return encodeURIComponent(timestamp);
  }
  const [, day, month, year, hour, minute, second] = match;
  const pad = (n) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function shortStage(stage) {
  if (!stage) return "";
  const beforeParen = stage.split("(")[0].trim();
  const words = beforeParen.split(/\s+/).filter(Boolean);
  return words.slice(0, 2).join(" ");
}

function fallbackGameName(devName) {
  return devName ? `${devName}'s game` : "Untitled game";
}

function slugToTitle(slug) {
  if (!slug) return "";

  const raw = decodeURIComponent(slug).replace(/\+/g, " ").trim();
  const withoutExt = raw.replace(
    /\.(html?|php|aspx?|zip|rar|7z|exe|dmg|apk)$/i,
    ""
  );

  // Opaque IDs (Drive-style) — not human game titles.
  if (
    !/[-_\s]/.test(withoutExt) &&
    withoutExt.length >= 20 &&
    /^[a-zA-Z0-9]+$/.test(withoutExt)
  ) {
    return "";
  }

  const cleaned = withoutExt.replace(/[-_]+/g, " ").trim();
  if (!cleaned) return "";

  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function extractGameName(url, devName) {
  const fallback = fallbackGameName(devName);
  if (!url) return fallback;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean);

    if (host.endsWith("itch.io")) {
      const slug = parts[parts.length - 1];
      return slugToTitle(slug) || fallback;
    }

    if (host.includes("steampowered.com") || host.includes("steamcommunity.com")) {
      const appIndex = parts.findIndex((part) => part === "app" || part === "apps");
      if (appIndex !== -1) {
        const namePart = parts[appIndex + 2];
        if (namePart) {
          return slugToTitle(namePart) || fallback;
        }
      }
      return fallback;
    }

    if (host.includes("drive.google.com") || host.includes("docs.google.com")) {
      // Drive links are usually opaque file/folder IDs with no game title.
      return fallback;
    }

    const last = parts[parts.length - 1];
    return slugToTitle(last) || fallback;
  } catch {
    return fallback;
  }
}

function toGoalItems(value) {
  if (!value) return [];

  const lines = value
    .split(/\n/)
    .map((line) => line.replace(/^[•\-\*]\s*/, "").trim())
    .filter(Boolean);

  if (lines.length > 1) return lines;

  return lines[0]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setStatus(message, state = "info") {
  statusEl.hidden = !message;
  statusEl.textContent = message;
  statusEl.dataset.state = state;
}

function normalizeItem(row) {
  const timestamp = row[COL.timestamp] || "";
  if (!timestamp) return null;

  const describe = row[COL.describe] || "";
  const buildLink = row[COL.buildLink] || "";
  const devName = row[COL.devName] || "";

  return {
    id: toId(timestamp),
    timestamp,
    type: row[COL.type] || "",
    describe,
    stage: row[COL.stage] || "",
    stageShort: shortStage(row[COL.stage] || ""),
    buildLink,
    goalsHigh: row[COL.goalsHigh] || "",
    goalsDetail: row[COL.goalsDetail] || "",
    playtester: row[COL.playtester] || "",
    instructions: row[COL.instructions] || "",
    prerequisites: row[COL.prerequisites] || "",
    devName,
    discord: row[COL.discord] || "",
    gameName: extractGameName(buildLink, devName),
  };
}

function formatStageBadge(stage) {
  if (!stage) return "";
  const match = stage.trim().match(/^(\S+)([\s\S]*)$/);
  if (!match) return "";
  const [, first, rest] = match;
  return `<span class="badge"><span class="badge-stage-lead">${escapeHtml(first)}</span>${escapeHtml(rest)}</span>`;
}

function groupByType(items) {
  const preferred = [
    "Live Playtest",
    "Trailer feedback",
    "Store Page feedback",
  ];
  const groups = new Map();

  items.forEach((item) => {
    const type = item.type || "Other";
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(item);
  });

  const ordered = [];
  preferred.forEach((type) => {
    if (groups.has(type)) {
      ordered.push([type, groups.get(type)]);
      groups.delete(type);
    }
  });

  [...groups.keys()]
    .sort((a, b) => a.localeCompare(b))
    .forEach((type) => {
      ordered.push([type, groups.get(type)]);
    });

  return ordered;
}

function createCard(item, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card";
  button.style.animationDelay = `${Math.min(index * 0.05, 0.35)}s`;
  button.dataset.id = item.id;
  button.innerHTML = `
    ${item.stageShort ? `<div class="card-badges"><span class="badge">${escapeHtml(item.stageShort)}</span></div>` : ""}
    <h2 class="card-title">${escapeHtml(item.gameName)}</h2>
    ${item.describe ? `<p class="card-snippet">${escapeHtml(item.describe)}</p>` : ""}
    <div class="card-footer">${escapeHtml(item.devName || "Unknown developer")}</div>
  `;
  button.addEventListener("click", () => openItem(item.id, true));
  return button;
}

function renderGrid(items) {
  gridEl.innerHTML = "";
  const groups = groupByType(items);

  groups.forEach(([type, groupItems]) => {
    const category = document.createElement("section");
    category.className = "category";
    category.innerHTML = `
      <h2 class="category-title">
        ${escapeHtml(type)}
        <span class="category-count">${groupItems.length}</span>
      </h2>
    `;

    const grid = document.createElement("div");
    grid.className = "grid";
    groupItems.forEach((item, index) => {
      grid.appendChild(createCard(item, index));
    });

    category.appendChild(grid);
    gridEl.appendChild(category);
  });

  gridEl.hidden = items.length === 0;
}

function sectionText(label, value, { clamp = false, icon = "doc" } = {}) {
  if (!hasUsefulText(value)) return "";
  const shouldClamp = clamp && needsClamp(value);
  return `
    <section class="section-card">
      ${sectionHeading(label, icon)}
      <div class="clamp-block${shouldClamp ? " is-clamped" : ""}">
        <p class="clamp-text">${escapeHtml(value)}</p>
        ${
          shouldClamp
            ? `<button type="button" class="text-btn clamp-toggle" aria-expanded="false">Show more</button>`
            : ""
        }
      </div>
    </section>
  `;
}

function sectionList(label, items, { icon = "targets" } = {}) {
  const useful = items.filter((item) => hasUsefulText(item));
  if (!useful.length) return "";
  return `
    <section class="section-card">
      ${sectionHeading(label, icon)}
      <ul>
        ${useful.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function beforeYouPlaySection(instructions, prerequisites) {
  const parts = [];
  if (hasUsefulText(instructions)) {
    parts.push(`
      <div class="checklist-item">
        ${sectionHeading("Special instructions", "alert", "h4")}
        <p>${escapeHtml(instructions)}</p>
      </div>
    `);
  }
  if (hasUsefulText(prerequisites)) {
    parts.push(`
      <div class="checklist-item">
        ${sectionHeading("Prerequisites / materials", "box", "h4")}
        <p>${escapeHtml(prerequisites)}</p>
      </div>
    `);
  }
  if (!parts.length) return "";

  return `
    <section class="section-card section-priority">
      ${sectionHeading("Before you play", "play")}
      <div class="checklist">${parts.join("")}</div>
    </section>
  `;
}

const SECTION_ICONS = {
  play: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9"></circle>
      <path d="M10 8.5v7l6-3.5z"></path>
    </svg>
  `,
  alert: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l9 16H3L12 3z"></path>
      <path d="M12 10v4"></path>
      <circle cx="12" cy="16.5" r="0.8"></circle>
    </svg>
  `,
  box: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 8l9-5 9 5v9l-9 5-9-5V8z"></path>
      <path d="M3 8l9 5 9-5M12 13v9"></path>
    </svg>
  `,
  users: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="9" r="3.2"></circle>
      <path d="M3.5 19c.8-3 2.8-4.5 5.5-4.5S14 16 14.8 19"></path>
      <circle cx="17" cy="10" r="2.4"></circle>
      <path d="M15.2 19c.4-1.8 1.5-3 3.3-3.2 1.5.2 2.6 1.2 3 3.2"></path>
    </svg>
  `,
  doc: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h7l5 5v13H7V3z"></path>
      <path d="M14 3v5h5M9 13h6M9 17h6"></path>
    </svg>
  `,
  targets: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8"></circle>
      <circle cx="12" cy="12" r="4.5"></circle>
      <circle cx="12" cy="12" r="1.5"></circle>
    </svg>
  `,
  detail: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6h14M5 12h14M5 18h9"></path>
    </svg>
  `,
};

function sectionHeading(label, icon, tag = "h3") {
  return `
    <${tag} class="section-heading">
      <span class="section-icon">${SECTION_ICONS[icon] || SECTION_ICONS.doc}</span>
      <span>${escapeHtml(label)}</span>
    </${tag}>
  `;
}

function metaChip(label, value) {
  if (!hasUsefulText(value)) return "";
  return `<span><strong>${escapeHtml(label)}</strong> ${escapeHtml(value)}</span>`;
}

function discordChip(discord) {
  if (!hasUsefulText(discord)) return "";
  return `
    <span class="meta-discord">
      <strong>Discord</strong>
      <code>${escapeHtml(discord)}</code>
      <button
        type="button"
        class="text-btn copy-discord"
        data-discord="${escapeHtml(discord)}"
      >Copy</button>
    </span>
  `;
}

function hasUsefulText(value) {
  if (!value) return false;
  const cleaned = String(value)
    .trim()
    .toLowerCase()
    .replace(/[.!\s]+$/g, "");
  return ![
    "",
    "-",
    "--",
    "—",
    "none",
    "n/a",
    "n.a",
    "na",
    "nil",
    "null",
    "nothing",
    "no",
    "nope",
    "not applicable",
  ].includes(cleaned);
}

function needsClamp(value) {
  return value.length > 220 || value.split(/\n/).length > 4;
}

async function copyDiscord(value, button) {
  try {
    await navigator.clipboard.writeText(value);
    const original = button.textContent;
    button.textContent = "Copied";
    button.disabled = true;
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1200);
  } catch (error) {
    console.error(error);
    button.textContent = "Failed";
    setTimeout(() => {
      button.textContent = "Copy";
    }, 1200);
  }
}

function openItem(id, pushHash) {
  const item = itemsById.get(id);
  if (!item) {
    setStatus(`No playtest found for “${id}”.`, "error");
    closeModal(false);
    return;
  }

  setStatus("");
  modalBadgesEl.innerHTML = `
    ${item.type ? `<span class="badge badge-type">${escapeHtml(item.type)}</span>` : ""}
    ${formatStageBadge(item.stage)}
  `;
  modalTitleEl.textContent = item.gameName;
  modalMetaEl.innerHTML = [
    metaChip("Dev", item.devName),
    discordChip(item.discord),
    metaChip("Submitted", item.timestamp),
  ].join("");

  modalBodyEl.innerHTML = [
    beforeYouPlaySection(item.instructions, item.prerequisites),
    sectionText("Preferred playtester", item.playtester, { icon: "users" }),
    sectionText("Game description", item.describe, { clamp: true, icon: "doc" }),
    sectionList("High-level goals", toGoalItems(item.goalsHigh), {
      icon: "targets",
    }),
    sectionText("Detailed goals", item.goalsDetail, {
      clamp: true,
      icon: "detail",
    }),
  ].join("");

  modalHeaderActionsEl.innerHTML = "";
  if (item.buildLink) {
    const link = document.createElement("a");
    link.className = "btn btn-primary";
    link.href = item.buildLink;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open playtest build";
    modalHeaderActionsEl.appendChild(link);
  }

  modalActionsEl.innerHTML = "";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn btn-secondary";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => closeModal(true));
  modalActionsEl.appendChild(closeBtn);

  if (!modalEl.open) {
    modalEl.showModal();
  }

  if (pushHash) {
    const next = `#/item/${item.id}`;
    if (location.hash !== next) {
      location.hash = next;
    }
  }
}

function closeModal(clearHash) {
  if (modalEl.open) {
    modalEl.close();
  }
  if (clearHash && location.hash.startsWith("#/item/")) {
    history.pushState("", document.title, location.pathname + location.search);
  }
}

function idFromHash() {
  const match = location.hash.match(/^#\/item\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function syncFromHash() {
  const id = idFromHash();
  if (id) {
    openItem(id, false);
  } else {
    closeModal(false);
  }
}

async function loadPlaytests() {
  setStatus("Loading playtests…");
  gridEl.hidden = true;

  try {
    const response = await fetch(SHEET_CSV_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Sheet request failed (${response.status})`);
    }

    const csv = await response.text();
    if (/<!DOCTYPE html>/i.test(csv) || /accounts\.google/i.test(csv)) {
      throw new Error(
        "Could not read the sheet. Make sure it is shared as “Anyone with the link”."
      );
    }

    const items = rowsToObjects(parseCsv(csv))
      .map(normalizeItem)
      .filter(Boolean);

    itemsById.clear();
    items.forEach((item) => itemsById.set(item.id, item));

    if (!items.length) {
      setStatus("No playtests found in the sheet yet.");
      return;
    }

    renderGrid(items);
    setStatus("");
    syncFromHash();
  } catch (error) {
    console.error(error);
    setStatus(
      error instanceof Error ? error.message : "Failed to load playtests.",
      "error"
    );
  }
}

modalCloseEl.addEventListener("click", () => closeModal(true));
modalEl.addEventListener("click", (event) => {
  if (event.target === modalEl) {
    closeModal(true);
  }
});
modalEl.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeModal(true);
});
modalMetaEl.addEventListener("click", (event) => {
  const button = event.target.closest(".copy-discord");
  if (!button) return;
  copyDiscord(button.dataset.discord || "", button);
});
modalBodyEl.addEventListener("click", (event) => {
  const button = event.target.closest(".clamp-toggle");
  if (!button) return;
  const block = button.closest(".clamp-block");
  if (!block) return;
  const expanded = block.classList.toggle("is-expanded");
  block.classList.toggle("is-clamped", !expanded);
  button.textContent = expanded ? "Show less" : "Show more";
  button.setAttribute("aria-expanded", String(expanded));
});
window.addEventListener("hashchange", syncFromHash);

const themeToggleEl = document.getElementById("theme-toggle");

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  themeToggleEl.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
  );
  themeToggleEl.title =
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

themeToggleEl.addEventListener("click", () => {
  setTheme(currentTheme() === "dark" ? "light" : "dark");
});

window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", (event) => {
    if (!localStorage.getItem("theme")) {
      setTheme(event.matches ? "dark" : "light");
    }
  });

setTheme(currentTheme());
loadPlaytests();
