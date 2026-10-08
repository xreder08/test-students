import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const files=execFileSync('git',['ls-files','--cached'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
let bad=false;
for(const path of files){
  if(/(?:^|\/)\.env(?:\.|$)/.test(path)&&path!=='.env.example'){console.error('Forbidden environment file:',path);bad=true;}
  const content=readFileSync(path,'utf8');
  // Report names only; never echo matching credentials.
  if(/\bgsk_[A-Za-z0-9]{25,}|\bAIza[A-Za-z0-9_-]{25,}|\bgh[pousr]_[A-Za-z0-9]{20,}/.test(content)){console.error('Possible credential in:',path);bad=true;}
}
if(bad)process.exit(1);console.log(`Checked ${files.length} tracked files; no embedded credentials detected.`);
