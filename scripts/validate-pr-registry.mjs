import {readFile} from 'node:fs/promises';
import {parsePrRegistry} from '../registry/pr-contract.mjs';
const body = await readFile(new URL('../registry/prs.json', import.meta.url), 'utf8');
const repository = process.env.GITHUB_REPOSITORY || JSON.parse(body).repository;
const {document} = parsePrRegistry(body, repository);
const retired = JSON.parse(await readFile(new URL('../registry/roadmap.json', import.meta.url), 'utf8'));
if (retired.repository !== repository || retired.deprecated !== true || retired.redirectTo !== 'registry/prs.json' ||
    Object.hasOwn(retired, 'milestones') || Object.hasOwn(retired, 'units') || Object.hasOwn(retired, 'plannedPrCount'))
  throw new Error('Only registry/prs.json may contain the active PR plan');
const specification=await readFile(new URL('../docs/DEVELOPMENT_PLAN.md',import.meta.url),'utf8');
const headings=[...specification.matchAll(/^\\*\\*PR-(\\d{2})\\s/gm)].map(m=>'NFT-'+m[1]);
if (headings.length!==document.units.length || headings.some((id,index)=>document.units[index]?.id!==id))
  throw new Error('Approved plan and canonical registry work-unit IDs disagree');
console.log(`Valid PR registry: ${repository}, ${document.units.length} approved units; runtime acceptance is separate.`);
