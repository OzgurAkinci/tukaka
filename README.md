# TUKAKA Database Studio

PostgreSQL, MySQL ve SQLite için masaüstü veritabanı istemcisi.

| Klasör | İçerik |
|---|---|
| `apps/web` | Arayüz (React, Vite, Tailwind, CodeMirror) |
| `apps/local-service` | Yerel API servisi (NestJS); bağlantılar, sorgular, geçmiş |
| `apps/desktop` | Electron kabuğu ve paketleme |
| `packages/contracts` | Arayüz ile servis arasında paylaşılan tipler |

## Geliştirme

```bash
pnpm install
pnpm dev:desktop
```

Servis `http://127.0.0.1:4317`, arayüz `http://127.0.0.1:5173` adresinde çalışır.
Uygulama verisi (bağlantılar, geçmiş) `~/Library/Application Support/TUKAKA Database Studio/studio.sqlite`
dosyasında, şifreler işletim sisteminin anahtar zincirinde tutulur.

Testler:

```bash
pnpm --filter local-service test
pnpm --filter local-service test:e2e
```

## Paketleme

```bash
pnpm package:desktop            # bu makine için yükleyici (macOS: dmg + zip)
pnpm package:desktop -- --win   # Windows x64 NSIS yükleyici (macOS'tan da üretilebilir)
pnpm package:desktop:dir        # yalnızca paketlenmemiş uygulama (hızlı test)
```

Çıktılar `apps/desktop/release/` klasörüne yazılır. Ek seçenekler: `--mac`, `--linux`,
`--x64`, `--arm64`, `--skip-build`.

Paketlenmiş uygulamada servis Electron içinde (`utilityProcess`) boş bir portta çalışır,
arayüz `app://tukaka` adresinden yüklenir ve her açılışta yeni bir oturum token'ı üretilir.

### Ortam değişkenleri

| Değişken | Açıklama |
|---|---|
| `TUKAKA_USER_DATA_DIR` | Masaüstü uygulamanın veri klasörü (test / taşınabilir kurulum) |
| `TUKAKA_DATA_DIR` | Servisin `studio.sqlite` klasörü |
| `TUKAKA_SESSION_TOKEN` | Servis token'ı; Electron otomatik üretir. Tanımsızsa doğrulama yalnızca geliştirmede kapalıdır |
| `TUKAKA_ALLOWED_ORIGINS` | CORS için ek origin'ler (virgülle ayrılmış) |
| `LOCAL_SERVICE_PORT` | Servis portu (`0` = boş port) |

### İmzalama

macOS paketi ad-hoc imzalıdır; başka bir Mac'te ilk açılışta Gatekeeper uyarısı verir
(sağ tık → Aç). Dağıtım için Apple Developer ID ile imzalama ve notarization,
Windows için kod imzalama sertifikası gerekir (`CSC_LINK` / `CSC_KEY_PASSWORD`).
