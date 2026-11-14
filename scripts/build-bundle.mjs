import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(rootDir, 'release/bundle');

function ensureExists(relPath) {
  const full = resolve(rootDir, relPath);
  if (!existsSync(full)) {
    throw new Error(`Missing build artifact: ${relPath}. Run "pnpm build" first.`);
  }
  return full;
}

function readJson(relPath) {
  return JSON.parse(readFileSync(resolve(rootDir, relPath), 'utf8'));
}

function main() {
  ensureExists('packages/shared/dist/index.js');
  ensureExists('packages/core/dist/index.js');
  ensureExists('packages/mcp/dist/index.js');
  ensureExists('apps/server/dist/index.js');
  ensureExists('apps/web/dist/index.html');

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const appDir = resolve(outDir, 'app');
  mkdirSync(appDir, { recursive: true });

  // Copy compiled packages and server
  const copyTargets = [
    ['packages/shared/dist', 'app/packages/shared/dist'],
    ['packages/core/dist', 'app/packages/core/dist'],
    ['packages/mcp/dist', 'app/packages/mcp/dist'],
    ['apps/server/dist', 'app/apps/server/dist'],
    ['apps/web/dist', 'app/public'],
    ['plugins', 'plugins'],
    ['README.md', 'README.md'],
  ];

  for (const [srcRel, dstRel] of copyTargets) {
    cpSync(resolve(rootDir, srcRel), resolve(outDir, dstRel), { recursive: true });
  }

  // Write clean package.json manifests (without devDependencies)
  for (const pkgRel of [
    'packages/shared/package.json',
    'packages/core/package.json',
    'packages/mcp/package.json',
    'apps/server/package.json',
  ]) {
    const manifest = readJson(pkgRel);
    delete manifest.devDependencies;
    const dstPath = resolve(appDir, pkgRel);
    mkdirSync(dirname(dstPath), { recursive: true });
    writeFileSync(dstPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }

  const rootManifest = readJson('package.json');
  writeFileSync(
    resolve(appDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'rolecard-studio-runtime',
        version: rootManifest.version || '1.0.0',
        private: true,
        type: 'module',
        scripts: {
          start: 'node apps/server/dist/index.js',
        },
        engines: rootManifest.engines,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  writeFileSync(
    resolve(appDir, 'pnpm-workspace.yaml'),
    "packages:\n  - 'packages/*'\n  - 'apps/*'\n",
    'utf8',
  );

  writeFileSync(
    resolve(appDir, '.npmrc'),
    'node-linker=hoisted\nsymlink=false\nprefer-workspace-packages=true\n',
    'utf8',
  );

  console.info('[bundle] Installing hoisted production dependencies...');
  execSync('pnpm install --prod --no-frozen-lockfile', {
    cwd: appDir,
    stdio: 'inherit',
  });

  // Also link workspace packages inside hoisted node_modules/@rolecard/*
  const scopeDir = resolve(appDir, 'node_modules/@rolecard');
  mkdirSync(scopeDir, { recursive: true });
  for (const [pkgName, srcSub] of [
    ['shared', 'packages/shared'],
    ['core', 'packages/core'],
    ['mcp', 'packages/mcp'],
  ]) {
    const target = resolve(scopeDir, pkgName);
    rmSync(target, { recursive: true, force: true });
    cpSync(resolve(appDir, srcSub), target, { recursive: true });
  }

  // Windows launcher (.bat)
  writeFileSync(
    resolve(outDir, 'start-rolecard.bat'),
    `@echo off
setlocal
cd /d "%~dp0"
if "%PORT%"=="" set PORT=3000
if "%HOST%"=="" set HOST=127.0.0.1
if "%ROLECARD_DATA_DIR%"=="" set ROLECARD_DATA_DIR=%~dp0data
set ROLECARD_WEB_DIST=%~dp0app\\public
set NODE_EXE=node
if exist "%~dp0runtime\\node.exe" set NODE_EXE="%~dp0runtime\\node.exe"
echo [RoleCard Studio] Starting on http://%HOST%:%PORT% ...
start "" http://%HOST%:%PORT%
%NODE_EXE% "%~dp0app\\apps\\server\\dist\\index.js"
`,
    'utf8',
  );

  // Linux / macOS launcher (.sh)
  writeFileSync(
    resolve(outDir, 'start-rolecard.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
export PORT="\${PORT:-3000}"
export HOST="\${HOST:-127.0.0.1}"
export ROLECARD_DATA_DIR="\${ROLECARD_DATA_DIR:-$ROOT_DIR/data}"
export ROLECARD_WEB_DIST="$ROOT_DIR/app/public"
NODE_BIN="node"
if [ -x "$ROOT_DIR/runtime/bin/node" ]; then
  NODE_BIN="$ROOT_DIR/runtime/bin/node"
fi
echo "[RoleCard Studio] Starting on http://$HOST:$PORT ..."
exec "$NODE_BIN" "$ROOT_DIR/app/apps/server/dist/index.js"
`,
    { encoding: 'utf8', mode: 0o755 },
  );

  // Linux systemd service installer
  writeFileSync(
    resolve(outDir, 'install-systemd.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="\${INSTALL_DIR:-/opt/rolecard-studio}"
DATA_DIR="\${DATA_DIR:-/var/lib/rolecard-studio}"
SERVICE_FILE="/etc/systemd/system/rolecard-studio.service"

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 sudo 运行此安装脚本: sudo bash install-systemd.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$INSTALL_DIR" "$DATA_DIR"
cp -r "$SCRIPT_DIR/"* "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/start-rolecard.sh"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=RoleCard Studio Service
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
Environment=HOST=0.0.0.0
Environment=PORT=3000
Environment=ROLECARD_DATA_DIR=$DATA_DIR
Environment=ROLECARD_WEB_DIST=$INSTALL_DIR/app/public
ExecStart=$INSTALL_DIR/start-rolecard.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now rolecard-studio
echo "[RoleCard Studio] 已安装并启动服务，访问 http://127.0.0.1:3000"
`,
    { encoding: 'utf8', mode: 0o755 },
  );

  console.info(`[bundle] Portable bundle ready at ${outDir}`);
}

main();
