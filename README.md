# Cloudflare Resolver API

Cloudflare Worker فقط، بدون واجهة. يعيد JSON يحتوي روابط التشغيل لكل السيرفرات التي يرجعها الموقع، ويدعم الأفلام والمسلسلات.

## الملفات

- `src/worker.js`: API Worker.
- `makima.a0d5c2ffd2859979.wasm`: وحدة فك التشفير المطلوبة.
- `wrangler.toml`: إعدادات النشر.

## النشر

```bash
npm install
npx wrangler login
npx wrangler secret put API_TOKEN
npx wrangler deploy
```

يمكن ترك `API_TOKEN` دون ضبط، لكن يفضل ضبطه حتى لا يكون الـAPI مفتوحًا للعامة.

## الفحص

```bash
curl https://YOUR_WORKER.workers.dev/health
```

## قائمة السيرفرات

```http
GET /servers
```

## فيلم

```bash
curl -X POST https://YOUR_WORKER.workers.dev/resolve-all \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer YOUR_API_TOKEN' \
  -d '{"type":"movie","tmdb_id":533535}'
```

## مسلسل

```bash
curl -X POST https://YOUR_WORKER.workers.dev/resolve-all \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer YOUR_API_TOKEN' \
  -d '{"type":"tv","tmdb_id":1399,"season":1,"episode":1}'
```

## شكل الاستجابة

```json
{
  "ok": true,
  "servers": [],
  "success_count": 8,
  "results": [
    {
      "server": "Leon",
      "ok": true,
      "stream_url": "https://.../index.m3u8"
    },
    {
      "server": "Jill",
      "ok": false,
      "error": "upstream ... failed (404)"
    }
  ]
}
```

عدد السيرفرات يقرأ ديناميكيًا من `/main/servers`، وليس ثابتًا داخل الكود. روابط التشغيل مؤقتة وموقعة.
