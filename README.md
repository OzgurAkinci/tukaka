# TUKAKA Database Studio

PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle, IBM i (AS400) ve ClickHouse için masaüstü
veritabanı istemcisi (macOS ve Windows).

| Klasör | İçerik |
|---|---|
| `apps/web` | Arayüz (React, Vite, Tailwind, CodeMirror) |
| `apps/local-service` | Yerel API servisi (NestJS); bağlantılar, sorgular, geçmiş |
| `apps/desktop` | Electron kabuğu ve paketleme |
| `apps/local-service/java` | IBM i için JDBC köprüsü (Java; jt400 sürücüsünü kullanır) |
| `packages/contracts` | Arayüz ile servis arasında paylaşılan tipler |

## Özellikler

- **Bağlantılar:** SSL modları, SSH tüneli (şifre ya da özel anahtar; sunucu anahtarı ilk
  bağlantıda sabitlenir), şifreler sistem anahtar zincirinde. SQLite için dosya seçici.
- **SQL editörü:** sekmeler, bağlantıya göre sözdizimi, şema tabanlı otomatik tamamlama,
  ⌘/Ctrl+Enter (seçim ya da tümü), ⌘/Ctrl+Shift+Enter ile EXPLAIN, iptal, satır limiti,
  geçmiş ve kayıtlı sorgular, CSV/JSON dışa aktarma.
- **Data Viewer:** sayfalama, sıralama, filtreler; satır ekleme/düzenleme/silme. Değişiklikler
  SQL önizlemesiyle onaylanır ve tek transaction içinde uygulanır; birincil anahtarla
  güncellenen/silinen her satır tam olarak 1 satırı etkilemelidir, aksi halde hepsi geri alınır.
- **Yapı:** kolonlar, indeksler, yabancı anahtarlar, DDL; fonksiyon/prosedür tanımları;
  tablo tasarımcısı (CREATE/ALTER SQL'i incelemek için editörde açılır, otomatik çalışmaz).
- **Görselleştirme:** EXPLAIN plan ağacı (maliyet çubuklarıyla), ER diyagramı (SVG dışa aktarma).
- **Tema:** koyu, açık ya da sistem.

### Veritabanı desteği

| Özellik | PostgreSQL | MySQL / MariaDB | SQLite | SQL Server | Oracle | IBM i (AS400) | ClickHouse |
|---|---|---|---|---|---|---|---|
| Satır düzenleme | ✓ | ✓ | ✓ | ✓ | ✓ | ✓¹ | — (transaction yok) |
| Sorgu iptali / zaman aşımı | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ |
| Fonksiyon/prosedürler | ✓ | ✓ | — | ✓ | ✓ | ✓ | — |
| Yabancı anahtar / ER ilişkileri | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| EXPLAIN | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| SSL | ✓ | ✓ | — | ✓ | ✓ (TCPS) | ✓ | ✓ (HTTPS) |
| SSH tüneli | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ |
| Varsayılan port | 5432 | 3306 | — | 1433 | 1521 | 8471 | 8123 |

¹ IBM i'de satır düzenleme commitment control kullanır; tabloların günlüklenmiş (journaled)
olması gerekir.

**Doğrulama durumu:** PostgreSQL, MySQL ve SQLite gerçek veritabanlarıyla kullanılıyor.
SQL Server, Oracle, IBM i ve ClickHouse sürücüleri birim testleriyle (ClickHouse için HTTP
protokolü taklidiyle, IBM i JDBC köprüsü için SQLite JDBC sürücüsüyle) doğrulandı; gerçek
sunucularla henüz test edilmedi.

### IBM i (AS400) notları

- Bağlantı IBM'in açık kaynak **JTOpen (jt400)** JDBC sürücüsüyle yapılır. Servis, küçük bir
  Java köprüsünü (`apps/local-service/java`) başlatıp onunla konuşur.
- **Java gerekir (11+).** Masaüstü paketine Eclipse Temurin 21 JRE gömülüdür; kullanıcının ayrıca
  Java kurması gerekmez. Geliştirmede JDK gerekir (bkz. Geliştirme).
- "Default library" alanı varsayılan kütüphanedir (SQL şeması, ör. `QGPL`). Adlandırma SQL
  biçimindedir: `KUTUPHANE.TABLO`.
- Port varsayılan (8471, TLS için 9471) bırakılırsa jt400 port eşleyiciyi (449) kullanır.
- Kütüphaneler, tablolar, kolonlar, indeksler ve kısıtlar `QSYS2` kataloğundan okunur; DDL
  `QSYS2.GENERATE_SQL` ile üretilir. Sistem kütüphaneleri (`Q*`, `SYS*`; `QGPL` hariç) gizlenir.
- SQL PL blokları (`BEGIN … END`, `CREATE PROCEDURE …`) tek başına `/` içeren satırla bitirilir.
- Sorgu planı (EXPLAIN) JDBC ile alınamadığından desteklenmez; IBM i Access Client Solutions'taki
  Visual Explain kullanılabilir.

### Oracle notları

- Oracle Instant Client **gerekmez**: `oracledb` sürücüsü saf JavaScript "Thin" modunda çalışır
  (Oracle Database 12.1 ve üzeri).
- Bağlantıdaki "Service name" alanı servis adıdır (ör. Oracle Free için `FREEPDB1`).
- Şemalar Oracle kullanıcılarıdır; yalnızca sistem dışı ve nesnesi olan kullanıcılar listelenir.
- PL/SQL blokları (`BEGIN … END;`, `CREATE FUNCTION …`) SQL Developer'daki gibi tek başına `/`
  içeren satırla bitirilir; düz SQL ifadeleri `;` ile ayrılabilir.
- Editörden çalışan ifadeler otomatik commit edilir (diğer veritabanlarıyla tutarlı). Data Viewer
  değişiklikleri ise tek transaction içinde, onaydan sonra uygulanır.
- DDL `DBMS_METADATA` ile alınır; başka şemaların nesneleri için yetki yoksa kolon ve
  kısıtlardan üretilir.

## Geliştirme

```bash
pnpm install
pnpm --filter local-service build:java   # IBM i desteği için (JDK 11+ gerekir)
pnpm dev:desktop
```

`build:java`, jt400 sürücüsünü Maven Central'dan indirip SHA-1 özetini doğrular
(`apps/local-service/java/lib/`, git'e girmez) ve JDBC köprüsünü derler. JDK yoksa IBM i
dışındaki her şey normal çalışır.

Servis `http://127.0.0.1:4317`, arayüz `http://127.0.0.1:5173` adresinde çalışır.

Uygulama verisi (bağlantılar, sorgu geçmişi, kayıtlı sorgular) `studio.sqlite` dosyasındadır:

| Platform | Klasör |
|---|---|
| macOS | `~/Library/Application Support/TUKAKA Database Studio/` |
| Windows | `%APPDATA%\TUKAKA Database Studio\` |
| Linux | `~/.local/share/tukaka-database-studio/` |

Veritabanı ve SSH şifreleri bu dosyada değil, işletim sisteminin güvenli kasasında
(macOS Keychain, Windows Credential Manager, Secret Service) tutulur. Şema değişiklikleri
uygulama açılırken otomatik olarak uygulanır (`apps/local-service/src/database/migrations.ts`).

Testler ve kontroller:

```bash
pnpm --filter local-service build:java:test   # köprü testleri için sqlite-jdbc de indirilir
pnpm --filter local-service test
pnpm --filter local-service test:e2e
pnpm --filter local-service lint
pnpm --filter web lint
```

## Paketleme

Güncel kurulum dosyalarının hepsini tek komutla üretmek için (önce eski çıktılar silinir):

```bash
pnpm package:all
```

Bu komut web arayüzünü ve servisi derler, ardından şunları üretir:

- `TUKAKA Database Studio-<sürüm>-arm64.dmg` ve `-arm64-mac.zip` (macOS, Apple Silicon)
- `TUKAKA Database Studio-Setup-<sürüm>-x64.exe` (Windows yükleyici)
- `TUKAKA Database Studio-Portable-<sürüm>-x64.exe` (Windows, kurulumsuz tek dosya)
- `TUKAKA Database Studio-<sürüm>-x64-win.zip` (Windows, kurulumsuz klasör)

Tek platform için:

```bash
pnpm package:mac
pnpm package:win
pnpm package:desktop:dir   # yalnızca paketlenmemiş uygulama (hızlı test)
```

Çıktılar `apps/desktop/release/` klasörüne yazılır. Dosya adlarındaki sürüm, kökteki
`package.json` dosyasının `version` alanından gelir; yeni bir sürüm çıkarmadan önce onu artırın.

Betiğin ek seçenekleri: `--mac`, `--win`, `--linux`, `--x64`, `--arm64`, `--dir`,
`--skip-build`, `--clean`. Örneğin Intel Mac için:

```bash
node apps/desktop/scripts/package.mjs --mac --x64
```

Native modüller (`better-sqlite3`, keyring) her platform için hazır binary'lerle geldiğinden
Windows yükleyicisi macOS üzerinde de üretilebilir.

Paketleme IBM i desteği için JDBC köprüsünü derler (JDK gerekir), jt400'ü ekler ve hedef
platform için Eclipse Temurin 21 JRE'yi Adoptium'dan indirip (SHA-256 doğrulamalı,
`apps/desktop/build/cache` altında önbellekli) gömer. Bu, paketi yaklaşık 45 MB büyütür;
istenmezse `--no-jre` ile atlanabilir (o durumda kullanıcının Java'sı kullanılır).

Paketlenmiş uygulamada servis Electron içinde (`utilityProcess`) boş bir portta çalışır,
arayüz `app://tukaka` adresinden yüklenir ve her açılışta yeni bir oturum token'ı üretilir.

### Uygulama ikonu

İkonun kaynağı `apps/desktop/build-resources/icon.svg` dosyasıdır. Değiştirdikten sonra macOS'ta
PNG/ICNS/ICO dosyalarını ve web favicon'unu yeniden üretin (Chrome gerekir):

```bash
node apps/desktop/scripts/build-icons.mjs
```

### Windows'ta kurulumsuz (portable) kullanım

İki seçenek vardır; ikisi de yönetici yetkisi ya da kurulum gerektirmez:

| | Portable `.exe` | `.zip` |
|---|---|---|
| Kullanım | Çift tıklayıp çalıştırın | Bir klasöre açıp içindeki `TUKAKA Database Studio.exe`'yi çalıştırın |
| Uygulama verisi | Exe'nin yanındaki `TUKAKA Database Studio Data` klasörü (USB bellekle taşınır) | `%APPDATA%\TUKAKA Database Studio\` |
| Açılış | Her açılışta geçici klasöre açıldığı için birkaç saniye daha yavaş | Hızlı |

Notlar:

- Portable exe'yi yazma izni olan bir klasörde (masaüstü, belgeler, USB bellek) çalıştırın;
  verisi yanına yazılır.
- Bağlantı ve SSH şifreleri güvenlik gereği o bilgisayarın Windows Kimlik Bilgisi
  Yöneticisi'nde tutulur ve taşınmaz. Portable uygulamayı başka bir bilgisayarda açtığınızda
  bağlantılar listede görünür ama şifrelerin yeniden girilmesi gerekir.
- İmzasız oldukları için ilk açılışta Windows SmartScreen uyarısı çıkabilir
  ("Ek bilgi" → "Yine de çalıştır").

### Ortam değişkenleri

| Değişken | Açıklama |
|---|---|
| `TUKAKA_USER_DATA_DIR` | Masaüstü uygulamanın veri klasörü (test / taşınabilir kurulum) |
| `TUKAKA_DATA_DIR` | Servisin `studio.sqlite` klasörü |
| `TUKAKA_SESSION_TOKEN` | Servis token'ı; Electron otomatik üretir. Tanımsızsa doğrulama yalnızca geliştirmede kapalıdır |
| `TUKAKA_ALLOWED_ORIGINS` | CORS için ek origin'ler (virgülle ayrılmış) |
| `LOCAL_SERVICE_PORT` | Servis portu (`0` = boş port) |
| `TUKAKA_JAVA_HOME` | IBM i köprüsü için Java (paketlenmiş uygulamada gömülü JRE); yoksa `JAVA_HOME`, sonra `PATH` |
| `TUKAKA_JAVA_DIR` | JDBC köprüsü ve sürücü jar'larının klasörü (varsayılan: `apps/local-service/java`) |

### İmzalama

macOS paketi ad-hoc imzalıdır; başka bir Mac'te ilk açılışta Gatekeeper uyarısı verir
(sağ tık → Aç). Dağıtım için Apple Developer ID ile imzalama ve notarization,
Windows için kod imzalama sertifikası gerekir (`CSC_LINK` / `CSC_KEY_PASSWORD`).
