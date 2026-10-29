'use strict';

/**
 * The web services catalog behind the local server's /__services page: every endpoint of every service
 * connection (services/<name>/openapi3.json), the backend and credentials it goes out with
 * (services/catalog.json), its parameters, and the app files that call it by endpoint ID ("eqp-v1/getX").
 *
 * Built from the project's own files on each request, so the page always shows the code as it is now.
 * Plain Node, no dependencies.
 */
const fs = require('fs');
const path = require('path');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// Windows-1252 characters for bytes 0x80-0x9F: undoes UTF-8 that was saved as cp1252 text ("â€”" -> "—").
const CP1252 = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96,
  '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };

/** Repairs double-encoded text (services/eqp-v1/openapi3.json has ~50 "â€”"); anything else is returned as-is. */
function fixMojibake(s) {
  const text = String(s || '');
  if (!/[âÃ][\u0080-\u00bf€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/.test(text)) {
    return text;
  }
  const bytes = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code <= 0xff) {
      bytes.push(code);
    } else if (CP1252[ch] !== undefined) {
      bytes.push(CP1252[ch]);
    } else {
      return text;
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(bytes));
  } catch {
    return text;
  }
}

/** The resource an endpoint belongs to, for grouping: /equiprite/v1/<resource>/…, or the LOV name for Fusion. */
function groupOf(service, p) {
  const parts = p.split('/').filter(Boolean);
  if (parts[0] === 'equiprite' && parts.length >= 3) {
    return parts[2];
  }
  if (service === 'ProjectLOV') {
    return parts[parts.length - 1] || service;
  }
  return parts[1] || parts[0] || service;
}

function paramOf(prm) {
  const schema = prm.schema || {};
  const xvb = prm['x-vb'] || {};
  let example = prm.example !== undefined ? prm.example : (xvb.defaultValue !== undefined ? xvb.defaultValue : schema.default);
  if (example === undefined && Array.isArray(schema.enum) && schema.enum.length) {
    example = schema.enum[0];
  }
  return {
    name: prm.name,
    in: prm.in,
    required: !!prm.required || prm.in === 'path',
    type: schema.type || '',
    example: example === undefined ? '' : String(example),
    description: fixMojibake(prm.description || '').trim(),
  };
}

/** Every "<service>/<operationId>" the web app names, with the files that name it. */
function scanUsage(appDir, serviceNames) {
  const usage = new Map();
  if (!serviceNames.length || !fs.existsSync(appDir)) {
    return usage;
  }
  const re = new RegExp(`\\b(${serviceNames.map((s) => s.replace(/[-]/g, '\\-')).join('|')})/([A-Za-z0-9_]+)`, 'g');
  const walk = (dir) => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        walk(full);
      } else if (/\.(js|json|html)$/.test(d.name)) {
        const text = fs.readFileSync(full, 'utf8');
        const rel = path.relative(appDir, full).split(path.sep).join('/');
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(text))) {
          const key = `${m[1]}/${m[2]}`;
          if (!usage.has(key)) {
            usage.set(key, new Set());
          }
          usage.get(key).add(rel);
        }
      }
    });
  };
  walk(appDir);
  return usage;
}

function authOf(backend) {
  if (!backend || !backend.basic) {
    return 'anon';
  }
  return backend.isFusion ? 'fusion' : 'other';
}

/**
 * @param {string} repoRoot  the project folder (holds services/ and webApps/)
 * @returns {{ services: object[], rows: object[] }}
 */
function buildCatalog(repoRoot) {
  const servicesDir = path.join(repoRoot, 'services');
  const catalog = JSON.parse(fs.readFileSync(path.join(servicesDir, 'catalog.json'), 'utf8'));
  const backends = {};
  Object.keys(catalog.backends || {}).forEach((name) => {
    const server = (catalog.backends[name].servers || [])[0] || {};
    const auth = ((server['x-vb'] || {}).authentication || {}).authenticated || null;
    backends[name] = { url: String(server.url || '').replace(/\/+$/, ''), basic: !!(auth && auth.type === 'basic'), credentials: (auth && auth.credentials) || '' };
  });
  const fusionCred = (backends.fusion || backends.bipService || {}).credentials;
  Object.values(backends).forEach((b) => { b.isFusion = !!b.credentials && b.credentials === fusionCred; });

  const names = fs.readdirSync(servicesDir).filter((n) => fs.existsSync(path.join(servicesDir, n, 'openapi3.json'))).sort();
  const usage = scanUsage(path.join(repoRoot, 'webApps', 'vbredwoodapp'), names);
  const services = [];
  const rows = [];
  names.forEach((name) => {
    const doc = JSON.parse(fs.readFileSync(path.join(servicesDir, name, 'openapi3.json'), 'utf8'));
    const backendName = String(((doc.servers || [])[0] || {}).url || '').replace(/^vb-catalog:\/\/backends\//, '');
    const backend = backends[backendName];
    let count = 0;
    let used = 0;
    Object.keys(doc.paths || {}).forEach((p) => {
      const item = doc.paths[p] || {};
      METHODS.forEach((method) => {
        const op = item[method];
        if (!op || typeof op !== 'object') {
          return;
        }
        const byKey = new Map();
        [...(item.parameters || []), ...(op.parameters || [])].forEach((prm) => {
          if (prm && prm.name && prm.in !== 'header') {
            byKey.set(`${prm.in}:${prm.name}`, paramOf(prm));
          }
        });
        (p.match(/\{([^}]+)\}/g) || []).forEach((m) => {
          const n = m.slice(1, -1);
          if (!byKey.has(`path:${n}`)) {
            byKey.set(`path:${n}`, { name: n, in: 'path', required: true, type: '', example: '', description: '' });
          }
        });
        const files = [...(usage.get(`${name}/${op.operationId}`) || [])].sort();
        count++;
        used += files.length ? 1 : 0;
        rows.push({
          s: name,
          m: method.toUpperCase(),
          p,
          o: op.operationId || '',
          t: fixMojibake(op.summary || '').trim(),
          d: fixMojibake(op.description || '').trim(),
          g: groupOf(name, p),
          params: [...byKey.values()],
          f: files,
        });
      });
    });
    services.push({
      name,
      backend: backendName,
      url: backend ? backend.url : '',
      auth: authOf(backend),
      cred: backend ? backend.credentials : '',
      count,
      used,
    });
  });
  return { services, rows };
}

module.exports = { buildCatalog, fixMojibake, groupOf, scanUsage };
