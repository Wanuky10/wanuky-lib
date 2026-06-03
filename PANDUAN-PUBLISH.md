# Panduan Publish wanuky-lib (Private — GitHub Packages)

Library ini bersifat **private** dan di-host di **GitHub Packages** — private npm registry
milik GitHub. Gratis hingga 500 MB, hanya bisa diinstall oleh akun yang diberi akses.

---

## Gambaran Umum Alur

```
wanuky-lib (private GitHub repo)
       │
       │ npm publish → GitHub Packages Registry
       │
       ▼
@wanuky10/template-engine   @wanuky10/web-editor
       │                         │
       └────────┬────────────────┘
                │ npm install (dengan PAT)
                ▼
         proyek-konsumen/
```

---

## Prasyarat Sekali Setup

### 1. Buat Private GitHub Repository

1. Buka https://github.com/new
2. Nama repo: `wanuky-lib`
3. Pilih **Private**
4. Jangan centang "Add README" (sudah ada file lokal)
5. Klik **Create repository**

> GitHub username: **Wanuky10** → scope yang digunakan: **`@wanuky1010`**

### 2. Buat Personal Access Token (PAT)

Token ini adalah "kata sandi" untuk publish dan install package dari GitHub Packages.

**Buat token untuk publish (simpan di mesin kamu sendiri):**

1. Buka https://github.com/settings/tokens/new (classic)
2. Note: `wanuky-lib publish`
3. Expiration: sesuai kebutuhan (90 hari atau No expiration)
4. Centang scope: `write:packages`, `read:packages`, `delete:packages`, `repo`
5. Klik **Generate token** — salin dan simpan di tempat aman

**Buat token untuk anggota tim (read-only):**

1. Langkah yang sama, tapi scope hanya: `read:packages`, `repo`
2. Note: `wanuky-lib read [nama-anggota]`

### 3. Simpan Token di Mesin Lokal (SEKALI per mesin)

Token TIDAK boleh ditulis di file project. Simpan di level user:

**Windows — PowerShell:**
```powershell
# Buka file C:\Users\[username]\.npmrc (buat jika belum ada)
# Tambahkan baris berikut:
"//npm.pkg.github.com/:_authToken=ghp_TOKEN_KAMU_DI_SINI" | Add-Content "$env:USERPROFILE\.npmrc"
"@wanuky10:registry=https://npm.pkg.github.com" | Add-Content "$env:USERPROFILE\.npmrc"
```

**Atau edit manual** file `C:\Users\Wanuky\.npmrc`:
```
@wanuky10:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=ghp_TOKEN_KAMU_DI_SINI
```

> File `~/.npmrc` (level user) tidak pernah masuk ke version control — aman.

---

## Langkah 1 — Setup Git & Push ke GitHub

Jalankan perintah berikut di terminal Windows dari folder `wanuky-lib`:

```powershell
# Hapus .git yang rusak jika ada, lalu inisialisasi ulang
Remove-Item -Recurse -Force .git -ErrorAction SilentlyContinue
git init -b main
git config user.name "Wahid Nur Hakim"
git config user.email "wahidnurhakim10@gmail.com"

# Tambahkan semua file
git add .
git status   # pastikan tidak ada file .env yang ikut

# Commit pertama
git commit -m "chore: initial commit wanuky-lib v1.1.0"

# Hubungkan ke GitHub (ganti URL sesuai repo yang baru dibuat)
git remote add origin https://github.com/[username-kamu]/wanuky-lib.git

# Push
git push -u origin main
```

---

## Langkah 2 — Publish ke GitHub Packages

Set token sebagai environment variable di terminal yang sama, lalu publish:

**PowerShell:**
```powershell
$env:NODE_AUTH_TOKEN = "ghp_TOKEN_KAMU_DI_SINI"

# Publish template-engine
cd packages\template-engine
npm publish

# Publish web-editor
cd ..\web-editor
npm publish

cd ..\..
```

**Bash / Git Bash:**
```bash
export NODE_AUTH_TOKEN="ghp_TOKEN_KAMU_DI_SINI"

cd packages/template-engine && npm publish
cd ../web-editor && npm publish
cd ../..
```

Setelah berhasil, kedua package muncul di:
`https://github.com/[username-kamu]/wanuky-lib/packages`

---

## Langkah 3 — Setup Proyek Konsumen

Lakukan ini sekali di setiap proyek yang menggunakan wanuky-lib.

### Tambahkan .npmrc di Root Proyek Konsumen

Buat file `.npmrc` (bukan di `~`, tapi di root proyek konsumen):

```
# .npmrc — proyek-konsumen/
@wanuky10:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

File ini aman di-commit — token tidak di-hardcode, dibaca dari environment.

### Install Package

```bash
# Set token (jika belum di ~/.npmrc)
export NODE_AUTH_TOKEN="ghp_TOKEN_READ_KAMU"   # Linux/Mac
# atau
$env:NODE_AUTH_TOKEN = "ghp_TOKEN_READ_KAMU"   # PowerShell

npm install @wanuky10/template-engine
npm install @wanuky10/web-editor
```

### Untuk CI/CD (GitHub Actions, dsb.)

Tambahkan token sebagai secret di repo konsumen (`NODE_AUTH_TOKEN`), lalu:

```yaml
# .github/workflows/deploy.yml
- name: Install dependencies
  run: npm install
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
```

---

## Penggunaan di Kode

### Template Engine (Server-side)

```js
// backend/config/templateEngine.js
import { buatEngine } from '@wanuky10/template-engine';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const engine = buatEngine({
  dirViews:   resolve(__dirname, '../../frontend/views'),
  dirLayouts: resolve(__dirname, '../../frontend/views/layouts'),
  cache: process.env.NODE_ENV === 'production',
});
```

### Web Editor (Browser-side — tanpa bundler)

Karena proyek menggunakan native ESM tanpa bundler, expose folder via Express
dan daftarkan di importmap HTML:

```js
// backend/app.js
app.use('/lib/web-editor', express.static(
  './node_modules/@wanuky10/web-editor/src'
));
```

```html
<!-- frontend/views/layouts/utama.html — di dalam <head> -->
<script type="importmap">
{
  "imports": {
    "@wanuky10/web-editor":           "/lib/web-editor/index.js",
    "@wanuky10/web-editor/rich-text": "/lib/web-editor/richTextEditor.js",
    "@wanuky10/web-editor/image":     "/lib/web-editor/imageEditor.js"
  }
}
</script>
```

```js
// frontend/public/js/fitur/artikel/editor.js
import { RichTextEditor } from '@wanuky10/web-editor';
import { ImageEditor }    from '@wanuky10/web-editor/image';
```

---

## Workflow Update Versi

Setiap kali ada perubahan pada library:

```bash
# 1. Bump versi di package yang berubah (patch/minor/major)
cd packages/template-engine
npm version patch   # → 1.1.0 menjadi 1.1.1

# 2. Jalankan test
npm test

# 3. Publish versi baru
export NODE_AUTH_TOKEN="ghp_TOKEN_KAMU"
npm publish

# 4. Kembali ke root, commit dan tag
cd ../..
git add packages/template-engine/package.json
git commit -m "chore: bump @wanuky10/template-engine ke v1.1.1"
git tag v1.1.1
git push && git push --tags

# 5. Di proyek konsumen — update ke versi terbaru
npm update @wanuky10/template-engine
```

---

## Memberi Akses ke Anggota Tim

1. **Tambahkan sebagai collaborator di GitHub repo:**
   GitHub repo → Settings → Collaborators → Add people

2. **Berikan token read-only** (lihat Langkah Prasyarat #2)

3. **Anggota tim setup di mesin mereka:**
   ```
   # ~/.npmrc (level user, satu kali per mesin)
   @wanuky10:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=ghp_TOKEN_READ_MEREKA
   ```

4. **Anggota tim install seperti biasa:**
   ```bash
   npm install @wanuky10/template-engine
   ```

---

## Checklist Sebelum Publish

```
[ ] Versi di package.json sudah di-bump (semver)
[ ] npm test lulus tanpa error
[ ] NODE_AUTH_TOKEN sudah di-set di terminal
[ ] Tidak ada file .env atau kredensial di dalam src/
[ ] PANDUAN.md diperbarui jika ada perubahan API
[ ] Git commit dan tag sudah dibuat
```

---

## Troubleshooting

**`npm publish` gagal: "401 Unauthorized"**
→ Token belum di-set atau expired. Buat token baru dan set ulang `NODE_AUTH_TOKEN`.

**`npm install` gagal di proyek konsumen: "404 Not Found"**
→ Pastikan `.npmrc` di root proyek konsumen sudah ada dan token valid.
→ Pastikan nama scope di `.npmrc` cocok (`@wanuky10`).

**`npm install` gagal: "403 Forbidden"**
→ Akun yang menginstall belum ditambahkan sebagai collaborator di repo GitHub.

**Scope tidak cocok saat publish**
→ GitHub Packages mengharuskan scope package (`@wanuky10`) sama dengan GitHub username
   atau nama organization. Jika berbeda, rename package di `package.json`.

---

*wanuky-lib — panduan publish private v1.1.0*
