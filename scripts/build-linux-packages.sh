#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-1.0.0}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$ROOT_DIR/release/bundle"
DEB_ROOT="$ROOT_DIR/release/deb-pkg"

if [ ! -d "$BUNDLE_DIR/app" ]; then
  echo "Bundle missing. Run 'node scripts/build-bundle.mjs' first."
  exit 1
fi

# 1. Build portable .tar.gz
tar -C "$ROOT_DIR/release" -czf "$ROOT_DIR/release/rolecard-studio-${VERSION}-linux-x64.tar.gz" bundle

# 2. Build .deb package (amd64)
rm -rf "$DEB_ROOT"
mkdir -p "$DEB_ROOT/DEBIAN"
mkdir -p "$DEB_ROOT/opt/rolecard-studio"
mkdir -p "$DEB_ROOT/usr/bin"
mkdir -p "$DEB_ROOT/etc/systemd/system"

cp -r "$BUNDLE_DIR/"* "$DEB_ROOT/opt/rolecard-studio/"
chmod +x "$DEB_ROOT/opt/rolecard-studio/start-rolecard.sh"

cat > "$DEB_ROOT/usr/bin/rolecard-studio" <<'EOF'
#!/usr/bin/env bash
exec /opt/rolecard-studio/start-rolecard.sh "$@"
EOF
chmod +x "$DEB_ROOT/usr/bin/rolecard-studio"

cat > "$DEB_ROOT/etc/systemd/system/rolecard-studio.service" <<'EOF'
[Unit]
Description=RoleCard Studio Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/rolecard-studio
Environment=HOST=0.0.0.0
Environment=PORT=3000
Environment=ROLECARD_DATA_DIR=/var/lib/rolecard-studio
Environment=ROLECARD_WEB_DIST=/opt/rolecard-studio/app/public
ExecStart=/opt/rolecard-studio/start-rolecard.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > "$DEB_ROOT/DEBIAN/control" <<EOF
Package: rolecard-studio
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: amd64
Maintainer: RoleCard Studio <noreply@github.com>
Description: AI-assisted RoleCard Studio (CCV3, Lorebook, Evolution & Sync)
EOF

cat > "$DEB_ROOT/DEBIAN/postinst" <<'EOF'
#!/usr/bin/env bash
set -e
mkdir -p /var/lib/rolecard-studio
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi
EOF
chmod 0755 "$DEB_ROOT/DEBIAN/postinst"

dpkg-deb --build "$DEB_ROOT" "$ROOT_DIR/release/rolecard-studio_${VERSION}_amd64.deb"
rm -rf "$DEB_ROOT"
echo "Linux packages built in $ROOT_DIR/release/"
