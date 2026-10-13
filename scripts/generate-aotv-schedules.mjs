/** Generates offline DRAFT token-specific schedules. No wallet, upload or chain access. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {planCompanionCollection,renderCompanionExport} from '../console/companion/portfolio.mjs';
if (process.argv.length!==4) {
  console.error('Usage: npm run companion:aotv:generate -- <local-catalog.json> <output-directory>');
  process.exitCode=1;
} else {
  try {
    const [input,folder]=process.argv.slice(2).map(x=>path.resolve(x));
    const parsed=JSON.parse(await readFile(input,'utf8'));
    if (parsed?.schemaVersion!==1 || parsed.collection!=='Androids Of The Vine') throw new Error('Unsupported template/version');
    // Accept only the scoped fields, never any anonymous financial terms.
    const plan=planCompanionCollection({enabled:parsed.enabled,projects:parsed.projects,enabledTokenIds:parsed.enabledTokenIds});
    const exportFile=renderCompanionExport(plan);
    if (folder===input || folder==='/') throw new Error('Unsafe output directory');
    await mkdir(folder,{recursive:true,mode:0o700});
    await writeFile(path.join(folder,'companion-draft-manifest.json'),JSON.stringify(exportFile,null,2)+'\n',{flag:'wx',mode:0o600});
    for (const row of exportFile.tokens) {
      await writeFile(path.join(folder,'token-'+String(row.tokenId).padStart(3,'0')+'-SCHEDULE-A-DRAFT.md'),row.scheduleA,{flag:'wx',mode:0o600});
    }
    console.log('Wrote '+exportFile.tokens.length+' local DRAFT schedules. Enabled='+plan.enabled+'; fully balanced='+plan.balanced+'. No final rights or sale authorization.');
  } catch (error) {
    console.error('Companion draft generation refused: '+(error instanceof Error?error.message:'Invalid input'));
    process.exitCode=1;
  }
}
