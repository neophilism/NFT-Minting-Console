/**
 * Optional, local-only collector companion planner for Androids Of The Vine.
 * No persistence, uploading, offers, commitments, wallet signing or publication.
 * Each token's two projects are a fixed informational/creative selection.
 */
export const AOTV_TOKENS = 40;
export const AOTV_PROJECTS = 40;
export const PROJECTS_PER_TOKEN = 2;
const ID = /^PROJECT-(0[1-9]|[1-3][0-9]|40)$/;
const DIGEST = /^[a-f0-9]{64}$/;
const FORBIDDEN_FIELDS = new Set(['investment', 'equity', 'ownership', 'financing', 'valuation', 'returns', 'proceeds', 'allocation']);
function fail(message) { throw new Error(message); }
function record(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('Invalid ' + label);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.includes(key) || FORBIDDEN_FIELDS.has(key)) fail('Unsupported ' + label + ' field');
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !desc.enumerable || !('value' in desc)) fail('Unsupported ' + label + ' property');
  }
  return value;
}
function safeText(value, label, max = 180) {
  if (typeof value !== 'string' || !value.trim() || value.length > max ||
      /[\u0000-\u001f\u007f<>]/u.test(value) || /\p{Cf}/u.test(value)) fail('Invalid ' + label);
  return value.trim();
}
function safeArray(value, label, max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > max || Object.keys(value).length !== value.length) fail('Invalid ' + label);
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !d.enumerable || !('value' in d)) fail('Invalid ' + label);
  }
  if (Reflect.ownKeys(value).length !== value.length + 1) fail('Invalid ' + label);
  return value;
}
function markdown(value) { return value.replace(/[\\\`*_{}[\]()>#+.!|~-]/g, '\\$&'); }
function blankName(name) { return /^TO_BE_SELECTED_\d{2}$/.test(name); }
export function planCompanionCollection(config) {
  const row = record(config, ['enabled', 'projects', 'enabledTokenIds'], 'companion configuration');
  if (typeof row.enabled !== 'boolean') fail('Companion opt-in must be explicit');
  if (!row.enabled) return Object.freeze({
    enabled: false, balanced: false, allMaterialsDefined: false,
    assignments: Object.freeze([]), frequencies: Object.freeze({}), enabledTokenIds: Object.freeze([]),
  });
  const projects = safeArray(row.projects, 'project catalog', AOTV_PROJECTS);
  if (projects.length !== AOTV_PROJECTS) fail('Choose precisely 40 unique projects');
  const byId = new Map();
  const seen = new Set();
  const ordered = projects.map((entry, index) => {
    const p = record(entry, ['id', 'title', 'materials'], 'project');
    const id = safeText(p.id, 'project ID', 12);
    if (!ID.test(id) || id !== 'PROJECT-' + String(index + 1).padStart(2, '0') || byId.has(id)) fail('Project IDs must be ordered 01 to 40');
    const title = safeText(p.title, 'project title');
    const identity = title.normalize('NFKC').toLocaleLowerCase('en');
    if (seen.has(identity)) fail('Project names must be unique');
    seen.add(identity);
    const files = safeArray(p.materials ?? [], 'project materials', 12).map(v => {
      const m = record(v, ['name','sha256','delivery','license'], 'material');
      const name = safeText(m.name, 'material filename', 200);
      if (!/^[a-f0-9]{64}$/.test(m.sha256)) fail('Provide a SHA-256 for each defined material');
      const delivery = safeText(m.delivery, 'delivery method', 500);
      const license = safeText(m.license, 'personal-use license', 500);
      return Object.freeze({name, sha256:m.sha256, delivery, license});
    });
    const result = Object.freeze({id,title,materials:Object.freeze(files)});
    byId.set(id,result);
    return result;
  });
  const all = Array.from({length:AOTV_TOKENS},(_,i)=>i+1);
  const selected = row.enabledTokenIds === undefined ? all : safeArray(row.enabledTokenIds, 'enabled token IDs', AOTV_TOKENS);
  const enabledTokens = new Set();
  for (const id of selected) {
    if (!Number.isInteger(id) || id < 1 || id > AOTV_TOKENS || enabledTokens.has(id)) fail('Token IDs must be unique integers 1 through 40');
    enabledTokens.add(id);
  }
  const freq = Object.fromEntries(ordered.map(p=>[p.id,0]));
  const pairs = new Set();
  const assignments = [];
  for (let i=0; i<AOTV_TOKENS; i++) {
    const a=ordered[i], b=ordered[(i+1)%AOTV_PROJECTS];
    const pair=[a.id,b.id].sort().join(':');
    if (a.id===b.id || pairs.has(pair)) fail('Duplicate project pair');
    pairs.add(pair);
    if (!enabledTokens.has(i+1)) continue;
    freq[a.id]++; freq[b.id]++;
    assignments.push(Object.freeze({tokenId:i+1,projects:Object.freeze([a,b])}));
  }
  const balanced = assignments.length===AOTV_TOKENS && Object.values(freq).every(n=>n===2) && pairs.size===AOTV_TOKENS;
  const allMaterialsDefined = balanced && ordered.every(p => !blankName(p.title) && p.materials.length > 0);
  return Object.freeze({
    enabled:true, balanced, allMaterialsDefined,
    assignments:Object.freeze(assignments), frequencies:Object.freeze(freq),
    enabledTokenIds:Object.freeze([...enabledTokens].sort((a,b)=>a-b)),
  });
}
export function renderCompanionSchedule(plan, tokenId) {
  if (!plan || plan.enabled !== true) return null;
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > AOTV_TOKENS) fail('Invalid token ID');
  const row=plan.assignments.find(entry=>entry.tokenId===tokenId);
  if (!row) return null;
  const parts=[
    '# Schedule A — Androids Of The Vine, Token #' + String(tokenId).padStart(3,'0'),
    '',
    '> DRAFT ONLY — NOT APPROVED FOR SALE, MINTING, DELIVERY OR PUBLICATION. Complete and review the exact two material packages before use.',
    '',
    'This optional, fixed Companion Portfolio contains only the two informational and creative project packages listed for this token. The original buyer receives no equity, financing access, financial participation, updates or continuing services by reason of these materials.',
  ];
  row.projects.forEach((p,i)=>{
    parts.push('', '## Project '+(i+1)+': '+markdown(p.title), '', '**Project reference:** '+p.id, '');
    if (p.materials.length===0) {
      parts.push('- **Exact material files and versions:** TO BE COMPLETED',
        '- **SHA-256:** TO BE COMPLETED',
        '- **One-time delivery method:** TO BE COMPLETED',
        '- **IP / third-party permissions:** TO BE COMPLETED');
    } else {
      p.materials.forEach((m,k)=>{
        parts.push('- **File '+(k+1)+':** '+markdown(m.name),
          '  - SHA-256: '+m.sha256,
          '  - One-time delivery: '+markdown(m.delivery),
          '  - Permissions: '+markdown(m.license));
      });
    }
  });
  parts.push('', '**Recipient:** Original Purchaser only; benefits do not pass to later NFT owners.',
    '**Scope:** Viewing, listening and reading existing materials as permitted by the listed rights and applicable licenses; no implied commercial rights.',
    '**No future work:** No obligation to continue, launch, update, host or provide future project materials.',
    '**Approval:** TO BE COMPLETED BY CREATOR AND LEGAL/IP REVIEW.',
    '');
  return parts.join('\n');
}
export function renderCompanionExport(plan) {
  if (!plan?.enabled) return Object.freeze({enabled:false,balanced:false,tokens:[]});
  return Object.freeze({
    schemaVersion:1, collection:'Androids Of The Vine',
    enabled:true, balanced:plan.balanced,
    draft:true, notReadyForMint:true, tokenCount:AOTV_TOKENS,
    tokens:plan.assignments.map(row=>({tokenId:row.tokenId,projects:row.projects.map(p=>({id:p.id,title:p.title})),scheduleA:renderCompanionSchedule(plan,row.tokenId)})),
  });
}
