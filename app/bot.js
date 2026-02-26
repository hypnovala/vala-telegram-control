const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");

const token = process.env.BOT_TOKEN;
const allowedUserId = process.env.ALLOWED_USER_ID;

if (!token) {
  console.error("Missing BOT_TOKEN env var");
  process.exit(1);
}
if (!allowedUserId) {
  console.error("Missing ALLOWED_USER_ID env var");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

const LANES = {
  VALA: "/data/VALA",
  HypnoticDreamTV: "/data/HypnoticDreamTV",
  Gated_Private: "/data/Gated_Private",
  Massage_Business: "/data/Massage_Business",
};

// --------------------
// BRAND FIREWALL RULES
// --------------------
const FIREWALL = {
  // Public lanes: must NOT contain erotic/explicit terms or massage references
  PUBLIC_BLOCKLIST: [
    // erotic / explicit signals (public lanes)
    /\b(nude|naked|uncensored|porn|xxx|onlyfans|explicit|hardcore)\b/i,
    /\b(happy\s*ending|handjob|blowjob|anal|cum|orgasm|climax)\b/i,
    /\b(sex|sexual|erotic)\b/i,
    /\b(18\+|id\s*verification|performer|adult\s*content)\b/i,

    // massage business crossover signals (public lanes)
    /\b(massage|therapist|therapy|client|session|table|oil|bodywork)\b/i,
    /\b(nervous\s*system|licensed)\b/i,
  ],

  // Massage lane: must NOT contain lingerie / VALA / erotic media references
  MASSAGE_BLOCKLIST: [
    /\b(VALA|Hypnotic\s*Dream|lingerie|sleepwear)\b/i,
    /\b(erotic|sexual|adult\s*content|18\+|uncensored|onlyfans)\b/i,
    /\b(model|shoot|campaign|goddess)\b/i,
  ],

  // Private lane: must NOT contain therapy claims or massage framing
  PRIVATE_BLOCKLIST: [
    /\b(therapy|therapeutic|healing\s*trauma|trauma\s*healing|treatment|medical)\b/i,
    /\b(massage\s*therapist|licensed|nervous\s*system)\b/i,
    /\b(client)\b/i,
  ],
};

function isAllowed(msg) {
  return msg?.from?.id?.toString() === allowedUserId.toString();
}

function safeJoin(base, target) {
  const targetPath = path.normalize(path.join(base, target));
  if (!targetPath.startsWith(base)) throw new Error("Invalid path");
  return targetPath;
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .sort();
}

function readFile(filePath, maxChars = 3500) {
  const content = fs.readFileSync(filePath, "utf8");
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + "\n\n[...truncated...]";
}

function moveFile(src, dest) {
  fs.renameSync(src, dest);
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeFirewallLog(lane, filename, verdict) {
  try {
    const logDir = "/data/Agent_Logs/firewall";
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const safeName = (filename || "unknown").replace(/[^\w.\- ]/g, "_");
    const outPath = path.join(logDir, `${lane}__${safeName}__${nowStamp()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(verdict, null, 2), "utf8");
    return outPath;
  } catch (e) {
    return null;
  }
}

function scanContentForLane(lane, content) {
  const hits = [];

  if (lane === "Massage_Business") {
    for (const re of FIREWALL.MASSAGE_BLOCKLIST) {
      if (re.test(content)) hits.push(re.toString());
    }
  } else if (lane === "Gated_Private") {
    for (const re of FIREWALL.PRIVATE_BLOCKLIST) {
      if (re.test(content)) hits.push(re.toString());
    }
  } else {
    for (const re of FIREWALL.PUBLIC_BLOCKLIST) {
      if (re.test(content)) hits.push(re.toString());
    }
  }

  const ok = hits.length === 0;
  return {
    ok,
    lane,
    hits,
    notes: ok
      ? ["No firewall violations detected for this lane."]
      : ["Firewall violations detected. Fix flagged terms or move to correct lane."],
  };
}

function helpText() {
  return `VALA Hybrid Control Bot ✅

Commands:
/help
/lanes
/list <LANE> <drafts|approved>
/preview <LANE> <drafts|approved> <filename>
/scan <LANE> <drafts|approved> <filename>
/approve <LANE> <filename>    (moves drafts -> approved)

Examples:
/list VALA drafts
/preview VALA drafts caption_01.md
/scan VALA drafts caption_01.md
/approve VALA caption_01.md`;
}

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  if (!isAllowed(msg)) return;

  const text = (msg.text || "").trim();

  if (text === "/help") return bot.sendMessage(chatId, helpText());
  if (text === "/lanes") return bot.sendMessage(chatId, Object.keys(LANES).join("\n"));

  // /list LANE drafts|approved
  if (text.startsWith("/list ")) {
    const parts = text.split(" ").filter(Boolean);
    if (parts.length !== 3) return bot.sendMessage(chatId, "Usage: /list <LANE> <drafts|approved>");
    const lane = parts[1];
    const bucket = parts[2];
    const base = LANES[lane];
    if (!base) return bot.sendMessage(chatId, "Unknown lane. Use /lanes");
    if (!["drafts", "approved"].includes(bucket)) return bot.sendMessage(chatId, "Bucket must be drafts or approved");

    const dir = path.join(base, bucket);
    const files = listFiles(dir);
    if (!files.length) return bot.sendMessage(chatId, `${lane}/${bucket}: (no files)`);
    return bot.sendMessage(chatId, `${lane}/${bucket}:\n` + files.join("\n"));
  }

  // /preview LANE drafts|approved filename
  if (text.startsWith("/preview ")) {
    const parts = text.split(" ").filter(Boolean);
    if (parts.length < 4) return bot.sendMessage(chatId, "Usage: /preview <LANE> <drafts|approved> <filename>");
    const lane = parts[1];
    const bucket = parts[2];
    const filename = parts.slice(3).join(" ");
    const base = LANES[lane];
    if (!base) return bot.sendMessage(chatId, "Unknown lane. Use /lanes");
    if (!["drafts", "approved"].includes(bucket)) return bot.sendMessage(chatId, "Bucket must be drafts or approved");

    try {
      const dir = path.join(base, bucket);
      const filePath = safeJoin(dir, filename);
      if (!fs.existsSync(filePath)) return bot.sendMessage(chatId, "File not found.");
      const content = readFile(filePath);
      return bot.sendMessage(chatId, `📄 ${lane}/${bucket}/${filename}\n\n` + content);
    } catch (e) {
      return bot.sendMessage(chatId, "Invalid filename/path.");
    }
  }

  // /scan LANE drafts|approved filename
  if (text.startsWith("/scan ")) {
    const parts = text.split(" ").filter(Boolean);
    if (parts.length < 4) return bot.sendMessage(chatId, "Usage: /scan <LANE> <drafts|approved> <filename>");
    const lane = parts[1];
    const bucket = parts[2];
    const filename = parts.slice(3).join(" ");
    const base = LANES[lane];
    if (!base) return bot.sendMessage(chatId, "Unknown lane. Use /lanes");
    if (!["drafts", "approved"].includes(bucket)) return bot.sendMessage(chatId, "Bucket must be drafts or approved");

    try {
      const dir = path.join(base, bucket);
      const filePath = safeJoin(dir, filename);
      if (!fs.existsSync(filePath)) return bot.sendMessage(chatId, "File not found.");

      const content = fs.readFileSync(filePath, "utf8");
      const verdict = scanContentForLane(lane, content);
      const logPath = writeFirewallLog(lane, filename, verdict);

      const msgOut =
        (verdict.ok ? "✅ FIREWALL PASS\n" : "⛔ FIREWALL FAIL\n") +
        `Lane: ${lane}\n` +
        (verdict.ok ? "" : `Hits:\n- ${verdict.hits.join("\n- ")}\n`) +
        (logPath ? `\nLogged: ${logPath}` : "");

      return bot.sendMessage(chatId, msgOut);
    } catch (e) {
      return bot.sendMessage(chatId, "Scan failed (invalid filename/path).");
    }
  }

  // /approve LANE filename (drafts -> approved)  [NO firewall block yet — scan-only mode]
  if (text.startsWith("/approve ")) {
    const parts = text.split(" ").filter(Boolean);
    if (parts.length < 3) return bot.sendMessage(chatId, "Usage: /approve <LANE> <filename>");
    const lane = parts[1];
    const filename = parts.slice(2).join(" ");
    const base = LANES[lane];
    if (!base) return bot.sendMessage(chatId, "Unknown lane. Use /lanes");

    const draftsDir = path.join(base, "drafts");
    const approvedDir = path.join(base, "approved");

    try {
      const src = safeJoin(draftsDir, filename);
      const dest = safeJoin(approvedDir, filename);
      if (!fs.existsSync(src)) return bot.sendMessage(chatId, "Draft file not found in drafts.");
      if (fs.existsSync(dest)) return bot.sendMessage(chatId, "A file with that name already exists in approved.");
      moveFile(src, dest);
      return bot.sendMessage(chatId, `✅ Approved: moved ${lane}/drafts/${filename} -> ${lane}/approved/${filename}`);
    } catch (e) {
      return bot.sendMessage(chatId, "Invalid filename/path.");
    }
  }

  if (text.startsWith("/")) {
    return bot.sendMessage(chatId, "Unknown command. Use /help");
  }
});

console.log("vala-telegram-bot running (polling)...");
