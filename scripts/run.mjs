// Wrapper khởi chạy electron-vite, đảm bảo ELECTRON_RUN_AS_NODE bị XÓA HẲN.
// Một số môi trường (CI, IDE, shell) set biến này khiến Electron chạy như Node thuần
// → require('electron') trả về string path, app crash với "Cannot read 'handle'".
// Electron coi mọi giá trị (kể cả "0") là bật, nên phải delete chứ không set 0.
import { spawn } from 'child_process'

const mode = process.argv[2] || 'dev'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE

const bin = process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'
const child = spawn(bin, [mode], { stdio: 'inherit', env, shell: true })
child.on('exit', (code) => process.exit(code ?? 0))
