// Copies the scripts from the repository root into this SuiteCloud project before validating or deploying:
//   node sync-files.js && suitecloud project:deploy
// Script records live in src/Objects; their deployments start in TESTING (owner only) until switched to RELEASED.
const fs = require('fs')
const path = require('path')

const repoRoot = path.join(__dirname, '..')
const target = path.join(__dirname, 'src/FileCabinet/SuiteScripts/rdnchl')
fs.rmSync(target, {recursive: true, force: true})
fs.mkdirSync(target, {recursive: true})
const files = fs.readdirSync(repoRoot).filter(f => f.endsWith('.js'))
files.forEach(f => fs.copyFileSync(path.join(repoRoot, f), path.join(target, f)))
console.log(`copied ${files.length} files to ${target}`)
