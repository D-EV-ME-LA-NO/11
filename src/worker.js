import WASM from "../makima.a0d5c2ffd2859979.wasm";

const API_BASE = "https://api.viduki.net";
const ORIGIN = "https://www.viduki.net";
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Cloudflare Worker) AppleWebKit/537.36 Chrome/137 Safari/537.36",
  Origin: ORIGIN,
  Referer: `${ORIGIN}/`,
  "Accept-Language": "en-US,en;q=0.9",
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

function cors(request, response) {
  const origin = request.headers.get("Origin");
  const allowed = origin || "*";
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", allowed);
  headers.set("Access-Control-Allow-Headers", "content-type, authorization");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

function hexBytes(value, name) {
  if (typeof value !== "string" || value.length % 2 || !/^[0-9a-f]+$/i.test(value)) throw new Error(`invalid hex field: ${name}`);
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function int64be(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, BigInt(value), false);
  return out;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function solveAltcha(challenge) {
  const target = String(challenge.challenge).toLowerCase();
  const salt = String(challenge.salt);
  const max = Number(challenge.maxnumber ?? 50000);
  for (let number = 0; number <= max; number++) {
    if (await sha256Hex(salt + String(number)) === target) {
      const took = 0;
      const payload = { algorithm: challenge.algorithm, challenge: challenge.challenge, number, salt, signature: challenge.signature, took };
      return btoa(JSON.stringify(payload));
    }
  }
  throw new Error("Altcha solution not found");
}

async function upstream(path, options = {}) {
  const response = await fetch(API_BASE + path, {
    ...options,
    headers: { ...BROWSER_HEADERS, Accept: "application/json", ...(options.headers || {}) },
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`upstream ${path} returned non-JSON (${response.status})`); }
  if (!response.ok) throw new Error(`upstream ${path} failed (${response.status})`);
  return data;
}

async function getNonce() {
  const challenge = await upstream("/altcha-challenge");
  const solution = await solveAltcha(challenge);
  const result = await upstream("/bootstrap", { headers: { "X-Altcha": solution } });
  if (!result?.n || !/^[0-9a-f]{32}$/i.test(result.n)) throw new Error("invalid bootstrap nonce");
  return result.n;
}

function createCrypto() {
  let instance;
  const ready = WebAssembly.instantiate(WASM, { env: { abort() { throw new Error("WASM abort"); } } }).then(x => { instance = x.instance; return instance.exports; });
  const manifest = { alloc: "_gGry", reset: "_kuez", writeByte: "_0SGL", readByte: "_4vLu", decryptPepper: "_iUeM", decryptEnvelope: "_kGtw" };
  const put = (e, data) => { const ptr = e[manifest.alloc](data.length); data.forEach((v, i) => e[manifest.writeByte](ptr, i, v)); return { ptr, len: data.length }; };
  const read = (e, ptr, len) => { const out = new Uint8Array(len); for (let i = 0; i < len; i++) out[i] = e[manifest.readByte](ptr, i); return out; };
  return {
    async decryptPepper(envelope, nonce) {
      const e = await ready; e[manifest.reset]();
      const a = put(e, hexBytes(nonce, "nonce"));
      const b = put(e, int64be(envelope.bucket));
      const c = put(e, hexBytes(envelope.iv, "iv"));
      const d = put(e, hexBytes(envelope.ct, "ct"));
      const f = put(e, hexBytes(envelope.tag, "tag"));
      const result = e[manifest.decryptPepper](a.ptr, a.len, b.ptr, b.len, c.ptr, c.len, d.ptr, d.len, f.ptr, f.len);
      return e[manifest.readByte](result, 0) === 0;
    },
    async decryptEnvelope(envelope, fields) {
      const e = await ready;
      const a = put(e, hexBytes(fields.clientNonce, "clientNonce"));
      const b = put(e, hexBytes(envelope.sn, "serverNonce"));
      const tb = put(e, int64be(envelope.tb));
      const d = put(e, hexBytes(fields.requestId, "requestId"));
      const e2 = put(e, hexBytes(envelope.iv2, "iv2"));
      const f = put(e, hexBytes(envelope.wk, "wk"));
      const g = put(e, hexBytes(envelope.tag2, "tag2"));
      const h = put(e, hexBytes(envelope.iv1, "iv1"));
      const i = put(e, hexBytes(envelope.ct, "ct"));
      const j = put(e, hexBytes(envelope.tag1, "tag1"));
      const out = e[manifest.alloc](hexBytes(envelope.ct, "ct").length);
      const length = e[manifest.decryptEnvelope](a.ptr, a.len, b.ptr, b.len, tb.ptr, 8, d.ptr, d.len, e2.ptr, e2.len, f.ptr, f.len, g.ptr, g.len, h.ptr, h.len, i.ptr, i.len, j.ptr, j.len, out);
      return length > 0 ? read(e, out, length) : null;
    },
  };
}

function sourcePath(input, server) {
  const id = encodeURIComponent(String(input.tmdb_id));
  const srv = encodeURIComponent(server);
  if (input.type === "tv") return `/main/tv/${id}/${encodeURIComponent(String(input.season))}/${encodeURIComponent(String(input.episode))}?srv=${srv}`;
  return `/main/movie/${id}?srv=${srv}`;
}

function findUrl(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.url === "string" && /^https?:\/\//i.test(value.url)) return value.url;
  for (const child of Object.values(value)) { const found = findUrl(child); if (found) return found; }
  return null;
}

async function getServers() {
  const data = await upstream("/main/servers");
  return Array.isArray(data) ? data : (Array.isArray(data?.servers) ? data.servers : (data?.data || []));
}

async function resolveAll(input) {
  const servers = await getServers();
  const nonce = await getNonce();
  const cryptoBox = createCrypto();
  const pepperChallenge = await upstream("/altcha-challenge");
  const pepperSolution = await solveAltcha(pepperChallenge);
  const pepper = await upstream("/pepper-key", { headers: { "X-Nonce": nonce, "X-Altcha": pepperSolution } });
  if (!await cryptoBox.decryptPepper(pepper, nonce)) throw new Error("pepper decrypt failed");

  const results = [];
  for (let offset = 0; offset < servers.length; offset += 3) {
    const batch = servers.slice(offset, offset + 3);
    const rows = await Promise.all(batch.map(async item => {
      const server = typeof item === "string" ? item : item.name;
      const clientNonce = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, "0")).join("");
      const requestId = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, "0")).join("");
      try {
        const envelope = await upstream(sourcePath(input, server), { headers: { "X-Nonce": nonce, "X-Client-Nonce": clientNonce, "X-Request-Id": requestId } });
        const clear = await cryptoBox.decryptEnvelope(envelope, { clientNonce, requestId });
        if (!clear) throw new Error("response decrypt failed");
        const data = JSON.parse(new TextDecoder().decode(clear));
        return { server, ok: true, stream_url: findUrl(data) };
      } catch (error) { return { server, ok: false, error: error.message }; }
    }));
    results.push(...rows);
  }
  return { ok: true, servers, success_count: results.filter(x => x.ok && x.stream_url).length, results };
}

function validInput(input) {
  if (!input || !["movie", "tv"].includes(input.type) || !Number.isInteger(Number(input.tmdb_id)) || Number(input.tmdb_id) <= 0) return false;
  if (input.type === "tv" && (!Number.isInteger(Number(input.season)) || !Number.isInteger(Number(input.episode)) || Number(input.season) < 1 || Number(input.episode) < 1)) return false;
  return true;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return cors(request, json({ ok: true }));
    const url = new URL(request.url);
    if (env.API_TOKEN && request.headers.get("Authorization") !== `Bearer ${env.API_TOKEN}`) return cors(request, json({ ok: false, error: "unauthorized" }, 401));
    try {
      if (request.method === "GET" && url.pathname === "/health") return cors(request, json({ ok: true, wasm: true }));
      if (request.method === "GET" && url.pathname === "/servers") return cors(request, json({ ok: true, servers: await getServers() }));
      if (request.method === "POST" && url.pathname === "/resolve-all") {
        const input = await request.json();
        if (!validInput(input)) return cors(request, json({ ok: false, error: "type, tmdb_id, season and episode are invalid" }, 400));
        return cors(request, json(await resolveAll(input)));
      }
      return cors(request, json({ ok: false, error: "not_found" }, 404));
    } catch (error) { return cors(request, json({ ok: false, error: error.message }, 502)); }
  },
};
