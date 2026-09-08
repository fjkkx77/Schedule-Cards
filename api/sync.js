/**
 * 日程卡片 · 跨设备同步接口
 *
 * 存储用 Upstash Redis 的 REST 接口，整个文件零依赖（Node 自带 fetch + crypto）。
 * 环境变量由 Vercel 的 Upstash 集成自动注入，两套命名都兼容：
 *   KV_REST_API_URL / KV_REST_API_TOKEN
 *   UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 *
 * 接口：
 *   GET  /api/sync                 → 探测：这个部署是否配好了同步
 *   GET  /api/sync?code=xxxx       → 取回该同步码下的数据 {ok, version, doc}
 *   POST /api/sync  {code, baseVersion, doc}
 *        → baseVersion 与服务端当前版本一致才写入；不一致返回 409 + 服务端最新数据
 */

const crypto = require("crypto");

const MAX_BODY_BYTES = 400 * 1024;   /* 一份数据最大 400KB，够存几千条日程 */
const MAX_EVENTS = 3000;
const TTL_SECONDS = 400 * 24 * 3600; /* 每次写入续期，长期不用才自动过期 */

function creds(){
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return (url && token) ? { url: url.replace(/\/+$/, ""), token } : null;
}

async function redis(command){
  const c = creds();
  const r = await fetch(c.url, {
    method: "POST",
    headers: { Authorization: "Bearer " + c.token, "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  if(!r.ok){
    const t = await r.text().catch(() => "");
    throw new Error("存储服务返回 " + r.status + " " + t.slice(0, 200));
  }
  const j = await r.json();
  return j.result;
}

/* 同步码本身不落库，只存它的哈希，拿到数据库也反推不出同步码 */
function keyOf(code){
  return "sched:" + crypto.createHash("sha256").update("scv1|" + code).digest("hex").slice(0, 40);
}

function cleanCode(v){
  const s = String(v == null ? "" : v).trim();
  return /^[A-Za-z0-9\-_]{8,64}$/.test(s) ? s : null;
}

function send(res, status, obj){
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  try{
    if(req.method === "OPTIONS"){ res.status(204); res.end(); return; }

    const configured = !!creds();

    if(req.method === "GET"){
      const raw = (req.query && req.query.code) || "";
      if(!raw) return send(res, 200, { ok: true, configured });   /* 探测用 */
      if(!configured) return send(res, 503, { ok: false, error: "服务端还没配置存储（缺少 Upstash 环境变量）" });

      const code = cleanCode(raw);
      if(!code) return send(res, 400, { ok: false, error: "同步码只能是 8~64 位的字母、数字、- 或 _" });

      const val = await redis(["GET", keyOf(code)]);
      if(!val) return send(res, 200, { ok: true, version: 0, doc: { events: [] }, empty: true });

      let parsed;
      try{ parsed = JSON.parse(val); }
      catch(e){ return send(res, 500, { ok: false, error: "服务端数据损坏" }); }
      return send(res, 200, {
        ok: true,
        version: parsed.version || 0,
        updatedAt: parsed.updatedAt || 0,
        doc: { events: Array.isArray(parsed.events) ? parsed.events : [] }
      });
    }

    if(req.method === "POST"){
      if(!configured) return send(res, 503, { ok: false, error: "服务端还没配置存储（缺少 Upstash 环境变量）" });

      let body = req.body;
      if(typeof body === "string"){
        try{ body = JSON.parse(body); }catch(e){ return send(res, 400, { ok:false, error:"请求体不是合法 JSON" }); }
      }
      if(!body || typeof body !== "object") return send(res, 400, { ok: false, error: "缺少请求体" });

      const code = cleanCode(body.code);
      if(!code) return send(res, 400, { ok: false, error: "同步码只能是 8~64 位的字母、数字、- 或 _" });

      const events = body.doc && Array.isArray(body.doc.events) ? body.doc.events : null;
      if(!events) return send(res, 400, { ok: false, error: "缺少 doc.events" });
      if(events.length > MAX_EVENTS) return send(res, 413, { ok: false, error: "日程条数超过上限 " + MAX_EVENTS });

      const payload = JSON.stringify({ events });
      if(Buffer.byteLength(payload, "utf8") > MAX_BODY_BYTES){
        return send(res, 413, { ok: false, error: "数据超过 400KB 上限" });
      }

      const key = keyOf(code);
      const cur = await redis(["GET", key]);
      let curVersion = 0, curDoc = { events: [] };
      if(cur){
        try{
          const p = JSON.parse(cur);
          curVersion = p.version || 0;
          curDoc = { events: Array.isArray(p.events) ? p.events : [] };
        }catch(e){ /* 坏数据直接当作空，让这次写入覆盖掉 */ }
      }

      const base = Number(body.baseVersion || 0);
      if(base !== curVersion){
        /* 另一台设备抢先写了：把最新版还给客户端，让它重新合并后再来一次 */
        return send(res, 409, { ok: false, conflict: true, version: curVersion, doc: curDoc });
      }

      const next = {
        version: curVersion + 1,
        updatedAt: Date.now(),
        events: events
      };
      await redis(["SET", key, JSON.stringify(next), "EX", String(TTL_SECONDS)]);
      return send(res, 200, { ok: true, version: next.version, updatedAt: next.updatedAt });
    }

    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { ok: false, error: "只支持 GET / POST" });
  }catch(err){
    return send(res, 500, { ok: false, error: String(err && err.message || err) });
  }
};
