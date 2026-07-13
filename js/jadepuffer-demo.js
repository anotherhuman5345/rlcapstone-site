/* UI for the JADEPUFFER detector demo — a clean, animated line-by-line scan in
   the same style as the AI hacking agent's terminal replay. Uses the detector
   in js/jadepuffer-detect.js. Reads and scores text only; runs nothing. */

(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);

  const ATTACK = `SELECT config_value FROM app_settings WHERE name = 'minio_credentials';
SELECT LOAD_FILE('/var/run/docker.sock');
SELECT name, dl FROM mysql.func;
-- High-ROI databases to drop (data already backed up to staging host)
INSERT INTO users (username, password) VALUES ('xadmin', '$2a$10$abcdefghijklmnopqrQ9');
INSERT INTO roles (username, role) VALUES ('xadmin', 'ROLE_ADMIN');
CREATE TABLE config_info_enc AS SELECT id, AES_ENCRYPT(content, 'uuid-key') FROM config_info;
SET GLOBAL FOREIGN_KEY_CHECKS = 0;
DROP TABLE config_info;
DROP DATABASE nacos;
CREATE TABLE README_RANSOM (msg TEXT);
INSERT INTO README_RANSOM (msg) VALUES ('Your data is encrypted. Pay 0.5 BTC to 3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy. Contact e78393397@proton.me');`;

  const BENIGN = `SELECT id, name, price FROM products WHERE category = 'coffee';
INSERT INTO orders (user_id, total_cents) VALUES (42, 1299);
UPDATE users SET last_login = NOW() WHERE id = 42;
SELECT COUNT(*) FROM sessions WHERE active = 1;
CREATE TABLE temp_daily_report AS SELECT user_id, SUM(total_cents) FROM orders GROUP BY user_id;
DROP TABLE temp_daily_report;
INSERT INTO audit_log (action, user_id) VALUES ('checkout', 42);`;

  // short, plain-English label for each flagged behaviour
  const TAG = {
    RANSOM_TABLE: "ransom note", RANSOM_MARKERS: "ransom demand",
    BULK_ENCRYPT: "encrypting data", FK_DISABLE: "disabling safety checks",
    DROP_DESTRUCTIVE: "deleting data", BACKDOOR_ADMIN: "backdoor admin",
    CONTAINER_ESCAPE: "breakout attempt", SECRET_HARVEST: "stealing secrets",
    AGENTIC_REASONING: "AI reasoning",
  };
  const LEVEL_CLASS = { CRITICAL: "crit", HIGH: "high", MEDIUM: "med", LOW: "low", CLEAN: "clean" };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function addLine(text, bad, tag) {
    const el = document.createElement("div");
    el.className = "jp-line" + (bad ? " bad" : " ok");
    const code = document.createElement("span");
    code.className = "jp-code";
    code.textContent = text.length > 78 ? text.slice(0, 78) + "…" : text;
    el.appendChild(code);
    if (bad) {
      const t = document.createElement("span");
      t.className = "jp-tag";
      t.textContent = tag;
      el.appendChild(t);
    }
    const term = $("jp-terminal");
    term.appendChild(el);
    term.scrollTop = term.scrollHeight;
  }

  async function run(which) {
    document.querySelectorAll(".jp-controls button").forEach((b) => (b.disabled = true));
    $("jp-terminal").innerHTML = "";
    $("jp-verdict").hidden = true;

    const statements = window.jadepuffer.statementsFrom(which === "attack" ? ATTACK : BENIGN);
    const report = window.jadepuffer.scan(statements);
    const byLine = {};
    report.findings.forEach((f) => { if (f.line && !byLine[f.line]) byLine[f.line] = f; });

    for (let i = 0; i < statements.length; i++) {
      const f = byLine[i + 1];
      addLine(statements[i], !!f, f ? (TAG[f.rule] || "suspicious") : "");
      await sleep(f ? 420 : 200);
    }
    await sleep(350);

    const v = $("jp-verdict");
    v.className = "jp-verdict " + (LEVEL_CLASS[report.level] || "low");
    const flagged = report.findings.filter((f) => f.line).length;
    v.innerHTML =
      `<div class="jp-badge"><span class="jp-num">${report.score}</span><span class="jp-lvl">${report.level}</span></div>` +
      `<div class="jp-say"><strong>${report.verdict}</strong>` +
      `<span>${flagged ? flagged + " dangerous actions flagged" : "nothing suspicious"}` +
      (report.iocHits.length ? ` · ${report.iocHits.length} known indicators matched` : "") +
      `</span></div>`;
    v.hidden = false;
    v.scrollIntoView({ behavior: "smooth", block: "nearest" });

    document.querySelectorAll(".jp-controls button").forEach((b) => (b.disabled = false));
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("scan-attack").addEventListener("click", () => run("attack"));
    $("scan-benign").addEventListener("click", () => run("benign"));
  });
})();
