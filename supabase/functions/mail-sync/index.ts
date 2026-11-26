// OOS mail sync: finds ticket emails in Gmail and guesses what they are. Supabase Edge Function.
// One file, no imports, so it can be pasted into Dashboard -> Edge Functions -> "Via editor".
// Secrets (Dashboard -> Edge Functions -> Secrets): GMAIL_USER, GMAIL_APP_PASSWORD (a Google app
// password, not the normal one), OWNER_EMAIL (the email you sign in to the app with).
// Read-only: the mailbox is opened with EXAMINE and messages are fetched with BODY.PEEK, so nothing
// is marked read, moved or deleted. It only returns guesses; the app asks you before adding anything.

export const DEFAULT_KW = ["ticket", "tickets", "order confirmation", "sold", "vstupenky", "objednavka"];
const MAX_MSGS = 30, MAX_BYTES = 61440;

/* ---------------- tiny IMAP client over any byte stream ---------------- */
export type Conn = { read(p: Uint8Array): Promise<number | null>; write(p: Uint8Array): Promise<number>; close(): void };
type Item = { text: string; lits: Uint8Array[] };
const enc = new TextEncoder(), latin1 = new TextDecoder("latin1");

export class Imap {
  c: Conn; buf: Uint8Array = new Uint8Array(0); tag = 0;
  constructor(c: Conn) { this.c = c; }
  async fill() {
    const chunk = new Uint8Array(65536), n = await this.c.read(chunk);
    if (n === null) throw new Error("Gmail closed the connection.");
    const b = new Uint8Array(this.buf.length + n); b.set(this.buf); b.set(chunk.subarray(0, n), this.buf.length); this.buf = b;
  }
  async line(): Promise<string> {
    for (;;) {
      for (let i = 0; i + 1 < this.buf.length; i++) if (this.buf[i] === 13 && this.buf[i + 1] === 10) {
        const s = latin1.decode(this.buf.subarray(0, i)); this.buf = this.buf.subarray(i + 2); return s;
      }
      await this.fill();
    }
  }
  async bytes(len: number): Promise<Uint8Array> {
    while (this.buf.length < len) await this.fill();
    const out = this.buf.slice(0, len); this.buf = this.buf.subarray(len); return out;
  }
  /* one response: a line plus every {n} literal it announces */
  async item(): Promise<Item> {
    let text = await this.line(); const lits: Uint8Array[] = []; let m;
    while ((m = text.match(/\{(\d+)\}$/))) { lits.push(await this.bytes(+m[1])); text += "\u0000" + await this.line(); }
    return { text, lits };
  }
  async send(s: string) { let p = enc.encode(s); while (p.length) { const n = await this.c.write(p); p = p.subarray(n); } }
  async cmd(c: string): Promise<Item[]> {
    const t = "a" + (++this.tag); await this.send(t + " " + c + "\r\n");
    const items: Item[] = [];
    for (;;) {
      const it = await this.item();
      if (it.text.startsWith(t + " ")) { if (!/^\S+ OK/i.test(it.text)) throw new Error(it.text.slice(t.length + 1)); return items; }
      items.push(it);
    }
  }
}
export const q = (s: string) => '"' + s.replace(/[\\"]/g, (m) => "\\" + m) + '"';

export function buildQuery(kws: string[], since: string | null) {
  const k = kws.map((w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/["()]/g, "").trim()).filter(Boolean).slice(0, 20);
  return `subject:(${(k.length ? k : DEFAULT_KW).map((w) => `"${w}"`).join(" OR ")}) -category:promotions ` +
    (since ? `after:${since.replace(/-/g, "/")}` : "newer_than:120d");
}

export async function findMail(conn: Conn, user: string, pass: string, query: string, max = MAX_MSGS) {
  const im = new Imap(conn);
  const hello = await im.line(); if (!/^\* OK/i.test(hello)) throw new Error("Unexpected Gmail greeting.");
  try { await im.cmd(`LOGIN ${q(user)} ${q(pass)}`); }
  catch (_) { throw new Error("Gmail refused the login. Check GMAIL_USER and that GMAIL_APP_PASSWORD is an app password (not your normal password)."); }
  // "All Mail" has a different name per Gmail language, so find it by its \All flag
  let box = "INBOX";
  for (const it of await im.cmd(`LIST "" "*"`)) {
    const m = it.text.match(/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (.+)$/i);
    if (m && /\\All\b/i.test(m[1]) && !m[2].includes("\u0000")) box = m[2];
  }
  await im.cmd(`EXAMINE ${box}`);
  const uids: number[] = [];
  for (const it of await im.cmd(`UID SEARCH X-GM-RAW ${q(query)}`)) {
    const m = it.text.match(/^\* SEARCH ?(.*)$/i); if (m) m[1].trim().split(/\s+/).filter(Boolean).forEach((u) => uids.push(+u));
  }
  const pick = uids.sort((a, b) => a - b).slice(-max);
  const out = [];
  if (pick.length) {
    for (const it of await im.cmd(`UID FETCH ${pick.join(",")} (UID BODY.PEEK[]<0.${MAX_BYTES}>)`)) {
      const u = it.text.match(/UID (\d+)/); if (!u || !it.lits.length) continue;
      out.push(parseMessage(latin1.decode(it.lits[0]), +u[1]));
    }
  }
  try { await im.cmd("LOGOUT"); } catch (_) { /* closing anyway */ }
  return out.sort((a, b) => b.uid - a.uid);
}

/* ---------------- MIME ---------------- */
const b64 = (s: string) => { try { const bin = atob(s.replace(/[^A-Za-z0-9+/=]/g, "")); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); } catch (_) { return new Uint8Array(0); } };
const qp = (s: string, header = false) => {
  if (header) s = s.replace(/_/g, " ");
  s = s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
    else out.push(s.charCodeAt(i) & 255);
  }
  return Uint8Array.from(out);
};
const raw = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);
const decode = (b: Uint8Array, cs: string) => { try { return new TextDecoder((cs || "utf-8").toLowerCase(), { fatal: false }).decode(b); } catch (_) { return new TextDecoder().decode(b); } };
export const words = (s: string) => s.replace(/(=\?[^?]+\?[bBqQ]\?[^?]*\?=)\s+(?==\?)/g, "$1")
  .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs, e, t) => decode(e.toUpperCase() === "B" ? b64(t) : qp(t, true), cs));

function headers(head: string) {
  const h: Record<string, string> = {};
  head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).forEach((l) => { const i = l.indexOf(":"); if (i > 0) { const k = l.slice(0, i).trim().toLowerCase(); if (!(k in h)) h[k] = l.slice(i + 1).trim(); } });
  return h;
}
const param = (v: string, p: string) => { const m = v.match(new RegExp(p + '\\s*=\\s*"?([^";]+)"?', "i")); return m ? m[1].trim() : ""; };

/* every text part of a (latin1-decoded) message, decoded to real text */
function parts(src: string, depth = 0): { type: string; text: string }[] {
  const i = src.search(/\r?\n\r?\n/), h = headers(i < 0 ? src : src.slice(0, i)), body = i < 0 ? "" : src.slice(i).replace(/^\r?\n\r?\n/, "");
  const ct = (h["content-type"] || "text/plain").toLowerCase();
  if (ct.startsWith("multipart/") && depth < 6) {
    const bd = param(h["content-type"], "boundary"); if (!bd) return [];
    return body.split("--" + bd).slice(1).filter((p) => !p.startsWith("--")).flatMap((p) => parts(p.replace(/^\r?\n/, ""), depth + 1));
  }
  if (!ct.startsWith("text/")) return [];
  const te = (h["content-transfer-encoding"] || "").toLowerCase();
  const bytes = te === "base64" ? b64(body) : te === "quoted-printable" ? qp(body) : raw(body);
  return [{ type: ct.split(";")[0], text: decode(bytes, param(h["content-type"] || "", "charset")) }];
}
const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", euro: "€", ndash: "–", mdash: "—", middot: "·" };
export const htmlText = (s: string) => s.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table|section)>/gi, "\n").replace(/<\/t[dh]>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m)
  .split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim()).filter(Boolean).join("\n");

export function parseMessage(src: string, uid = 0) {
  const i = src.search(/\r?\n\r?\n/), h = headers(i < 0 ? src : src.slice(0, i));
  const ps = parts(src), plain = ps.find((p) => p.type === "text/plain" && p.text.trim().length > 200), html = ps.find((p) => p.type === "text/html");
  const text = plain ? plain.text.replace(/\r/g, "") : html ? htmlText(html.text) : (ps[0]?.text || "");
  const subject = words(h["subject"] || "").replace(/\s+/g, " ").trim(), from = words(h["from"] || "").trim();
  const d = new Date(h["date"] || ""), date = isNaN(+d) ? "" : d.toISOString();
  return { id: (h["message-id"] || "").replace(/[<>\s]/g, "") || "uid:" + uid, uid, from, subject, date,
    snippet: text.replace(/\s+/g, " ").trim().slice(0, 240), guess: guess(subject, text, date) };
}

/* ---------------- guesses ---------------- */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const MON: [RegExp, number][] = [[/^jan|^led/, 1], [/^feb|^uno/, 2], [/^mar|^bre/, 3], [/^apr|^dub/, 4], [/^may|^kve/, 5], [/^jun|^cervn/, 6],
  [/^jul|^cervc|^cerven(c|e)/, 7], [/^aug|^srp/, 8], [/^sep|^zar/, 9], [/^oct|^rij/, 10], [/^nov|^lis/, 11], [/^dec|^pro/, 12]];
const mon = (w: string) => { w = fold(w).toLowerCase(); if (w === "cervna") return 6; if (w.startsWith("cervenc")) return 7; for (const [r, n] of MON) if (r.test(w)) return n; return 0; };
const ymd = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 2000 && y < 2100) ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "";
const MW = "([A-Za-zÀ-ſ]{3,12})\\.?";
export function dates(t: string) {
  const out: { i: number; v: string }[] = [], add = (i: number, v: string) => { if (v) out.push({ i, v }); };
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) add(m.index!, ymd(+m[1], +m[2], +m[3]));
  for (const m of t.matchAll(/\b(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})\b/g)) add(m.index!, ymd(+m[3], +m[2], +m[1]));
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})\\.?\\s+${MW}\\s+(\\d{4})\\b`, "g"))) { const n = mon(m[2]); if (n) add(m.index!, ymd(+m[3], n, +m[1])); }
  for (const m of t.matchAll(new RegExp(`\\b${MW}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "g"))) { const n = mon(m[1]); if (n) add(m.index!, ymd(+m[3], n, +m[2])); }
  return out.sort((a, b) => a.i - b.i).map((x) => x.v);
}
export function num(s: string) {
  s = s.replace(/[\s ]/g, "");
  const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lc >= 0) s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  else if (ld >= 0 && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, "");
  return parseFloat(s);
}
const CUR: Record<string, string> = { "€": "EUR", eur: "EUR", "kč": "CZK", kc: "CZK", czk: "CZK", "$": "USD", usd: "USD", "£": "GBP", gbp: "GBP" };
const N = "(\\d{1,3}(?:[ .,\\u00a0]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)";
const C = "(€|eur|kč|kc|czk|\\$|usd|£|gbp)";
export function amounts(t: string) {
  const out: { i: number; v: number; cur: string }[] = [];
  for (const m of t.matchAll(new RegExp(`${C}\\s?${N}|${N}\\s?${C}(?![a-z])`, "gi"))) {
    const v = num(m[2] || m[3]), cur = CUR[(m[1] || m[4]).toLowerCase()];
    if (v > 0 && cur) out.push({ i: m.index!, v, cur });
  }
  return out;
}
const TOTAL = /(grand total|order total|total paid|total|you paid|amount paid|celkem|k úhradě|k uhrade|payout|you('|’)ll receive|you will receive|earnings|proceeds|výplata|vyplata)/gi;
export function guess(subject: string, text: string, date = "") {
  const T = subject + "\n" + text, s = fold(subject).toLowerCase();
  const sale = /\bsold\b|payout|paid out|prodan|prodej/.test(s) || /(your (tickets?|listing)s? (has|have) (been )?sold|you('|’)ve sold|you have sold)/i.test(T);
  // event: a labelled line wins, else the subject without the "order confirmation"-style words
  const lab = text.match(/^(?:event|akce|představení|predstaveni|koncert)\s*[:\-]\s*(.{3,80})$/im);
  let event = lab ? lab[1].trim() : subject.replace(/^((re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/(order confirmation|confirmation of your order|your order( for)?|you('|’)ve got tickets( to)?|you got tickets( to)?|your tickets?( (for|to))?|tickets? (for|to)|your listing( for)?|(has|have) (been )?sold!?|you('|’)ve sold( tickets?( (for|to))?)?|sold:|potvrzen[ií] objedn[aá]vky|objedn[aá]vka|vstupenky na)/gi, " ")
    .replace(/^[\s\-–:|!,.]+|[\s\-–:|!,.]+$/g, "").replace(/\s{2,}/g, " ");
  if (!event) event = subject;
  const day = date.slice(0, 10), ds = dates(fold(text) + "\n" + fold(subject));
  const eventDate = ds.find((d) => !day || d >= day) || ds[0] || "";
  const am = amounts(T); let total = 0, currency = "EUR";
  for (const m of T.matchAll(TOTAL)) { const a = am.find((x) => x.i > m.index! && x.i - m.index! < 80); if (a) { total = a.v; currency = a.cur; break; } }
  if (!total && am.length) { const a = am.reduce((x, y) => (y.v > x.v ? y : x)); total = a.v; currency = a.cur; }
  const qm = T.match(/(?:qty|quantity|počet|pocet|množství|mnozstvi)\s*[:\-]?\s*(\d{1,2})\b/i) || T.match(/\b(\d{1,2})\s*(?:x\s*)?(?:e-?)?(?:tickets?|vstupen\w*|lístk\w*|listk\w*)\b/i) || T.match(/\b(\d{1,2})\s*x\s/i);
  const qty = Math.max(1, Math.min(99, qm ? +qm[1] : 1));
  // matched on accent-free text: JS \b doesn't treat letters like "Ř" as word characters
  const ft = fold(text), f1 = (r: RegExp) => { const m = ft.match(r); return m ? m[1].trim().slice(0, 14) : ""; };
  const sector = f1(/\b(?:section|sec\.?|sektor|block|blok)\s*[:#\-]?\s*([A-Za-z0-9][A-Za-z0-9\-]{0,9})\b/i);
  const row = f1(/\b(?:row|rada)\s*[:#\-]?\s*([A-Za-z0-9]{1,5})\b/i);
  const sm = ft.match(/\b(?:seats?|sedadl[oa]|mista|misto)\s*[:#\-]?\s*(\d{1,4}(?:\s*(?:[-–,&]|and|to|a)\s*\d{1,4})*)/i);
  const seats = sm ? sm[1].replace(/\s*(?:–|to)\s*/g, "-").replace(/\s*(?:&|and|a)\s*/g, ",").replace(/\s+/g, "") : "";
  return { type: sale ? "sale" : "purchase", event: event.slice(0, 90), eventDate, qty, total, each: total ? Math.round(total / qty * 100) / 100 : 0, currency, sector, row, seats };
}

/* ---------------- HTTP ---------------- */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // @ts-ignore Deno global exists in the Edge Runtime
    const env = (k: string) => (Deno.env.get(k) || "").trim();
    // only the owner may read the mailbox: check who is calling with Supabase Auth
    const who = await fetch(env("SUPABASE_URL") + "/auth/v1/user", { headers: { Authorization: req.headers.get("Authorization") || "", apikey: env("SUPABASE_ANON_KEY") } });
    if (!who.ok) return json({ error: "Sign in to the app first (Sync page)." }, 401);
    const me = await who.json();
    if (!env("OWNER_EMAIL") || String(me.email || "").toLowerCase() !== env("OWNER_EMAIL").toLowerCase()) return json({ error: "This account isn't allowed to read the mailbox. Check the OWNER_EMAIL secret." }, 403);
    if (!env("GMAIL_USER") || !env("GMAIL_APP_PASSWORD")) return json({ error: "Add the GMAIL_USER and GMAIL_APP_PASSWORD secrets in Supabase." }, 500);
    const body = await req.json().catch(() => ({}));
    const kws = Array.isArray(body.keywords) ? body.keywords.filter((k: unknown) => typeof k === "string" && k.length <= 40) : DEFAULT_KW;
    const since = typeof body.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.since) ? body.since : null;
    const query = buildQuery(kws, since);
    // @ts-ignore Deno global exists in the Edge Runtime
    const conn = await Deno.connectTls({ hostname: "imap.gmail.com", port: 993 });
    try { return json({ found: await findMail(conn, env("GMAIL_USER"), env("GMAIL_APP_PASSWORD").replace(/\s+/g, ""), query), query }); }
    finally { try { conn.close(); } catch (_) { /* already closed */ } }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
// @ts-ignore Deno global exists in the Edge Runtime; Node (tests) skips this
if (typeof Deno !== "undefined") Deno.serve(handler);
