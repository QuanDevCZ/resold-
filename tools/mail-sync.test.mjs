// Tests for supabase/functions/mail-sync/index.ts: node --test tools/   (Node 22.18+/24 runs the .ts directly)
// Real Gmail can't be reached from a test, so the IMAP part runs against a scripted fake Gmail.
import test from "node:test";
import assert from "node:assert/strict";
import { parseMessage, guess, findMail, buildQuery, num, dates, words } from "../supabase/functions/mail-sync/index.ts";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
const latin1 = (buf) => Buffer.from(buf).toString("latin1");

// 1) Ticketmaster-style purchase: encoded subject, multipart/alternative, html in base64
const purchase = [
  "From: Ticketmaster <customer_support@email.ticketmaster.com>",
  "To: me@example.com",
  "Subject: =?UTF-8?B?" + Buffer.from("You've Got Tickets to Calvin Harris – Saint Paul").toString("base64") + "?=",
  "Date: Wed, 21 Oct 2026 10:15:00 +0200",
  "Message-ID: <abc123@tm.example>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/alternative; boundary="b1"',
  "",
  "--b1",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "short",
  "--b1",
  "Content-Type: text/html; charset=utf-8",
  "Content-Transfer-Encoding: base64",
  "",
  b64("<html><head><style>p{color:red}</style></head><body><h1>Calvin Harris</h1><p>Sat, 29 Apr 2027 &middot; 8:00 PM</p>" +
    "<table><tr><td>Section 206</td><td>Row 4</td><td>Seat 14</td></tr></table><p>1 Ticket</p><p>Order Total: &euro;93.00</p></body></html>"),
  "--b1--",
  "",
].join("\r\n");

// 2) Resale-style sale: quoted-printable plain text
const sale = [
  "From: viagogo <sales@viagogo.example>",
  "Subject: Your tickets have sold! Sam Fender - Newcastle",
  "Date: Mon, 2 Nov 2026 09:00:00 +0000",
  "Message-ID: <sale-77@vg.example>",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Great news! Your listing has sold.=0D",
  "Event: Sam Fender - Newcastle=0D",
  "Date: 5 June 2027=0D",
  "Quantity: 2=0D",
  "Section L1A, Row FF, Seats 9-10=0D",
  "You will receive: =E2=82=AC300.00 after the event. This is a long enough plain text part to be used as the body of the message.",
  "",
].join("\r\n");

// 3) Czech purchase: windows-1250, quoted-printable, Czech month and Kč with a space
const cz = [
  "From: Ticketportal <info@ticketportal.example>",
  "Subject: =?windows-1250?Q?Potvrzen=ED_objedn=E1vky_=96_Sara_Rikas?=",
  "Date: Tue, 3 Nov 2026 18:00:00 +0100",
  "Content-Type: text/plain; charset=windows-1250",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "D=ECkujeme za n=E1kup. Datum: 12. prosince 2026 v 20:00, Lucerna Praha.",
  "2 vstupenky, Sektor: B, =D8ada: 7, M=EDsta: 11 - 12",
  "Celkem: 2 400 K=E8. Tento text je dost dlouh=FD na to, aby se pou=9Eil jako t=EClo zpr=E1vy.",
  "",
].join("\r\n");

test("purchase email: subject, event, date, seats, total", () => {
  const m = parseMessage(purchase, 41);
  assert.equal(m.id, "abc123@tm.example");
  assert.equal(m.subject, "You've Got Tickets to Calvin Harris – Saint Paul");
  assert.equal(m.date, "2026-10-21T08:15:00.000Z");
  const g = m.guess;
  assert.equal(g.type, "purchase");
  assert.equal(g.event, "Calvin Harris – Saint Paul");
  assert.equal(g.eventDate, "2027-04-29");
  assert.deepEqual([g.sector, g.row, g.seats, g.qty, g.total, g.each, g.currency], ["206", "4", "14", 1, 93, 93, "EUR"]);
  assert.ok(!m.snippet.includes("color:red"), "style blocks are dropped");
});

test("sale email: type, labelled event, qty, payout per ticket", () => {
  const g = parseMessage(sale, 42).guess;
  assert.equal(g.type, "sale");
  assert.equal(g.event, "Sam Fender - Newcastle");
  assert.equal(g.eventDate, "2027-06-05");
  assert.deepEqual([g.qty, g.total, g.each, g.currency, g.sector, g.row, g.seats], [2, 300, 150, "EUR", "L1A", "FF", "9-10"]);
});

test("Czech email: windows-1250, Czech month, Kč amount, seats range", () => {
  const m = parseMessage(cz, 43);
  assert.equal(m.subject, "Potvrzení objednávky – Sara Rikas");
  const g = m.guess;
  assert.equal(g.type, "purchase");
  assert.equal(g.event, "Sara Rikas");
  assert.equal(g.eventDate, "2026-12-12");
  assert.deepEqual([g.qty, g.total, g.each, g.currency, g.sector, g.row, g.seats], [2, 2400, 1200, "CZK", "B", "7", "11-12"]);
});

test("number formats", () => {
  assert.equal(num("1.234,50"), 1234.5);
  assert.equal(num("1,234.50"), 1234.5);
  assert.equal(num("2 400"), 2400);
  assert.equal(num("93,00"), 93);
  assert.equal(num("1.200"), 1200);
});

test("dates in several formats, in order of appearance", () => {
  assert.deepEqual(dates("on 2027-01-02, then 3.4.2027, 5 May 2027 and September 26, 2027"), ["2027-01-02", "2027-04-03", "2027-05-05", "2027-09-26"]);
});

test("encoded words", () => {
  assert.equal(words("=?utf-8?Q?Caf=C3=A9_?= =?utf-8?B?w6k=?="), "Café é");
});

test("query: keywords without diacritics or quotes, date filter", () => {
  assert.equal(buildQuery(["Vstupenky", 'or"der'], "2026-11-01"), 'subject:("Vstupenky" OR "order") -category:promotions after:2026/11/01');
  assert.match(buildQuery([], null), /newer_than:120d$/);
});

test("a guess never returns qty 0 and keeps event text short", () => {
  const g = guess("x".repeat(200), "0 tickets", "");
  assert.equal(g.qty, 1);
  assert.ok(g.event.length <= 90);
});

/* ---- IMAP against a scripted fake Gmail, delivered in tiny chunks to exercise buffering ---- */
function fakeGmail(messages) {
  const enc = new TextEncoder();
  let out = enc.encode("* OK Gimap ready\r\n"), log = [];
  const reply = (s) => { const b = typeof s === "string" ? enc.encode(s) : s; const n = new Uint8Array(out.length + b.length); n.set(out); n.set(b, out.length); out = n; };
  return {
    log,
    async read(p) { if (!out.length) return null; const n = Math.min(7, p.length, out.length); p.set(out.subarray(0, n)); out = out.subarray(n); return n; },
    async write(p) {
      const line = new TextDecoder().decode(p).trim(); log.push(line.replace(/LOGIN .*/, "LOGIN ***"));
      const [tag, ...rest] = line.split(" "), cmd = rest.join(" ");
      if (cmd.startsWith("LOGIN")) reply(cmd.includes('"good"') ? `${tag} OK me authenticated\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
      else if (cmd.startsWith("LIST")) reply(`* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\All \\HasNoChildren) "/" "[Gmail]/V&AWE-echny zpr&AOE-vy"\r\n${tag} OK done\r\n`);
      else if (cmd.startsWith("EXAMINE")) reply(`* 3 EXISTS\r\n${tag} OK [READ-ONLY] selected\r\n`);
      else if (cmd.startsWith("UID SEARCH")) reply(`* SEARCH ${Object.keys(messages).join(" ")}\r\n${tag} OK search done\r\n`);
      else if (cmd.startsWith("UID FETCH")) {
        for (const [uid, src] of Object.entries(messages)) {
          const body = Buffer.from(src, "latin1");
          reply(`* ${uid} FETCH (UID ${uid} BODY[]<0> {${body.length}}\r\n`); reply(new Uint8Array(body)); reply(")\r\n");
        }
        reply(`${tag} OK fetch done\r\n`);
      } else if (cmd.startsWith("LOGOUT")) reply(`* BYE\r\n${tag} OK bye\r\n`);
      return p.length;
    },
    close() {},
  };
}

test("IMAP: read-only All Mail, search, literals across chunks, newest first", async () => {
  const czBytes = latin1(Buffer.from(cz, "latin1"));
  const g = fakeGmail({ 7: purchase, 9: sale, 12: czBytes });
  const found = await findMail(g, "me@gmail.com", "good", buildQuery(["ticket"], null));
  assert.deepEqual(found.map((f) => f.uid), [12, 9, 7]);
  assert.equal(found[1].guess.type, "sale");
  assert.equal(found[0].guess.currency, "CZK");
  assert.ok(g.log.some((l) => l.includes('EXAMINE "[Gmail]/V&AWE-echny zpr&AOE-vy"')), "opens All Mail found by its \\All flag, read-only");
  assert.ok(g.log.some((l) => l.includes("BODY.PEEK[]")), "fetches without marking read");
  assert.ok(!g.log.some((l) => /STORE|EXPUNGE|COPY|MOVE/.test(l)), "never changes the mailbox");
});

test("IMAP: wrong password gives a clear message", async () => {
  await assert.rejects(findMail(fakeGmail({}), "me@gmail.com", "bad", "x"), /app password/);
});
