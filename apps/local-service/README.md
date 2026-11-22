# TUKAKA Database Studio

Modern, cross-platform ve offline-first veritabanı yönetim uygulaması.

TUKAKA Database Studio; PostgreSQL, MySQL/MariaDB ve SQLite gibi farklı veritabanlarını tek bir arayüzden yönetmeyi hedefleyen bağımsız bir Database Studio uygulamasıdır.

Uygulama web arayüzü ve masaüstü uygulaması olarak çalışabilecek şekilde tasarlanmaktadır.

## 1. Teknolojiler

| Teknoloji | Kullanım |
|---|---|
| Node.js | JavaScript çalışma ortamı |
| pnpm | Paket yönetimi |
| TypeScript | Tip güvenli geliştirme |
| Turborepo | Monorepo yönetimi |
| React | Web arayüzü |
| Vite | Frontend geliştirme sunucusu |
| Tailwind CSS 4 | UI stilleri |
| Lucide React | İkonlar |
| CodeMirror 6 | SQL editörü |
| Electron | Masaüstü uygulaması |
| NestJS | Local Service API |
| better-sqlite3 | Yerel uygulama veritabanı |

## 2. Sistem gereksinimleri

Geliştirme ortamı için:

- Node.js
- pnpm
- Git

Kontrol etmek için:

```bash
node -v
npm -v
pnpm -v
git --version
```

Mevcut geliştirme ortamında kullanılan sürümler:

```text
Node.js: 26.13.1
npm:     11.20.0
pnpm:    10.34.9
Git:     2.39.5
```

## 3. Projeyi indirme

```bash
git clone <REPOSITORY_URL>
cd tukaka-database-studio
```

Henüz uzak Git deposu oluşturulmadıysa mevcut proje klasöründe çalışmaya devam edilebilir.

## 4. Bağımlılıkları yükleme

Projenin ana dizininde:

```bash
pnpm install
```

Bu komut monorepo içerisindeki uygulamaların ve ortak paketlerin bağımlılıklarını yükler.

Native bağımlılıkların kurulumunda pnpm build script izinleri sorarsa yalnızca güvenilir ve gerekli paketleri onaylayın.

`better-sqlite3` native modülünü derlemek gerekirse:

```bash
pnpm approve-builds
pnpm rebuild better-sqlite3
```

## 5. Proje yapısı

```text
tukaka-database-studio/
│
├── apps/
│   ├── web/
│   │   └── React + Vite uygulaması
│   │
│   ├── desktop/
│   │   └── Electron masaüstü uygulaması
│   │
│   └── local-service/
│       └── NestJS + SQLite yerel API
│
├── packages/
│   ├── ui/
│   ├── contracts/
│   ├── database-core/
│   ├── database-drivers/
│   ├── sql-editor/
│   └── config/
│
├── infrastructure/
├── docs/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

### Uygulamaların sorumlulukları

**Web**

React tabanlı kullanıcı arayüzü. Tarayıcı üzerinden çalışır.

**Desktop**

Electron tabanlı masaüstü kabuğu. Web arayüzünü masaüstünde çalıştırır.

**Local Service**

NestJS tabanlı yerel servis. SQLite veritabanının tek sahibidir. Web ve Desktop uygulamaları bu servise localhost üzerinden bağlanacaktır.

## 6. Geliştirme ortamını başlatma

### 6.1. Local Service

Birinci Terminal:

```bash
pnpm --filter local-service start:dev
```

Varsayılan adres:

```text
http://127.0.0.1:4317
```

Sağlık kontrolü:

```bash
curl http://127.0.0.1:4317/health
```

Beklenen cevap:

```json
{
  "status": "ok",
  "service": "local-service",
  "database": "connected",
  "timestamp": "..."
}
```

### 6.2. Web uygulaması

İkinci Terminal:

```bash
pnpm --filter web dev
```

Varsayılan geliştirme adresi:

```text
http://localhost:5173
```

### 6.3. Desktop uygulaması

Üçüncü Terminal yerine tek komutla web geliştirme sunucusu ve Electron başlatılabilir:

```bash
pnpm dev:desktop
```

Bu komut mevcut geliştirme yapılandırmasında Vite ve Electron süreçlerini birlikte başlatır.

**Not:** Şu an `dev:desktop` komutu Local Service'i otomatik başlatmıyor. Servis API'sini kullanacak özellikleri geliştirirken Local Service'i ayrıca çalıştırmalısınız. Bu entegrasyon sonraki geliştirme aşamalarında tamamlanacaktır.

## 7. Local SQLite veritabanı

Uygulama verileri proje klasöründe tutulmaz. İşletim sisteminin uygulama veri dizininde saklanır.

Veritabanı dosyası:

```text
studio.sqlite
```

Varsayılan konumlar:

**macOS**

```text
~/Library/Application Support/TUKAKA Database Studio/studio.sqlite
```

**Windows**

```text
%APPDATA%/TUKAKA Database Studio/studio.sqlite
```

**Linux**

```text
~/.local/share/tukaka-database-studio/studio.sqlite
```

Test veya özel geliştirme ortamında veri klasörü `TUKAKA_DATA_DIR` ortam değişkeniyle değiştirilebilir.

Örnek:

```bash
TUKAKA_DATA_DIR=/tmp/tukaka-test pnpm --filter local-service start:dev
```

## 8. Mimari prensipler

- Uygulama internet bağlantısı veya merkezi sunucu gerektirmeden çalışacak şekilde tasarlanır.
- Local Service yalnızca `127.0.0.1` adresini dinler.
- Web ve Desktop aynı bilgisayarda aynı SQLite veritabanını kullanır.
- SQLite veritabanının sahibi Local Service'tir.
- Veritabanı bağlantı sürücüleri frontend tarafında çalıştırılmaz.
- Bağlantı şifreleri SQLite içerisinde düz metin olarak saklanmaz.
- Şifreler işletim sisteminin güvenli kimlik bilgisi deposunda tutulur.
- Bağlantı profilleri JSON olarak dışarı aktarılıp içeri alınabilir.
- SQL export/import işlemleri veritabanı şeması ve verileri içindir; bağlantı profilleri için JSON kullanılır.

## 9. Geliştirme komutları

Ana dizinden:

```bash
# Tüm bağımlılıkları yükle
pnpm install

# Web uygulamasını başlat
pnpm --filter web dev

# Local Service'i başlat
pnpm --filter local-service start:dev

# Desktop uygulamasını başlat
pnpm dev:desktop

# Local Service TypeScript kontrolü
pnpm --filter local-service exec tsc --noEmit

# Web uygulaması TypeScript kontrolü
pnpm --filter web exec tsc --noEmit

# Monorepo build
pnpm build
```

## 10. Geliştirme durumu

### Tamamlananlar

- [x] pnpm monorepo kurulumu
- [x] Turborepo yapılandırması
- [x] React + Vite kurulumu
- [x] Tailwind CSS 4 kurulumu
- [x] Lucide React kurulumu
- [x] CodeMirror 6 SQL editörü
- [x] Dark Database Studio arayüzü
- [x] Dinamik bağlantı oluşturma arayüzü (şimdilik mock state)
- [x] Electron masaüstü uygulaması
- [x] NestJS Local Service
- [x] Local Service'in 127.0.0.1 üzerinde çalışması
- [x] better-sqlite3 kurulumu ve çalışma testi
- [x] Platforma göre SQLite dosya konumu
- [x] SQLite başlangıç şeması
- [x] SQLite sağlık kontrolü API'si
- [x] Bağlantı profilleri tablosu

### Devam edenler

- [ ] Bağlantı profili CRUD API'leri
- [ ] DTO ve veri doğrulama
- [ ] İşletim sistemi güvenli parola deposu entegrasyonu
- [ ] React arayüzünü Local Service'e bağlama
- [ ] Gerçek PostgreSQL bağlantısı
- [ ] Gerçek MySQL/MariaDB bağlantısı
- [ ] SQLite dosya bağlantısı
- [ ] SQL sorgusu çalıştırma
- [ ] Sonuç grid'i ve veri dışa aktarma
- [ ] Sorgu geçmişi
- [ ] Bağlantı profili JSON import/export
- [ ] Electron üzerinden Local Service'i otomatik başlatma
- [ ] Web ve Desktop için ortak yerel servis yönetimi
- [ ] Uygulama paketleme ve dağıtım

---

**Proje:** TUKAKA Database Studio  
**Sürüm:** 0.1.0  
**Durum:** Aktif geliştirme