/* JADEPUFFER detector (browser version) — a DEFENSIVE tool that reads a database
   activity log and flags the behaviours of agentic (LLM-driven) database
   extortion, as reported by Sysdig. It only reads and scores text — it never
   runs anything. Educational v2 of the AI Hacking Agent project. */

(function () {
  "use strict";

  const IOCS = {
    "C2 / beacon host": ["45.131.66.106"],
    "exfil / staging host": ["64.20.53.230"],
    "ransom bitcoin address": ["3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"],
    "ransom contact email": ["e78393397@proton.me"],
    "known ransom table names": ["README_RANSOM", "RECOVER_YOUR_DATA", "PLEASE_READ_ME"],
  };

  const RULES = [
    { id: "RANSOM_TABLE", weight: 45, name: "Ransom-note table created",
      stage: "Impact / Extortion", mitre: "T1486 Data Encrypted for Impact",
      re: /\b(create\s+table|insert\s+into)\b[^;]*\b(readme_ransom|recover_your_data|please_read_me|decrypt|ransom)\b/i,
      why: "A table whose name reads like a ransom note — the attacker's demand is stored in the database itself." },
    { id: "RANSOM_MARKERS", weight: 35, name: "Ransom text / crypto markers",
      stage: "Impact / Extortion", mitre: "T1657 Financial Theft",
      re: /(bitcoin|\bbtc\b|monero|\bwallet\b|decryptor|your\s+data\s+has\s+been\s+encrypted|\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b|\b[\w.+-]+@proton\.me\b)/i,
      why: "Ransom wording, a crypto wallet, or a contact address appears in the SQL." },
    { id: "BULK_ENCRYPT", weight: 30, name: "Bulk AES encryption of a table",
      stage: "Impact", mitre: "T1486 Data Encrypted for Impact",
      re: /create\s+table\s+\w+[^;]*\bas\s+select\b[^;]*aes_encrypt\s*\(/i,
      why: "A whole table is copied through AES_ENCRYPT() — the 'encrypt everything' step of the ransom." },
    { id: "FK_DISABLE", weight: 20, name: "Foreign-key checks disabled",
      stage: "Impact", mitre: "T1485 Data Destruction",
      re: /set\s+(global\s+)?foreign_key_checks\s*=\s*0/i,
      why: "Foreign-key checks switched off — usually to force through mass DROPs that constraints would block." },
    { id: "DROP_DESTRUCTIVE", weight: 15, name: "Destructive DROP / TRUNCATE",
      stage: "Impact", mitre: "T1485 Data Destruction",
      re: /\b(drop\s+(table|database)|truncate\s+table)\b/i,
      why: "Tables or databases are being destroyed." },
    { id: "BACKDOOR_ADMIN", weight: 30, name: "Backdoor admin account inserted",
      stage: "Persistence / PrivEsc", mitre: "T1136 Create Account",
      re: /insert\s+into\s+(users|roles)\b[^;]*(role_admin|\brole\b.*admin|\$2[aby]\$)/i,
      why: "A new user or admin role inserted straight into the auth tables (often with a bcrypt hash) — a database backdoor." },
    { id: "CONTAINER_ESCAPE", weight: 25, name: "Privilege / container-escape probing",
      stage: "Discovery / PrivEsc", mitre: "T1611 Escape to Host",
      re: /(load_file\s*\(\s*['"]?\/(proc|var\/run\/docker\.sock|etc\/)|into\s+(out|dump)file|from\s+mysql\.func\b)/i,
      why: "The DB is used to read host files (/proc, docker.sock) or list UDFs — probing to break out of the database." },
    { id: "SECRET_HARVEST", weight: 15, name: "Secret / credential harvesting",
      stage: "Credential Access", mitre: "T1552 Unsecured Credentials",
      re: /(credentials\.json|\.env\b|secret|api[_-]?key|minioadmin)/i,
      why: "Queries reach for credential files or secrets in the environment." },
    { id: "AGENTIC_REASONING", weight: 20, name: "AI-style reasoning left in the SQL (agentic tell)",
      stage: "Attribution", mitre: "Behavioural",
      re: /(--|#|\/\*)[^\n]*\b(high[- ]?roi|largest|drop it too|already\s+backed\s+up|prioriti|let'?s\s|we\s+should|i'?ll\s|step\s+\d|todo:)\b/i,
      why: "Human attackers don't leave natural-language reasoning in throwaway SQL. Comments like 'high-ROI DBs to drop' are a signature of an LLM-driven operator — the thing that makes JADEPUFFER new." },
  ];

  function level(score) {
    if (score >= 90) return "CRITICAL";
    if (score >= 55) return "HIGH";
    if (score >= 25) return "MEDIUM";
    if (score >= 1) return "LOW";
    return "CLEAN";
  }

  function scan(statements) {
    const findings = [];
    statements.forEach((stmt, i) => {
      RULES.forEach((rule) => {
        if (rule.re.test(stmt)) {
          findings.push({ rule: rule.id, name: rule.name, stage: rule.stage,
            mitre: rule.mitre, weight: rule.weight, why: rule.why,
            line: i + 1, evidence: stmt.trim().slice(0, 150) });
        }
      });
    });

    // cross-statement: encrypt a table, then drop originals
    const encTables = [], dropped = [];
    statements.forEach((s) => {
      const e = /create\s+table\s+(\w+)[^;]*aes_encrypt/i.exec(s);
      if (e) encTables.push(e[1].toLowerCase());
      const d = /drop\s+table\s+`?(\w+)`?/i.exec(s);
      if (d) dropped.push(d[1].toLowerCase());
    });
    if (encTables.length && dropped.length) {
      findings.push({ rule: "ENCRYPT_THEN_DESTROY", name: "Encrypt-copy then destroy original",
        stage: "Impact", mitre: "T1486 / T1485", weight: 25, line: 0,
        why: "A table was copied through encryption and the originals then dropped — the full 'lock the data, delete the original' ransom pattern.",
        evidence: "encrypted: [" + [...new Set(encTables)] + "]; dropped: [" + [...new Set(dropped)] + "]" });
    }

    const low = statements.join("\n").toLowerCase();
    const iocHits = [];
    for (const label in IOCS) {
      IOCS[label].forEach((v) => { if (low.includes(v.toLowerCase())) iocHits.push({ type: label, value: v }); });
    }

    let score = findings.reduce((a, f) => a + f.weight, 0) + 25 * iocHits.length;
    score = Math.min(score, 100);
    return {
      score, level: level(score), findings, iocHits,
      verdict: score >= 55 ? "Looks like JADEPUFFER-style agentic database extortion."
        : score >= 25 ? "Some suspicious activity — worth a review."
        : "No JADEPUFFER indicators found.",
    };
  }

  // expose for the demo page
  window.jadepuffer = { scan, statementsFrom: (text) =>
    text.split(/\n/).map((s) => s.trim()).filter(Boolean) };
})();
